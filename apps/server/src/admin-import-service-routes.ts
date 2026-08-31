import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AdminImportJobsResponse } from '@home-music/shared';
import { createAdminExternalProviderBatchManager } from './admin-external-provider-batch-bootstrap.js';
import { registerAdminExternalProviderBatchRoutes } from './admin-external-provider-batch-routes.js';
import { AdminImportService } from './admin-import-service.js';
import type { ImportJobQueue } from './import-job-queue.js';
import {
  ExternalProviderError,
  ExternalProviderImportManager
} from './external-provider.js';
import { ExternalProviderScratchManager } from './external-provider-scratch.js';
import { ImportAutomaticFlowManager } from './import-automatic-flow.js';
import { installImportRetryStarter } from './import-retry.js';
import { ImportStagingManager, type PromotedImportFile } from './import-staging.js';
import {
  DEFAULT_IMPORT_STAGING_TTL_HOURS,
  ImportStagingCleanupManager,
  parseImportStagingTtlHours
} from './import-staging-cleanup.js';
import {
  DEFAULT_IMPORT_UPLOAD_MAX_MEGABYTES,
  ImportUploadError,
  ImportUploadManager,
  parseImportUploadMaxMegabytes
} from './import-upload.js';
import {
  DEFAULT_IMPORT_URL_MAX_MEGABYTES,
  DEFAULT_IMPORT_URL_MAX_REDIRECTS,
  DEFAULT_IMPORT_URL_TIMEOUT_SECONDS,
  ImportUrlError,
  ImportUrlManager,
  parseImportUrlMaxMegabytes,
  parseImportUrlMaxRedirects,
  parseImportUrlTimeoutSeconds
} from './import-url.js';
import {
  ImportMediaValidationError,
  ImportMediaValidationManager,
  resolveFfprobeCommand
} from './import-media-validation.js';
import {
  ImportMetadataPreviewError,
  ImportMetadataPreviewManager,
  type ImportProviderMetadataHint
} from './import-metadata-preview.js';
import {
  ImportDuplicateDetectionError,
  ImportDuplicateDetectionManager
} from './import-duplicate-detection.js';
import {
  ImportSafeDestinationError,
  ImportSafeDestinationManager
} from './import-safe-destination.js';
import {
  YT_DLP_COMMAND_CONFIG,
  YT_DLP_PROVIDER_ID,
  YtDlpProvider
} from './yt-dlp-provider.js';

const defaultImportStagingPath = fileURLToPath(new URL('../../../data/import-staging/', import.meta.url));
const defaultExternalProviderScratchPath = fileURLToPath(new URL('../../../data/provider-scratch/', import.meta.url));

type RegisterAdminImportRoutesOptions = {
  uploads?: ImportUploadManager;
  urls?: ImportUrlManager;
  externalProviders?: ExternalProviderImportManager;
  mediaValidation?: ImportMediaValidationManager;
  metadataPreview?: ImportMetadataPreviewManager;
  duplicateDetection?: ImportDuplicateDetectionManager;
  safeDestination?: ImportSafeDestinationManager;
  automaticFlow?: ImportAutomaticFlowManager | null;
  stagingCleanup?: ImportStagingCleanupManager | null;
  providerMetadata?: (jobId: string) => ImportProviderMetadataHint | null;
  onPromoted?: (file: PromotedImportFile, jobId: string) => Promise<void>;
};

function sendImportError(reply: FastifyReply, error: unknown) {
  if (
    error instanceof ImportUploadError
    || error instanceof ImportUrlError
    || error instanceof ExternalProviderError
    || error instanceof ImportMediaValidationError
    || error instanceof ImportMetadataPreviewError
    || error instanceof ImportDuplicateDetectionError
    || error instanceof ImportSafeDestinationError
  ) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (error instanceof Error && error.name === 'ImportUploadCancelledError') {
    return reply.code(409).send({ error: 'Upload cancelado.' });
  }
  throw error;
}

function createDefaultStagingManager() {
  return new ImportStagingManager({
    stagingRoot: process.env.HOME_MUSIC_IMPORT_STAGING_DIR || defaultImportStagingPath,
    musicDir: process.env.MUSIC_DIR || ''
  });
}

