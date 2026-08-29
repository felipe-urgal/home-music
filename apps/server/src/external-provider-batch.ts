import { randomUUID } from 'node:crypto';
import type { ImportJob } from '@home-music/shared';
import {
  ExternalProviderError,
  type ExternalProviderImportManager,
  type ExternalProviderRequest
} from './external-provider.js';
import type {
  ImportAutomaticFlowManager,
  ImportAutomaticFlowOutcome
} from './import-automatic-flow.js';
import type { ImportJobQueue } from './import-job-queue.js';
import {
  ImportSafeDestinationError,
  normalizeImportFolderPath,
  type ImportSafeDestinationManager
} from './import-safe-destination.js';

export const DEFAULT_PROVIDER_BATCH_MAX_ITEMS = 50;
export const DEFAULT_PROVIDER_BATCH_MAX_MEGABYTES = 2_048;
export const DEFAULT_PROVIDER_BATCH_MAX_DURATION_MINUTES = 720;
const DEFAULT_PREVIEW_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_RETAINED_BATCHES = 50;
const MAX_URL_BYTES = 4_096;
const MAX_LABEL_LENGTH = 240;

export type ExternalProviderBatchStatus =
  | 'ready'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type ExternalProviderBatchItemStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'duplicate'
  | 'ignored'
  | 'failed'
  | 'cancelled';

export type ExternalProviderBatchInspectionItem = Readonly<{
  sourceId: string | null;
  label: string;
  durationSeconds: number | null;
  request: ExternalProviderRequest | null;
  unavailableReason?: string | null;
}>;

export type ExternalProviderBatchInspection = Readonly<{
  providerId: string;
  label: string;
  items: readonly ExternalProviderBatchInspectionItem[];
}>;

export type ExternalProviderBatchInspector = Readonly<{
  providerId: string;
  inspect: (
    request: ExternalProviderRequest,
    signal: AbortSignal
  ) => Promise<ExternalProviderBatchInspection | null>;
}>;

export type ExternalProviderBatchLimits = Readonly<{
  maxItems: number;
  maxBytes: number;
  maxDurationSeconds: number;
}>;

export type ExternalProviderBatchItem = Readonly<{
  index: number;
  sourceId: string | null;
  label: string;
  durationSeconds: number | null;
  status: ExternalProviderBatchItemStatus;
  jobId: string | null;
  destination: string | null;
  error: string | null;
}>;

export type ExternalProviderBatchSummary = Readonly<{
  total: number;
  processed: number;
  completed: number;
  duplicates: number;
  ignored: number;
  failed: number;
  cancelled: number;
  importedBytes: number;
  importedDurationSeconds: number;
}>;

export type ExternalProviderBatch = Readonly<{
  id: string;
  providerId: string;
  label: string;
  status: ExternalProviderBatchStatus;
  folderPath: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string;
  error: string | null;
  limits: ExternalProviderBatchLimits;
  summary: ExternalProviderBatchSummary;
  items: readonly ExternalProviderBatchItem[];
}>;

type MutableBatchItem = {
  sourceId: string | null;
  label: string;
  durationSeconds: number | null;
  request: ExternalProviderRequest | null;
  unavailableReason: string | null;
  status: ExternalProviderBatchItemStatus;
  jobId: string | null;
  destination: string | null;
  error: string | null;
};

type MutableBatch = {
  id: string;
  providerId: string;
  label: string;
  status: ExternalProviderBatchStatus;
  folderPath: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string;
  error: string | null;
  items: MutableBatchItem[];
  importedBytes: number;
  importedDurationSeconds: number;
};

type BatchSession = {
  cancelRequested: boolean;
  currentJobId: string | null;
  settled: Promise<void>;
};

type ExternalProviderBatchLogger = Readonly<{
  info?: (context: Record<string, unknown>, message: string) => void;
  warn?: (context: Record<string, unknown>, message: string) => void;
}>;

