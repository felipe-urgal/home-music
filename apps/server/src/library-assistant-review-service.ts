import { DatabaseSync } from 'node:sqlite';
import type { Track } from '@home-music/shared';
import {
  isLibraryAssistantAutoApplicable,
  type AdminLibraryAssistantBatchDecisionResponse,
  type AdminLibraryAssistantReviewResponse,
  type LibraryAssistantArtworkTarget,
  type LibraryAssistantDecision,
  type LibraryAssistantDecisionResult,
  type LibraryAssistantDecisionSummary,
  type LibraryAssistantMetadataTarget,
  type LibraryAssistantReviewItem,
  type LibraryAssistantSuggestionStatus,
  type LibraryAssistantSuggestionTarget
} from '@home-music/shared/library-assistant';
import {
  downloadCoverArtArchiveImage,
  type DownloadedCoverArtArchiveImage
} from './cover-art-archive.js';
import type { LibraryAssistantStore, LibraryAssistantStoredSuggestion } from './library-assistant-store.js';
import type { TrackCoverOverrideStore } from './track-cover-overrides.js';
import {
  normalizeMetadataOverridePatch,
  type TrackMetadataOverrideStore
} from './track-metadata-overrides.js';

const MAX_REVIEW_ITEMS = 500;
const MAX_REVIEW_RUNS = 100;
const MAX_BATCH_DECISIONS = 100;
const OPEN_STATUSES = new Set<LibraryAssistantSuggestionStatus>(['pending', 'review']);

type ReviewLibrary = {
  listTracks: () => Track[];
  revision: () => number;
};

type ReviewServiceOptions = {
  databasePath: string;
  store: LibraryAssistantStore;
  metadataOverrides: TrackMetadataOverrideStore;
  coverOverrides: TrackCoverOverrideStore;
  library: ReviewLibrary;
  onMetadataChanged: () => void;
  onArtworkChanged: () => void;
  downloadArtwork?: (sourceUrl: string) => Promise<DownloadedCoverArtArchiveImage>;
  now?: () => Date;
};

type ReviewBatchOptions = {
  confirmReview?: boolean;
};

type ReviewRun = NonNullable<ReturnType<LibraryAssistantStore['getRun']>>;
type ReviewableTarget = LibraryAssistantMetadataTarget | LibraryAssistantArtworkTarget;

class LibraryAssistantDecisionStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  close() {
    this.db.close();
  }

  transitionSuggestion(
    suggestionId: string,
    nextStatus: 'applied' | 'rejected' | 'stale' | 'failed',
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

  invalidateOpenReviewSuggestions(updatedAt: string) {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.prepare(`
        UPDATE library_assistant_runs
        SET status = 'stale', finished_at = COALESCE(finished_at, ?)
        WHERE capability IN ('metadata', 'artwork')
          AND status = 'completed'
          AND EXISTS (
            SELECT 1
            FROM library_assistant_suggestions AS suggestion
            WHERE suggestion.run_id = library_assistant_runs.id
              AND suggestion.status IN ('pending', 'review')
          );
      `).run(updatedAt);
      const result = this.db.prepare(`
        UPDATE library_assistant_suggestions
        SET status = 'stale', updated_at = ?
        WHERE run_id IN (
          SELECT id
          FROM library_assistant_runs
          WHERE capability IN ('metadata', 'artwork')
        )
          AND status IN ('pending', 'review');
      `).run(updatedAt);
      this.db.exec('COMMIT;');
      return Number(result.changes);
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }
}

function metadataTrack(track: Track, physical: LibraryAssistantReviewItem['track']['physical']) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    physical
  };
}

function liveMetadataValue(track: Track, target: LibraryAssistantMetadataTarget) {
  return track[target.field];
}

function artworkExpectedValue(target: LibraryAssistantArtworkTarget) {
  return target.currentHasCover ? target.currentCoverVersion ?? 'physical' : '';
}

function targetExpectedValue(target: ReviewableTarget) {
  return target.capability === 'metadata' ? target.currentValue : artworkExpectedValue(target);
}

function isReviewableTarget(target: LibraryAssistantSuggestionTarget): target is ReviewableTarget {
  return target.capability === 'metadata' || target.capability === 'artwork';
}