function createDefaultStagingCleanupManager(app: FastifyInstance, staging: ImportStagingManager) {
  let ttlHours = DEFAULT_IMPORT_STAGING_TTL_HOURS;
  try {
    ttlHours = parseImportStagingTtlHours(process.env.HOME_MUSIC_IMPORT_STAGING_TTL_HOURS);
  } catch (error) {
    app.log.warn(
      { err: error, fallbackHours: DEFAULT_IMPORT_STAGING_TTL_HOURS },
      'TTL do staging de importação inválido; usando o valor padrão.'
    );
  }
  return new ImportStagingCleanupManager({
    staging,
    ttlMs: ttlHours * 60 * 60 * 1000,
    logger: {
      info: (context, message) => app.log.info(context, message),
      warn: (context, message) => app.log.warn(context, message)
    }
  });
}

function createDefaultUploadManager(
  app: FastifyInstance,
  queue: ImportJobQueue,
  staging: ImportStagingManager
) {
  let maxMegabytes = DEFAULT_IMPORT_UPLOAD_MAX_MEGABYTES;
  try {
    maxMegabytes = parseImportUploadMaxMegabytes(process.env.HOME_MUSIC_IMPORT_UPLOAD_MAX_MB);
  } catch (error) {
    app.log.warn(
      { err: error, fallbackMegabytes: DEFAULT_IMPORT_UPLOAD_MAX_MEGABYTES },
      'Limite de upload de importação inválido; usando o valor padrão.'
    );
  }

  return new ImportUploadManager({
    queue,
    staging,
    maxBytes: maxMegabytes * 1024 * 1024
  });
}

function createDefaultUrlManager(
  app: FastifyInstance,
  queue: ImportJobQueue,
  staging: ImportStagingManager
) {
  let maxMegabytes = DEFAULT_IMPORT_URL_MAX_MEGABYTES;
  let timeoutSeconds = DEFAULT_IMPORT_URL_TIMEOUT_SECONDS;
  let maxRedirects = DEFAULT_IMPORT_URL_MAX_REDIRECTS;

  try {
    maxMegabytes = parseImportUrlMaxMegabytes(process.env.HOME_MUSIC_IMPORT_URL_MAX_MB);
  } catch (error) {
    app.log.warn(
      { err: error, fallbackMegabytes: DEFAULT_IMPORT_URL_MAX_MEGABYTES },
      'Limite da importação por URL inválido; usando o valor padrão.'
    );
  }
  try {
    timeoutSeconds = parseImportUrlTimeoutSeconds(process.env.HOME_MUSIC_IMPORT_URL_TIMEOUT_SECONDS);
  } catch (error) {
    app.log.warn(
      { err: error, fallbackSeconds: DEFAULT_IMPORT_URL_TIMEOUT_SECONDS },
      'Timeout da importação por URL inválido; usando o valor padrão.'
    );
  }
  try {
    maxRedirects = parseImportUrlMaxRedirects(process.env.HOME_MUSIC_IMPORT_URL_MAX_REDIRECTS);
  } catch (error) {
    app.log.warn(
      { err: error, fallbackRedirects: DEFAULT_IMPORT_URL_MAX_REDIRECTS },
      'Limite de redirects da importação por URL inválido; usando o valor padrão.'
    );
  }

  return new ImportUrlManager({
    queue,
    staging,
    maxBytes: maxMegabytes * 1024 * 1024,
    timeoutMs: timeoutSeconds * 1000,
    maxRedirects
  });
}

function executablePath(candidate: string | undefined) {
  const clean = candidate?.trim() ?? '';
  if (!clean || !path.isAbsolute(clean) || clean.includes('\0')) return '';
  try {
    accessSync(clean, constants.X_OK);
    if (!statSync(clean).isFile()) return '';
    return path.normalize(clean);
  } catch {
    return '';
  }
}

function resolveYtDlpCommand(app: FastifyInstance) {
  const configured = process.env.HOME_MUSIC_YT_DLP_PATH?.trim()
    || process.env.HOME_MUSIC_YTDLP_PATH?.trim()
    || '';
  if (configured) {
    const resolved = executablePath(configured);
    if (!resolved) {
      app.log.warn(
        { component: 'yt-dlp-provider' },
        'HOME_MUSIC_YT_DLP_PATH não aponta para um executável absoluto acessível; provider externo ficará desativado.'
      );
    }
    return resolved;
  }

  const candidates = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    process.env.HOME ? path.join(process.env.HOME, '.local/bin/yt-dlp') : ''
  ];
  for (const candidate of candidates) {
    const resolved = executablePath(candidate);
    if (resolved) return resolved;
  }
  return '';
}

