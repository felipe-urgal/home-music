import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LIBRARY_ASSISTANT_ALGORITHM_VERSION,
  LIBRARY_ASSISTANT_CONTRACT_VERSION,
  type LibraryAssistantCapability,
  type LibraryAssistantConfidenceBand,
  type LibraryAssistantEvidence,
  type LibraryAssistantProvenance,
  type LibraryAssistantReasonCode,
  type LibraryAssistantRun,
  type LibraryAssistantRunError,
  type LibraryAssistantRunStatus,
  type LibraryAssistantSuggestion,
  type LibraryAssistantSuggestionStatus,
  type LibraryAssistantSuggestionTarget
} from '@home-music/shared/library-assistant';

const DEFAULT_MAX_RETAINED_RUNS = 200;
const MAX_PROVIDER_CACHE_ENTRIES = 500;
const MAX_PROVIDER_CACHE_PAYLOAD_BYTES = 64 * 1024;
const MAX_SUGGESTION_PAYLOAD_BYTES = 64 * 1024;
const MAX_IDENTIFIER_LENGTH = 192;
const MAX_REASON_CODES = 16;
const MAX_EVIDENCE_ITEMS = 32;
const INTERRUPTED_ERROR: LibraryAssistantRunError = {
  code: 'interrupted',
  message: 'A análise foi interrompida pelo reinício do serviço.',
  action: 'Inicie uma nova análise se ela ainda for necessária.'
};

const capabilities: readonly LibraryAssistantCapability[] = ['metadata', 'artwork', 'lyrics'];
const runStatuses: readonly LibraryAssistantRunStatus[] = [
  'queued', 'running', 'completed', 'failed', 'cancelled', 'stale'
];
const suggestionStatuses: readonly LibraryAssistantSuggestionStatus[] = [
  'pending', 'review', 'applied', 'rejected', 'stale', 'failed'
];
const confidenceBands: readonly LibraryAssistantConfidenceBand[] = ['low', 'medium', 'high'];

type Row = Record<string, unknown>;

type StoreOptions = {
  now?: () => Date;
  maxRetainedRuns?: number;
};

export type LibraryAssistantStoredSuggestionInput = {
  id: string;
  runId: string;
  capability: LibraryAssistantCapability;
  trackId: string;
  status?: 'pending' | 'review';
  confidence: LibraryAssistantConfidenceBand;
  reasonCodes: LibraryAssistantReasonCode[];
  evidence: LibraryAssistantEvidence[];
  provenance: LibraryAssistantProvenance;
  target: LibraryAssistantSuggestionTarget;
  premiseSignature: string;
  createdAt: string;
};

export type LibraryAssistantStoredSuggestion = {
  suggestion: LibraryAssistantSuggestion;
  premiseSignature: string;
};

export type LibraryAssistantProviderCacheKey = {
  provider: string;
  providerVersion: string;
  cacheKeyHash: string;
};

export type LibraryAssistantProviderCacheEntry = {
  payload: unknown;
  expiresAtMs: number;
  updatedAt: string;
};

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function parseJson(value: unknown, fallback: unknown) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function byteLength(value: string) {
  return Buffer.byteLength(value, 'utf8');
}

function requireIdentifier(value: string, label: string, maximum = MAX_IDENTIFIER_LENGTH) {
  if (!value || value.length > maximum || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new TypeError(`${label} inválido.`);
  }
}

function requireTrackId(value: string) {
  requireIdentifier(value, 'trackId', 64);
}

function requirePremiseSignature(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError('Assinatura de premissa inválida.');
}

function requireSafeText(value: string, label: string, maximum = 1_000) {
  if (value.length > maximum || /[\r\n\t]/.test(value)) throw new TypeError(`${label} inválido.`);
}

