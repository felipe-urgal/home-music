import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AdminImportJobsResponse } from '@home-music/shared';
import type { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import {
  ImportUploadError,
  ImportUploadManager,
  parseImportUploadMaxMegabytes
} from './import-upload.js';

const defaultImportStagingPath = fileURLToPath(new URL('../../../data/import-staging/', import.meta.url));

type RegisterAdminImportRoutesOptions = {
  uploads?: ImportUploadManager;
};

function sendUploadError(reply: FastifyReply, error: unknown) {
  if (error instanceof ImportUploadError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (error instanceof Error && error.name === 'ImportUploadCancelledError') {
    return reply.code(409).send({ error: 'Upload cancelado.' });
  }
  throw error;
}

function createDefaultUploadManager(queue: ImportJobQueue) {
  const maxMegabytes = parseImportUploadMaxMegabytes(process.env.HOME_MUSIC_IMPORT_UPLOAD_MAX_MB);
  return new ImportUploadManager({
    queue,
    staging: new ImportStagingManager({
      stagingRoot: process.env.HOME_MUSIC_IMPORT_STAGING_DIR || defaultImportStagingPath,
      musicDir: process.env.MUSIC_DIR || ''
    }),
    maxBytes: maxMegabytes * 1024 * 1024
  });
}

export function registerAdminImportRoutes(
  app: FastifyInstance,
  queue: ImportJobQueue,
  options: RegisterAdminImportRoutesOptions = {}
) {
  const uploads = options.uploads ?? createDefaultUploadManager(queue);

  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
      done(null, payload);
    });
  }

  app.get('/api/admin/imports', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const response: AdminImportJobsResponse & { upload: ReturnType<typeof getUploadConfig> } = {
      jobs: queue.list(),
      upload: getUploadConfig(uploads)
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
        return sendUploadError(reply, error);
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
        return sendUploadError(reply, error);
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
        return sendUploadError(reply, error);
      }
    }
  );
}

function getUploadConfig(uploads: ImportUploadManager) {
  return uploads.config;
}
