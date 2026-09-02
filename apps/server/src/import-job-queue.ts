import { randomUUID } from 'node:crypto';
import type {
  ImportJob,
  ImportJobSource,
  ImportJobStatus,
  ImportMediaDecision,
  ImportMetadataPreview
} from '@home-music/shared';
import {
  currentHeavyWorkRequestContext,
  HeavyWorkQueueSaturatedError,
  type HeavyWorkQueueRuntime
} from './heavy-work-queue.js';
import type { ImportJobRetryLineage, ImportJobWithRetry } from './import-retry.js';

const TERMINAL_STATUSES = new Set<ImportJobStatus>(['completed', 'failed', 'cancelled']);
const ALLOWED_TRANSITIONS: Record<ImportJobStatus, readonly ImportJobStatus[]> = {
  pending: ['processing', 'failed', 'cancelled'],
  processing: ['pending', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
};
const MAX_RETRY_JOB_ID_LENGTH = 128;
const MAX_RETRY_ATTEMPTS = 1_000;

type ImportJobQueueOptions = {
  now?: () => Date;
  createId?: () => string;
  maxRetainedJobs?: number;
  maxNonTerminalJobs?: number;
  maxNonTerminalJobsPerOwner?: number;
  retryAfterSeconds?: number;
  onChange?: (job: ImportJobWithRetry) => void;
};

function copyDecision(decision: ImportMediaDecision | null): ImportMediaDecision | null {
  if (!decision) return null;
  return {
    ...decision,
    input: { ...decision.input },
    output: { ...decision.output }
  };
}

function copyMetadataValues(values: ImportMetadataPreview['embedded']) {
  return { ...values };
}

function copyMetadataPreview(preview: ImportMetadataPreview | null): ImportMetadataPreview | null {
  if (!preview) return null;
  return {
    ...preview,
    embedded: copyMetadataValues(preview.embedded),
    provider: preview.provider ? copyMetadataValues(preview.provider) : null,
    overrides: copyMetadataValues(preview.overrides),
    effective: copyMetadataValues(preview.effective),
    fieldStates: { ...preview.fieldStates },
    cover: { ...preview.cover }
  };
}

function copyRetry(retry: ImportJobRetryLineage | null): ImportJobRetryLineage | null {
  return retry ? { ...retry } : null;
}

function copyJob(job: ImportJobWithRetry): ImportJobWithRetry {
  return {
    ...job,
    source: { ...job.source },
    mediaDecision: copyDecision(job.mediaDecision),
    metadataPreview: copyMetadataPreview(job.metadataPreview),
    retry: copyRetry(job.retry)
  };
}

function normalizeSource(source: ImportJobSource): ImportJobSource {
  if (source.type === 'provider') {
    const provider = source.provider?.trim().slice(0, 80) || null;
    if (!provider) throw new Error('Provider de importação obrigatório.');
    return { type: 'provider', provider };
  }
  return { type: source.type, provider: null };
}

function normalizeRetry(retry: ImportJobRetryLineage | null | undefined): ImportJobRetryLineage | null {
  if (!retry) return null;
  const parentJobId = retry.parentJobId.trim();
  const rootJobId = retry.rootJobId.trim();
  if (
    !parentJobId
    || !rootJobId
    || parentJobId.length > MAX_RETRY_JOB_ID_LENGTH
    || rootJobId.length > MAX_RETRY_JOB_ID_LENGTH
    || !Number.isSafeInteger(retry.attempt)
    || retry.attempt < 2
    || retry.attempt > MAX_RETRY_ATTEMPTS
  ) {
    throw new Error('Vínculo de retry de importação inválido.');
  }
  return { parentJobId, rootJobId, attempt: retry.attempt };
}

export class ImportJobQueue {
  private readonly jobs: ImportJobWithRetry[] = [];
  private readonly owners = new Map<string, string>();
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly maxRetainedJobs: number;
  private readonly maxNonTerminalJobs: number;
  private readonly maxNonTerminalJobsPerOwner: number;
  private readonly retryAfterSeconds: number;
  private readonly onChange?: (job: ImportJobWithRetry) => void;
  private rejected = 0;
  private lastQueueWaitMs = 0;

  constructor(options: ImportJobQueueOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.maxRetainedJobs = Math.max(1, Math.floor(options.maxRetainedJobs ?? 200));
    this.maxNonTerminalJobs = Math.max(1, Math.floor(options.maxNonTerminalJobs ?? 64));
    this.maxNonTerminalJobsPerOwner = Math.min(
      this.maxNonTerminalJobs,
      Math.max(1, Math.floor(options.maxNonTerminalJobsPerOwner ?? 32))
    );
    this.retryAfterSeconds = Math.max(1, Math.floor(options.retryAfterSeconds ?? 2));
    this.onChange = options.onChange;
  }

  get runtime(): HeavyWorkQueueRuntime {
    const now = this.now().getTime();
    let oldestPendingMs = 0;
    let active = 0;
    let pending = 0;
    for (const job of this.jobs) {
      if (job.status === 'processing') active += 1;
      if (job.status === 'pending') {
        pending += 1;
        oldestPendingMs = Math.max(oldestPendingMs, Math.max(0, now - Date.parse(job.createdAt)));
      }
    }
    return {
      active,
      pending,
      rejected: this.rejected,
      oldestPendingMs,
      lastQueueWaitMs: this.lastQueueWaitMs
    };
  }

  enqueue(source: ImportJobSource, label: string, retry?: ImportJobRetryLineage | null) {
    const cleanLabel = label.trim().slice(0, 240);
    if (!cleanLabel) throw new Error('Descrição da importação obrigatória.');

    const ownerId = currentHeavyWorkRequestContext().ownerId;
    const nonTerminalJobs = this.jobs.filter(job => !TERMINAL_STATUSES.has(job.status));
    const ownerJobs = nonTerminalJobs.filter(job => this.owners.get(job.id) === ownerId);
    if (
      nonTerminalJobs.length >= this.maxNonTerminalJobs
      || ownerJobs.length >= this.maxNonTerminalJobsPerOwner
    ) {
      this.rejected += 1;
      throw new HeavyWorkQueueSaturatedError('imports', this.retryAfterSeconds);
    }

    const timestamp = this.now().toISOString();
    const job: ImportJobWithRetry = {
      id: this.createId(),
      source: normalizeSource(source),
      label: cleanLabel,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      error: null,
      mediaDecision: null,
      metadataPreview: null,
      retry: normalizeRetry(retry)
    };

    this.jobs.push(job);
    this.owners.set(job.id, ownerId);
    this.trimRetainedJobs();
    this.notify(job);
    return copyJob(job);
  }

  setMediaDecision(id: string, decision: ImportMediaDecision) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) return null;
    if (TERMINAL_STATUSES.has(job.status)) {
      throw new Error('Job terminal não aceita nova decisão de mídia.');
    }

    job.mediaDecision = copyDecision(decision);
    job.updatedAt = this.now().toISOString();
    this.notify(job);
    return copyJob(job);
  }

  setMetadataPreview(id: string, preview: ImportMetadataPreview) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) return null;
    if (TERMINAL_STATUSES.has(job.status)) {
      throw new Error('Job terminal não aceita preview de metadata.');
    }

    job.metadataPreview = copyMetadataPreview(preview);
    job.updatedAt = this.now().toISOString();
    this.notify(job);
    return copyJob(job);
  }

  transition(id: string, nextStatus: ImportJobStatus, error?: string) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) return null;
    if (job.status === nextStatus) return copyJob(job);
    if (!ALLOWED_TRANSITIONS[job.status].includes(nextStatus)) {
      throw new Error(`Transição de importação inválida: ${job.status} -> ${nextStatus}.`);
    }

    const timestamp = this.now().toISOString();
    job.status = nextStatus;
    job.updatedAt = timestamp;
    if (nextStatus === 'processing' && !job.startedAt) {
      job.startedAt = timestamp;
      this.lastQueueWaitMs = Math.max(0, Date.parse(timestamp) - Date.parse(job.createdAt));
    }
    if (TERMINAL_STATUSES.has(nextStatus)) {
      job.finishedAt = timestamp;
      this.owners.delete(job.id);
    }
    job.error = nextStatus === 'failed' ? error?.trim().slice(0, 500) || 'Falha na importação.' : null;

    this.trimRetainedJobs();
    this.notify(job);
    return copyJob(job);
  }

  get(id: string) {
    const job = this.jobs.find(item => item.id === id);
    return job ? copyJob(job) : null;
  }

  list() {
    return [...this.jobs].reverse().map(copyJob);
  }

  private notify(job: ImportJobWithRetry) {
    this.onChange?.(copyJob(job));
  }

  private trimRetainedJobs() {
    while (this.jobs.length > this.maxRetainedJobs) {
      const removableIndex = this.jobs.findIndex(job => TERMINAL_STATUSES.has(job.status));
      if (removableIndex < 0) return;
      const [removed] = this.jobs.splice(removableIndex, 1);
      if (removed) this.owners.delete(removed.id);
    }
  }
}
