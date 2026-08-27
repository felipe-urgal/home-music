import { randomUUID } from 'node:crypto';
import type { ImportJob, ImportJobSource, ImportJobStatus } from '@home-music/shared';

const TERMINAL_STATUSES = new Set<ImportJobStatus>(['completed', 'failed', 'cancelled']);
const ALLOWED_TRANSITIONS: Record<ImportJobStatus, readonly ImportJobStatus[]> = {
  pending: ['processing', 'failed', 'cancelled'],
  processing: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
};

type ImportJobQueueOptions = {
  now?: () => Date;
  createId?: () => string;
  maxRetainedJobs?: number;
};

function copyJob(job: ImportJob): ImportJob {
  return {
    ...job,
    source: { ...job.source }
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

export class ImportJobQueue {
  private readonly jobs: ImportJob[] = [];
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly maxRetainedJobs: number;

  constructor(options: ImportJobQueueOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.maxRetainedJobs = Math.max(1, Math.floor(options.maxRetainedJobs ?? 200));
  }

  enqueue(source: ImportJobSource, label: string) {
    const cleanLabel = label.trim().slice(0, 240);
    if (!cleanLabel) throw new Error('Descrição da importação obrigatória.');

    const timestamp = this.now().toISOString();
    const job: ImportJob = {
      id: this.createId(),
      source: normalizeSource(source),
      label: cleanLabel,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      error: null
    };

    this.jobs.push(job);
    this.trimRetainedJobs();
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
    if (nextStatus === 'processing' && !job.startedAt) job.startedAt = timestamp;
    if (TERMINAL_STATUSES.has(nextStatus)) job.finishedAt = timestamp;
    job.error = nextStatus === 'failed' ? error?.trim().slice(0, 500) || 'Falha na importação.' : null;

    this.trimRetainedJobs();
    return copyJob(job);
  }

  get(id: string) {
    const job = this.jobs.find(item => item.id === id);
    return job ? copyJob(job) : null;
  }

  list() {
    return this.jobs.toReversed().map(copyJob);
  }

  private trimRetainedJobs() {
    while (this.jobs.length > this.maxRetainedJobs) {
      const removableIndex = this.jobs.findIndex(job => TERMINAL_STATUSES.has(job.status));
      if (removableIndex < 0) return;
      this.jobs.splice(removableIndex, 1);
    }
  }
}
