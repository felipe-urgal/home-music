import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AdminLibraryNormalizationAssociateRequest } from '@home-music/shared';
import { LibraryMetadataNormalizationStore } from './library-metadata-normalization.js';

type RegisterOptions = {
  onChanged?: () => void;
};

function sendValidationError(reply: FastifyReply, error: unknown) {
  if (error instanceof TypeError || error instanceof RangeError) {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
}

export function registerAdminLibraryNormalizationRoutes(
  app: FastifyInstance,
  store: LibraryMetadataNormalizationStore,
  options: RegisterOptions = {}
) {
  app.get('/api/admin/library/normalization', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return store.review();
  });

  app.post<{ Body: AdminLibraryNormalizationAssociateRequest }>(
    '/api/admin/library/normalization/aliases',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      try {
        store.associate(request.body);
        options.onChanged?.();
        return reply.code(201).send(store.review());
      } catch (error) {
        return sendValidationError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/library/normalization/aliases/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      try {
        if (!store.remove(request.params.id)) {
          return reply.code(404).send({ error: 'Associação não encontrada.' });
        }
        options.onChanged?.();
        return reply.code(204).send();
      } catch (error) {
        return sendValidationError(reply, error);
      }
    }
  );
}
