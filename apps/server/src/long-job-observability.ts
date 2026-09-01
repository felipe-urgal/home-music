import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ImportJob } from '@home-music/shared';
import { sanitizeOperationError } from './admin-operation-history.js';

export type LongJobType = 'library.scan' | 'import' | 'transcode';

type LongJobLogger = {
  info: (bindings: object, message: string) => void;
  warn: (bindings: object, message: string) => void;
};

type LongJobObservabilityOptions = {
  now?: () => Date;
  createId?: () => string;
};

type LongJobReference = {
  jobType: LongJobType;
  jobId: string;
  operationId: string | null;
  resourceId: string | null;
  requestId: string | null;
};

export type LongJobRun = LongJobReference & {
  startedAtMs: number;
};

export type LongJobCompletionMetrics = {
  tracks?: number;
  added?: number;
  updated?: number;
  removed?: number;
  unchanged?: number;
};

type StartLongJobInput = {
  jobType: LongJobType;
  jobId?: string | null;
  operationId?: string | null;
  resourceId?: string | null;
};

const MAX_IDENTIFIER_LENGTH = 192;

function safeIdentifier(value: string | null | undefined) {
  const clean = value?.trim();
  if (!clean || clean.length > MAX_IDENTIFIER_LENGTH) return null;
  if (clean.includes('/') || clean.includes('\\') || clean.includes('?') || clean.includes('@')) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(clean)) return null;
  return clean;
}

function timeValue(value: string | null | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function durationMs(startedAtMs: number, finishedAtMs: number) {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) return 0;
  return Math.max(0, Math.round(finishedAtMs - startedAtMs));
}

function logBindings(reference: LongJobReference) {
  return {
    jobType: reference.jobType,
    jobId: reference.jobId,
    ...(reference.operationId ? { operationId: reference.operationId } : {}),
    ...(reference.resourceId ? { resourceId: reference.resourceId } : {}),
    ...(reference.requestId ? { requestId: reference.requestId } : {})
  };
}

function metricBindings(metrics: LongJobCompletionMetrics) {
  return Object.fromEntries(
    Object.entries(metrics)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
      .map(([key, value]) => [key, Math.max(0, Math.round(value))])
  );
}

export class LongJobObservability {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly requestContext = new AsyncLocalStorage<string>();

  constructor(
    private readonly logger: LongJobLogger,
    options: LongJobObservabilityOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  withRequest<T>(requestId: string, operation: () => T): T {
    const cleanRequestId = safeIdentifier(requestId);
    if (!cleanRequestId) return operation();
    return this.requestContext.run(cleanRequestId, operation);
  }

  start(input: StartLongJobInput): LongJobRun {
    const startedAtMs = this.now().getTime();
    const reference = this.reference(input);
    this.info({
      event: 'long_job.started',
      ...logBindings(reference)
    }, 'Job longo iniciado.');
    return { ...reference, startedAtMs };
  }

  complete(run: LongJobRun, metrics: LongJobCompletionMetrics = {}) {
    const finishedAtMs = this.now().getTime();
    this.info({
      event: 'long_job.completed',
      ...logBindings(run),
      durationMs: durationMs(run.startedAtMs, finishedAtMs),
      ...metricBindings(metrics)
    }, 'Job longo concluído.');
  }

  fail(run: LongJobRun, error: unknown) {
    const finishedAtMs = this.now().getTime();
    const sanitized = sanitizeOperationError(error);
    this.warn({
      event: 'long_job.failed',
      ...logBindings(run),
      durationMs: durationMs(run.startedAtMs, finishedAtMs),
      errorMessage: sanitized.message,
      errorAction: sanitized.action
    }, 'Job longo falhou.');
  }

  observeImportJob(job: ImportJob, operationId: string | null) {
    const nowMs = this.now().getTime();
    const reference = this.reference({
      jobType: 'import',
      jobId: job.id,
      operationId
    });
    const startedAtMs = timeValue(job.startedAt ?? job.createdAt, nowMs);

    if (job.status === 'processing' && job.startedAt && job.startedAt === job.updatedAt) {
      this.info({
        event: 'long_job.started',
        ...logBindings(reference)
      }, 'Job longo iniciado.');
      return;
    }

    if (job.status === 'completed') {
      this.info({
        event: 'long_job.completed',
        ...logBindings(reference),
        durationMs: durationMs(startedAtMs, timeValue(job.finishedAt, nowMs))
      }, 'Job longo concluído.');
      return;
    }

    if (job.status === 'cancelled') {
      this.info({
        event: 'long_job.cancelled',
        ...logBindings(reference),
        durationMs: durationMs(startedAtMs, timeValue(job.finishedAt, nowMs))
      }, 'Job longo cancelado.');
      return;
    }

    if (job.status === 'failed') {
      const sanitized = sanitizeOperationError(job.error);
      this.warn({
        event: 'long_job.failed',
        ...logBindings(reference),
        durationMs: durationMs(startedAtMs, timeValue(job.finishedAt, nowMs)),
        errorMessage: sanitized.message,
        errorAction: sanitized.action
      }, 'Job longo falhou.');
    }
  }

  private reference(input: StartLongJobInput): LongJobReference {
    const generatedId = `${input.jobType.replace('.', '-')}-${this.createId()}`;
    return {
      jobType: input.jobType,
      jobId: safeIdentifier(input.jobId) ?? safeIdentifier(generatedId) ?? 'long-job',
      operationId: safeIdentifier(input.operationId),
      resourceId: safeIdentifier(input.resourceId),
      requestId: safeIdentifier(this.requestContext.getStore())
    };
  }

  private info(bindings: object, message: string) {
    try {
      this.logger.info(bindings, message);
    } catch {
      // Observabilidade nunca deve alterar o resultado da operação principal.
    }
  }

  private warn(bindings: object, message: string) {
    try {
      this.logger.warn(bindings, message);
    } catch {
      // Observabilidade nunca deve alterar o resultado da operação principal.
    }
  }
}
