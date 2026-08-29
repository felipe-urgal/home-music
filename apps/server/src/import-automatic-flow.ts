import type { ImportJob, ImportMetadataPreview } from '@home-music/shared';
import type { ImportJobQueue } from './import-job-queue.js';
import type { ImportMediaValidationManager } from './import-media-validation.js';
import type { ImportMetadataPreviewManager } from './import-metadata-preview.js';
import type {
  ImportDuplicateCheck,
  ImportDuplicateDetectionManager
} from './import-duplicate-detection.js';
import type { ImportSafeDestinationManager } from './import-safe-destination.js';

const DEFAULT_WAIT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 150;
const REVIEW_METADATA_STATES = new Set(['missing', 'suggested', 'conflict']);

type ImportAutomaticFlowLogger = Readonly<{
  info?: (context: Record<string, unknown>, message: string) => void;
  warn?: (context: Record<string, unknown>, message: string) => void;
}>;

type ImportAutomaticFlowOptions = {
  queue: Pick<ImportJobQueue, 'get'>;
  mediaValidation: Pick<ImportMediaValidationManager, 'validate'>;
  metadataPreview: Pick<ImportMetadataPreviewManager, 'captureSource' | 'extract' | 'update'>;
  duplicateDetection: Pick<
    ImportDuplicateDetectionManager,
    'captureSource' | 'forgetCheck' | 'detect' | 'get' | 'isReady'
  >;
  safeDestination: Pick<ImportSafeDestinationManager, 'promote'>;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  logger?: ImportAutomaticFlowLogger;
};

export type ImportAutomaticFlowReason =
  | 'completed'
  | 'metadata_review'
  | 'duplicate_review'
  | 'duplicate_blocked'
  | 'terminal'
  | 'timeout'
  | 'error';

export type ImportAutomaticFlowOutcome = Readonly<{
  jobId: string;
  reason: ImportAutomaticFlowReason;
}>;