function createDefaultExternalProviderManager(
  queue: ImportJobQueue,
  staging: ImportStagingManager,
  ytDlpCommand: string
) {
  return new ExternalProviderImportManager({
    queue,
    staging,
    scratch: new ExternalProviderScratchManager({
      scratchRoot: process.env.HOME_MUSIC_EXTERNAL_PROVIDER_SCRATCH_DIR || defaultExternalProviderScratchPath,
      musicDir: process.env.MUSIC_DIR || ''
    }),
    providers: [new YtDlpProvider()],
    providerConfigs: {
      [YT_DLP_PROVIDER_ID]: {
        [YT_DLP_COMMAND_CONFIG]: ytDlpCommand
      }
    }
  });
}

function createDefaultMediaValidationManager(
  queue: ImportJobQueue,
  staging: ImportStagingManager
) {
  const ffmpegCommand = process.env.HOME_MUSIC_FFMPEG_PATH?.trim() || 'ffmpeg';
  const ffprobeCommand = resolveFfprobeCommand(
    process.env.HOME_MUSIC_FFPROBE_PATH,
    process.env.HOME_MUSIC_FFMPEG_PATH
  );
  return new ImportMediaValidationManager({
    queue,
    staging,
    ffmpegCommand,
    ffprobeCommand
  });
}

