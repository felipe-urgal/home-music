import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM,
  LIBRARY_ASSISTANT_CONTENT_HASH_VERSION,
  type LibraryAssistantContentIdentity,
  type LibraryAssistantJob,
  type LibraryAssistantJobError,
  type LibraryAssistantJobKind,
  type LibraryAssistantJobStatus
} from '@home-music/shared/library-assistant';

const INTERRUPTED_ERROR: LibraryAssistantJobError = {
  code: 'interrupted',
  message: 'O job foi interrompido pelo reinício do serviço.',
  action: 'Inicie o job novamente se ele ainda for necessário.'
};

type Row = Record<string, unknown>;

type CacheEvidence = {
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
};

type CreateJobInput = {
  id: string;
  kind: LibraryAssistantJobKind;
  libraryRevision: number;
  total: number;
  createdAt: string;
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

function parseStatus(value: unknown): LibraryAssistantJobStatus {
  if (
    value === 'queued'
    || value === 'running'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
    || value === 'stale'
  ) return value;
  return 'failed';
}

function parseKind(value: unknown): LibraryAssistantJobKind {
  return value === 'content-hash' ? value : 'content-hash';
}

function jobFromRow(row: Row): LibraryAssistantJob {
  const errorCode = nullableString(row.error_code);
  const errorMessage = nullableString(row.error_message);
  const errorAction = nullableString(row.error_action);
  return {
    id: stringValue(row.id),
    kind: parseKind(row.kind),
    status: parseStatus(row.status),
    libraryRevision: Math.max(0, Math.trunc(numberValue(row.library_revision))),
    progress: {
      completed: Math.max(0, Math.trunc(numberValue(row.completed_items))),
      total: Math.max(0, Math.trunc(numberValue(row.total_items)))
    },
    createdAt: stringValue(row.created_at),
    startedAt: nullableString(row.started_at),
    finishedAt: nullableString(row.finished_at),
    error: errorCode && errorMessage && errorAction
      ? { code: errorCode, message: errorMessage, action: errorAction }
      : null
  };
}

function validateEvidence(evidence: CacheEvidence) {
  if (!evidence.relativePath || path.posix.isAbsolute(evidence.relativePath) || evidence.relativePath.includes('\\')) {
    throw new TypeError('Evidência de cache exige caminho relativo normalizado.');
  }
  if (!Number.isSafeInteger(evidence.sizeBytes) || evidence.sizeBytes < 0) {
    throw new RangeError('Tamanho da evidência de cache inválido.');
  }
  if (!Number.isFinite(evidence.mtimeMs) || evidence.mtimeMs < 0) {
    throw new RangeError('mtime da evidência de cache inválido.');
  }
}

function validateIdentity(identity: LibraryAssistantContentIdentity) {
  if (
    identity.algorithm !== LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM
    || identity.version !== LIBRARY_ASSISTANT_CONTENT_HASH_VERSION
    || !/^[a-f0-9]{64}$/.test(identity.digest)
    || !Number.isSafeInteger(identity.sizeBytes)
    || identity.sizeBytes < 0
  ) {
    throw new TypeError('Identidade por conteúdo inválida.');
  }
}

export class LibraryAssistantStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string, now = new Date()) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_assistant_content_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        algorithm TEXT NOT NULL,
        version INTEGER NOT NULL,
        digest TEXT NOT NULL CHECK(length(digest) = 64),
        size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
        created_at TEXT NOT NULL,
        UNIQUE(algorithm, version, digest, size_bytes)
      );

      CREATE TABLE IF NOT EXISTS library_assistant_hash_cache (
        relative_path TEXT NOT NULL,
        file_size INTEGER NOT NULL CHECK(file_size >= 0),
        mtime_ms REAL NOT NULL CHECK(mtime_ms >= 0),
        algorithm TEXT NOT NULL,
        version INTEGER NOT NULL,
        identity_id INTEGER NOT NULL REFERENCES library_assistant_content_identities(id) ON DELETE CASCADE,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(relative_path, file_size, mtime_ms, algorithm, version)
      );

      CREATE INDEX IF NOT EXISTS idx_library_assistant_hash_cache_identity
      ON library_assistant_hash_cache(identity_id);

      CREATE TABLE IF NOT EXISTS library_assistant_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('content-hash')),
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'stale')),
        library_revision INTEGER NOT NULL CHECK(library_revision >= 0),
        total_items INTEGER NOT NULL CHECK(total_items >= 0),
        completed_items INTEGER NOT NULL DEFAULT 0 CHECK(completed_items >= 0),
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error_code TEXT,
        error_message TEXT,
        error_action TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_library_assistant_jobs_created
      ON library_assistant_jobs(created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS library_assistant_job_results (
        job_id TEXT NOT NULL REFERENCES library_assistant_jobs(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL,
        identity_id INTEGER NOT NULL REFERENCES library_assistant_content_identities(id) ON DELETE RESTRICT,
        PRIMARY KEY(job_id, track_id)
      );
    `);

    const interruptedAt = now.toISOString();
    this.db.prepare(`
      UPDATE library_assistant_jobs
      SET status = 'failed',
          finished_at = ?,
          error_code = ?,
          error_message = ?,
          error_action = ?
      WHERE status IN ('queued', 'running');
    `).run(
      interruptedAt,
      INTERRUPTED_ERROR.code,
      INTERRUPTED_ERROR.message,
      INTERRUPTED_ERROR.action
    );
  }

  close() {
    this.db.close();
  }

  getCachedIdentity(evidence: CacheEvidence): LibraryAssistantContentIdentity | null {
    validateEvidence(evidence);
    const row = this.db.prepare(`
      SELECT i.algorithm, i.version, i.digest, i.size_bytes
      FROM library_assistant_hash_cache c
      JOIN library_assistant_content_identities i ON i.id = c.identity_id
      WHERE c.relative_path = ?
        AND c.file_size = ?
        AND c.mtime_ms = ?
        AND c.algorithm = ?
        AND c.version = ?
      LIMIT 1;
    `).get(
      evidence.relativePath,
      evidence.sizeBytes,
      evidence.mtimeMs,
      LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM,
      LIBRARY_ASSISTANT_CONTENT_HASH_VERSION
    ) as Row | undefined;
    if (!row) return null;
    return {
      algorithm: LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM,
      version: LIBRARY_ASSISTANT_CONTENT_HASH_VERSION,
      digest: stringValue(row.digest),
      sizeBytes: Math.max(0, Math.trunc(numberValue(row.size_bytes)))
    };
  }

  putCachedIdentity(
    evidence: CacheEvidence,
    identity: LibraryAssistantContentIdentity,
    updatedAt: string
  ) {
    validateEvidence(evidence);
    validateIdentity(identity);
    if (identity.sizeBytes !== evidence.sizeBytes) {
      throw new TypeError('Identidade e evidência possuem tamanhos incompatíveis.');
    }

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.prepare(`
        INSERT INTO library_assistant_content_identities(
          algorithm, version, digest, size_bytes, created_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(algorithm, version, digest, size_bytes) DO NOTHING;
      `).run(identity.algorithm, identity.version, identity.digest, identity.sizeBytes, updatedAt);
      const identityRow = this.db.prepare(`
        SELECT id
        FROM library_assistant_content_identities
        WHERE algorithm = ? AND version = ? AND digest = ? AND size_bytes = ?;
      `).get(identity.algorithm, identity.version, identity.digest, identity.sizeBytes) as Row | undefined;
      const identityId = Math.trunc(numberValue(identityRow?.id));
      if (identityId <= 0) throw new Error('Identidade por conteúdo não pôde ser persistida.');

      this.db.prepare(`
        DELETE FROM library_assistant_hash_cache
        WHERE relative_path = ? AND algorithm = ? AND version = ?;
      `).run(evidence.relativePath, identity.algorithm, identity.version);
      this.db.prepare(`
        INSERT INTO library_assistant_hash_cache(
          relative_path, file_size, mtime_ms, algorithm, version, identity_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
      `).run(
        evidence.relativePath,
        evidence.sizeBytes,
        evidence.mtimeMs,
        identity.algorithm,
        identity.version,
        identityId,
        updatedAt
      );
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  createJob(input: CreateJobInput) {
    this.db.prepare(`
      INSERT INTO library_assistant_jobs(
        id, kind, status, library_revision, total_items, completed_items, created_at
      ) VALUES (?, ?, 'queued', ?, ?, 0, ?);
    `).run(input.id, input.kind, input.libraryRevision, input.total, input.createdAt);
    return this.getJob(input.id)!;
  }

  getJob(id: string) {
    const row = this.db.prepare(`
      SELECT * FROM library_assistant_jobs WHERE id = ? LIMIT 1;
    `).get(id) as Row | undefined;
    return row ? jobFromRow(row) : null;
  }

  listJobs(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    return (this.db.prepare(`
      SELECT *
      FROM library_assistant_jobs
      ORDER BY created_at DESC, id DESC
      LIMIT ?;
    `).all(safeLimit) as Row[]).map(jobFromRow);
  }

  startJob(id: string, startedAt: string) {
    const result = this.db.prepare(`
      UPDATE library_assistant_jobs
      SET status = 'running', started_at = ?, error_code = NULL, error_message = NULL, error_action = NULL
      WHERE id = ? AND status = 'queued';
    `).run(startedAt, id);
    return Number(result.changes) > 0;
  }

  setProgress(id: string, completed: number) {
    this.db.prepare(`
      UPDATE library_assistant_jobs
      SET completed_items = MIN(total_items, MAX(completed_items, ?))
      WHERE id = ? AND status = 'running';
    `).run(Math.max(0, Math.trunc(completed)), id);
  }

  recordResult(jobId: string, trackId: string, identity: LibraryAssistantContentIdentity) {
    validateIdentity(identity);
    const row = this.db.prepare(`
      SELECT id
      FROM library_assistant_content_identities
      WHERE algorithm = ? AND version = ? AND digest = ? AND size_bytes = ?
      LIMIT 1;
    `).get(identity.algorithm, identity.version, identity.digest, identity.sizeBytes) as Row | undefined;
    const identityId = Math.trunc(numberValue(row?.id));
    if (identityId <= 0) throw new Error('Resultado referencia identidade não persistida.');
    this.db.prepare(`
      INSERT INTO library_assistant_job_results(job_id, track_id, identity_id)
      VALUES (?, ?, ?)
      ON CONFLICT(job_id, track_id) DO UPDATE SET identity_id = excluded.identity_id;
    `).run(jobId, trackId, identityId);
  }

  completeJob(id: string, finishedAt: string) {
    const result = this.db.prepare(`
      UPDATE library_assistant_jobs
      SET status = 'completed', completed_items = total_items, finished_at = ?
      WHERE id = ? AND status = 'running';
    `).run(finishedAt, id);
    return Number(result.changes) > 0;
  }

  failJob(id: string, finishedAt: string, error: LibraryAssistantJobError) {
    const result = this.db.prepare(`
      UPDATE library_assistant_jobs
      SET status = 'failed', finished_at = ?, error_code = ?, error_message = ?, error_action = ?
      WHERE id = ? AND status IN ('queued', 'running');
    `).run(finishedAt, error.code, error.message, error.action, id);
    return Number(result.changes) > 0;
  }

  cancelJob(id: string, finishedAt: string) {
    const result = this.db.prepare(`
      UPDATE library_assistant_jobs
      SET status = 'cancelled', finished_at = ?, error_code = NULL, error_message = NULL, error_action = NULL
      WHERE id = ? AND status IN ('queued', 'running');
    `).run(finishedAt, id);
    return Number(result.changes) > 0;
  }

  markStale(id: string, finishedAt: string) {
    const result = this.db.prepare(`
      UPDATE library_assistant_jobs
      SET status = 'stale', finished_at = ?, error_code = NULL, error_message = NULL, error_action = NULL
      WHERE id = ? AND status IN ('queued', 'running', 'completed');
    `).run(finishedAt, id);
    return Number(result.changes) > 0;
  }

  markStaleForRevision(currentRevision: number, finishedAt: string) {
    const rows = this.db.prepare(`
      SELECT id
      FROM library_assistant_jobs
      WHERE library_revision <> ? AND status IN ('queued', 'running', 'completed');
    `).all(currentRevision) as Row[];
    const ids = rows.map(row => stringValue(row.id)).filter(Boolean);
    if (ids.length === 0) return ids;
    const mark = this.db.prepare(`
      UPDATE library_assistant_jobs
      SET status = 'stale', finished_at = ?, error_code = NULL, error_message = NULL, error_action = NULL
      WHERE id = ? AND status IN ('queued', 'running', 'completed');
    `);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const id of ids) mark.run(finishedAt, id);
      this.db.exec('COMMIT;');
      return ids;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  countContentIdentities() {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM library_assistant_content_identities;').get() as Row;
    return Math.max(0, Math.trunc(numberValue(row.count)));
  }
}
