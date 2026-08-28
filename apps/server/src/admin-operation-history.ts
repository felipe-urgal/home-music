import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AdminOperationCounts,
  AdminOperationHistoryItem,
  AdminOperationKind,
  AdminOperationStatus,
  AdminScanTrigger,
  ImportJob,
  ImportJobSource,
  ScanResponse
} from '@home-music/shared';

const DEFAULT_MAX_RETAINED_OPERATIONS = 500;
const MAX_LABEL_LENGTH = 180;
const MAX_ERROR_LENGTH = 320;
const TERMINAL_STATUSES: readonly AdminOperationStatus[] = ['completed', 'failed', 'cancelled'];
const INTERRUPTED_MESSAGE = 'A operação foi interrompida pelo reinício do serviço.';
const INTERRUPTED_ACTION = 'Inicie a operação novamente se ela ainda for necessária.';

type Row = Record<string, unknown>;

type HistoryFilters = {
  kind?: AdminOperationKind;
  status?: AdminOperationStatus;
  limit?: number;
};

type SanitizedOperationError = {
  message: string;
  action: string;
};

type OperationHistoryOptions = {
  now?: () => Date;
  createId?: () => string;
  maxRetainedOperations?: number;
};

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyCounts(): AdminOperationCounts {
  return {
    tracks: null,
    added: null,
    updated: null,
    removed: null,
    unchanged: null
  };
}

function scanCounts(result: ScanResponse): AdminOperationCounts {
  return {
    tracks: result.tracks,
    added: result.added,
    updated: result.updated,
    removed: result.removed,
    unchanged: result.unchanged
  };
}

function parseCounts(value: unknown): AdminOperationCounts {
  if (typeof value !== 'string' || !value) return emptyCounts();
  try {
    const parsed = JSON.parse(value) as Partial<AdminOperationCounts>;
    return {
      tracks: numberValue(parsed.tracks),
      added: numberValue(parsed.added),
      updated: numberValue(parsed.updated),
      removed: numberValue(parsed.removed),
      unchanged: numberValue(parsed.unchanged)
    };
  } catch {
    return emptyCounts();
  }
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String(error.code || '').toUpperCase();
}

function rawErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

function redactSensitiveText(value: string) {
  let text = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  text = text.replace(
    /\b(authorization|cookie|password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
    (_match, key: string) => `${key}=[redigido]`
  );
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redigido]');
  text = text.replace(/https?:\/\/[^\s)}>,;]+/gi, '[URL removida]');
  text = text.replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\s)\]}>,;]*/g, '[caminho removido]');
  text = text.replace(/(^|[\s("'=])\/(?:[^/\s]+\/)*[^\s)\]}>,;]*/g, '$1[caminho removido]');
  text = text.replace(/~\/(?:[^/\s]+\/)*[^\s)\]}>,;]*/g, '[caminho removido]');
  return text.slice(0, MAX_ERROR_LENGTH);
}

export function sanitizeOperationLabel(label: string, fallback = 'Operação') {
  const redacted = redactSensitiveText(label).slice(0, MAX_LABEL_LENGTH).trim();
  if (!redacted || redacted === '[URL removida]' || redacted === '[caminho removido]') return fallback;
  return redacted;
}

export function sanitizeOperationError(error: unknown): SanitizedOperationError {
  const code = errorCode(error);
  const raw = rawErrorMessage(error);
  const lower = raw.toLocaleLowerCase('pt-BR');

  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return {
      message: 'A origem necessária para a operação não foi encontrada.',
      action: 'Verifique se a biblioteca ou fonte está disponível e tente novamente.'
    };
  }

  if (code === 'EACCES' || code === 'EPERM' || lower.includes('permission denied')) {
    return {
      message: 'O Home Music não tem permissão para acessar um recurso necessário.',
      action: 'Revise as permissões do serviço e tente novamente.'
    };
  }

  if (code === 'SQLITE_BUSY' || lower.includes('database is locked') || lower.includes('database locked')) {
    return {
      message: 'O banco de dados estava ocupado durante a operação.',
      action: 'Aguarde a operação atual terminar e tente novamente.'
    };
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('network') || lower.includes('fetch')) {
    return {
      message: 'A fonte não respondeu dentro do esperado.',
      action: 'Verifique a conectividade e a disponibilidade da fonte antes de tentar novamente.'
    };
  }

  if (lower.includes('ffmpeg') || lower.includes('codec') || lower.includes('format') || lower.includes('formato')) {
    return {
      message: 'A mídia não pôde ser processada no formato atual.',
      action: 'Valide o arquivo e a disponibilidade do FFmpeg antes de tentar novamente.'
    };
  }

  const message = redactSensitiveText(raw);
  return {
    message: message || 'A operação falhou por um erro interno.',
    action: 'Tente novamente. Se o erro persistir, consulte os logs do serviço no servidor.'
  };
}

