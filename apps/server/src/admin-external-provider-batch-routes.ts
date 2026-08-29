import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ExternalProviderBatchError,
  type ExternalProviderBatchManager
} from './external-provider-batch.js';
import { ExternalProviderError } from './external-provider.js';
import { ImportSafeDestinationError } from './import-safe-destination.js';

type BatchRouteOptions = {
  batches: ExternalProviderBatchManager;
};

function sendBatchError(reply: FastifyReply, error: unknown) {
  if (
    error instanceof ExternalProviderBatchError
    || error instanceof ExternalProviderError
    || error instanceof ImportSafeDestinationError
  ) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  throw error;
}

export function registerAdminExternalProviderBatchRoutes(
  app: FastifyInstance,
  options: BatchRouteOptions
) {
  const { batches } = options;

  app.post<{ Params: { providerId: string }; Body: { url?: unknown } }>(
    '/api/admin/imports/providers/:providerId/batches/inspect',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const batch = await batches.inspect(request.params.providerId, {
          url: typeof request.body?.url === 'string' ? request.body.url : ''
        });
        return { batch, limits: batches.getLimits() };
      } catch (error) {
        return sendBatchError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/imports/provider-batches/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      try {
        return { batch: batches.get(request.params.id) };
      } catch (error) {
        return sendBatchError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { folderPath?: unknown } }>(
    '/api/admin/imports/provider-batches/:id/start',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return reply.code(202).send({ batch: batches.start(request.params.id, request.body?.folderPath) });
      } catch (error) {
        return sendBatchError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/imports/provider-batches/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return { batch: await batches.cancel(request.params.id) };
      } catch (error) {
        return sendBatchError(reply, error);
      }
    }
  );

  app.addHook('onClose', async () => {
    batches.stop();
  });
}
