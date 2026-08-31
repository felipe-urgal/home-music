import type { Readable } from 'node:stream';
import type { ImportJobQueue } from './import-job-queue.js';
import type { ExternalProviderImportManager } from './external-provider.js';
import type { ImportAutomaticFlowManager } from './import-automatic-flow.js';
import type { ImportDuplicateDetectionManager } from './import-duplicate-detection.js';
import type { ImportMediaValidationManager } from './import-media-validation.js';
import type { ImportMetadataPreviewManager } from './import-metadata-preview.js';
import {
  ImportRetryStartError,
  type ImportRetryContext,
  type ImportRetryInput
} from './import-retry.js';
import type { ImportSafeDestinationManager } from './import-safe-destination.js';
import type { ImportUploadManager } from './import-upload.js';
import { ImportUploadError } from './import-upload.js';
import type { ImportUrlManager } from './import-url.js';
import { ImportUrlError } from './import-url.js';

type ImportServiceLogger = {
  warn: (context: Record<string, unknown>, message: string) => void;
};

type ImportQueuePort = Pick<ImportJobQueue, 'list'>;
type ImportUploadPort = Pick<ImportUploadManager, 'config' | 'start' | 'receive' | 'cancel'>;
type ImportUrlPort = Pick<ImportUrlManager, 'config' | 'start' | 'cancel'>;
type ExternalProviderPort = Pick<ExternalProviderImportManager, 'listProviders' | 'start' | 'cancel'>;
type MediaValidationPort = Pick<ImportMediaValidationManager, 'profiles' | 'validate'>;
type MetadataPreviewPort = Pick<
  ImportMetadataPreviewManager,
  'captureSource' | 'extract' | 'update' | 'getCover' | 'forget'
>;
type DuplicateDetectionPort = Pick<
  ImportDuplicateDetectionManager,
  'captureSource' | 'forgetCheck' | 'forget' | 'get' | 'detect' | 'review'
>;
type SafeDestinationPort = Pick<ImportSafeDestinationManager, 'plan' | 'promote'>;
type AutomaticFlowPort = Pick<
  ImportAutomaticFlowManager,
  'startWhenReady' | 'disable' | 'isEnabled' | 'resume'
>;

export type AdminImportServiceOptions = {
  queue: ImportQueuePort;
  uploads: ImportUploadPort;
  urls: ImportUrlPort;
  externalProviders: ExternalProviderPort;
  mediaValidation: MediaValidationPort;
  metadataPreview: MetadataPreviewPort;
  duplicateDetection: DuplicateDetectionPort;
  safeDestination: SafeDestinationPort;
  automaticFlow: AutomaticFlowPort | null;
  logger: ImportServiceLogger;
};

function automaticRequested(value: unknown) {
  return value !== false;
}

export class AdminImportService {
  private readonly automaticUploads = new Set<string>();

  constructor(private readonly options: AdminImportServiceOptions) {}

  listJobs() {
    return this.options.queue.list();
  }

  get uploadConfig() {
    return this.options.uploads.config;
  }

  get urlConfig() {
    return this.options.urls.config;
  }

  get mediaValidationConfig() {
    return { profiles: this.options.mediaValidation.profiles };
  }

  listProviders() {
    return this.options.externalProviders.listProviders();
  }

  async startRetry(context: ImportRetryContext, input: ImportRetryInput) {
    const before = new Set(this.options.queue.list().map(job => job.id));
    try {
      if (context.source.type === 'upload') {
        return await this.options.uploads.start(input.fileName, input.size, context.lineage);
      }
      if (context.source.type === 'url') {
        return await this.options.urls.start(input.url);
      }
      throw new ImportRetryStartError('A fonte desta importação não suporta retry seguro.', 409);
    } catch (error) {
      if (error instanceof ImportRetryStartError) throw error;
      const child = this.options.queue.list().find(job => !before.has(job.id)) ?? null;
      if (error instanceof ImportUploadError || error instanceof ImportUrlError) {
        throw new ImportRetryStartError(error.message, error.statusCode, child);
      }
      if (child) {
        throw new ImportRetryStartError(
          child.error || 'Não foi possível iniciar a nova tentativa de importação.',
          500,
          child
        );
      }
      throw error;
    }
  }