function liveArtworkValue(trackId: string, coverOverrides: TrackCoverOverrideStore) {
  coverOverrides.refresh();
  const cover = coverOverrides.getStatus(trackId);
  if (!cover) return null;
  if (cover.override) return cover.override.version;
  return cover.effectiveHasCover ? 'physical' : '';
}

function liveTargetValue(
  track: Track,
  target: ReviewableTarget,
  coverOverrides: TrackCoverOverrideStore
) {
  return target.capability === 'metadata'
    ? liveMetadataValue(track, target)
    : liveArtworkValue(target.trackId, coverOverrides);
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
  for (const result of results) {
    if (result.outcome === 'applied') value.applied += 1;
    else if (result.outcome === 'rejected') value.rejected += 1;
    else if (result.outcome === 'already-applied' || result.outcome === 'already-rejected') value.alreadyResolved += 1;
    else if (result.outcome === 'stale') value.stale += 1;
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

function isValidRevision(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateDecision(decision: LibraryAssistantDecision) {
  if (!decision || typeof decision !== 'object') throw new TypeError('Decisão inválida.');
  if (!/^[A-Za-z0-9._:-]{1,192}$/.test(decision.runId)) throw new TypeError('Run inválido.');
  if (!/^[A-Za-z0-9._:-]{1,192}$/.test(decision.suggestionId)) throw new TypeError('Sugestão inválida.');
  if (decision.action !== 'apply' && decision.action !== 'reject') throw new TypeError('Ação inválida.');
  if (!isValidRevision(decision.expectedLibraryRevision)) throw new TypeError('Revisão esperada inválida.');
  if (typeof decision.expectedCurrentValue !== 'string' || decision.expectedCurrentValue.length > 1_000) {
    throw new TypeError('Valor atual esperado inválido.');
  }
  if (
    decision.replaceExistingArtworkOverride != null
    && typeof decision.replaceExistingArtworkOverride !== 'boolean'
  ) {
    throw new TypeError('Confirmação de substituição de capa inválida.');
  }
}

export class LibraryAssistantReviewService {
  private readonly decisions: LibraryAssistantDecisionStore;
  private readonly now: () => Date;
  private readonly downloadArtwork: (sourceUrl: string) => Promise<DownloadedCoverArtArchiveImage>;
  private decisionTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: ReviewServiceOptions) {
    this.decisions = new LibraryAssistantDecisionStore(options.databasePath);
    this.now = options.now ?? (() => new Date());
    this.downloadArtwork = options.downloadArtwork ?? (sourceUrl => downloadCoverArtArchiveImage(sourceUrl));
  }

  close() {
    this.decisions.close();
  }

  getReviewQueue(limit = 200): AdminLibraryAssistantReviewResponse {
    const safeLimit = Math.max(1, Math.min(MAX_REVIEW_ITEMS, Math.trunc(limit)));
    const tracks = new Map(this.options.library.listTracks().map(track => [track.id, track]));
    const items: LibraryAssistantReviewItem[] = [];

    for (const run of this.options.store.listRuns(MAX_REVIEW_RUNS)) {
      if (items.length >= safeLimit) break;
      if (
        (run.capability !== 'metadata' && run.capability !== 'artwork')
        || !['running', 'completed', 'stale'].includes(run.status)
      ) continue;
      for (const status of ['review', 'pending'] as const) {
        const records = this.options.store.listSuggestionRecords(run.id, {
          status,
          limit: Math.min(MAX_REVIEW_ITEMS, safeLimit - items.length)
        });
        for (const record of records) {
          if (items.length >= safeLimit) break;
          const item = this.toReviewItem(run, record, tracks);
          if (item) items.push(item);
        }
      }
    }

    items.sort((left, right) => {
      const created = left.suggestion.createdAt.localeCompare(right.suggestion.createdAt);
      return created || left.suggestion.id.localeCompare(right.suggestion.id);
    });
    return { libraryRevision: this.options.library.revision(), items };
  }

  resetOpenSuggestions() {
    const activeRun = this.options.store.listRuns(MAX_REVIEW_RUNS)
      .find(run => (
        (run.capability === 'metadata' || run.capability === 'artwork')
        && (run.status === 'queued' || run.status === 'running')
      ));
    if (activeRun) {
      throw new RangeError('Cancele a análise em andamento antes de limpar as sugestões abertas.');
    }
    return this.decisions.invalidateOpenReviewSuggestions(this.now().toISOString());
  }

  async decide(decision: LibraryAssistantDecision): Promise<LibraryAssistantDecisionResult> {
    validateDecision(decision);
    const previous = this.decisionTail;
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.decisionTail = previous.then(() => current);
    await previous;
    try {
      return await this.decideSerial(decision);
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
      if (
        decision.action === 'apply'
        && record
        && OPEN_STATUSES.has(record.suggestion.status)
        && record.suggestion.target.capability !== 'metadata'
      ) {
        results.push(result(
          decision,
          'failed',
          decision.expectedCurrentValue,
          'Sugestões de capa exigem revisão individual antes de baixar e persistir a imagem externa.'
        ));
        continue;
      }
      if (
        decision.action === 'apply'
        && record
        && OPEN_STATUSES.has(record.suggestion.status)
        && !isLibraryAssistantAutoApplicable(record.suggestion)
        && options.confirmReview !== true
      ) {
        results.push(result(
          decision,
          'failed',
          decision.expectedCurrentValue,
          'Esta sugestão exige confirmação explícita para aplicação em lote.'
        ));
        continue;
      }
      try {
        results.push(await this.decide(decision));
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

  private toReviewItem(
    run: ReviewRun,
    record: LibraryAssistantStoredSuggestion,
    tracks: ReadonlyMap<string, Track>
  ): LibraryAssistantReviewItem | null {
    const suggestion = record.suggestion;
    if (!isReviewableTarget(suggestion.target) || !OPEN_STATUSES.has(suggestion.status)) return null;
    const track = tracks.get(suggestion.target.trackId);
    if (!track) {
      const updatedAt = this.now().toISOString();
      if (this.decisions.transitionSuggestion(suggestion.id, 'stale', updatedAt)) {
        this.decisions.markRunStale(run.id, updatedAt);
      }
      return null;
    }
    const currentValue = liveTargetValue(track, suggestion.target, this.options.coverOverrides);
    if (
      currentValue == null
      || currentValue !== targetExpectedValue(suggestion.target)
      || (suggestion.target.capability === 'metadata'
        && this.hasHumanOverrideChangedSinceAnalysis(suggestion.target, suggestion.createdAt))
    ) {
      const updatedAt = this.now().toISOString();
      if (this.decisions.transitionSuggestion(suggestion.id, 'stale', updatedAt)) {
        this.decisions.markRunStale(run.id, updatedAt);
      }
      return null;
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

  private async decideSerial(decision: LibraryAssistantDecision): Promise<LibraryAssistantDecisionResult> {
    const run = this.options.store.getRun(decision.runId);
    if (!run) return result(decision, 'not-found', null, 'Run não encontrado.');
    const record = this.findSuggestionRecord(decision.runId, decision.suggestionId);
    if (!record) return result(decision, 'not-found', null, 'Sugestão não encontrada.');

    const suggestion = record.suggestion;
    if (suggestion.status === 'applied') return result(decision, 'already-applied', null);
    if (suggestion.status === 'rejected') return result(decision, 'already-rejected', null);
    if (suggestion.status === 'stale') return result(decision, 'stale', null, 'A sugestão já está desatualizada.');
    if (suggestion.status === 'failed') return result(decision, 'failed', null, 'A sugestão não está disponível para revisão.');
    if (!isReviewableTarget(suggestion.target)) {
      return result(decision, 'unsupported', null, 'Esta capability ainda não suporta apply/reject.');
    }
    if (run.libraryRevision !== decision.expectedLibraryRevision) {
      return this.markStale(decision, run, null, 'A revisão esperada não corresponde ao run analisado.');
    }
    const expectedValue = targetExpectedValue(suggestion.target);
    if (expectedValue !== decision.expectedCurrentValue) {
      return this.markStale(decision, run, null, 'O valor esperado não corresponde à sugestão analisada.');
    }

    return suggestion.target.capability === 'metadata'
      ? this.decideMetadata(decision, run, suggestion.target)
      : this.decideArtwork(decision, run, suggestion.target);
  }

  private decideMetadata(
    decision: LibraryAssistantDecision,
    run: ReviewRun,
    target: LibraryAssistantMetadataTarget
  ): LibraryAssistantDecisionResult {
    const track = this.options.library.listTracks().find(item => item.id === target.trackId);
    const currentValue = track ? liveMetadataValue(track, target) : null;
    if (currentValue == null || currentValue !== target.currentValue) {
      return this.markStale(decision, run, currentValue, 'A metadata mudou desde a análise. Revise uma nova sugestão.');
    }
    if (this.hasHumanOverrideChangedSinceAnalysis(target, this.findSuggestionRecord(decision.runId, decision.suggestionId)?.suggestion.createdAt ?? '')) {
      return this.markStale(
        decision,
        run,
        currentValue,
        'Uma decisão humana neste campo mudou depois da análise. Analise novamente antes de aplicar.'
      );
    }

    const updatedAt = this.now().toISOString();
    if (decision.action === 'reject') {
      const changed = this.decisions.transitionSuggestion(decision.suggestionId, 'rejected', updatedAt);
      if (!changed) return this.resolveRace(decision);
      return result(decision, 'rejected', currentValue);
    }

    try {
      const patch = normalizeMetadataOverridePatch({ [target.field]: target.suggestedValue });
      const metadata = this.options.metadataOverrides.patch(target.trackId, patch);
      if (!metadata) return this.markStale(decision, run, null, 'A música não existe mais na biblioteca.');
      const changed = this.decisions.transitionSuggestion(decision.suggestionId, 'applied', updatedAt);
      if (!changed) return this.resolveRace(decision);
      this.options.onMetadataChanged();
      return result(decision, 'applied', metadata.effective[target.field]);
    } catch {
      return result(decision, 'failed', currentValue, 'Não foi possível aplicar a metadata sugerida.');
    }
  }

  private async decideArtwork(
    decision: LibraryAssistantDecision,
    run: ReviewRun,
    target: LibraryAssistantArtworkTarget
  ): Promise<LibraryAssistantDecisionResult> {
    const track = this.options.library.listTracks().find(item => item.id === target.trackId);
    const currentValue = track ? liveArtworkValue(target.trackId, this.options.coverOverrides) : null;
    if (currentValue == null || currentValue !== artworkExpectedValue(target)) {
      return this.markStale(decision, run, currentValue, 'A capa mudou desde a análise. Revise uma nova sugestão.');
    }

    const updatedAt = this.now().toISOString();
    if (decision.action === 'reject') {
      const changed = this.decisions.transitionSuggestion(decision.suggestionId, 'rejected', updatedAt);
      if (!changed) return this.resolveRace(decision);
      return result(decision, 'rejected', currentValue);
    }

    try {
      const cover = this.options.coverOverrides.getStatus(target.trackId);
      if (!cover) return this.markStale(decision, run, null, 'A música não existe mais na biblioteca.');
      if (cover.override && !decision.replaceExistingArtworkOverride) {
        return result(
          decision,
          'failed',
          cover.override.version,
          'Já existe capa manual para esta faixa. Confirme a substituição antes de aplicar a capa do Cover Art Archive.'
        );
      }
      const downloaded = await this.downloadArtwork(target.sourceUrl);
      const saved = this.options.coverOverrides.save(target.trackId, downloaded.data, downloaded.contentType);
      if (!saved) return this.markStale(decision, run, null, 'A música não existe mais na biblioteca.');
      const changed = this.decisions.transitionSuggestion(decision.suggestionId, 'applied', updatedAt);
      if (!changed) return this.resolveRace(decision);
      this.options.onArtworkChanged();
      return result(decision, 'applied', saved.override?.version ?? 'override');
    } catch (error) {
      return result(
        decision,
        'failed',
        currentValue,
        error instanceof Error ? error.message : 'Não foi possível aplicar a capa sugerida.'
      );
    }
  }

  private hasHumanOverrideChangedSinceAnalysis(target: LibraryAssistantMetadataTarget, analyzedAt: string) {
    const fieldUpdatedAt = this.options.metadataOverrides.fieldUpdatedAt(target.trackId, target.field);
    return Boolean(fieldUpdatedAt && fieldUpdatedAt > analyzedAt);
  }

  private markStale(
    decision: LibraryAssistantDecision,
    run: ReviewRun,
    currentValue: string | null,
    message: string
  ) {
    const updatedAt = this.now().toISOString();
    if (this.decisions.transitionSuggestion(decision.suggestionId, 'stale', updatedAt)) {
      this.decisions.markRunStale(run.id, updatedAt);
    }
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
