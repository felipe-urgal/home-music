import { createHash, randomUUID } from 'node:crypto';
import type { Track } from '@home-music/shared';
import {
  type LibraryAssistantCapability,
  type LibraryAssistantConfidenceBand,
  type LibraryAssistantEvidence,
  type LibraryAssistantProvenance,
  type LibraryAssistantReasonCode,
  type LibraryAssistantRun,
  type LibraryAssistantSuggestionStatus,
  type LibraryAssistantSuggestionTarget
} from '@home-music/shared/library-assistant';
import { sanitizeOperationError } from './admin-operation-history.js';
import {
  HeavyWorkQueueAbortedError,
  type HeavyWorkQueue
} from './heavy-work-queue.js';
import type { LongJobObservability, LongJobRun } from './long-job-observability.js';
import type { LibraryAssistantIncrementalIndex } from './library-assistant-incremental-index.js';
import type {
  LibraryAssistantPersistentQueue,
  LibraryAssistantWorkItem
} from './library-assistant-persistent-queue.js';
import type { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import type {
  LibraryAssistantStore,
  LibraryAssistantStoredSuggestionInput
} from './library-assistant-store.js';

const MAX_ANALYZERS_PER_CAPABILITY = 8;
const MAX_SUGGESTIONS_PER_LEGACY_RUN = 500;
const MAX_OWNER_ID_LENGTH = 128;
const INVALIDATION_BATCH_SIZE = 500;
const DEFAULT_RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000
] as const;
const TRANSIENT_ERROR_CODES = new Set([
  'provider-timeout',
  'provider-rate-limited',
  'provider-request-failed',
  'econnreset',
  'econnrefused',
  'etimedout',
  'eai_again',
  'enotfound',
  'und_err_connect_timeout',
  'und_err_headers_timeout',
  'und_err_socket'
]);

type LibraryAssistantLibrarySource = {
  listTracks: () => Track[];
  revision: () => number;
};

export type LibraryAssistantSuggestionDraft = {
  capability: LibraryAssistantCapability;
  confidence: LibraryAssistantConfidenceBand;
  reasonCodes: LibraryAssistantReasonCode[];
  evidence: LibraryAssistantEvidence[];
  provenance: LibraryAssistantProvenance;
  target: LibraryAssistantSuggestionTarget;
};

export type LibraryAssistantAnalyzer = {
  id: string;
  capability: LibraryAssistantCapability;
  analyze: (context: {
    runId: string;
    tracks: readonly Track[];
    signal?: AbortSignal;
    providers: LibraryAssistantProviderGateway;
  }) => Promise<readonly LibraryAssistantSuggestionDraft[]>;
};

type LibraryAssistantServiceOptions = {
  store: LibraryAssistantStore;
  queue: HeavyWorkQueue;
  observability: LongJobObservability;
  providers: LibraryAssistantProviderGateway;
  library: LibraryAssistantLibrarySource;
  analyzers?: readonly LibraryAssistantAnalyzer[];
  workQueue?: LibraryAssistantPersistentQueue;
  incrementalIndex?: LibraryAssistantIncrementalIndex;
  retryDelaysMs?: readonly number[];
  now?: () => Date;
  createId?: () => string;
  premiseSignature?: (capability: LibraryAssistantCapability, track: Track) => string;
};

type LibraryAssistantStartRunOptions = {
  full?: boolean;
};

function safeOwnerId(value: string | null | undefined) {
  const clean = value?.trim();
  if (!clean || clean.length > MAX_OWNER_ID_LENGTH) return 'system';
  return clean;
}

function defaultPremiseSignature(capability: LibraryAssistantCapability, track: Track) {
  const common = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist
  };
  const premise = capability === 'artwork'
    ? {
        ...common,
        hasCover: track.hasCover,
        coverVersion: track.coverVersion ?? null
      }
    : {
        ...common,
        duration: track.duration
      };
  return createHash('sha256').update(JSON.stringify({ capability, premise })).digest('hex');
}