type ExternalProviderBatchManagerOptions = {
  queue: Pick<ImportJobQueue, 'get'>;
  externalProviders: Pick<ExternalProviderImportManager, 'listProviders' | 'start' | 'cancel' | 'getPrepared'>;
  automaticFlow: Pick<ImportAutomaticFlowManager, 'startWhenReady' | 'disable'>;
  safeDestination: Pick<ImportSafeDestinationManager, 'promote'>;
  inspectors: readonly ExternalProviderBatchInspector[];
  maxItems?: number;
  maxBytes?: number;
  maxDurationSeconds?: number;
  previewTtlMs?: number;
  maxRetainedBatches?: number;
  now?: () => Date;
  createId?: () => string;
  afterDiscard?: (jobId: string) => Promise<void> | void;
  logger?: ExternalProviderBatchLogger;
};

export type ExternalProviderBatchErrorCode =
  | 'batch_not_supported'
  | 'batch_not_found'
  | 'batch_expired'
  | 'batch_not_ready'
  | 'batch_limit_exceeded'
  | 'invalid_input';

export class ExternalProviderBatchError extends Error {
  constructor(
    public readonly code: ExternalProviderBatchErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ExternalProviderBatchError';
  }
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  label: string,
  maximum: number
) {
  const clean = value?.trim();
  if (!clean) return fallback;
  if (!/^\d+$/.test(clean)) throw new Error(`${label} inválido.`);
  const parsed = Number(clean);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${label} inválido.`);
  }
  return parsed;
}

export function parseProviderBatchMaxItems(value: string | undefined) {
  return parsePositiveInteger(value, DEFAULT_PROVIDER_BATCH_MAX_ITEMS, 'Limite de itens do lote', 1_000);
}

export function parseProviderBatchMaxMegabytes(value: string | undefined) {
  return parsePositiveInteger(
    value,
    DEFAULT_PROVIDER_BATCH_MAX_MEGABYTES,
    'Limite de tamanho do lote',
    1024 * 1024
  );
}

export function parseProviderBatchMaxDurationMinutes(value: string | undefined) {
  return parsePositiveInteger(
    value,
    DEFAULT_PROVIDER_BATCH_MAX_DURATION_MINUTES,
    'Limite de duração do lote',
    365 * 24 * 60
  );
}

function normalizeRequest(request: ExternalProviderRequest) {
  const raw = typeof request?.url === 'string' ? request.url.trim() : '';
  if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_URL_BYTES) {
    throw new ExternalProviderBatchError('invalid_input', 'URL do lote inválida.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ExternalProviderBatchError('invalid_input', 'URL do lote inválida.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new ExternalProviderBatchError('invalid_input', 'URL do lote inválida.');
  }
  url.hash = '';
  return Object.freeze({ url: url.toString() }) satisfies ExternalProviderRequest;
}

function cleanLabel(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const clean = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, MAX_LABEL_LENGTH) || fallback;
}

function safeDuration(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function publicError(error: unknown) {
  if (
    error instanceof ExternalProviderBatchError
    || error instanceof ExternalProviderError
    || error instanceof ImportSafeDestinationError
  ) {
    return error.message;
  }
  return 'Falha no item do lote.';
}

function terminalItem(status: ExternalProviderBatchItemStatus) {
  return status !== 'queued' && status !== 'processing';
}

function summary(batch: MutableBatch): ExternalProviderBatchSummary {
  let completed = 0;
  let duplicates = 0;
  let ignored = 0;
  let failed = 0;
  let cancelled = 0;
  for (const item of batch.items) {
    if (item.status === 'completed') completed += 1;
    else if (item.status === 'duplicate') duplicates += 1;
    else if (item.status === 'ignored') ignored += 1;
    else if (item.status === 'failed') failed += 1;
    else if (item.status === 'cancelled') cancelled += 1;
  }
  return {
    total: batch.items.length,
    processed: batch.items.filter(item => terminalItem(item.status)).length,
    completed,
    duplicates,
    ignored,
    failed,
    cancelled,
    importedBytes: batch.importedBytes,
    importedDurationSeconds: batch.importedDurationSeconds
  };
}

function snapshot(batch: MutableBatch, limits: ExternalProviderBatchLimits): ExternalProviderBatch {
  return {
    id: batch.id,
    providerId: batch.providerId,
    label: batch.label,
    status: batch.status,
    folderPath: batch.folderPath,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    startedAt: batch.startedAt,
    finishedAt: batch.finishedAt,
    expiresAt: batch.expiresAt,
    error: batch.error,
    limits: { ...limits },
    summary: summary(batch),
    items: batch.items.map((item, index) => ({
      index,
      sourceId: item.sourceId,
      label: item.label,
      durationSeconds: item.durationSeconds,
      status: item.status,
      jobId: item.jobId,
      destination: item.destination,
      error: item.error
    }))
  };
}

function mediaDuration(job: ImportJob | null, fallback: number | null) {
  const preview = job?.metadataPreview?.durationSeconds;
  if (typeof preview === 'number' && Number.isFinite(preview) && preview > 0) return preview;
  const probed = job?.mediaDecision?.input.durationSeconds;
  if (typeof probed === 'number' && Number.isFinite(probed) && probed > 0) return probed;
  return fallback ?? 0;
}

export class ExternalProviderBatchManager {
  private readonly queue: ExternalProviderBatchManagerOptions['queue'];
  private readonly externalProviders: ExternalProviderBatchManagerOptions['externalProviders'];
  private readonly automaticFlow: ExternalProviderBatchManagerOptions['automaticFlow'];
  private readonly safeDestination: ExternalProviderBatchManagerOptions['safeDestination'];
  private readonly inspectors = new Map<string, ExternalProviderBatchInspector>();
  private readonly limits: ExternalProviderBatchLimits;
  private readonly previewTtlMs: number;
  private readonly maxRetainedBatches: number;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly afterDiscard?: ExternalProviderBatchManagerOptions['afterDiscard'];
  private readonly logger?: ExternalProviderBatchLogger;
  private readonly batches = new Map<string, MutableBatch>();
  private readonly sessions = new Map<string, BatchSession>();

  constructor(options: ExternalProviderBatchManagerOptions) {
    this.queue = options.queue;
    this.externalProviders = options.externalProviders;
    this.automaticFlow = options.automaticFlow;
    this.safeDestination = options.safeDestination;
    this.previewTtlMs = options.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS;
    this.maxRetainedBatches = options.maxRetainedBatches ?? DEFAULT_MAX_RETAINED_BATCHES;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.afterDiscard = options.afterDiscard;
    this.logger = options.logger;
    this.limits = Object.freeze({
      maxItems: options.maxItems ?? DEFAULT_PROVIDER_BATCH_MAX_ITEMS,
      maxBytes: options.maxBytes ?? DEFAULT_PROVIDER_BATCH_MAX_MEGABYTES * 1024 * 1024,
      maxDurationSeconds: options.maxDurationSeconds ?? DEFAULT_PROVIDER_BATCH_MAX_DURATION_MINUTES * 60
    });

    if (!Number.isSafeInteger(this.limits.maxItems) || this.limits.maxItems <= 0) {
      throw new Error('Limite de itens do lote inválido.');
    }
    if (!Number.isSafeInteger(this.limits.maxBytes) || this.limits.maxBytes <= 0) {
      throw new Error('Limite de bytes do lote inválido.');
    }
    if (!Number.isFinite(this.limits.maxDurationSeconds) || this.limits.maxDurationSeconds <= 0) {
      throw new Error('Limite de duração do lote inválido.');
    }
    if (!Number.isSafeInteger(this.previewTtlMs) || this.previewTtlMs <= 0) {
      throw new Error('TTL do preview de lote inválido.');
    }
    if (!Number.isSafeInteger(this.maxRetainedBatches) || this.maxRetainedBatches <= 0) {
      throw new Error('Limite de lotes retidos inválido.');
    }

    for (const inspector of options.inspectors) {
      const id = inspector.providerId.trim().toLowerCase();
      if (!id || this.inspectors.has(id)) throw new Error(`Inspector de lote duplicado ou inválido: ${id}.`);
      this.inspectors.set(id, inspector);
    }
  }

  supports(providerId: string) {
    return this.inspectors.has(providerId.trim().toLowerCase());
  }

  getLimits() {
    return { ...this.limits };
  }

  get(batchId: string) {
    const batch = this.requireBatch(batchId);
    if (batch.status === 'ready') this.assertFresh(batch);
    return snapshot(batch, this.limits);
  }

  async inspect(providerId: string, request: ExternalProviderRequest) {
    this.prune();
    const id = providerId.trim().toLowerCase();
    const inspector = this.inspectors.get(id);
    if (!inspector) return null;
    const provider = this.externalProviders.listProviders().find(item => item.id === id);
    if (!provider || !provider.configured) {
      throw new ExternalProviderBatchError('batch_not_supported', 'Provider externo não está disponível para lotes.', 503);
    }

    const normalized = normalizeRequest(request);
    const controller = new AbortController();
    const inspection = await inspector.inspect(normalized, controller.signal);
    if (!inspection) return null;
    if (inspection.providerId.trim().toLowerCase() !== id) {
      throw new ExternalProviderBatchError('invalid_input', 'O inspector retornou um provider incompatível.');
    }
    if (inspection.items.length === 0) {
      throw new ExternalProviderBatchError('invalid_input', 'A lista externa não possui mídias importáveis.');
    }
    if (inspection.items.length > this.limits.maxItems) {
      throw new ExternalProviderBatchError(
        'batch_limit_exceeded',
        `A lista possui ${inspection.items.length} itens e excede o limite de ${this.limits.maxItems}.`,
        413
      );
    }

    let knownDuration = 0;
    const items = inspection.items.map((item, index): MutableBatchItem => {
      const durationSeconds = safeDuration(item.durationSeconds);
      knownDuration += durationSeconds ?? 0;
      return {
        sourceId: typeof item.sourceId === 'string' ? item.sourceId.trim().slice(0, 128) || null : null,
        label: cleanLabel(item.label, `Item ${index + 1}`),
        durationSeconds,
        request: item.request ? normalizeRequest(item.request) : null,
        unavailableReason: item.unavailableReason ? cleanLabel(item.unavailableReason, 'Item indisponível.') : null,
        status: 'queued',
        jobId: null,
        destination: null,
        error: null
      };
    });
    if (knownDuration > this.limits.maxDurationSeconds) {
      throw new ExternalProviderBatchError(
        'batch_limit_exceeded',
        'A duração conhecida da lista excede o limite configurado para lotes.',
        413
      );
    }

    const now = this.now();
    const batch: MutableBatch = {
      id: this.createId(),
      providerId: id,
      label: cleanLabel(inspection.label, 'Lista externa'),
      status: 'ready',
      folderPath: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      startedAt: null,
      finishedAt: null,
      expiresAt: new Date(now.getTime() + this.previewTtlMs).toISOString(),
      error: null,
      items,
      importedBytes: 0,
      importedDurationSeconds: 0
    };
    this.batches.set(batch.id, batch);
    this.prune();
    return snapshot(batch, this.limits);
  }

  start(batchId: string, folderPath?: unknown) {
    const batch = this.requireBatch(batchId);
    this.assertFresh(batch);
    if (batch.status !== 'ready') {
      throw new ExternalProviderBatchError('batch_not_ready', 'Este lote já foi iniciado.', 409);
    }

    batch.folderPath = normalizeImportFolderPath(folderPath).join('/');
    batch.status = 'running';
    const timestamp = this.now().toISOString();
    batch.startedAt = timestamp;
    batch.updatedAt = timestamp;
    const session: BatchSession = {
      cancelRequested: false,
      currentJobId: null,
      settled: Promise.resolve()
    };
    this.sessions.set(batch.id, session);
    session.settled = this.run(batch, session).finally(() => {
      if (this.sessions.get(batch.id) === session) this.sessions.delete(batch.id);
    });
    return snapshot(batch, this.limits);
  }

  async cancel(batchId: string) {
    const batch = this.requireBatch(batchId);
    if (batch.status === 'ready') {
      this.markRemainingCancelled(batch);
      this.finishBatch(batch, 'cancelled');
      return snapshot(batch, this.limits);
    }
    if (batch.status !== 'running' && batch.status !== 'cancelling') {
      return snapshot(batch, this.limits);
    }

    batch.status = 'cancelling';
    batch.updatedAt = this.now().toISOString();
    const session = this.sessions.get(batchId);
    if (session) {
      session.cancelRequested = true;
      const childId = session.currentJobId;
      if (childId) {
        this.automaticFlow.disable(childId);
        const job = this.queue.get(childId);
        const acquisitionActive = job?.status === 'processing' && !this.externalProviders.getPrepared(childId);
        if (acquisitionActive) {
          await this.externalProviders.cancel(childId).catch(() => undefined);
          await this.afterDiscard?.(childId);
        }
      }
    }
    return snapshot(batch, this.limits);
  }

  async stop() {
    const active = [...this.sessions.entries()];
    await Promise.all(active.map(async ([batchId, session]) => {
      await this.cancel(batchId).catch(() => undefined);
      await session.settled.catch(() => undefined);
    }));
  }

  private async run(batch: MutableBatch, session: BatchSession) {
    const seenSourceIds = new Set<string>();
    try {
      for (const item of batch.items) {
        if (session.cancelRequested) break;
        if (!item.request) {
          item.status = 'ignored';
          item.error = item.unavailableReason || 'Item indisponível na origem.';
          this.touch(batch);
          continue;
        }
        if (item.sourceId && seenSourceIds.has(item.sourceId)) {
          item.status = 'duplicate';
          item.error = 'Item repetido dentro do próprio lote.';
          this.touch(batch);
          continue;
        }
        if (item.sourceId) seenSourceIds.add(item.sourceId);

        item.status = 'processing';
        item.error = null;
        this.touch(batch);
        let childId: string | null = null;
        try {
          const started = await this.externalProviders.start(batch.providerId, item.request);
          childId = started.job.id;
          item.jobId = childId;
          session.currentJobId = childId;
          this.touch(batch);

          if (session.cancelRequested) {
            await this.discardChild(childId);
            item.status = 'cancelled';
            continue;
          }

          const outcome = await this.automaticFlow.startWhenReady(childId);
          if (session.cancelRequested) {
            await this.discardChild(childId);
            item.status = 'cancelled';
            continue;
          }
          await this.handleOutcome(batch, item, childId, outcome);
        } catch (error) {
          item.status = session.cancelRequested ? 'cancelled' : 'failed';
          item.error = session.cancelRequested ? null : publicError(error);
          if (childId) await this.discardChild(childId);
        } finally {
          session.currentJobId = null;
          this.touch(batch);
        }
      }

      if (session.cancelRequested) {
        this.markRemainingCancelled(batch);
        this.finishBatch(batch, 'cancelled');
      } else {
        this.finishBatch(batch, 'completed');
      }
    } catch (error) {
      batch.error = publicError(error);
      this.markRemainingFailed(batch, batch.error);
      this.finishBatch(batch, 'failed');
      this.logger?.warn?.(
        { providerBatchId: batch.id, providerId: batch.providerId, error: batch.error },
        'Lote externo terminou por falha do orquestrador.'
      );
    }
  }

  private async handleOutcome(
    batch: MutableBatch,
    item: MutableBatchItem,
    childId: string,
    outcome: ImportAutomaticFlowOutcome
  ) {
    if (outcome.reason === 'destination_review') {
      const prepared = this.externalProviders.getPrepared(childId);
      const job = this.queue.get(childId);
      if (!prepared || !job) throw new Error('Mídia preparada não está mais disponível para promoção.');
      const durationSeconds = mediaDuration(job, item.durationSeconds);
      if (batch.importedBytes + prepared.payload.sizeBytes > this.limits.maxBytes) {
        item.status = 'failed';
        item.error = 'O tamanho acumulado do lote atingiu o limite configurado.';
        await this.discardChild(childId);
        return;
      }
      if (batch.importedDurationSeconds + durationSeconds > this.limits.maxDurationSeconds) {
        item.status = 'failed';
        item.error = 'A duração acumulada do lote atingiu o limite configurado.';
        await this.discardChild(childId);
        return;
      }

      const promoted = await this.safeDestination.promote(childId, batch.folderPath ?? undefined);
      this.automaticFlow.disable(childId);
      item.status = 'completed';
      item.destination = promoted.destination.relativePath;
      item.durationSeconds = durationSeconds || item.durationSeconds;
      batch.importedBytes += prepared.payload.sizeBytes;
      batch.importedDurationSeconds += durationSeconds;
      this.logger?.info?.(
        { providerBatchId: batch.id, importJobId: childId, destination: item.destination },
        'Item do lote externo importado.'
      );
      return;
    }

    if (outcome.reason === 'duplicate_blocked') {
      item.status = 'duplicate';
      item.error = 'A mídia já existe na biblioteca.';
      await this.discardChild(childId);
      return;
    }
    if (outcome.reason === 'metadata_review' || outcome.reason === 'duplicate_review') {
      item.status = 'ignored';
      item.error = outcome.reason === 'metadata_review'
        ? 'Metadata exige revisão manual antes de importar.'
        : 'Possível duplicata exige revisão manual antes de importar.';
      await this.discardChild(childId);
      return;
    }
    if (outcome.reason === 'completed') {
      item.status = 'completed';
      return;
    }

    const job = this.queue.get(childId);
    item.status = 'failed';
    item.error = job?.error || (outcome.reason === 'timeout'
      ? 'A importação excedeu o tempo limite.'
      : 'O pipeline automático não conseguiu preparar este item.');
    await this.discardChild(childId);
  }

  private async discardChild(jobId: string) {
    this.automaticFlow.disable(jobId);
    const job = this.queue.get(jobId);
    if (job?.status === 'processing' || job?.status === 'pending') {
      await this.externalProviders.cancel(jobId).catch(() => undefined);
    }
    await this.afterDiscard?.(jobId);
  }

  private requireBatch(batchId: string) {
    const id = typeof batchId === 'string' ? batchId.trim() : '';
    const batch = this.batches.get(id);
    if (!batch) throw new ExternalProviderBatchError('batch_not_found', 'Lote externo não encontrado.', 404);
    return batch;
  }

  private assertFresh(batch: MutableBatch) {
    if (Date.parse(batch.expiresAt) <= this.now().getTime()) {
      this.batches.delete(batch.id);
      throw new ExternalProviderBatchError('batch_expired', 'O preview deste lote expirou. Analise o link novamente.', 410);
    }
  }

  private touch(batch: MutableBatch) {
    batch.updatedAt = this.now().toISOString();
  }

  private finishBatch(batch: MutableBatch, status: Extract<ExternalProviderBatchStatus, 'completed' | 'cancelled' | 'failed'>) {
    batch.status = status;
    const timestamp = this.now().toISOString();
    batch.updatedAt = timestamp;
    batch.finishedAt = timestamp;
  }

  private markRemainingCancelled(batch: MutableBatch) {
    for (const item of batch.items) {
      if (item.status === 'queued' || item.status === 'processing') {
        item.status = 'cancelled';
        item.error = null;
      }
    }
  }

  private markRemainingFailed(batch: MutableBatch, error: string) {
    for (const item of batch.items) {
      if (item.status === 'queued' || item.status === 'processing') {
        item.status = 'failed';
        item.error = error;
      }
    }
  }

  private prune() {
    const now = this.now().getTime();
    for (const [id, batch] of this.batches) {
      if (batch.status === 'ready' && Date.parse(batch.expiresAt) <= now) this.batches.delete(id);
    }
    if (this.batches.size <= this.maxRetainedBatches) return;
    for (const [id, batch] of this.batches) {
      if (this.batches.size <= this.maxRetainedBatches) break;
      if (batch.status === 'completed' || batch.status === 'cancelled' || batch.status === 'failed') {
        this.batches.delete(id);
      }
    }
  }
}
