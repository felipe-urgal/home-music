import { DatabaseSync } from 'node:sqlite';
import type { Track } from '@home-music/shared';
import {
  isLibraryAssistantAutoApplicable,
  type AdminLibraryAssistantBatchDecisionResponse,
  type AdminLibraryAssistantReviewResponse,
  type LibraryAssistantDecision,
  type LibraryAssistantDecisionResult,
  type LibraryAssistantDecisionSummary,
  type LibraryAssistantMetadataTarget,
  type LibraryAssistantReviewItem,
  type LibraryAssistantSuggestionStatus
} from '@home-music/shared/library-assistant';
import type { LibraryAssistantStore, LibraryAssistantStoredSuggestion } from './library-assistant-store.js';
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
  library: ReviewLibrary;
  onMetadataChanged: () => void;
  now?: () => Date;
};

type ReviewRun = NonNullable<ReturnType<LibraryAssistantStore['getRun']>>;
type Row = Record<string, unknown>;

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function storedSuggestionFromRow(row: Row): LibraryAssistantStoredSuggestion {
  const capability = stringValue(row.capability) as LibraryAssistantStoredSuggestion['suggestion']['capability'];
  const trackId = stringValue(row.track_id);
  const target = jsonValue<LibraryAssistantStoredSuggestion['suggestion']['target']>(row.target_json, {
    capability: 'metadata',
    trackId,
    field: 'title',
    currentValue: '',
    suggestedValue: ''
  });
  return {
    premiseSignature: stringValue(row.premise_signature),
    suggestion: {
      id: stringValue(row.id),
      runId: stringValue(row.run_id),
      capability,
      status: stringValue(row.status) as LibraryAssistantStoredSuggestion['suggestion']['status'],
      confidence: stringValue(row.confidence) as LibraryAssistantStoredSuggestion['suggestion']['confidence'],
      reasonCodes: jsonValue(row.reason_codes_json, []),
      evidence: jsonValue(row.evidence_json, []),
      provenance: jsonValue(row.provenance_json, { source: 'local', providerVersion: null, externalId: null }),
      target: { ...target, capability, trackId } as LibraryAssistantStoredSuggestion['suggestion']['target'],
      createdAt: stringValue(row.created_at),
      updatedAt: stringValue(row.updated_at)
    }
  };
}

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

  getSuggestionRecord(runId: string, suggestionId: string) {
    const row = this.db.prepare(`
      SELECT *
      FROM library_assistant_suggestions
      WHERE run_id = ? AND id = ?
      LIMIT 1;
    `).get(runId, suggestionId) as Row | undefined;
    return row ? storedSuggestionFromRow(row) : null;
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
}

