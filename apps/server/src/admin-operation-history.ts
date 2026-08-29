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
import type { ImportJobWithRetry, ImportRetryContext } from './import-retry.js';

const DEFAULT_MAX_RETAINED_OPERATIONS = 500;
const MAX_LABEL_LENGTH = 180;
const MAX_ERROR_LENGTH = 320;
const MAX_OPERATION_ID_LENGTH = 256;
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

export type AdminImportFailureDisposition = 'none' | 'retryable' | 'definitive';

export type AdminImportRetryInfo = Readonly<{
  attempt: number;
  parentOperationId: string | null;
  rootOperationId: string;
  failureDisposition: AdminImportFailureDisposition;
}>;

export type AdminOperationHistoryItemWithRetry = AdminOperationHistoryItem & {
  importRetry: AdminImportRetryInfo | null;
};

export class AdminOperationRetryError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 409
  ) {
    super(message);
    this.name = 'AdminOperationRetryError';
  }
}

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

export function classifyImportFailure(job: Pick<ImportJob, 'status' | 'error' | 'source'>): AdminImportFailureDisposition {
  if (job.status !== 'failed') return 'none';
  if (job.source.type === 'provider') return 'definitive';

  const lower = (job.error ?? '').toLocaleLowerCase('pt-BR');
  const httpStatus = /\bhttp\s+(\d{3})\b/i.exec(lower);
  if (httpStatus) {
    const status = Number(httpStatus[1]);
    if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retryable';
    return 'definitive';
  }

  const definitiveFragments = [
    'não foi reconhecido como áudio suportado',
    'não possui uma faixa de áudio válida',
    'rejeitou ou não reconheceu a mídia',
    'não conseguiu processar a mídia importada',
    'não há container seguro',
    'duração mudou além do esperado',
    'payload mudou',
    'content-type incompatível',
    'excede o limite',
    'tamanho recebido não corresponde',
    'tamanho diferente do arquivo selecionado',
    'arquivo vazio',
    'formato não suportado',
    'rede não permitida',
    'rede local',
    'credenciais embutidas',
    'somente urls http',
    'portas padrão http/https',
    'url inválida',
    'url obrigatória',
    'limite de redirecionamentos'
  ];
  if (definitiveFragments.some(fragment => lower.includes(fragment))) return 'definitive';

  return 'retryable';
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

function parseFailureDisposition(value: unknown): AdminImportFailureDisposition {
  return value === 'retryable' || value === 'definitive' ? value : 'none';
}

function historyItem(row: Row): AdminOperationHistoryItemWithRetry {
  const id = stringValue(row.id);
  const kind = row.kind === 'import' ? 'import' : 'scan';
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
  const attempt = Math.max(1, Math.trunc(numberValue(row.import_attempt) ?? 1));
  const rootOperationId = nullableString(row.import_root_id) || id;

  return {
    id,
    kind,
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
    canRetry: Boolean(row.can_retry),
    importRetry: kind === 'import'
      ? {
          attempt,
          parentOperationId: nullableString(row.import_retry_of_id),
          rootOperationId,
          failureDisposition: parseFailureDisposition(row.import_failure_disposition)
        }
      : null
  };
}

function operationIdForJob(jobId: string) {
  return `import-${jobId}`;
}

function jobIdFromOperationId(operationId: string) {
  if (!operationId.startsWith('import-') || operationId.length <= 'import-'.length) {
    throw new AdminOperationRetryError('Operação de importação inválida.', 404);
  }
  return operationId.slice('import-'.length);
}

function ensureHistoryColumn(db: DatabaseSync, column: string, definition: string) {
  const columns = db.prepare('PRAGMA table_info(admin_operation_history)').all() as Row[];
  if (columns.some(item => item.name === column)) return;
  db.exec(`ALTER TABLE admin_operation_history ADD COLUMN ${column} ${definition};`);
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
        can_retry INTEGER NOT NULL DEFAULT 0 CHECK(can_retry IN (0, 1)),
        import_retry_of_id TEXT,
        import_root_id TEXT,
        import_attempt INTEGER,
        import_failure_disposition TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_admin_operation_history_created
      ON admin_operation_history(created_at DESC, id DESC);

      CREATE INDEX IF NOT EXISTS idx_admin_operation_history_kind_status
      ON admin_operation_history(kind, status, created_at DESC);
    `);

    ensureHistoryColumn(this.db, 'import_retry_of_id', 'TEXT');
    ensureHistoryColumn(this.db, 'import_root_id', 'TEXT');
    ensureHistoryColumn(this.db, 'import_attempt', 'INTEGER');
    ensureHistoryColumn(this.db, 'import_failure_disposition', "TEXT NOT NULL DEFAULT 'none'");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_admin_operation_history_retry_parent
      ON admin_operation_history(import_retry_of_id);

      UPDATE admin_operation_history
      SET import_root_id = id,
          import_attempt = 1,
          import_failure_disposition = CASE WHEN status = 'failed' THEN 'definitive' ELSE 'none' END
      WHERE kind = 'import'
        AND (import_root_id IS NULL OR import_attempt IS NULL);
    `);

    this.recoverInterruptedOperations();
    this.recoverOrphanRetryClaims();
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

  recordImport(job: ImportJob & { retry?: ImportJobWithRetry['retry'] }) {
    const retry = job.retry ?? null;
    const operationId = operationIdForJob(job.id);
    const status = importStatus(job.status);
    const failureDisposition = classifyImportFailure(job);
    const sanitizedError = status === 'failed' ? sanitizeOperationError(job.error) : null;
    const sourceProvider = safeProvider(job.source);
    const canRetry = status === 'failed'
      && failureDisposition === 'retryable'
      && (job.source.type === 'upload' || job.source.type === 'url');
    const parentOperationId = retry ? operationIdForJob(retry.parentJobId) : null;
    const rootOperationId = retry ? operationIdForJob(retry.rootJobId) : operationId;
    const attempt = retry?.attempt ?? 1;

    this.db.prepare(`
      INSERT INTO admin_operation_history(
        id, kind, status, label, created_at, started_at, finished_at,
        import_source_type, import_provider, counts_json,
        error_message, error_action, can_retry,
        import_retry_of_id, import_root_id, import_attempt, import_failure_disposition
      ) VALUES (?, 'import', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        label = excluded.label,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        import_source_type = excluded.import_source_type,
        import_provider = excluded.import_provider,
        error_message = excluded.error_message,
        error_action = excluded.error_action,
        can_retry = excluded.can_retry,
        import_retry_of_id = COALESCE(admin_operation_history.import_retry_of_id, excluded.import_retry_of_id),
        import_root_id = COALESCE(admin_operation_history.import_root_id, excluded.import_root_id),
        import_attempt = COALESCE(admin_operation_history.import_attempt, excluded.import_attempt),
        import_failure_disposition = excluded.import_failure_disposition
    `).run(
      operationId,
      status,
      safeImportLabel(job),
      job.createdAt,
      job.startedAt,
      job.finishedAt,
      job.source.type,
      sourceProvider,
      sanitizedError?.message ?? null,
      sanitizedError?.action ?? null,
      canRetry ? 1 : 0,
      parentOperationId,
      rootOperationId,
      attempt,
      failureDisposition
    );

    if (parentOperationId) {
      this.db.prepare(`
        UPDATE admin_operation_history
        SET can_retry = 0
        WHERE id = ? AND kind = 'import'
      `).run(parentOperationId);
    }
    this.trimRetained();
  }

  prepareImportRetry(operationId: string): ImportRetryContext {
    const cleanId = operationId.trim();
    if (!cleanId || cleanId.length > MAX_OPERATION_ID_LENGTH) {
      throw new AdminOperationRetryError('Operação de importação inválida.', 404);
    }
    const row = this.db.prepare(`
      SELECT id, kind, status, import_source_type, import_provider, can_retry,
             import_root_id, import_attempt, import_failure_disposition
      FROM admin_operation_history
      WHERE id = ?
      LIMIT 1
    `).get(cleanId) as Row | undefined;
    if (!row || row.kind !== 'import') {
      throw new AdminOperationRetryError('Operação de importação não encontrada.', 404);
    }
    if (row.status !== 'failed' || !Boolean(row.can_retry) || row.import_failure_disposition !== 'retryable') {
      throw new AdminOperationRetryError('Esta importação não possui uma nova tentativa segura disponível.');
    }

    const existingChild = this.db.prepare(`
      SELECT id
      FROM admin_operation_history
      WHERE import_retry_of_id = ?
      LIMIT 1
    `).get(cleanId) as Row | undefined;
    if (existingChild) {
      this.db.prepare('UPDATE admin_operation_history SET can_retry = 0 WHERE id = ?').run(cleanId);
      throw new AdminOperationRetryError('Esta tentativa já originou uma nova importação.');
    }

    const sourceType = nullableString(row.import_source_type);
    if (sourceType !== 'upload' && sourceType !== 'url') {
      throw new AdminOperationRetryError('A fonte desta importação não suporta retry seguro.');
    }
    const rootOperationId = nullableString(row.import_root_id) || cleanId;
    const currentAttempt = Math.max(1, Math.trunc(numberValue(row.import_attempt) ?? 1));
    const claim = this.db.prepare(`
      UPDATE admin_operation_history
      SET can_retry = 0
      WHERE id = ?
        AND kind = 'import'
        AND status = 'failed'
        AND can_retry = 1
        AND import_failure_disposition = 'retryable'
    `).run(cleanId);
    if (Number(claim.changes) !== 1) {
      throw new AdminOperationRetryError('Outra nova tentativa já foi iniciada para esta importação.');
    }

    return {
      source: { type: sourceType, provider: null },
      lineage: {
        parentJobId: jobIdFromOperationId(cleanId),
        rootJobId: jobIdFromOperationId(rootOperationId),
        attempt: currentAttempt + 1
      }
    };
  }

  releaseImportRetry(context: ImportRetryContext) {
    const parentOperationId = operationIdForJob(context.lineage.parentJobId);
    const child = this.db.prepare(`
      SELECT id
      FROM admin_operation_history
      WHERE import_retry_of_id = ?
      LIMIT 1
    `).get(parentOperationId) as Row | undefined;
    if (child) return false;

    const result = this.db.prepare(`
      UPDATE admin_operation_history
      SET can_retry = 1
      WHERE id = ?
        AND kind = 'import'
        AND status = 'failed'
        AND import_failure_disposition = 'retryable'
        AND can_retry = 0
    `).run(parentOperationId);
    return Number(result.changes) > 0;
  }

  bindRetryAttempt(childJobId: string, context: ImportRetryContext) {
    const childOperationId = operationIdForJob(childJobId);
    const parentOperationId = operationIdForJob(context.lineage.parentJobId);
    const rootOperationId = operationIdForJob(context.lineage.rootJobId);
    const result = this.db.prepare(`
      UPDATE admin_operation_history
      SET import_retry_of_id = ?, import_root_id = ?, import_attempt = ?
      WHERE id = ? AND kind = 'import'
    `).run(parentOperationId, rootOperationId, context.lineage.attempt, childOperationId);
    if (Number(result.changes) <= 0) {
      throw new AdminOperationRetryError('A nova tentativa não foi registrada no histórico.', 500);
    }
    this.db.prepare(`
      UPDATE admin_operation_history
      SET can_retry = 0
      WHERE id = ? AND kind = 'import'
    `).run(parentOperationId);
    return childOperationId;
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
             error_message, error_action, can_retry,
             import_retry_of_id, import_root_id, import_attempt, import_failure_disposition
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
          can_retry = 0,
          import_failure_disposition = CASE WHEN kind = 'import' THEN 'none' ELSE import_failure_disposition END
      WHERE status IN ('pending', 'running')
    `).run(finishedAt, INTERRUPTED_MESSAGE, INTERRUPTED_ACTION);
  }

  private recoverOrphanRetryClaims() {
    this.db.prepare(`
      UPDATE admin_operation_history
      SET can_retry = 1
      WHERE kind = 'import'
        AND status = 'failed'
        AND can_retry = 0
        AND import_failure_disposition = 'retryable'
        AND import_source_type IN ('upload', 'url')
        AND NOT EXISTS (
          SELECT 1
          FROM admin_operation_history AS child
          WHERE child.import_retry_of_id = admin_operation_history.id
        )
    `).run();
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
