import { DatabaseSync } from 'node:sqlite';
import type { Track } from '@home-music/shared';
import {
  isLibraryAssistantAutoApplicable,
  type AdminLibraryAssistantBatchDecisionResponse,
  type AdminLibraryAssistantReviewResponse,
  type LibraryAssistantDecision,
  type LibraryAssistantDecisionResult,
  type LibraryAssistantDecisionSummary,
  type LibraryAssistantLyricsSource,
  type LibraryAssistantLyricsTarget,
  type LibraryAssistantReviewItem,
  type LibraryAssistantSuggestionStatus
} from '@home-music/shared/library-assistant';
import type { LibraryAssistantReviewService } from './library-assistant-review-service.js';
import type { LibraryAssistantStore, LibraryAssistantStoredSuggestion } from './library-assistant-store.js';
import type { TrackLyricsOverrideStore, ManagedLyricsOrigin } from './track-lyrics-overrides.js';
import type { TrackMetadataOverrideStore } from './track-metadata-overrides.js';

const MAX_REVIEW_ITEMS = 500;
const MAX_REVIEW_RUNS = 100;
const MAX_BATCH_DECISIONS = 100;
const OPEN_STATUSES = new Set<LibraryAssistantSuggestionStatus>(['pending', 'review']);

type BaseReviewPort = Pick<
  LibraryAssistantReviewService,
  'getReviewQueue' | 'resetOpenSuggestions' | 'decide' | 'decideBatch' | 'close'
>;

type ReviewLibrary = {
  listTracks: () => Track[];
  revision: () => number;
};

export type ResolvedManagedLyricsCandidate = {
  candidateId: string;
  synchronized: boolean;
  language: string | null;
  text: string;
  source: LibraryAssistantLyricsSource;
  origin: ManagedLyricsOrigin;
  provider: string | null;
  externalId: string | null;
  preservePrevious: boolean;
  baseLyricsFingerprint: string | null;
};

type CompositeReviewOptions = {
  databasePath: string;
  base: BaseReviewPort;
  store: LibraryAssistantStore;
  metadataOverrides: Pick<TrackMetadataOverrideStore, 'get'>;
  lyricsOverrides: TrackLyricsOverrideStore;
  library: ReviewLibrary;
  hasSidecarLyrics: (trackId: string) => Promise<boolean>;
  effectiveLyricsFingerprint: (trackId: string) => Promise<string>;
  resolveLyricsCandidate: (candidateId: string) => Promise<ResolvedManagedLyricsCandidate | null>;
  discardLyricsCandidate?: (candidateId: string) => void;
  onLyricsChanged: () => void;
  now?: () => Date;
};

type ReviewBatchOptions = { confirmReview?: boolean };
type ReviewRun = NonNullable<ReturnType<LibraryAssistantStore['getRun']>>;

class LyricsDecisionStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  close() {
    this.db.close();
  }

  transition(
    suggestionId: string,
    nextStatus: 'applied' | 'rejected' | 'stale',
    updatedAt: string
  ) {
    const result = this.db.prepare(`
      UPDATE library_assistant_suggestions
      SET status = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'review');
    `).run(nextStatus, updatedAt, suggestionId);
    return Number(result.changes) > 0;
  }

  markRunStale(runId: string, updatedAt: string) {
    this.db.prepare(`
      UPDATE library_assistant_runs
      SET status = 'stale', finished_at = COALESCE(finished_at, ?)
      WHERE id = ? AND status = 'completed';
    `).run(updatedAt, runId);
  }
}

function summary(results: LibraryAssistantDecisionResult[]): LibraryAssistantDecisionSummary {
  const value: LibraryAssistantDecisionSummary = {
    total: results.length,
    applied: 0,
    rejected: 0,
    alreadyResolved: 0,
    stale: 0,
    failed: 0
  };
  for (const item of results) {
    if (item.outcome === 'applied') value.applied += 1;
    else if (item.outcome === 'rejected') value.rejected += 1;
    else if (item.outcome === 'already-applied' || item.outcome === 'already-rejected') value.alreadyResolved += 1;
    else if (item.outcome === 'stale') value.stale += 1;
    else value.failed += 1;
  }
  return value;
}

