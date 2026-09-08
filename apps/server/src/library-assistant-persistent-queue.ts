import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const QUEUE_INSTALLATION_KEY = 'installed_at';
const INTERRUPTED_ERROR_CODE = 'interrupted';
const MAX_IDENTIFIER_LENGTH = 192;

export type LibraryAssistantWorkStatus =
  | 'pending'
  | 'processing'
  | 'matched'
  | 'no_match'
  | 'retry'
  | 'failed';

export type LibraryAssistantWorkItem = {
  runId: string;
  analyzerId: string;
  trackId: string;
  status: LibraryAssistantWorkStatus;
  attempts: number;
  retryAtMs: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorAction: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LibraryAssistantWorkSummary = Record<LibraryAssistantWorkStatus, number> & {
  total: number;
};

type WorkError = { code: string; message: string; action: string };
type Row = Record<string, unknown>;

type PersistentQueueOptions = {
  now?: () => Date;
  onRetry?: (item: LibraryAssistantWorkItem, error: WorkError) => void;
};

const workStatuses: readonly LibraryAssistantWorkStatus[] = [
  'pending',
  'processing',
  'matched',
  'no_match',
  'retry',
  'failed'
];

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

function nullableNumber(value: unknown) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function workStatus(value: unknown): LibraryAssistantWorkStatus {
  return typeof value === 'string' && workStatuses.includes(value as LibraryAssistantWorkStatus)
    ? value as LibraryAssistantWorkStatus
    : 'failed';
}

function requireIdentifier(value: string, label: string, maximum = MAX_IDENTIFIER_LENGTH) {
  if (!value || value.length > maximum || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new TypeError(`${label} inválido.`);
  }
}

function itemFromRow(row: Row): LibraryAssistantWorkItem {
  return {
    runId: stringValue(row.run_id),
    analyzerId: stringValue(row.analyzer_id),
    trackId: stringValue(row.track_id),
    status: workStatus(row.status),
    attempts: Math.max(0, Math.trunc(numberValue(row.attempts))),
    retryAtMs: nullableNumber(row.retry_at_ms),
    lastErrorCode: nullableString(row.last_error_code),
    lastErrorMessage: nullableString(row.last_error_message),
    lastErrorAction: nullableString(row.last_error_action),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at)
  };
}

export class LibraryAssistantPersistentQueue {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly onRetry?: (item: LibraryAssistantWorkItem, error: WorkError) => void;

