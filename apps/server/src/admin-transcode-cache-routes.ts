import type { FastifyInstance } from 'fastify';
import {
  TranscodeCacheBusyError,
  type TranscodeCacheMaintenance
} from './transcode-cache-maintenance.js';

export function registerAdminTranscodeCacheRoutes(
  app: FastifyInstance,
  maintenance: TranscodeCacheMaintenance
) {
  app.get('/api/admin/transcoding/cache', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return maintenance.status();
  });

  app.delete('/api/admin/transcoding/cache', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    try {
      return await maintenance.clear();
    } catch (error) {
      if (error instanceof TranscodeCacheBusyError) {
        return reply.code(error.statusCode).send({
          error: error.message,
          cache: error.cache
        });
      }
      throw error;
    }
  });
}
