import type { FastifyInstance } from 'fastify';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import {
  LibraryHttpSnapshotCache,
  matchesIfNoneMatch,
  selectLibraryContentEncoding
} from './library-http-cache.js';
import type { LibraryService } from './library-service.js';

export function registerLibraryRoutes(
  app: FastifyInstance,
  library: LibraryService,
  integrityQueue?: HeavyWorkQueue
) {
  const libraryHttpCache = new LibraryHttpSnapshotCache(library);

  app.get('/api/library', async (request, reply) => {
    const snapshot = libraryHttpCache.snapshot();
    reply.header('Cache-Control', 'private, no-cache');
    reply.header('ETag', snapshot.etag);
    reply.header('Vary', 'Accept-Encoding');

    if (matchesIfNoneMatch(request.headers['if-none-match'], snapshot.etag)) {
      return reply.code(304).send();
    }

    const encoding = selectLibraryContentEncoding(
      request.headers['accept-encoding'],
      snapshot.body.byteLength
    );
    const body = await libraryHttpCache.bodyFor(snapshot, encoding);
    reply.type('application/json; charset=utf-8');
    if (encoding !== 'identity') reply.header('Content-Encoding', encoding);
    return reply.send(body);
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