function terminal(job: ImportJob | null) {
  return Boolean(job && ['completed', 'failed', 'cancelled'].includes(job.status));
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function providerSuggestionPatch(preview: ImportMetadataPreview) {
  const patch: Record<string, string> = {};
  const provider = preview.provider;
  if (!provider) return patch;

  for (const field of ['title', 'artist', 'album'] as const) {
    if (preview.fieldStates[field] !== 'suggested') continue;
    const value = provider[field]?.trim();
    if (value) patch[field] = value;
  }
  return patch;
}

export function importMetadataNeedsReview(preview: ImportMetadataPreview) {
  const title = preview.effective.title?.trim() ?? '';
  const artist = preview.effective.artist?.trim() ?? '';
  if (!title || !artist) return true;
  return REVIEW_METADATA_STATES.has(preview.fieldStates.title)
    || REVIEW_METADATA_STATES.has(preview.fieldStates.artist);
}

function duplicatePauseReason(check: ImportDuplicateCheck): ImportAutomaticFlowReason | null {
  if (check.disposition === 'blocked') return 'duplicate_blocked';
  if (check.disposition === 'review' && !check.reviewedAt) return 'duplicate_review';
  return null;
}

export class ImportAutomaticFlowManager {
  private readonly queue: ImportAutomaticFlowOptions['queue'];
  private readonly mediaValidation: ImportAutomaticFlowOptions['mediaValidation'];
  private readonly metadataPreview: ImportAutomaticFlowOptions['metadataPreview'];
  private readonly duplicateDetection: ImportAutomaticFlowOptions['duplicateDetection'];
  private readonly safeDestination: ImportAutomaticFlowOptions['safeDestination'];
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly logger?: ImportAutomaticFlowLogger;
  private readonly enabled = new Set<string>();
  private readonly active = new Map<string, Promise<ImportAutomaticFlowOutcome>>();

  constructor(options: ImportAutomaticFlowOptions) {
    this.queue = options.queue;
    this.mediaValidation = options.mediaValidation;
    this.metadataPreview = options.metadataPreview;
    this.duplicateDetection = options.duplicateDetection;
    this.safeDestination = options.safeDestination;
    this.waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.logger = options.logger;

    if (!Number.isSafeInteger(this.waitTimeoutMs) || this.waitTimeoutMs <= 0) {
      throw new Error('Timeout do fluxo automático de importação inválido.');
    }
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs <= 0) {
      throw new Error('Intervalo do fluxo automático de importação inválido.');
    }
  }

  isEnabled(jobId: string) {
    return this.enabled.has(jobId);
  }

  startWhenReady(jobId: string) {
    this.enabled.add(jobId);
    return this.ensureRunning(jobId);
  }

  resume(jobId: string) {
    if (!this.enabled.has(jobId)) return Promise.resolve<ImportAutomaticFlowOutcome | null>(null);
    return this.ensureRunning(jobId);
  }

  disable(jobId: string) {
    this.enabled.delete(jobId);
  }

  stop() {
    this.enabled.clear();
  }

  private ensureRunning(jobId: string) {
    const existing = this.active.get(jobId);
    if (existing) return existing;

    let run!: Promise<ImportAutomaticFlowOutcome>;
    run = this.runWhenReady(jobId).finally(() => {
      if (this.active.get(jobId) === run) this.active.delete(jobId);
    });
    this.active.set(jobId, run);
    return run;
  }

  private async runWhenReady(jobId: string): Promise<ImportAutomaticFlowOutcome> {
    try {
      const ready = await this.waitForPending(jobId);
      if (!ready) return this.finishIfTerminalOrTimeout(jobId);
      if (!this.enabled.has(jobId)) return { jobId, reason: 'terminal' };

      let job = this.queue.get(jobId);
      if (!job || terminal(job)) return this.finishTerminal(jobId);

      if (!job.mediaDecision) {
        await this.metadataPreview.captureSource(jobId).catch(error => {
          this.logger?.warn?.(
            { importJobId: jobId, stage: 'metadata-source', error: this.errorMessage(error) },
            'Fluxo automático não conseguiu antecipar metadata da importação.'
          );
        });
        await this.duplicateDetection.captureSource(jobId).catch(error => {
          this.logger?.warn?.(
            { importJobId: jobId, stage: 'duplicate-source', error: this.errorMessage(error) },
            'Fluxo automático não conseguiu antecipar fingerprint da importação.'
          );
        });
        this.duplicateDetection.forgetCheck(jobId);
        await this.mediaValidation.validate(jobId, 'original');
        job = this.queue.get(jobId);
        if (!job || terminal(job)) return this.finishTerminal(jobId);
      }

      let preview = job.metadataPreview;
      if (!preview) {
        const extracted = await this.metadataPreview.extract(jobId);
        preview = extracted.preview;
      }

      const suggestionPatch = providerSuggestionPatch(preview);
      if (Object.keys(suggestionPatch).length > 0) {
        preview = this.metadataPreview.update(jobId, suggestionPatch).preview;
        this.duplicateDetection.forgetCheck(jobId);
      }

      if (importMetadataNeedsReview(preview)) {
        this.logger?.info?.(
          { importJobId: jobId, stage: 'metadata-review' },
          'Fluxo automático pausado para revisão de metadata.'
        );
        return { jobId, reason: 'metadata_review' };
      }

      let duplicateCheck = this.duplicateDetection.get(jobId);
      if (!duplicateCheck) duplicateCheck = await this.duplicateDetection.detect(jobId);
      const duplicatePause = duplicatePauseReason(duplicateCheck);
      if (duplicatePause) {
        this.logger?.info?.(
          { importJobId: jobId, stage: duplicatePause },
          'Fluxo automático pausado pela verificação de duplicatas.'
        );
        return { jobId, reason: duplicatePause };
      }
      if (!this.duplicateDetection.isReady(jobId)) {
        return { jobId, reason: 'duplicate_review' };
      }

      await this.safeDestination.promote(jobId, undefined);
      this.enabled.delete(jobId);
      return { jobId, reason: 'completed' };
    } catch (error) {
      const current = this.queue.get(jobId);
      if (terminal(current)) this.enabled.delete(jobId);
      this.logger?.warn?.(
        { importJobId: jobId, stage: 'automatic-flow', error: this.errorMessage(error) },
        'Fluxo automático de importação foi interrompido.'
      );
      return { jobId, reason: 'error' };
    }
  }

  private async waitForPending(jobId: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.waitTimeoutMs) {
      if (!this.enabled.has(jobId)) return false;
      const job = this.queue.get(jobId);
      if (!job || terminal(job)) return false;
      if (job.status === 'pending') return true;
      await sleep(this.pollIntervalMs);
    }
    return false;
  }

  private finishIfTerminalOrTimeout(jobId: string): ImportAutomaticFlowOutcome {
    const job = this.queue.get(jobId);
    if (!job || terminal(job) || !this.enabled.has(jobId)) return this.finishTerminal(jobId);
    this.enabled.delete(jobId);
    this.logger?.warn?.(
      { importJobId: jobId, stage: 'wait-pending' },
      'Fluxo automático expirou aguardando a aquisição da mídia.'
    );
    return { jobId, reason: 'timeout' };
  }

  private finishTerminal(jobId: string): ImportAutomaticFlowOutcome {
    this.enabled.delete(jobId);
    return { jobId, reason: 'terminal' };
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Erro desconhecido';
  }
}