  async startUpload(fileName: unknown, size: unknown, automatic: unknown) {
    const result = await this.options.uploads.start(fileName, size);
    if (this.options.automaticFlow && automaticRequested(automatic)) {
      this.automaticUploads.add(result.job.id);
    }
    return result;
  }

  async receiveUpload(jobId: string, payload: Readable, contentLength?: number) {
    try {
      const result = await this.options.uploads.receive(jobId, payload, contentLength);
      if (this.options.automaticFlow && this.automaticUploads.delete(jobId)) {
        void this.options.automaticFlow.startWhenReady(jobId);
      }
      return result;
    } catch (error) {
      this.automaticUploads.delete(jobId);
      this.options.automaticFlow?.disable(jobId);
      throw error;
    }
  }

  async cancelUpload(jobId: string) {
    this.automaticUploads.delete(jobId);
    const job = await this.options.uploads.cancel(jobId);
    this.forgetDerivedState(jobId);
    return { job };
  }

  async startUrl(url: unknown, automatic: unknown) {
    const result = await this.options.urls.start(url);
    if (this.options.automaticFlow && automaticRequested(automatic)) {
      void this.options.automaticFlow.startWhenReady(result.job.id);
    }
    return result;
  }

  async cancelUrl(jobId: string) {
    const job = await this.options.urls.cancel(jobId);
    this.forgetDerivedState(jobId);
    return { job };
  }

  async startExternalProvider(providerId: string, url: unknown, automatic: unknown) {
    const result = await this.options.externalProviders.start(providerId, {
      url: typeof url === 'string' ? url : ''
    });
    if (this.options.automaticFlow && automaticRequested(automatic)) {
      void this.options.automaticFlow.startWhenReady(result.job.id);
    }
    return result;
  }

  async cancelExternalProvider(jobId: string) {
    const job = await this.options.externalProviders.cancel(jobId);
    this.forgetDerivedState(jobId);
    return { job };
  }

  async validate(jobId: string, profile: unknown) {
    await this.options.metadataPreview.captureSource(jobId).catch(error => {
      this.options.logger.warn(
        { err: error, importJobId: jobId },
        'Não foi possível antecipar metadata da importação.'
      );
    });
    await this.options.duplicateDetection.captureSource(jobId).catch(error => {
      this.options.logger.warn(
        { err: error, importJobId: jobId },
        'Não foi possível antecipar fingerprint da importação.'
      );
    });
    this.options.duplicateDetection.forgetCheck(jobId);
    return this.options.mediaValidation.validate(jobId, profile);
  }

  async extractMetadataPreview(jobId: string) {
    const result = await this.options.metadataPreview.extract(jobId);
    this.options.duplicateDetection.forgetCheck(jobId);
    return result;
  }

  updateMetadataPreview(jobId: string, payload: unknown) {
    const result = this.options.metadataPreview.update(jobId, payload);
    this.options.duplicateDetection.forgetCheck(jobId);
    if (this.options.automaticFlow?.isEnabled(jobId)) {
      void this.options.automaticFlow.resume(jobId);
    }
    return result;
  }

  getCover(jobId: string) {
    return this.options.metadataPreview.getCover(jobId);
  }

  getDuplicateCheck(jobId: string) {
    return this.options.duplicateDetection.get(jobId);
  }

  async detectDuplicates(jobId: string) {
    return this.options.duplicateDetection.detect(jobId);
  }

  reviewDuplicates(jobId: string) {
    const check = this.options.duplicateDetection.review(jobId);
    if (this.options.automaticFlow?.isEnabled(jobId)) {
      void this.options.automaticFlow.resume(jobId);
    }
    return check;
  }

  async planDestination(jobId: string, folderPath: string | undefined) {
    return this.options.safeDestination.plan(jobId, folderPath);
  }

  async promote(jobId: string, folderPath: unknown) {
    const result = await this.options.safeDestination.promote(jobId, folderPath);
    this.options.automaticFlow?.disable(jobId);
    return result;
  }

  private forgetDerivedState(jobId: string) {
    this.options.automaticFlow?.disable(jobId);
    this.options.metadataPreview.forget(jobId);
    this.options.duplicateDetection.forget(jobId);
  }
}