function validateEvidence(evidence: LibraryAssistantEvidence[]) {
  if (!Array.isArray(evidence) || evidence.length > MAX_EVIDENCE_ITEMS) {
    throw new RangeError('Quantidade de evidências inválida.');
  }
  for (const item of evidence) {
    if (item.version !== LIBRARY_ASSISTANT_CONTRACT_VERSION) {
      throw new TypeError('Versão de evidência não suportada.');
    }
    if (item.type === 'duration-delta') {
      if (!Number.isFinite(item.deltaSeconds) || Math.abs(item.deltaSeconds) > 24 * 60 * 60) {
        throw new RangeError('Delta de duração inválido.');
      }
      continue;
    }
    if (item.type === 'album-context') {
      if (
        !Number.isSafeInteger(item.matchedTracks)
        || !Number.isSafeInteger(item.totalTracks)
        || item.matchedTracks < 0
        || item.totalTracks < 0
        || item.matchedTracks > item.totalTracks
        || item.totalTracks > 10_000
      ) throw new RangeError('Contexto de álbum inválido.');
      continue;
    }
    if (item.type === 'source-conflict') {
      if (item.sources.length < 2 || item.sources.length > 8) {
        throw new RangeError('Conflito entre fontes inválido.');
      }
      continue;
    }
    if (item.type === 'file-context') {
      requireSafeText(item.fileName, 'fileName', 255);
      if (item.fileName.includes('/') || item.fileName.includes('\\')) {
        throw new TypeError('fileName não pode conter caminho físico.');
      }
      if (item.folderName != null) {
        requireSafeText(item.folderName, 'folderName', 255);
        if (item.folderName.includes('/') || item.folderName.includes('\\')) {
          throw new TypeError('folderName não pode conter caminho físico.');
        }
      }
      continue;
    }
    if (item.type === 'external-id') {
      requireSafeText(item.id, 'externalId', 256);
      continue;
    }
    requireSafeText(item.sourceValue, 'sourceValue', 512);
    requireSafeText(item.candidateValue, 'candidateValue', 512);
  }
}

function validateProvenance(provenance: LibraryAssistantProvenance) {
  if (provenance.providerVersion != null) requireSafeText(provenance.providerVersion, 'providerVersion', 128);
  if (provenance.externalId != null) requireSafeText(provenance.externalId, 'externalId', 256);
}

function validateTarget(target: LibraryAssistantSuggestionTarget, capability: LibraryAssistantCapability, trackId: string) {
  if (target.capability !== capability || target.trackId !== trackId) {
    throw new TypeError('Target da sugestão não corresponde à capability/faixa.');
  }
  if (target.capability === 'metadata') {
    requireSafeText(target.currentValue, 'currentValue', 1_000);
    requireSafeText(target.suggestedValue, 'suggestedValue', 1_000);
    return;
  }
  requireSafeText(target.candidateId, 'candidateId', 256);
  if (target.capability === 'artwork') {
    if (target.label != null) requireSafeText(target.label, 'artworkLabel', 256);
    return;
  }
  if (target.language != null) requireSafeText(target.language, 'language', 32);
}

function validateSuggestion(input: LibraryAssistantStoredSuggestionInput) {
  requireIdentifier(input.id, 'suggestionId');
  requireIdentifier(input.runId, 'runId');
  requireTrackId(input.trackId);
  requirePremiseSignature(input.premiseSignature);
  if (!capabilities.includes(input.capability)) throw new TypeError('Capability inválida.');
  if (!confidenceBands.includes(input.confidence)) throw new TypeError('Confiança inválida.');
  if (input.status && input.status !== 'pending' && input.status !== 'review') {
    throw new TypeError('Status inicial de sugestão inválido.');
  }
  if (
    !Array.isArray(input.reasonCodes)
    || input.reasonCodes.length === 0
    || input.reasonCodes.length > MAX_REASON_CODES
  ) throw new RangeError('Reason codes inválidos.');
  validateEvidence(input.evidence);
  validateProvenance(input.provenance);
  validateTarget(input.target, input.capability, input.trackId);

  const payload = JSON.stringify({
    reasonCodes: input.reasonCodes,
    evidence: input.evidence,
    provenance: input.provenance,
    target: input.target
  });
  if (byteLength(payload) > MAX_SUGGESTION_PAYLOAD_BYTES) {
    throw new RangeError('Sugestão excede o limite de persistência.');
  }
}