function metadataPremiseSignature(track: Track, target: Extract<LibraryAssistantSuggestionTarget, { capability: 'metadata' }>) {
  return createHash('sha256').update(JSON.stringify({
    capability: 'metadata',
    trackId: track.id,
    field: target.field,
    value: track[target.field]
  })).digest('hex');
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'analysis-failed';
  const raw = String(error.code || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(raw) ? raw : 'analysis-failed';
}

function httpStatus(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  for (const key of ['status', 'statusCode']) {
    if (!(key in error)) continue;
    const value = Number(error[key as keyof typeof error]);
    if (Number.isInteger(value)) return value;
  }
  return null;
}

function isTransientFailure(error: unknown) {
  const code = errorCode(error);
  if (TRANSIENT_ERROR_CODES.has(code)) return true;
  const status = httpStatus(error);
  if (status === 408 || status === 425 || status === 429 || (status != null && status >= 500)) return true;
  return error instanceof TypeError && /fetch|network|socket|connect/i.test(error.message);
}

function isTerminal(run: LibraryAssistantRun) {
  return run.status === 'completed'
    || run.status === 'failed'
    || run.status === 'cancelled'
    || run.status === 'stale';
}

function isCancellation(error: unknown, signal?: AbortSignal) {
  return signal?.aborted
    || error instanceof HeavyWorkQueueAbortedError
    || (error instanceof Error && (
      error.name === 'AbortError'
      || error.name === 'LibraryAssistantProviderAbortedError'
    ));
}

export class LibraryAssistantService {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly premiseSignature: (capability: LibraryAssistantCapability, track: Track) => string;
  private readonly retryDelaysMs: readonly number[];
  private readonly analyzersByCapability = new Map<LibraryAssistantCapability, LibraryAssistantAnalyzer[]>();
  private readonly analyzersById = new Map<string, LibraryAssistantAnalyzer>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly scheduled = new Map<string, Promise<void>>();
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  private closing = false;

  constructor(private readonly options: LibraryAssistantServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.premiseSignature = options.premiseSignature ?? defaultPremiseSignature;
    this.retryDelaysMs = (options.retryDelaysMs?.length ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS)
      .map(value => Math.max(1, Math.trunc(value)));

    for (const analyzer of options.analyzers ?? []) {
      if (!analyzer.id.trim() || analyzer.id.length > 128) throw new TypeError('Analyzer do assistente exige id válido.');
      if (this.analyzersById.has(analyzer.id)) throw new TypeError(`Analyzer duplicado: ${analyzer.id}.`);
      const current = this.analyzersByCapability.get(analyzer.capability) ?? [];
      if (current.length >= MAX_ANALYZERS_PER_CAPABILITY) {
        throw new RangeError(`Muitos analyzers registrados para ${analyzer.capability}.`);
      }
      current.push(analyzer);
      this.analyzersByCapability.set(analyzer.capability, current);
      this.analyzersById.set(analyzer.id, analyzer);
    }

    if (options.workQueue) {
      for (const run of options.store.listRuns(200)) {
        if (run.status === 'queued' || run.status === 'running') {
          this.schedulePersistentRun(run.id, run.capability, run.libraryRevision, 'system');
        }
      }
      return;
    }

    for (const run of options.store.listRuns(200)) {
      if (run.status === 'failed' && run.error?.code === 'interrupted') {
        this.invalidateOpenSuggestions(run.id);
      }
    }
  }

  startRun(
    capability: LibraryAssistantCapability,
    ownerId?: string | null,
    options: LibraryAssistantStartRunOptions = {}
  ) {
    const libraryRevision = this.options.library.revision();
    if (!Number.isSafeInteger(libraryRevision) || libraryRevision < 0) {
      throw new Error('Revision atual da biblioteca é inválida.');
    }
    const tracks = this.options.library.listTracks().map(track => ({ ...track }));
    const runId = `assistant-${this.createId()}`;
    const createdAt = this.now().toISOString();
    const run = this.options.store.createRun({
      id: runId,
      capability,
      libraryRevision,
      createdAt
    });

    if (this.options.workQueue) {
      const analyzers = this.analyzersByCapability.get(capability) ?? [];
      let trackIds = tracks.map(track => track.id);
      if (this.options.incrementalIndex) {
        try {
          trackIds = this.options.incrementalIndex.planRun({
            runId,
            capability,
            analyzerIds: analyzers.map(analyzer => analyzer.id),
            tracks: tracks.map(track => ({
              id: track.id,
              premiseSignature: this.premiseSignature(capability, track)
            })),
            forceFull: options.full === true,
            updatedAt: createdAt
          });
        } catch {
          // O índice incremental é uma otimização derivada. Em caso de falha,
          // degradar para uma análise completa preserva o comportamento correto.
          trackIds = tracks.map(track => track.id);
        }
      }

      try {
        this.options.workQueue.enqueue(
          runId,
          analyzers.map(analyzer => analyzer.id),
          trackIds,
          createdAt
        );
      } catch (error) {
        const sanitized = sanitizeOperationError(error);
        this.options.store.failRun(runId, this.now().toISOString(), {
          code: errorCode(error),
          message: sanitized.message,
          action: sanitized.action
        });
        throw error;
      }
      this.schedulePersistentRun(runId, capability, libraryRevision, safeOwnerId(ownerId));
      return run;
    }

    this.scheduleLegacyRun(runId, capability, libraryRevision, tracks, safeOwnerId(ownerId));
    return run;
  }

  getRun(runId: string) {
    this.refreshStaleRun(runId);
    return this.options.store.getRun(runId);
  }

  listRuns(limit = 50) {
    const runs = this.options.store.listRuns(limit);
    for (const run of runs) this.refreshStaleRun(run.id);
    return this.options.store.listRuns(limit);
  }

  listSuggestions(
    runId: string,
    filters: { status?: LibraryAssistantSuggestionStatus; limit?: number } = {}
  ) {
    this.refreshStaleRun(runId);
    if (!this.options.store.getRun(runId)) return null;
    return this.options.store.listSuggestionRecords(runId, filters).map(record => record.suggestion);
  }

  cancelRun(runId: string) {
    const current = this.options.store.getRun(runId);
    if (!current) return null;
    if (isTerminal(current)) return current;
    const timer = this.retryTimers.get(runId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(runId);
    this.controllers.get(runId)?.abort();
    this.invalidateOpenSuggestions(runId);
    this.options.store.cancelRun(runId, this.now().toISOString());
    return this.options.store.getRun(runId)!;
  }

  async close() {
    this.closing = true;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.scheduled.values()]);
    this.controllers.clear();
    this.scheduled.clear();
  }

  private scheduleLegacyRun(
    runId: string,
    capability: LibraryAssistantCapability,
    libraryRevision: number,
    tracks: readonly Track[],
    ownerId: string
  ) {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    let scheduled!: Promise<void>;
    scheduled = this.options.queue.runWithContext(
      { ownerId, signal: controller.signal },
      signal => this.executeLegacyRun(runId, capability, libraryRevision, tracks, signal)
    ).catch(error => {
      this.handleScheduledFailure(runId, error, controller.signal);
    }).finally(() => {
      if (this.controllers.get(runId) === controller) this.controllers.delete(runId);
      if (this.scheduled.get(runId) === scheduled) this.scheduled.delete(runId);
    });
    this.scheduled.set(runId, scheduled);
    void scheduled;
  }

  private schedulePersistentRun(
    runId: string,
    capability: LibraryAssistantCapability,
    libraryRevision: number,
    ownerId: string
  ) {
    if (this.closing || this.scheduled.has(runId)) return;
    const existingTimer = this.retryTimers.get(runId);
    if (existingTimer) clearTimeout(existingTimer);
    this.retryTimers.delete(runId);

    const controller = new AbortController();
    this.controllers.set(runId, controller);
    let scheduled!: Promise<void>;
    scheduled = this.options.queue.runWithContext(
      { ownerId, signal: controller.signal },
      signal => this.executePersistentRun(runId, capability, libraryRevision, signal)
    ).catch(error => {
      this.handleScheduledFailure(runId, error, controller.signal);
    }).finally(() => {
      if (this.controllers.get(runId) === controller) this.controllers.delete(runId);
      if (this.scheduled.get(runId) === scheduled) this.scheduled.delete(runId);
    });
    this.scheduled.set(runId, scheduled);
    void scheduled;
  }

  private async executePersistentRun(
    runId: string,
    capability: LibraryAssistantCapability,
    libraryRevision: number,
    signal?: AbortSignal
  ) {
    const workQueue = this.options.workQueue;
    if (!workQueue) return;
    const current = this.options.store.getRun(runId);
    if (!current || isTerminal(current)) return;
    if (current.status === 'queued' && !this.options.store.startRun(runId, this.now().toISOString())) return;
    if (current.status !== 'queued' && current.status !== 'running') return;

    const observed = this.options.observability.start({
      jobType: 'library.assistant',
      jobId: runId,
      resourceId: capability
    });

    try {
      if (signal?.aborted) throw new HeavyWorkQueueAbortedError('library-assistant');
      if (this.options.library.revision() !== libraryRevision) {
        this.markRunStale(runId, observed);
        return;
      }

      const tracks = this.options.library.listTracks().map(track => ({ ...track }));
      const trackMap = new Map(tracks.map(track => [track.id, track]));

      for (;;) {
        if (signal?.aborted) throw new HeavyWorkQueueAbortedError('library-assistant');
        const run = this.options.store.getRun(runId);
        if (!run || run.status !== 'running') return;
        if (this.options.library.revision() !== libraryRevision) {
          this.markRunStale(runId, observed);
          return;
        }

        const claimedAt = this.now();
        const item = workQueue.claimNext(runId, claimedAt.getTime(), claimedAt.toISOString());
        if (!item) {
          const summary = workQueue.summary(runId);
          const unfinished = summary.pending + summary.processing + summary.retry;
          if (unfinished === 0) {
            const finishedAt = this.now().toISOString();
            if (this.options.store.completeRun(runId, finishedAt)) {
              try {
                this.options.incrementalIndex?.finishRun(runId, capability, finishedAt);
              } catch {
                // Estado incremental é derivado. Falha aqui apenas faz a próxima
                // execução reprocessar mais faixas do que o necessário.
              }
              this.options.observability.complete(observed, {
                tracks: summary.matched + summary.no_match + summary.failed
              });
            }
            return;
          }

          const retryAtMs = workQueue.nextRetryAt(runId);
          this.scheduleRetry(
            runId,
            capability,
            libraryRevision,
            retryAtMs ?? this.now().getTime() + 1_000
          );
          return;
        }

        const analyzer = this.analyzersById.get(item.analyzerId);
        const track = trackMap.get(item.trackId);
        if (!analyzer || analyzer.capability !== capability || !track) {
          workQueue.markFailed(item, {
            code: !analyzer ? 'analyzer-unavailable' : 'track-unavailable',
            message: !analyzer
              ? 'O analyzer necessário para esta faixa não está disponível.'
              : 'A faixa não está mais disponível no snapshot da biblioteca.',
            action: 'Revise a configuração do Assistente e inicie uma nova análise se necessário.'
          }, this.now().toISOString());
          continue;
        }

        try {
          const drafts = await analyzer.analyze({
            runId,
            tracks: [track],
            signal,
            providers: this.options.providers
          });
          if (!Array.isArray(drafts)) throw new TypeError(`Analyzer ${analyzer.id} retornou resultado inválido.`);
          if (signal?.aborted) throw new HeavyWorkQueueAbortedError('library-assistant');
          if (this.options.library.revision() !== libraryRevision) {
            this.markRunStale(runId, observed);
            return;
          }

          const inputs = drafts.map(draft => this.toStoredSuggestion(runId, capability, trackMap, draft));
          this.options.store.insertSuggestions(inputs);
          const updatedAt = this.now().toISOString();
          if (drafts.length > 0) workQueue.markMatched(item, updatedAt);
          else workQueue.markNoMatch(item, updatedAt);
        } catch (error) {
          if (isCancellation(error, signal)) throw error;
          this.persistWorkFailure(item, error);
        }
      }
    } catch (error) {
      if (isCancellation(error, signal)) {
        if (this.closing) return;
        this.invalidateOpenSuggestions(runId);
        const changed = this.options.store.cancelRun(runId, this.now().toISOString());
        if (changed) this.options.observability.cancel(observed);
        return;
      }
      this.invalidateOpenSuggestions(runId);
      const sanitized = sanitizeOperationError(error);
      const changed = this.options.store.failRun(runId, this.now().toISOString(), {
        code: errorCode(error),
        message: sanitized.message,
        action: sanitized.action
      });
      if (changed) this.options.observability.fail(observed, error);
    }
  }

  private persistWorkFailure(item: LibraryAssistantWorkItem, error: unknown) {
    const workQueue = this.options.workQueue;
    if (!workQueue) return;
    const sanitized = sanitizeOperationError(error);
    const persistedError = {
      code: errorCode(error),
      message: sanitized.message,
      action: sanitized.action
    };
    if (isTransientFailure(error) && item.attempts <= this.retryDelaysMs.length) {
      const delayMs = this.retryDelaysMs[Math.max(0, item.attempts - 1)] ?? this.retryDelaysMs.at(-1) ?? 1;
      const retryAtMs = this.now().getTime() + delayMs;
      workQueue.markRetry(item, retryAtMs, persistedError, this.now().toISOString());
      return;
    }
    workQueue.markFailed(item, persistedError, this.now().toISOString());
  }

  private scheduleRetry(
    runId: string,
    capability: LibraryAssistantCapability,
    libraryRevision: number,
    retryAtMs: number
  ) {
    if (this.closing || this.retryTimers.has(runId)) return;
    const delayMs = Math.min(
      2_147_483_647,
      Math.max(25, Math.trunc(retryAtMs - this.now().getTime()))
    );
    const timer = setTimeout(() => {
      this.retryTimers.delete(runId);
      const run = this.options.store.getRun(runId);
      if (!this.closing && run?.status === 'running') {
        this.schedulePersistentRun(runId, capability, libraryRevision, 'system');
      }
    }, delayMs);
    timer.unref?.();
    this.retryTimers.set(runId, timer);
  }

  private async executeLegacyRun(
    runId: string,
    capability: LibraryAssistantCapability,
    libraryRevision: number,
    tracks: readonly Track[],
    signal?: AbortSignal
  ) {
    if (!this.options.store.startRun(runId, this.now().toISOString())) return;
    const observed = this.options.observability.start({
      jobType: 'library.assistant',
      jobId: runId,
      resourceId: capability
    });
    const trackMap = new Map(tracks.map(track => [track.id, track]));

    try {
      if (signal?.aborted) throw new HeavyWorkQueueAbortedError('library-assistant');
      if (this.options.library.revision() !== libraryRevision) {
        this.markRunStale(runId, observed);
        return;
      }

      const analyzers = this.analyzersByCapability.get(capability) ?? [];
      let suggestionCount = 0;
      for (const analyzer of analyzers) {
        if (signal?.aborted) throw new HeavyWorkQueueAbortedError('library-assistant');
        const drafts = await analyzer.analyze({
          runId,
          tracks,
          signal,
          providers: this.options.providers
        });
        if (!Array.isArray(drafts)) throw new TypeError(`Analyzer ${analyzer.id} retornou resultado inválido.`);
        suggestionCount += drafts.length;
        if (suggestionCount > MAX_SUGGESTIONS_PER_LEGACY_RUN) {
          throw new RangeError('Análise excedeu o limite de sugestões por run.');
        }
        if (signal?.aborted) throw new HeavyWorkQueueAbortedError('library-assistant');
        if (this.options.library.revision() !== libraryRevision) {
          this.markRunStale(runId, observed);
          return;
        }
        const inputs = drafts.map(draft => this.toStoredSuggestion(runId, capability, trackMap, draft));
        this.options.store.insertSuggestions(inputs);
      }

      if (signal?.aborted) throw new HeavyWorkQueueAbortedError('library-assistant');
      if (this.options.library.revision() !== libraryRevision) {
        this.markRunStale(runId, observed);
        return;
      }
      if (this.options.store.completeRun(runId, this.now().toISOString())) {
        this.options.observability.complete(observed, { tracks: tracks.length });
      }
    } catch (error) {
      if (isCancellation(error, signal)) {
        if (this.closing) return;
        this.invalidateOpenSuggestions(runId);
        const changed = this.options.store.cancelRun(runId, this.now().toISOString());
        if (changed) this.options.observability.cancel(observed);
        return;
      }
      this.invalidateOpenSuggestions(runId);
      const sanitized = sanitizeOperationError(error);
      const changed = this.options.store.failRun(runId, this.now().toISOString(), {
        code: errorCode(error),
        message: sanitized.message,
        action: sanitized.action
      });
      if (changed) this.options.observability.fail(observed, error);
    }
  }

  private toStoredSuggestion(
    runId: string,
    capability: LibraryAssistantCapability,
    tracks: ReadonlyMap<string, Track>,
    draft: LibraryAssistantSuggestionDraft
  ): LibraryAssistantStoredSuggestionInput {
    if (draft.capability !== capability || draft.target.capability !== capability) {
      throw new TypeError('Analyzer retornou sugestão para capability diferente do run.');
    }
    const track = tracks.get(draft.target.trackId);
    if (!track) throw new TypeError('Analyzer retornou sugestão para faixa fora do snapshot analisado.');
    return {
      id: `suggestion-${this.createId()}`,
      runId,
      capability,
      trackId: track.id,
      status: 'review',
      confidence: draft.confidence,
      reasonCodes: [...draft.reasonCodes],
      evidence: [...draft.evidence],
      provenance: { ...draft.provenance },
      target: { ...draft.target },
      premiseSignature: this.suggestionPremiseSignature(capability, track, draft.target),
      createdAt: this.now().toISOString()
    };
  }

  private suggestionPremiseSignature(
    capability: LibraryAssistantCapability,
    track: Track,
    target: LibraryAssistantSuggestionTarget
  ) {
    return capability === 'metadata' && target.capability === 'metadata'
      ? metadataPremiseSignature(track, target)
      : this.premiseSignature(capability, track);
  }

  private refreshStaleRun(runId: string) {
    const run = this.options.store.getRun(runId);
    if (!run || run.status === 'failed' || run.status === 'cancelled') return;
    const currentRevision = this.options.library.revision();
    if (currentRevision === run.libraryRevision) return;

    if (run.status === 'queued' || run.status === 'running') {
      const timer = this.retryTimers.get(runId);
      if (timer) clearTimeout(timer);
      this.retryTimers.delete(runId);
      this.controllers.get(runId)?.abort();
      this.invalidateOpenSuggestions(runId);
      this.options.store.markRunStale(runId, this.now().toISOString());
      return;
    }

    const tracks = new Map(this.options.library.listTracks().map(track => [track.id, track]));
    const records = this.options.store.listSuggestionRecords(runId, { limit: MAX_SUGGESTIONS_PER_LEGACY_RUN });
    let stale = false;
    const updatedAt = this.now().toISOString();
    for (const record of records) {
      if (record.suggestion.status !== 'pending' && record.suggestion.status !== 'review') continue;
      const track = tracks.get(record.suggestion.target.trackId);
      const currentSignature = track
        ? this.suggestionPremiseSignature(run.capability, track, record.suggestion.target)
        : null;
      if (!currentSignature || currentSignature !== record.premiseSignature) {
        stale = this.options.store.markSuggestionStale(record.suggestion.id, updatedAt) || stale;
      }
    }
    if (stale) this.options.store.markRunStale(runId, updatedAt);
  }

  private invalidateOpenSuggestions(runId: string) {
    const updatedAt = this.now().toISOString();
    for (const status of ['pending', 'review'] as const) {
      for (;;) {
        const records = this.options.store.listSuggestionRecords(runId, {
          status,
          limit: INVALIDATION_BATCH_SIZE
        });
        if (records.length === 0) break;
        for (const record of records) {
          this.options.store.markSuggestionStale(record.suggestion.id, updatedAt);
        }
        if (records.length < INVALIDATION_BATCH_SIZE) break;
      }
    }
  }

  private markRunStale(runId: string, observed: LongJobRun) {
    this.invalidateOpenSuggestions(runId);
    if (this.options.store.markRunStale(runId, this.now().toISOString())) {
      this.options.observability.fail(observed, new Error('Snapshot da biblioteca mudou durante a análise.'));
    }
  }

  private handleScheduledFailure(runId: string, error: unknown, signal?: AbortSignal) {
    if (this.closing && isCancellation(error, signal)) return;
    this.invalidateOpenSuggestions(runId);
    if (isCancellation(error, signal)) {
      this.options.store.cancelRun(runId, this.now().toISOString());
      return;
    }
    const sanitized = sanitizeOperationError(error);
    this.options.store.failRun(runId, this.now().toISOString(), {
      code: errorCode(error),
      message: sanitized.message,
      action: sanitized.action
    });
  }
}