function result(
  decision: LibraryAssistantDecision,
  outcome: LibraryAssistantDecisionResult['outcome'],
  currentValue: string | null,
  message: string | null = null
): LibraryAssistantDecisionResult {
  return {
    runId: decision.runId,
    suggestionId: decision.suggestionId,
    action: decision.action,
    outcome,
    currentValue,
    message
  };
}

function validateDecision(decision: LibraryAssistantDecision) {
  if (!decision || typeof decision !== 'object') throw new TypeError('Decisão inválida.');
  if (!/^[A-Za-z0-9._:-]{1,192}$/.test(decision.runId)) throw new TypeError('Run inválido.');
  if (!/^[A-Za-z0-9._:-]{1,192}$/.test(decision.suggestionId)) throw new TypeError('Sugestão inválida.');
  if (decision.action !== 'apply' && decision.action !== 'reject') throw new TypeError('Ação inválida.');
  if (!Number.isSafeInteger(decision.expectedLibraryRevision) || decision.expectedLibraryRevision < 0) {
    throw new TypeError('Revisão esperada inválida.');
  }
  if (typeof decision.expectedCurrentValue !== 'string' || decision.expectedCurrentValue.length > 1_000) {
    throw new TypeError('Valor atual esperado inválido.');
  }
}

function managedLyricsValue(store: TrackLyricsOverrideStore, trackId: string) {
  const current = store.get(trackId);
  return current ? `managed:${current.updatedAt}` : '';
}

function isLocalTarget(target: LibraryAssistantLyricsTarget) {
  return target.source === 'local-transcription' || target.source === 'local-alignment';
}

function metadataTrack(
  track: Track,
  physical: LibraryAssistantReviewItem['track']['physical']
): LibraryAssistantReviewItem['track'] {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    physical
  };
}