export function registerAdminImportRoutes(
  app: FastifyInstance,
  queue: ImportJobQueue,
  options: RegisterAdminImportRoutesOptions = {}
) {
  let defaultStaging: ImportStagingManager | null = null;
  const staging = () => {
    defaultStaging ??= createDefaultStagingManager();
    return defaultStaging;
  };
  const uploads = options.uploads ?? createDefaultUploadManager(app, queue, staging());
  const urls = options.urls ?? createDefaultUrlManager(app, queue, staging());
  const ytDlpCommand = resolveYtDlpCommand(app);
  const externalProviders = options.externalProviders ?? createDefaultExternalProviderManager(queue, staging(), ytDlpCommand);
  const mediaValidation = options.mediaValidation ?? createDefaultMediaValidationManager(queue, staging());
  const providerMetadata = options.providerMetadata ?? ((jobId: string) => {
    const metadata = externalProviders.getPrepared(jobId)?.metadata;
    if (!metadata) return null;
    return {
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album
    };
  });
  const metadataPreview = options.metadataPreview ?? new ImportMetadataPreviewManager({
    queue,
    staging: staging(),
    validatedLookup: jobId => mediaValidation.getValidated(jobId),
    providerMetadata
  });
  const duplicateDetection = options.duplicateDetection ?? new ImportDuplicateDetectionManager({
    queue,
    staging: staging(),
    validatedLookup: jobId => mediaValidation.getValidated(jobId)
  });
  const safeDestination = options.safeDestination ?? new ImportSafeDestinationManager({
    queue,
    staging: staging(),
    validatedLookup: jobId => mediaValidation.getValidated(jobId),
    duplicateReady: jobId => duplicateDetection.isReady(jobId),
    afterPromote: options.onPromoted
  });
  const automaticFlow = options.automaticFlow === undefined
    ? new ImportAutomaticFlowManager({
        queue,
        mediaValidation,
        metadataPreview,
        duplicateDetection,
        safeDestination,
        logger: {
          info: (context, message) => app.log.info(context, message),
          warn: (context, message) => app.log.warn(context, message)
        }
      })
    : options.automaticFlow;
  const stagingCleanup = options.stagingCleanup !== undefined
    ? options.stagingCleanup
    : process.env.MUSIC_DIR?.trim()
      ? createDefaultStagingCleanupManager(app, staging())
      : null;

  const ytDlpAvailable = Boolean(
    automaticFlow
    && ytDlpCommand
    && externalProviders.listProviders().some(provider => provider.id === YT_DLP_PROVIDER_ID && provider.configured)
  );
  const providerBatches = ytDlpAvailable && automaticFlow
    ? createAdminExternalProviderBatchManager({
        app,
        queue,
        externalProviders,
        automaticFlow,
        safeDestination,
        metadataPreview,
        duplicateDetection,
        ytDlpCommand
      })
    : null;

  if (providerBatches) {
    registerAdminExternalProviderBatchRoutes(app, { batches: providerBatches });
  }

  const imports = new AdminImportService({
    queue,
    uploads,
    urls,
    externalProviders,
    mediaValidation,
    metadataPreview,
    duplicateDetection,
    safeDestination,
    automaticFlow,
    logger: {
      warn: (context, message) => app.log.warn(context, message)
    }
  });

  installImportRetryStarter(app, (context, input) => imports.startRetry(context, input));

  if (stagingCleanup) {
    app.addHook('onReady', async () => {
      try {
        await stagingCleanup.start();
      } catch (error) {
        app.log.warn(
          { err: error, component: 'import-staging-cleanup', reason: 'startup' },
          'Falha na varredura inicial do staging de importações.'
        );
      }
    });
    app.addHook('onClose', async () => {
      stagingCleanup.stop();
    });
  }
  if (automaticFlow) {
    app.addHook('onClose', async () => {
      automaticFlow.stop();
    });
  }

  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
      done(null, payload);
    });
  }

  app.get('/api/admin/imports', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const response: AdminImportJobsResponse & {
      upload: typeof imports.uploadConfig;
      url: typeof imports.urlConfig;
      mediaValidation: typeof imports.mediaValidationConfig;
      providers: ReturnType<AdminImportService['listProviders']>;
    } = {
      jobs: imports.listJobs(),
      upload: imports.uploadConfig,
      url: imports.urlConfig,
      mediaValidation: imports.mediaValidationConfig,
      providers: imports.listProviders()
    };
    return response;
  });

  app.post<{ Body: { fileName?: unknown; size?: unknown; automatic?: unknown } }>(
    '/api/admin/imports/uploads',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return reply.code(201).send(
          await imports.startUpload(request.body?.fileName, request.body?.size, request.body?.automatic)
        );
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.put<{ Params: { id: string }; Body: Readable }>(
    '/api/admin/imports/uploads/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const contentLengthValue = request.headers['content-length'];
      const contentLength = typeof contentLengthValue === 'string' && /^\d+$/.test(contentLengthValue)
        ? Number(contentLengthValue)
        : undefined;
      try {
        return await imports.receiveUpload(request.params.id, request.body, contentLength);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/imports/uploads/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.cancelUpload(request.params.id);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Body: { url?: unknown; automatic?: unknown } }>(
    '/api/admin/imports/urls',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return reply.code(202).send(await imports.startUrl(request.body?.url, request.body?.automatic));
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/imports/urls/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.cancelUrl(request.params.id);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { providerId: string }; Body: { url?: unknown; automatic?: unknown } }>(
    '/api/admin/imports/providers/:providerId',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return reply.code(202).send(
          await imports.startExternalProvider(
            request.params.providerId,
            request.body?.url,
            request.body?.automatic
          )
        );
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/imports/providers/jobs/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.cancelExternalProvider(request.params.id);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { profile?: unknown } }>(
    '/api/admin/imports/:id/validate',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.validate(request.params.id, request.body?.profile);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/imports/:id/metadata-preview',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.extractMetadataPreview(request.params.id);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/imports/:id/metadata-preview',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return imports.updateMetadataPreview(request.params.id, request.body);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/imports/:id/cover',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const cover = imports.getCover(request.params.id);
      if (!cover) return reply.code(404).send({ error: 'Capa do preview não encontrada.' });
      reply.type(cover.contentType);
      return reply.send(cover.data);
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/imports/:id/duplicates',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      return { check: imports.getDuplicateCheck(request.params.id) };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/imports/:id/duplicates',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return { check: await imports.detectDuplicates(request.params.id) };
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/imports/:id/duplicates/review',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return { check: imports.reviewDuplicates(request.params.id) };
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string }; Querystring: { folderPath?: string } }>(
    '/api/admin/imports/:id/destination',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      try {
        return { destination: await imports.planDestination(request.params.id, request.query.folderPath) };
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { folderPath?: unknown } }>(
    '/api/admin/imports/:id/promote',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.promote(request.params.id, request.body?.folderPath);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );
}