  constructor(databasePath: string, options: PersistentQueueOptions = {}) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.now = options.now ?? (() => new Date());
    this.onRetry = options.onRetry;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_assistant_work_items (
        run_id TEXT NOT NULL REFERENCES library_assistant_runs(id) ON DELETE CASCADE,
        analyzer_id TEXT NOT NULL,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'matched', 'no_match', 'retry', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
        retry_at_ms INTEGER,
        last_error_code TEXT,
        last_error_message TEXT,
        last_error_action TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_id, analyzer_id, track_id)
      );

      CREATE INDEX IF NOT EXISTS idx_library_assistant_work_ready
      ON library_assistant_work_items(run_id, status, retry_at_ms, created_at, track_id);

      CREATE TABLE IF NOT EXISTS library_assistant_queue_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);

    const openedAt = this.now().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO library_assistant_queue_meta(key, value)
      VALUES (?, ?);
    `).run(QUEUE_INSTALLATION_KEY, openedAt);

    this.recoverInterruptedWork();
  }

  close() {
    this.db.close();
  }

  enqueue(
    runId: string,
    analyzerIds: readonly string[],
    trackIds: readonly string[],
    createdAt: string
  ) {
    requireIdentifier(runId, 'runId');
    for (const analyzerId of analyzerIds) requireIdentifier(analyzerId, 'analyzerId', 128);
    for (const trackId of trackIds) requireIdentifier(trackId, 'trackId', 64);
    if (analyzerIds.length === 0 || trackIds.length === 0) return 0;

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO library_assistant_work_items(
        run_id, analyzer_id, track_id, status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 0, ?, ?);
    `);
    let inserted = 0;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const analyzerId of analyzerIds) {
        for (const trackId of trackIds) {
          const result = insert.run(runId, analyzerId, trackId, createdAt, createdAt);
          inserted += Number(result.changes);
        }
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
    return inserted;
  }

  claimNext(runId: string, nowMs: number, updatedAt: string): LibraryAssistantWorkItem | null {
    requireIdentifier(runId, 'runId');
    if (!Number.isFinite(nowMs)) throw new RangeError('Instante da fila inválido.');

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const row = this.db.prepare(`
        SELECT *
        FROM library_assistant_work_items
        WHERE run_id = ?
          AND (
            status = 'pending'
            OR (status = 'retry' AND retry_at_ms IS NOT NULL AND retry_at_ms <= ?)
          )
        ORDER BY
          CASE status WHEN 'pending' THEN 0 ELSE 1 END,
          COALESCE(retry_at_ms, 0) ASC,
          created_at ASC,
          analyzer_id ASC,
          track_id ASC
        LIMIT 1;
      `).get(runId, Math.trunc(nowMs)) as Row | undefined;

      if (!row) {
        this.db.exec('COMMIT;');
        return null;
      }

      const analyzerId = stringValue(row.analyzer_id);
      const trackId = stringValue(row.track_id);
      const result = this.db.prepare(`
        UPDATE library_assistant_work_items
        SET status = 'processing',
            attempts = attempts + 1,
            retry_at_ms = NULL,
            updated_at = ?
        WHERE run_id = ? AND analyzer_id = ? AND track_id = ?
          AND status IN ('pending', 'retry');
      `).run(updatedAt, runId, analyzerId, trackId);
      if (Number(result.changes) !== 1) throw new Error('Item da fila não pôde ser reservado.');

      const claimed = this.db.prepare(`
        SELECT * FROM library_assistant_work_items
        WHERE run_id = ? AND analyzer_id = ? AND track_id = ?;
      `).get(runId, analyzerId, trackId) as Row;
      this.db.exec('COMMIT;');
      return itemFromRow(claimed);
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  markMatched(item: LibraryAssistantWorkItem, updatedAt: string) {
    return this.markTerminal(item, 'matched', updatedAt);
  }

  markNoMatch(item: LibraryAssistantWorkItem, updatedAt: string) {
    return this.markTerminal(item, 'no_match', updatedAt);
  }

  markFailed(
    item: LibraryAssistantWorkItem,
    error: WorkError,
    updatedAt: string
  ) {
    const result = this.db.prepare(`
      UPDATE library_assistant_work_items
      SET status = 'failed', retry_at_ms = NULL,
          last_error_code = ?, last_error_message = ?, last_error_action = ?, updated_at = ?
      WHERE run_id = ? AND analyzer_id = ? AND track_id = ? AND status = 'processing';
    `).run(
      error.code,
      error.message,
      error.action,
      updatedAt,
      item.runId,
      item.analyzerId,
      item.trackId
    );
    return Number(result.changes) > 0;
  }

  markRetry(
    item: LibraryAssistantWorkItem,
    retryAtMs: number,
    error: WorkError,
    updatedAt: string
  ) {
    if (!Number.isSafeInteger(retryAtMs) || retryAtMs <= 0) throw new RangeError('retryAt inválido.');
    const result = this.db.prepare(`
      UPDATE library_assistant_work_items
      SET status = 'retry', retry_at_ms = ?,
          last_error_code = ?, last_error_message = ?, last_error_action = ?, updated_at = ?
      WHERE run_id = ? AND analyzer_id = ? AND track_id = ? AND status = 'processing';
    `).run(
      retryAtMs,
      error.code,
      error.message,
      error.action,
      updatedAt,
      item.runId,
      item.analyzerId,
      item.trackId
    );
    const changed = Number(result.changes) > 0;
    if (changed) {
      try {
        this.onRetry?.(item, error);
      } catch {
        // Métrica derivada não pode alterar o estado persistido da fila.
      }
    }
    return changed;
  }

  summary(runId: string): LibraryAssistantWorkSummary {
    requireIdentifier(runId, 'runId');
    const summary: LibraryAssistantWorkSummary = {
      total: 0,
      pending: 0,
      processing: 0,
      matched: 0,
      no_match: 0,
      retry: 0,
      failed: 0
    };
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM library_assistant_work_items
      WHERE run_id = ?
      GROUP BY status;
    `).all(runId) as Row[];
    for (const row of rows) {
      const status = workStatus(row.status);
      const count = Math.max(0, Math.trunc(numberValue(row.count)));
      summary[status] += count;
      summary.total += count;
    }
    return summary;
  }

  nextRetryAt(runId: string) {
    requireIdentifier(runId, 'runId');
    const row = this.db.prepare(`
      SELECT MIN(retry_at_ms) AS retry_at_ms
      FROM library_assistant_work_items
      WHERE run_id = ? AND status = 'retry' AND retry_at_ms IS NOT NULL;
    `).get(runId) as Row | undefined;
    return nullableNumber(row?.retry_at_ms);
  }

  private markTerminal(
    item: LibraryAssistantWorkItem,
    status: 'matched' | 'no_match',
    updatedAt: string
  ) {
    const result = this.db.prepare(`
      UPDATE library_assistant_work_items
      SET status = ?, retry_at_ms = NULL,
          last_error_code = NULL, last_error_message = NULL, last_error_action = NULL,
          updated_at = ?
      WHERE run_id = ? AND analyzer_id = ? AND track_id = ? AND status = 'processing';
    `).run(status, updatedAt, item.runId, item.analyzerId, item.trackId);
    return Number(result.changes) > 0;
  }

  private recoverInterruptedWork() {
    const installed = this.db.prepare(`
      SELECT value FROM library_assistant_queue_meta WHERE key = ? LIMIT 1;
    `).get(QUEUE_INSTALLATION_KEY) as Row | undefined;
    const installedAt = stringValue(installed?.value, this.now().toISOString());
    const updatedAt = this.now().toISOString();

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      // A sugestão é persistida antes do estado terminal. Se o processo cair nesse pequeno
      // intervalo, considerar a faixa concluída evita duplicar a sugestão na retomada.
      this.db.prepare(`
        UPDATE library_assistant_work_items AS work
        SET status = 'matched', retry_at_ms = NULL, updated_at = ?
        WHERE status = 'processing'
          AND EXISTS (
            SELECT 1
            FROM library_assistant_suggestions AS suggestion
            JOIN library_assistant_runs AS run ON run.id = suggestion.run_id
            WHERE suggestion.run_id = work.run_id
              AND suggestion.track_id = work.track_id
              AND suggestion.capability = run.capability
          );
      `).run(updatedAt);

      this.db.prepare(`
        UPDATE library_assistant_work_items
        SET status = 'pending', retry_at_ms = NULL, updated_at = ?
        WHERE status = 'processing';
      `).run(updatedAt);

      // LibraryAssistantStore legado marca runs ativos como interrupted ao abrir. Runs
      // criados depois da instalação desta fila são recuperáveis e voltam a running.
      this.db.prepare(`
        UPDATE library_assistant_runs
        SET status = 'running', finished_at = NULL,
            error_code = NULL, error_message = NULL, error_action = NULL
        WHERE status = 'failed'
          AND error_code = ?
          AND created_at >= ?;
      `).run(INTERRUPTED_ERROR_CODE, installedAt);

      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }
}