export class LibraryAssistantCompositeReviewService {
  private readonly decisions: LyricsDecisionStore;
  private readonly now: () => Date;
  private decisionTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: CompositeReviewOptions) {
    this.decisions = new LyricsDecisionStore(options.databasePath);
    this.now = options.now ?? (() => new Date());
  }

  close() {
    this.decisions.close();
    this.options.base.close();
  }

  getReviewQueue(limit = 200): AdminLibraryAssistantReviewResponse {
    const safeLimit = Math.max(1, Math.min(MAX_REVIEW_ITEMS, Math.trunc(limit)));
    const base = this.options.base.getReviewQueue(MAX_REVIEW_ITEMS);
    const tracks = new Map(this.options.library.listTracks().map(track => [track.id, track]));
    const items = [...base.items];

    for (const run of this.options.store.listRuns(MAX_REVIEW_RUNS)) {
      if (!['running', 'completed', 'stale'].includes(run.status)) continue;
      for (const status of ['review', 'pending'] as const) {
        const records = this.options.store.listSuggestionRecords(run.id, { status, limit: MAX_REVIEW_ITEMS });
        for (const record of records) {
          if (record.suggestion.target.capability !== 'lyrics' || !OPEN_STATUSES.has(record.suggestion.status)) continue;
          const item = this.toLyricsReviewItem(run, record, tracks);
          if (item) items.push(item);
        }
      }
    }

    items.sort((left, right) => {
      const created = left.suggestion.createdAt.localeCompare(right.suggestion.createdAt);
      return created || left.suggestion.id.localeCompare(right.suggestion.id);
    });
    return { libraryRevision: this.options.library.revision(), items: items.slice(0, safeLimit) };
  }

  resetOpenSuggestions() {
    return this.options.base.resetOpenSuggestions();
  }

  clearManagedLyrics(trackId: string) {
    if (!this.options.library.listTracks().some(track => track.id === trackId)) return null;
    const removed = this.options.lyricsOverrides.clear(trackId);
    if (removed) this.options.onLyricsChanged();
    return removed;
  }

  async decide(decision: LibraryAssistantDecision): Promise<LibraryAssistantDecisionResult> {
    validateDecision(decision);
    const record = this.findSuggestionRecord(decision.runId, decision.suggestionId);
    if (!record || record.suggestion.target.capability !== 'lyrics') {
      return this.options.base.decide(decision);
    }

    const previous = this.decisionTail;
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.decisionTail = previous.then(() => current);
    await previous;
    try {
      return await this.decideLyrics(decision, record.suggestion.target);
    } finally {
      release();
    }
  }

  async decideBatch(
    decisions: LibraryAssistantDecision[],
    options: ReviewBatchOptions = {}
  ): Promise<AdminLibraryAssistantBatchDecisionResponse> {
    if (!Array.isArray(decisions) || decisions.length < 1 || decisions.length > MAX_BATCH_DECISIONS) {
      throw new RangeError(`O lote deve conter entre 1 e ${MAX_BATCH_DECISIONS} decisões.`);
    }
    for (const decision of decisions) validateDecision(decision);
    const keys = decisions.map(decision => `${decision.runId}:${decision.suggestionId}`);
    if (new Set(keys).size !== keys.length) throw new TypeError('O lote contém sugestões duplicadas.');

    const results: LibraryAssistantDecisionResult[] = [];
    for (const decision of decisions) {
      const record = this.findSuggestionRecord(decision.runId, decision.suggestionId);
      if (record?.suggestion.target.capability === 'lyrics') {
        if (
          decision.action === 'apply'
          && OPEN_STATUSES.has(record.suggestion.status)
          && !isLibraryAssistantAutoApplicable(record.suggestion)
          && options.confirmReview !== true
        ) {
          results.push(result(
            decision,
            'failed',
            decision.expectedCurrentValue,
            'Esta sugestão de letra exige confirmação explícita para aplicação em lote.'
          ));
          continue;
        }
        try {
          results.push(await this.decide(decision));
        } catch {
          results.push(result(decision, 'failed', null, 'Não foi possível concluir esta decisão de letra.'));
        }
        continue;
      }

      try {
        const delegated = await this.options.base.decideBatch([decision], options);
        results.push(delegated.results[0] ?? result(decision, 'failed', null));
      } catch {
        results.push(result(decision, 'failed', null, 'Não foi possível concluir esta decisão.'));
      }
    }
    return { results, summary: summary(results) };
  }

  private findSuggestionRecord(runId: string, suggestionId: string) {
    return this.options.store
      .listSuggestionRecords(runId, { limit: MAX_REVIEW_ITEMS })
      .find(item => item.suggestion.id === suggestionId) ?? null;
  }

  private toLyricsReviewItem(
    run: ReviewRun,
    record: LibraryAssistantStoredSuggestion,
    tracks: ReadonlyMap<string, Track>
  ): LibraryAssistantReviewItem | null {
    const suggestion = record.suggestion;
    if (suggestion.target.capability !== 'lyrics') return null;
    const track = tracks.get(suggestion.target.trackId);
    if (!track) {
      this.markStale(suggestion.id, run.id);
      return null;
    }
    if (!isLocalTarget(suggestion.target)) {
      const currentValue = managedLyricsValue(this.options.lyricsOverrides, track.id);
      if (currentValue !== suggestion.target.currentValue) {
        this.markStale(suggestion.id, run.id);
        return null;
      }
    }
    const metadata = this.options.metadataOverrides.get(track.id);
    const physical = metadata?.physical ?? {
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist
    };
    return {
      runLibraryRevision: run.libraryRevision,
      suggestion,
      track: metadataTrack(track, physical)
    };
  }

  private async decideLyrics(
    decision: LibraryAssistantDecision,
    target: LibraryAssistantLyricsTarget
  ): Promise<LibraryAssistantDecisionResult> {
    const run = this.options.store.getRun(decision.runId);
    if (!run) return result(decision, 'not-found', null, 'Run não encontrado.');
    const record = this.findSuggestionRecord(decision.runId, decision.suggestionId);
    if (!record) return result(decision, 'not-found', null, 'Sugestão não encontrada.');
    if (record.suggestion.status === 'applied') return result(decision, 'already-applied', null);
    if (record.suggestion.status === 'rejected') return result(decision, 'already-rejected', null);
    if (record.suggestion.status === 'stale') return result(decision, 'stale', null, 'A sugestão já está desatualizada.');
    if (record.suggestion.status === 'failed') return result(decision, 'failed', null, 'A sugestão não está disponível para revisão.');
    if (run.libraryRevision !== decision.expectedLibraryRevision) {
      return this.markStaleResult(decision, run, null, 'A revisão esperada não corresponde ao run analisado.');
    }
    if (target.currentValue !== decision.expectedCurrentValue) {
      return this.markStaleResult(decision, run, null, 'O estado de lyrics esperado não corresponde à sugestão analisada.');
    }

    const track = this.options.library.listTracks().find(item => item.id === target.trackId);
    if (!track) return this.markStaleResult(decision, run, null, 'A música não existe mais na biblioteca.');
    const local = isLocalTarget(target);
    const currentValue = local
      ? `effective:${await this.options.effectiveLyricsFingerprint(target.trackId)}`
      : managedLyricsValue(this.options.lyricsOverrides, target.trackId);
    if (currentValue !== target.currentValue) {
      return this.markStaleResult(
        decision,
        run,
        currentValue,
        local ? 'A letra efetiva mudou desde o processamento local.' : 'A letra gerenciada mudou desde a análise.'
      );
    }

    const updatedAt = this.now().toISOString();
    if (decision.action === 'reject') {
      const changed = this.decisions.transition(decision.suggestionId, 'rejected', updatedAt);
      if (!changed) return this.resolveRace(decision);
      if (local) this.options.discardLyricsCandidate?.(target.candidateId);
      return result(decision, 'rejected', currentValue);
    }

    try {
      if (!local && await this.options.hasSidecarLyrics(target.trackId)) {
        return this.markStaleResult(
          decision,
          run,
          'sidecar',
          'Uma letra local apareceu desde a análise. O provider externo não substituiu o sidecar.'
        );
      }
      const recheckedValue = local
        ? `effective:${await this.options.effectiveLyricsFingerprint(target.trackId)}`
        : managedLyricsValue(this.options.lyricsOverrides, target.trackId);
      if (recheckedValue !== target.currentValue) {
        return this.markStaleResult(decision, run, recheckedValue, 'A fonte de lyrics mudou desde a revisão.');
      }

      const candidate = await this.options.resolveLyricsCandidate(target.candidateId);
      if (!candidate) {
        return result(decision, 'failed', currentValue, 'A letra sugerida não está mais disponível.');
      }
      if (
        candidate.candidateId !== target.candidateId
        || candidate.synchronized !== target.synchronized
        || candidate.source !== (target.source ?? 'lrclib')
      ) {
        return result(
          decision,
          'failed',
          currentValue,
          'A letra candidata mudou desde a revisão. Execute uma nova análise antes de aplicar.'
        );
      }
      if (local && candidate.baseLyricsFingerprint !== target.currentValue.replace(/^effective:/, '')) {
        return this.markStaleResult(decision, run, currentValue, 'A premissa da letra local não corresponde mais à revisão.');
      }

      const saved = this.options.lyricsOverrides.save(target.trackId, {
        mode: candidate.synchronized ? 'synced' : 'plain',
        text: candidate.text,
        origin: candidate.origin,
        provider: candidate.provider,
        externalId: candidate.externalId,
        language: candidate.language
      }, { preservePrevious: candidate.preservePrevious });
      if (!saved) return this.markStaleResult(decision, run, null, 'A música não existe mais na biblioteca.');
      const changed = this.decisions.transition(decision.suggestionId, 'applied', updatedAt);
      if (!changed) return this.resolveRace(decision);
      if (local) this.options.discardLyricsCandidate?.(target.candidateId);
      this.options.onLyricsChanged();
      return result(decision, 'applied', `managed:${saved.updatedAt}`);
    } catch {
      return result(
        decision,
        'failed',
        currentValue,
        'Não foi possível validar e persistir a letra sugerida. Tente novamente depois.'
      );
    }
  }

  private markStale(suggestionId: string, runId: string) {
    const updatedAt = this.now().toISOString();
    if (this.decisions.transition(suggestionId, 'stale', updatedAt)) {
      this.decisions.markRunStale(runId, updatedAt);
    }
  }

  private markStaleResult(
    decision: LibraryAssistantDecision,
    run: ReviewRun,
    currentValue: string | null,
    message: string
  ) {
    this.markStale(decision.suggestionId, run.id);
    return result(decision, 'stale', currentValue, message);
  }

  private resolveRace(decision: LibraryAssistantDecision) {
    const record = this.findSuggestionRecord(decision.runId, decision.suggestionId);
    if (!record) return result(decision, 'not-found', null, 'Sugestão não encontrada.');
    if (record.suggestion.status === 'applied') return result(decision, 'already-applied', null);
    if (record.suggestion.status === 'rejected') return result(decision, 'already-rejected', null);
    if (record.suggestion.status === 'stale') return result(decision, 'stale', null);
    return result(decision, 'failed', null, 'A sugestão foi alterada por outra operação.');
  }
}
