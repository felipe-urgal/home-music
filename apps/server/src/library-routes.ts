import type { FastifyInstance } from 'fastify';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import type { LibraryService } from './library-service.js';

export function registerLibraryRoutes(
  app: FastifyInstance,
  library: LibraryService,
  integrityQueue?: HeavyWorkQueue
) {
  app.get('/api/library', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return {
      tracks: library.listPublicTracks(),
      ...library.status()
    };
  });

  app.get('/api/library/status', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return library.status();
  });

  app.post('/api/library/scan', async (_request, reply) => {
    const result = await library.rescan('manual');
    reply.header('Cache-Control', 'no-store');
    return result;
  });

  app.get('/api/admin/library/overview', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return library.overview();
  });

  app.post('/api/admin/library/integrity/check', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const overview = integrityQueue
      ? await integrityQueue.run(() => library.checkIntegrity())
      : await library.checkIntegrity();
    if (!overview) {
      return reply.code(409).send({
        error: 'Biblioteca não está pronta para verificação de integridade.'
      });
    }
    return overview;
  });
}