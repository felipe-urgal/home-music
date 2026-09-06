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
import type { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import type {
  LibraryAssistantStore,
  LibraryAssistantStoredSuggestionInput
} from './library-assistant-store.js';

const MAX_ANALYZERS_PER_CAPABILITY = 8;
const MAX_SUGGESTIONS_PER_RUN = 5_000;
const MAX_OWNER_ID_LENGTH = 128;

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
  now?: () => Date;
  createId?: () => string;
  premiseSignature?: (capability: LibraryAssistantCapability, track: Track) => string;
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

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'analysis-failed';
  const raw = String(error.code || '').trim().toLowerCase();
  return /^[a-z0-9-]{1,64}$/.test(raw) ? raw : 'analysis-failed';
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
  private readonly analyzersByCapability = new Map<LibraryAssistantCapability, LibraryAssistantAnalyzer[]>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly options: LibraryAssistantServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.premiseSignature = options.premiseSignature ?? defaultPremiseSignature;

    for (const analyzer of options.analyzers ?? []) {
      if (!analyzer.id.trim() || analyzer.id.length > 128) throw new TypeError('Analyzer do assistente exige id válido.');
      const current = this.analyzersByCapability.get(analyzer.capability) ?? [];
      if (current.some(item => item.id === analyzer.id)) throw new TypeError(`Analyzer duplicado: ${analyzer.id}.`);
      if (current.length >= MAX_ANALYZERS_PER_CAPABILITY) {
        throw new RangeError(`Muitos analyzers registrados para ${analyzer.capability}.`);
      }
      current.push(analyzer);
      this.analyzersByCapability.set(analyzer.capability, current);
    }
  }

  startRun(capability: LibraryAssistantCapability, ownerId?: string | null) {
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
    const controller = new AbortController();
    this.controllers.set(runId, controller);

    void this.options.queue.runWithContext(
      { ownerId: safeOwnerId(ownerId), signal: controller.signal },
      signal => this.executeRun(runId, capability, libraryRevision, tracks, signal)
    ).catch(error => {
      this.handleScheduledFailure(runId, error, controller.signal);
    }).finally(() => {
      this.controllers.delete(runId);
    });

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
    this.controllers.get(runId)?.abort();
    this.options.store.cancelRun(runId, this.now().toISOString());
    return this.options.store.getRun(runId)!;
  }

  close() {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  private async executeRun(
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
        if (suggestionCount > MAX_SUGGESTIONS_PER_RUN) {
          throw new RangeError('Análise excedeu o limite de sugestões por run.');
        }
        if (signal?.aborted) throw new HeavyWorkQueueAbortedError('library-assistant');
        if (this.options.library.revision() !== libraryRevision) {
          this.markRunStale(runId, observed);
          return;
        }
        const inputs = drafts.map(draft => this.toStoredSuggestion(runId, capability, tracks, draft));
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
        const changed = this.options.store.cancelRun(runId, this.now().toISOString());
        if (changed) this.options.observability.cancel(observed);
        return;
      }
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
    tracks: readonly Track[],
    draft: LibraryAssistantSuggestionDraft
  ): LibraryAssistantStoredSuggestionInput {
    if (draft.capability !== capability || draft.target.capability !== capability) {
      throw new TypeError('Analyzer retornou sugestão para capability diferente do run.');
    }
    const track = tracks.find(item => item.id === draft.target.trackId);
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
      premiseSignature: this.premiseSignature(capability, track),
      createdAt: this.now().toISOString()
    };
  }

  private refreshStaleRun(runId: string) {
    const run = this.options.store.getRun(runId);
    if (!run || run.status === 'failed' || run.status === 'cancelled' || run.status === 'stale') return;
    const currentRevision = this.options.library.revision();
    if (currentRevision === run.libraryRevision) return;

    if (run.status === 'queued' || run.status === 'running') {
      this.controllers.get(runId)?.abort();
      this.options.store.markRunStale(runId, this.now().toISOString());
      return;
    }

    const tracks = new Map(this.options.library.listTracks().map(track => [track.id, track]));
    const records = this.options.store.listSuggestionRecords(runId, { limit: MAX_SUGGESTIONS_PER_RUN });
    let stale = false;
    const updatedAt = this.now().toISOString();
    for (const record of records) {
      if (record.suggestion.status !== 'pending' && record.suggestion.status !== 'review') continue;
      const track = tracks.get(record.suggestion.target.trackId);
      const currentSignature = track
        ? this.premiseSignature(run.capability, track)
        : null;
      if (!currentSignature || currentSignature !== record.premiseSignature) {
        stale = this.options.store.markSuggestionStale(record.suggestion.id, updatedAt) || stale;
      }
    }
    if (stale) this.options.store.markRunStale(runId, updatedAt);
  }

  private markRunStale(runId: string, observed: LongJobRun) {
    if (this.options.store.markRunStale(runId, this.now().toISOString())) {
      this.options.observability.fail(observed, new Error('Snapshot da biblioteca mudou durante a análise.'));
    }
  }

  private handleScheduledFailure(runId: string, error: unknown, signal?: AbortSignal) {
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