function importStatus(status: ImportJob['status']): AdminOperationStatus {
  return status === 'processing' ? 'running' : status;
}

function safeProvider(source: ImportJobSource) {
  if (source.type !== 'provider' || !source.provider) return null;
  return sanitizeOperationLabel(source.provider, 'Fonte externa').slice(0, 80);
}

function safeImportLabel(job: ImportJob) {
  const fallback = job.source.type === 'upload'
    ? 'Importação por upload'
    : job.source.type === 'url'
      ? 'Importação por URL'
      : `Importação por ${safeProvider(job.source) || 'fonte externa'}`;
  return sanitizeOperationLabel(job.label, fallback);
}

function durationMs(startedAt: string | null, finishedAt: string | null, createdAt: string) {
  if (!finishedAt) return null;
  const start = Date.parse(startedAt || createdAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return null;
  return Math.max(0, finish - start);
}

function historyItem(row: Row): AdminOperationHistoryItem {
  const createdAt = stringValue(row.created_at);
  const startedAt = nullableString(row.started_at);
  const finishedAt = nullableString(row.finished_at);
  const errorMessage = nullableString(row.error_message);
  const errorAction = nullableString(row.error_action);
  const sourceType = nullableString(row.import_source_type);
  const importSource: ImportJobSource | null = sourceType === 'upload' || sourceType === 'url' || sourceType === 'provider'
    ? {
        type: sourceType,
        provider: nullableString(row.import_provider)
      }
    : null;

  return {
    id: stringValue(row.id),
    kind: row.kind === 'import' ? 'import' : 'scan',
    status: row.status as AdminOperationStatus,
    label: stringValue(row.label, 'Operação'),
    createdAt,
    startedAt,
    finishedAt,
    durationMs: durationMs(startedAt, finishedAt, createdAt),
    scanTrigger: row.scan_trigger === 'manual' || row.scan_trigger === 'automatic' ? row.scan_trigger : null,
    importSource,
    counts: parseCounts(row.counts_json),
    error: errorMessage && errorAction ? { message: errorMessage, action: errorAction } : null,
    canRetry: Boolean(row.can_retry)
  };
}

export class AdminOperationHistoryStore {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly maxRetainedOperations: number;

  constructor(databasePath: string, options: OperationHistoryOptions = {}) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.maxRetainedOperations = Math.max(1, Math.min(5_000, Math.trunc(options.maxRetainedOperations ?? DEFAULT_MAX_RETAINED_OPERATIONS)));

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_operation_history (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('scan', 'import')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
        label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND ${MAX_LABEL_LENGTH}),
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        scan_trigger TEXT CHECK(scan_trigger IS NULL OR scan_trigger IN ('manual', 'automatic')),
        import_source_type TEXT CHECK(import_source_type IS NULL OR import_source_type IN ('upload', 'url', 'provider')),
        import_provider TEXT,
        counts_json TEXT,
        error_message TEXT,
        error_action TEXT,
        can_retry INTEGER NOT NULL DEFAULT 0 CHECK(can_retry IN (0, 1))
      );

      CREATE INDEX IF NOT EXISTS idx_admin_operation_history_created
      ON admin_operation_history(created_at DESC, id DESC);

      CREATE INDEX IF NOT EXISTS idx_admin_operation_history_kind_status
      ON admin_operation_history(kind, status, created_at DESC);
    `);

    this.recoverInterruptedOperations();
    this.trimRetained();
  }

  close() {
    this.db.close();
  }

  startScan(trigger: AdminScanTrigger) {
    const id = `scan-${this.createId()}`;
    const timestamp = this.now().toISOString();
    this.db.prepare(`
      INSERT INTO admin_operation_history(
        id, kind, status, label, created_at, started_at, scan_trigger, can_retry
      ) VALUES (?, 'scan', 'running', ?, ?, ?, ?, 0)
    `).run(
      id,
      trigger === 'automatic' ? 'Scan automático' : 'Scan manual',
      timestamp,
      timestamp,
      trigger
    );
    this.trimRetained();
    return id;
  }

  completeScan(id: string, result: ScanResponse) {
    const finishedAt = this.now().toISOString();
    this.db.prepare(`
      UPDATE admin_operation_history
      SET status = 'completed', finished_at = ?, counts_json = ?, error_message = NULL, error_action = NULL
      WHERE id = ? AND kind = 'scan' AND status = 'running'
    `).run(finishedAt, JSON.stringify(scanCounts(result)), id);
    this.trimRetained();
  }

  failScan(id: string, error: unknown) {
    const finishedAt = this.now().toISOString();
    const sanitized = sanitizeOperationError(error);
    this.db.prepare(`
      UPDATE admin_operation_history
      SET status = 'failed', finished_at = ?, error_message = ?, error_action = ?
      WHERE id = ? AND kind = 'scan' AND status = 'running'
    `).run(finishedAt, sanitized.message, sanitized.action, id);
    this.trimRetained();
  }

  recordImport(job: ImportJob) {
    const status = importStatus(job.status);
    const sanitizedError = status === 'failed' ? sanitizeOperationError(job.error) : null;
    const sourceProvider = safeProvider(job.source);

    this.db.prepare(`
      INSERT INTO admin_operation_history(
        id, kind, status, label, created_at, started_at, finished_at,
        import_source_type, import_provider, counts_json,
        error_message, error_action, can_retry
      ) VALUES (?, 'import', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        label = excluded.label,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        import_source_type = excluded.import_source_type,
        import_provider = excluded.import_provider,
        error_message = excluded.error_message,
        error_action = excluded.error_action,
        can_retry = excluded.can_retry
    `).run(
      `import-${job.id}`,
      status,
      safeImportLabel(job),
      job.createdAt,
      job.startedAt,
      job.finishedAt,
      job.source.type,
      sourceProvider,
      sanitizedError?.message ?? null,
      sanitizedError?.action ?? null
    );
    this.trimRetained();
  }

  list(filters: HistoryFilters = {}) {
    const clauses: string[] = [];
    const bindings: Array<string | number> = [];
    if (filters.kind) {
      clauses.push('kind = ?');
      bindings.push(filters.kind);
    }
    if (filters.status) {
      clauses.push('status = ?');
      bindings.push(filters.status);
    }
    const limit = Math.max(1, Math.min(500, Math.trunc(filters.limit ?? 200)));
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT id, kind, status, label, created_at, started_at, finished_at,
             scan_trigger, import_source_type, import_provider, counts_json,
             error_message, error_action, can_retry
      FROM admin_operation_history
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(...bindings, limit) as Row[];
    return rows.map(historyItem);
  }

  private recoverInterruptedOperations() {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM admin_operation_history
      WHERE status IN ('pending', 'running')
    `).get() as Row | undefined;
    if ((numberValue(row?.count) ?? 0) <= 0) return;

    const finishedAt = this.now().toISOString();
    this.db.prepare(`
      UPDATE admin_operation_history
      SET status = 'cancelled',
          finished_at = ?,
          error_message = ?,
          error_action = ?,
          can_retry = 0
      WHERE status IN ('pending', 'running')
    `).run(finishedAt, INTERRUPTED_MESSAGE, INTERRUPTED_ACTION);
  }

  private trimRetained() {
    const placeholders = TERMINAL_STATUSES.map(() => '?').join(', ');
    this.db.prepare(`
      DELETE FROM admin_operation_history
      WHERE id IN (
        SELECT id
        FROM admin_operation_history
        WHERE status IN (${placeholders})
        ORDER BY created_at DESC, id DESC
        LIMIT -1 OFFSET ?
      )
    `).run(...TERMINAL_STATUSES, this.maxRetainedOperations);
  }
}