function runSummary(db: DatabaseSync, runId: string) {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM library_assistant_suggestions
    WHERE run_id = ?
    GROUP BY status;
  `).all(runId) as Row[];
  const summary: LibraryAssistantRun['summary'] = {
    total: 0,
    pending: 0,
    review: 0,
    applied: 0,
    rejected: 0,
    stale: 0,
    failed: 0
  };
  for (const row of rows) {
    const status = enumValue(row.status, suggestionStatuses, 'failed');
    const count = Math.max(0, Math.trunc(numberValue(row.count)));
    summary.total += count;
    summary[status] += count;
  }
  return summary;
}

function runFromRow(db: DatabaseSync, row: Row): LibraryAssistantRun {
  const errorCode = nullableString(row.error_code);
  const errorMessage = nullableString(row.error_message);
  const errorAction = nullableString(row.error_action);
  const id = stringValue(row.id);
  return {
    id,
    capability: enumValue(row.capability, capabilities, 'metadata'),
    status: enumValue(row.status, runStatuses, 'failed'),
    libraryRevision: Math.max(0, Math.trunc(numberValue(row.library_revision))),
    algorithmVersion: LIBRARY_ASSISTANT_ALGORITHM_VERSION,
    summary: runSummary(db, id),
    createdAt: stringValue(row.created_at),
    startedAt: nullableString(row.started_at),
    finishedAt: nullableString(row.finished_at),
    error: errorCode && errorMessage && errorAction
      ? { code: errorCode, message: errorMessage, action: errorAction }
      : null
  };
}

function suggestionFromRow(row: Row): LibraryAssistantStoredSuggestion {
  const capability = enumValue(row.capability, capabilities, 'metadata');
  const trackId = stringValue(row.track_id);
  const target = parseJson(row.target_json, null) as LibraryAssistantSuggestionTarget | null;
  const evidence = parseJson(row.evidence_json, []) as LibraryAssistantEvidence[];
  const reasonCodes = parseJson(row.reason_codes_json, []) as LibraryAssistantReasonCode[];
  const provenance = parseJson(row.provenance_json, null) as LibraryAssistantProvenance | null;
  if (!target || !provenance) throw new Error('Sugestão persistida inválida.');
  return {
    premiseSignature: stringValue(row.premise_signature),
    suggestion: {
      id: stringValue(row.id),
      runId: stringValue(row.run_id),
      capability,
      status: enumValue(row.status, suggestionStatuses, 'failed'),
      confidence: enumValue(row.confidence, confidenceBands, 'low'),
      reasonCodes,
      evidence,
      provenance,
      target: { ...target, trackId, capability } as LibraryAssistantSuggestionTarget,
      createdAt: stringValue(row.created_at),
      updatedAt: stringValue(row.updated_at)
    }
  };
}

export class LibraryAssistantStore {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly maxRetainedRuns: number;

  constructor(databasePath: string, options: StoreOptions = {}) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.now = options.now ?? (() => new Date());
    this.maxRetainedRuns = Math.max(10, Math.min(2_000, Math.trunc(
      options.maxRetainedRuns ?? DEFAULT_MAX_RETAINED_RUNS
    )));

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_assistant_runs (
        id TEXT PRIMARY KEY NOT NULL,
        capability TEXT NOT NULL CHECK(capability IN ('metadata', 'artwork', 'lyrics')),
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'stale')),
        library_revision INTEGER NOT NULL CHECK(library_revision >= 0),
        algorithm_version INTEGER NOT NULL CHECK(algorithm_version > 0),
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error_code TEXT,
        error_message TEXT,
        error_action TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_library_assistant_runs_created
      ON library_assistant_runs(created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS library_assistant_suggestions (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES library_assistant_runs(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        capability TEXT NOT NULL CHECK(capability IN ('metadata', 'artwork', 'lyrics')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'review', 'applied', 'rejected', 'stale', 'failed')),
        confidence TEXT NOT NULL CHECK(confidence IN ('low', 'medium', 'high')),
        reason_codes_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        target_json TEXT NOT NULL,
        premise_signature TEXT NOT NULL CHECK(length(premise_signature) = 64),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_library_assistant_suggestions_run_status
      ON library_assistant_suggestions(run_id, status, created_at ASC, id ASC);

      CREATE TABLE IF NOT EXISTS library_assistant_provider_cache (
        provider TEXT NOT NULL,
        provider_version TEXT NOT NULL,
        cache_key_hash TEXT NOT NULL CHECK(length(cache_key_hash) = 64),
        payload_json TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(provider, provider_version, cache_key_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_library_assistant_provider_cache_expiry
      ON library_assistant_provider_cache(expires_at_ms ASC);
    `);

    const interruptedAt = this.now().toISOString();
    this.db.prepare(`
      UPDATE library_assistant_runs
      SET status = 'failed', finished_at = ?, error_code = ?, error_message = ?, error_action = ?
      WHERE status IN ('queued', 'running');
    `).run(
      interruptedAt,
      INTERRUPTED_ERROR.code,
      INTERRUPTED_ERROR.message,
      INTERRUPTED_ERROR.action
    );
    this.pruneExpiredProviderCache(this.now().getTime());
  }

  close() {
    this.db.close();
  }

  createRun(input: {
    id: string;
    capability: LibraryAssistantCapability;
    libraryRevision: number;
    createdAt: string;
  }) {
    requireIdentifier(input.id, 'runId');
    if (!capabilities.includes(input.capability)) throw new TypeError('Capability inválida.');
    if (!Number.isSafeInteger(input.libraryRevision) || input.libraryRevision < 0) {
      throw new RangeError('Library revision inválida.');
    }
    this.db.prepare(`
      INSERT INTO library_assistant_runs(
        id, capability, status, library_revision, algorithm_version, created_at
      ) VALUES (?, ?, 'queued', ?, ?, ?);
    `).run(
      input.id,
      input.capability,
      input.libraryRevision,
      LIBRARY_ASSISTANT_ALGORITHM_VERSION,
      input.createdAt
    );
    this.pruneRuns();
    return this.getRun(input.id)!;
  }

  getRun(id: string) {
    const row = this.db.prepare(`
      SELECT * FROM library_assistant_runs WHERE id = ? LIMIT 1;
    `).get(id) as Row | undefined;
    return row ? runFromRow(this.db, row) : null;
  }

  listRuns(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    return (this.db.prepare(`
      SELECT *
      FROM library_assistant_runs
      ORDER BY created_at DESC, id DESC
      LIMIT ?;
    `).all(safeLimit) as Row[]).map(row => runFromRow(this.db, row));
  }

  startRun(id: string, startedAt: string) {
    const result = this.db.prepare(`
      UPDATE library_assistant_runs
      SET status = 'running', started_at = ?, error_code = NULL, error_message = NULL, error_action = NULL
      WHERE id = ? AND status = 'queued';
    `).run(startedAt, id);
    return Number(result.changes) > 0;
  }

  insertSuggestions(inputs: readonly LibraryAssistantStoredSuggestionInput[]) {
    if (inputs.length === 0) return;
    if (inputs.length > 5_000) throw new RangeError('Análise excedeu o limite de sugestões.');
    for (const input of inputs) validateSuggestion(input);

    const insert = this.db.prepare(`
      INSERT INTO library_assistant_suggestions(
        id, run_id, track_id, capability, status, confidence,
        reason_codes_json, evidence_json, provenance_json, target_json,
        premise_signature, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const input of inputs) {
        insert.run(
          input.id,
          input.runId,
          input.trackId,
          input.capability,
          input.status ?? 'review',
          input.confidence,
          JSON.stringify(input.reasonCodes),
          JSON.stringify(input.evidence),
          JSON.stringify(input.provenance),
          JSON.stringify(input.target),
          input.premiseSignature,
          input.createdAt,
          input.createdAt
        );
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  listSuggestionRecords(
    runId: string,
    filters: { status?: LibraryAssistantSuggestionStatus; limit?: number } = {}
  ) {
    const status = filters.status;
    if (status && !suggestionStatuses.includes(status)) throw new TypeError('Status de sugestão inválido.');
    const limit = Math.max(1, Math.min(500, Math.trunc(filters.limit ?? 200)));
    const rows = status
      ? this.db.prepare(`
          SELECT * FROM library_assistant_suggestions
          WHERE run_id = ? AND status = ?
          ORDER BY created_at ASC, id ASC
          LIMIT ?;
        `).all(runId, status, limit) as Row[]
      : this.db.prepare(`
          SELECT * FROM library_assistant_suggestions
          WHERE run_id = ?
          ORDER BY created_at ASC, id ASC
          LIMIT ?;
        `).all(runId, limit) as Row[];
    return rows.map(suggestionFromRow);
  }

  markSuggestionStale(id: string, updatedAt: string) {
    const result = this.db.prepare(`
      UPDATE library_assistant_suggestions
      SET status = 'stale', updated_at = ?
      WHERE id = ? AND status IN ('pending', 'review');
    `).run(updatedAt, id);
    return Number(result.changes) > 0;
  }

  completeRun(id: string, finishedAt: string) {
    const result = this.db.prepare(`
      UPDATE library_assistant_runs
      SET status = 'completed', finished_at = ?
      WHERE id = ? AND status = 'running';
    `).run(finishedAt, id);
    return Number(result.changes) > 0;
  }

  markRunStale(id: string, finishedAt: string) {
    const result = this.db.prepare(`
      UPDATE library_assistant_runs
      SET status = 'stale', finished_at = COALESCE(finished_at, ?)
      WHERE id = ? AND status IN ('queued', 'running', 'completed');
    `).run(finishedAt, id);
    return Number(result.changes) > 0;
  }

  failRun(id: string, finishedAt: string, error: LibraryAssistantRunError) {
    requireSafeText(error.code, 'errorCode', 64);
    requireSafeText(error.message, 'errorMessage', 320);
    requireSafeText(error.action, 'errorAction', 320);
    const result = this.db.prepare(`
      UPDATE library_assistant_runs
      SET status = 'failed', finished_at = ?, error_code = ?, error_message = ?, error_action = ?
      WHERE id = ? AND status IN ('queued', 'running');
    `).run(finishedAt, error.code, error.message, error.action, id);
    return Number(result.changes) > 0;
  }

  cancelRun(id: string, finishedAt: string) {
    const result = this.db.prepare(`
      UPDATE library_assistant_runs
      SET status = 'cancelled', finished_at = ?, error_code = NULL, error_message = NULL, error_action = NULL
      WHERE id = ? AND status IN ('queued', 'running');
    `).run(finishedAt, id);
    return Number(result.changes) > 0;
  }

  getProviderCache(key: LibraryAssistantProviderCacheKey, nowMs: number): LibraryAssistantProviderCacheEntry | null {
    this.validateProviderCacheKey(key);
    const row = this.db.prepare(`
      SELECT payload_json, expires_at_ms, updated_at
      FROM library_assistant_provider_cache
      WHERE provider = ? AND provider_version = ? AND cache_key_hash = ?
      LIMIT 1;
    `).get(key.provider, key.providerVersion, key.cacheKeyHash) as Row | undefined;
    if (!row) return null;
    const expiresAtMs = Math.trunc(numberValue(row.expires_at_ms));
    if (expiresAtMs <= nowMs) {
      this.deleteProviderCache(key);
      return null;
    }
    return {
      payload: parseJson(row.payload_json, null),
      expiresAtMs,
      updatedAt: stringValue(row.updated_at)
    };
  }

  putProviderCache(
    key: LibraryAssistantProviderCacheKey,
    payload: unknown,
    expiresAtMs: number,
    updatedAt: string
  ) {
    this.validateProviderCacheKey(key);
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
      throw new RangeError('Expiração de cache inválida.');
    }
    const payloadJson = JSON.stringify(payload);
    if (byteLength(payloadJson) > MAX_PROVIDER_CACHE_PAYLOAD_BYTES) {
      throw new RangeError('Payload normalizado do provider excede o limite de cache.');
    }
    this.db.prepare(`
      INSERT INTO library_assistant_provider_cache(
        provider, provider_version, cache_key_hash, payload_json, expires_at_ms, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_version, cache_key_hash) DO UPDATE SET
        payload_json = excluded.payload_json,
        expires_at_ms = excluded.expires_at_ms,
        updated_at = excluded.updated_at;
    `).run(
      key.provider,
      key.providerVersion,
      key.cacheKeyHash,
      payloadJson,
      expiresAtMs,
      updatedAt
    );
    this.pruneProviderCache();
  }

  deleteProviderCache(key: LibraryAssistantProviderCacheKey) {
    this.validateProviderCacheKey(key);
    this.db.prepare(`
      DELETE FROM library_assistant_provider_cache
      WHERE provider = ? AND provider_version = ? AND cache_key_hash = ?;
    `).run(key.provider, key.providerVersion, key.cacheKeyHash);
  }

  clearProviderCache(provider?: string) {
    if (provider == null) {
      this.db.exec('DELETE FROM library_assistant_provider_cache;');
      return;
    }
    requireIdentifier(provider, 'provider', 64);
    this.db.prepare('DELETE FROM library_assistant_provider_cache WHERE provider = ?;').run(provider);
  }

  private validateProviderCacheKey(key: LibraryAssistantProviderCacheKey) {
    requireIdentifier(key.provider, 'provider', 64);
    requireIdentifier(key.providerVersion, 'providerVersion', 64);
    if (!/^[a-f0-9]{64}$/.test(key.cacheKeyHash)) throw new TypeError('Hash da chave de cache inválido.');
  }

  private pruneExpiredProviderCache(nowMs: number) {
    this.db.prepare('DELETE FROM library_assistant_provider_cache WHERE expires_at_ms <= ?;').run(nowMs);
  }

  private pruneProviderCache() {
    this.pruneExpiredProviderCache(this.now().getTime());
    this.db.prepare(`
      DELETE FROM library_assistant_provider_cache
      WHERE rowid IN (
        SELECT rowid
        FROM library_assistant_provider_cache
        ORDER BY updated_at DESC, rowid DESC
        LIMIT -1 OFFSET ?
      );
    `).run(MAX_PROVIDER_CACHE_ENTRIES);
  }

  private pruneRuns() {
    this.db.prepare(`
      DELETE FROM library_assistant_runs
      WHERE id IN (
        SELECT id
        FROM library_assistant_runs
        WHERE status IN ('completed', 'failed', 'cancelled', 'stale')
        ORDER BY created_at DESC, id DESC
        LIMIT -1 OFFSET ?
      );
    `).run(this.maxRetainedRuns);
  }
}