export class LibraryAssistantReviewService {
  private readonly decisions: LibraryAssistantDecisionStore;
  private readonly now: () => Date;
  private decisionTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: ReviewServiceOptions) {
    this.decisions = new LibraryAssistantDecisionStore(options.databasePath);
    this.now = options.now ?? (() => new Date());
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
      if (run.capability !== 'metadata' || !['completed', 'stale'].includes(run.status)) continue;
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

  async decide(decision: LibraryAssistantDecision): Promise<LibraryAssistantDecisionResult> {
    validateDecision(decision);
    const previous = this.decisionTail;
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.decisionTail = previous.then(() => current);
    await previous;
    try {
      return this.decideSerial(decision);
    } finally {
      release();
    }
  }

  async decideBatch(decisions: LibraryAssistantDecision[]): Promise<AdminLibraryAssistantBatchDecisionResponse> {
    if (!Array.isArray(decisions) || decisions.length < 1 || decisions.length > MAX_BATCH_DECISIONS) {
      throw new RangeError(`O lote deve conter entre 1 e ${MAX_BATCH_DECISIONS} decisões.`);
    }
    for (const decision of decisions) validateDecision(decision);
    const keys = decisions.map(decision => `${decision.runId}:${decision.suggestionId}`);
    if (new Set(keys).size !== keys.length) throw new TypeError('O lote contém sugestões duplicadas.');

    const results: LibraryAssistantDecisionResult[] = [];
    for (const decision of decisions) {
      const record = this.decisions.getSuggestionRecord(decision.runId, decision.suggestionId);
      if (
        decision.action === 'apply'
        && record
        && OPEN_STATUSES.has(record.suggestion.status)
        && !isLibraryAssistantAutoApplicable(record.suggestion)
      ) {
        results.push(result(
          decision,
          'failed',
          decision.expectedCurrentValue,
          'Esta sugestão exige revisão individual e não pode ser aplicada pelo lote seguro.'
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

  private toReviewItem(
    run: ReviewRun,
    record: LibraryAssistantStoredSuggestion,
    tracks: ReadonlyMap<string, Track>
  ): LibraryAssistantReviewItem | null {
    const suggestion = record.suggestion;
    if (suggestion.target.capability !== 'metadata' || !OPEN_STATUSES.has(suggestion.status)) return null;
    const track = tracks.get(suggestion.target.trackId);
    if (!track) {
      const updatedAt = this.now().toISOString();
      if (this.decisions.transitionSuggestion(suggestion.id, 'stale', updatedAt)) {
        this.decisions.markRunStale(run.id, updatedAt);
      }
      return null;
    }
    const currentValue = liveMetadataValue(track, suggestion.target);
    if (
      currentValue !== suggestion.target.currentValue
      || this.hasHumanOverrideChangedSinceAnalysis(suggestion.target, suggestion.createdAt)
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

  private decideSerial(decision: LibraryAssistantDecision): LibraryAssistantDecisionResult {
    const run = this.options.store.getRun(decision.runId);
    if (!run) return result(decision, 'not-found', null, 'Run não encontrado.');
    const record = this.decisions.getSuggestionRecord(decision.runId, decision.suggestionId);
    if (!record) return result(decision, 'not-found', null, 'Sugestão não encontrada.');

    const suggestion = record.suggestion;
    if (suggestion.status === 'applied') return result(decision, 'already-applied', null);
    if (suggestion.status === 'rejected') return result(decision, 'already-rejected', null);
    if (suggestion.status === 'stale') return result(decision, 'stale', null, 'A sugestão já está desatualizada.');
    if (suggestion.status === 'failed') return result(decision, 'failed', null, 'A sugestão não está disponível para revisão.');
    if (suggestion.target.capability !== 'metadata') {
      return result(decision, 'unsupported', null, 'Esta capability ainda não suporta apply/reject.');
    }
    if (run.libraryRevision !== decision.expectedLibraryRevision) {
      return this.markStale(decision, run, null, 'A revisão esperada não corresponde ao run analisado.');
    }
    if (suggestion.target.currentValue !== decision.expectedCurrentValue) {
      return this.markStale(decision, run, null, 'O valor esperado não corresponde à sugestão analisada.');
    }

    const track = this.options.library.listTracks().find(item => item.id === suggestion.target.trackId);
    const currentValue = track ? liveMetadataValue(track, suggestion.target) : null;
    if (currentValue == null || currentValue !== suggestion.target.currentValue) {
      return this.markStale(decision, run, currentValue, 'A metadata mudou desde a análise. Revise uma nova sugestão.');
    }
    if (this.hasHumanOverrideChangedSinceAnalysis(suggestion.target, suggestion.createdAt)) {
      return this.markStale(
        decision,
        run,
        currentValue,
        'Uma decisão humana neste campo mudou depois da análise. Analise novamente antes de aplicar.'
      );
    }

    const updatedAt = this.now().toISOString();
    if (decision.action === 'reject') {
      const changed = this.decisions.transitionSuggestion(suggestion.id, 'rejected', updatedAt);
      if (!changed) return this.resolveRace(decision);
      return result(decision, 'rejected', currentValue);
    }

    try {
      const patch = normalizeMetadataOverridePatch({ [suggestion.target.field]: suggestion.target.suggestedValue });
      const metadata = this.options.metadataOverrides.patch(suggestion.target.trackId, patch);
      if (!metadata) return this.markStale(decision, run, null, 'A música não existe mais na biblioteca.');
      const changed = this.decisions.transitionSuggestion(suggestion.id, 'applied', updatedAt);
      if (!changed) return this.resolveRace(decision);
      this.options.onMetadataChanged();
      return result(decision, 'applied', metadata.effective[suggestion.target.field]);
    } catch {
      return result(decision, 'failed', currentValue, 'Não foi possível aplicar a metadata sugerida.');
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
    const record = this.decisions.getSuggestionRecord(decision.runId, decision.suggestionId);
    if (!record) return result(decision, 'not-found', null, 'Sugestão não encontrada.');
    if (record.suggestion.status === 'applied') return result(decision, 'already-applied', null);
    if (record.suggestion.status === 'rejected') return result(decision, 'already-rejected', null);
    if (record.suggestion.status === 'stale') return result(decision, 'stale', null);
    return result(decision, 'failed', null, 'A sugestão foi alterada por outra operação.');
  }
}
