import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AdminImportJobsResponse } from '@home-music/shared';
import type { ImportJobQueue } from './import-job-queue.js';
import {
  ImportRetryStartError,
  installImportRetryStarter
} from './import-retry.js';
import { ImportStagingManager } from './import-staging.js';
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

const defaultImportStagingPath = fileURLToPath(new URL('../../../data/import-staging/', import.meta.url));

type RegisterAdminImportRoutesOptions = {
  uploads?: ImportUploadManager;
  urls?: ImportUrlManager;
  mediaValidation?: ImportMediaValidationManager;
  metadataPreview?: ImportMetadataPreviewManager;
  duplicateDetection?: ImportDuplicateDetectionManager;
  safeDestination?: ImportSafeDestinationManager;
  stagingCleanup?: ImportStagingCleanupManager | null;
  providerMetadata?: (jobId: string) => ImportProviderMetadataHint | null;
};

function sendImportError(reply: FastifyReply, error: unknown) {
  if (
    error instanceof ImportUploadError
    || error instanceof ImportUrlError
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
  const mediaValidation = options.mediaValidation ?? createDefaultMediaValidationManager(queue, staging());
  const metadataPreview = options.metadataPreview ?? new ImportMetadataPreviewManager({
    queue,
    staging: staging(),
    validatedLookup: jobId => mediaValidation.getValidated(jobId),
    providerMetadata: options.providerMetadata
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
    duplicateReady: jobId => duplicateDetection.isReady(jobId)
  });
  const stagingCleanup = options.stagingCleanup !== undefined
    ? options.stagingCleanup
    : process.env.MUSIC_DIR?.trim()
      ? createDefaultStagingCleanupManager(app, staging())
      : null;

  installImportRetryStarter(app, async (context, input) => {
    const before = new Set(queue.list().map(job => job.id));
    try {
      if (context.source.type === 'upload') {
        return await uploads.start(input.fileName, input.size, context.lineage);
      }
      if (context.source.type === 'url') {
        return await urls.start(input.url);
      }
      throw new ImportRetryStartError('A fonte desta importação não suporta retry seguro.', 409);
    } catch (error) {
      if (error instanceof ImportRetryStartError) throw error;
      const child = queue.list().find(job => !before.has(job.id)) ?? null;
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
  });

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

  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
      done(null, payload);
    });
  }

  app.get('/api/admin/imports', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const response: AdminImportJobsResponse & {
      upload: ReturnType<typeof getUploadConfig>;
      url: ReturnType<typeof getUrlConfig>;
      mediaValidation: ReturnType<typeof getMediaValidationConfig>;
    } = {
      jobs: queue.list(),
      upload: getUploadConfig(uploads),
      url: getUrlConfig(urls),
      mediaValidation: getMediaValidationConfig(mediaValidation)
    };
    return response;
  });

  app.post<{ Body: { fileName?: unknown; size?: unknown } }>(
    '/api/admin/imports/uploads',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const result = await uploads.start(request.body?.fileName, request.body?.size);
        return reply.code(201).send(result);
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
        return await uploads.receive(request.params.id, request.body, contentLength);
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
        const job = await uploads.cancel(request.params.id);
        metadataPreview.forget(request.params.id);
        duplicateDetection.forget(request.params.id);
        return { job };
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Body: { url?: unknown } }>(
    '/api/admin/imports/urls',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const result = await urls.start(request.body?.url);
        return reply.code(202).send(result);
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
        const job = await urls.cancel(request.params.id);
        metadataPreview.forget(request.params.id);
        duplicateDetection.forget(request.params.id);
        return { job };
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
        await metadataPreview.captureSource(request.params.id).catch(error => {
          app.log.warn({ err: error, importJobId: request.params.id }, 'Não foi possível antecipar metadata da importação.');
        });
        await duplicateDetection.captureSource(request.params.id).catch(error => {
          app.log.warn({ err: error, importJobId: request.params.id }, 'Não foi possível antecipar fingerprint da importação.');
        });
        duplicateDetection.forgetCheck(request.params.id);
        return await mediaValidation.validate(request.params.id, request.body?.profile);
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
        const result = await metadataPreview.extract(request.params.id);
        duplicateDetection.forgetCheck(request.params.id);
        return result;
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
        const result = metadataPreview.update(request.params.id, request.body);
        duplicateDetection.forgetCheck(request.params.id);
        return result;
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/imports/:id/cover',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const cover = metadataPreview.getCover(request.params.id);
      if (!cover) return reply.code(404).send({ error: 'Capa do preview não encontrada.' });
      reply.type(cover.contentType);
      return reply.send(cover.data);
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/imports/:id/duplicates',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      return { check: duplicateDetection.get(request.params.id) };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/imports/:id/duplicates',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return { check: await duplicateDetection.detect(request.params.id) };
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
        return { check: duplicateDetection.review(request.params.id) };
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
        return { destination: await safeDestination.plan(request.params.id, request.query.folderPath) };
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
        return await safeDestination.promote(request.params.id, request.body?.folderPath);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );
}

function getUploadConfig(uploads: ImportUploadManager) {
  return uploads.config;
}

function getUrlConfig(urls: ImportUrlManager) {
  return urls.config;
}

function getMediaValidationConfig(mediaValidation: ImportMediaValidationManager) {
  return { profiles: mediaValidation.profiles };
}
