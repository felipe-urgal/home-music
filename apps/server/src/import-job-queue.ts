import { randomUUID } from 'node:crypto';
import type {
  ImportJob,
  ImportJobSource,
  ImportJobStatus,
  ImportMediaDecision,
  ImportMetadataPreview
} from '@home-music/shared';

const TERMINAL_STATUSES = new Set<ImportJobStatus>(['completed', 'failed', 'cancelled']);
const ALLOWED_TRANSITIONS: Record<ImportJobStatus, readonly ImportJobStatus[]> = {
  pending: ['processing', 'failed', 'cancelled'],
  processing: ['pending', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
};

type ImportJobQueueOptions = {
  now?: () => Date;
  createId?: () => string;
  maxRetainedJobs?: number;
  onChange?: (job: ImportJob) => void;
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

function copyJob(job: ImportJob): ImportJob {
  return {
    ...job,
    source: { ...job.source },
    mediaDecision: copyDecision(job.mediaDecision),
    metadataPreview: copyMetadataPreview(job.metadataPreview)
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
  private readonly onChange?: (job: ImportJob) => void;

  constructor(options: ImportJobQueueOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.maxRetainedJobs = Math.max(1, Math.floor(options.maxRetainedJobs ?? 200));
    this.onChange = options.onChange;
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
      error: null,
      mediaDecision: null,
      metadataPreview: null
    };

    this.jobs.push(job);
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
    if (nextStatus === 'processing' && !job.startedAt) job.startedAt = timestamp;
    if (TERMINAL_STATUSES.has(nextStatus)) job.finishedAt = timestamp;
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

  private notify(job: ImportJob) {
    this.onChange?.(copyJob(job));
  }

  private trimRetainedJobs() {
    while (this.jobs.length > this.maxRetainedJobs) {
      const removableIndex = this.jobs.findIndex(job => TERMINAL_STATUSES.has(job.status));
      if (removableIndex < 0) return;
      this.jobs.splice(removableIndex, 1);
    }
  }
}
