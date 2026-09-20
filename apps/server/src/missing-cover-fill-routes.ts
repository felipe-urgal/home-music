import type { FastifyInstance } from 'fastify';
import type { AdminMissingCoverFillResponse } from '@home-music/shared/library-assistant';
import type { MissingCoverFillService } from './missing-cover-fill-service.js';

export function registerMissingCoverFillRoutes(
  app: FastifyInstance,
  service: MissingCoverFillService
) {
  app.get('/api/admin/library-assistant/covers/fill', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const response: AdminMissingCoverFillResponse = { job: service.getJob() };
    return response;
  });

  app.post('/api/admin/library-assistant/covers/fill', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const response: AdminMissingCoverFillResponse = { job: service.start() };
    return response;
  });
}
