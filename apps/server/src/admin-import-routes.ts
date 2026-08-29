import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AdminImportJobsResponse } from '@home-music/shared';
import type { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
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

const defaultImportStagingPath = fileURLToPath(new URL('../../../data/import-staging/', import.meta.url));

type RegisterAdminImportRoutesOptions = {
  uploads?: ImportUploadManager;
  urls?: ImportUrlManager;
};

function sendImportError(reply: FastifyReply, error: unknown) {
  if (error instanceof ImportUploadError || error instanceof ImportUrlError) {
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
    } = {
      jobs: queue.list(),
      upload: getUploadConfig(uploads),
      url: getUrlConfig(urls)
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
        return { job: await uploads.cancel(request.params.id) };
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
        return { job: await urls.cancel(request.params.id) };
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
