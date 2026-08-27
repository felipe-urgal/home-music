import type { FastifyInstance } from 'fastify';
import type { AdminImportJobsResponse } from '@home-music/shared';
import type { ImportJobQueue } from './import-job-queue.js';

export function registerAdminImportRoutes(app: FastifyInstance, queue: ImportJobQueue) {
  app.get('/api/admin/imports', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const response: AdminImportJobsResponse = { jobs: queue.list() };
    return response;
  });
}
