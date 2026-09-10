import type { FastifyInstance } from 'fastify';
import {
  LibraryAssistantFingerprintOperationError,
  type LibraryAssistantFingerprintService
} from './library-assistant-fingerprint-service.js';

const ID = /^[A-Za-z0-9._:-]{1,192}$/;

function validId(value: string) {
  return ID.test(value);
}

export function registerLibraryAssistantFingerprintRoutes(
  app: FastifyInstance,
  fingerprints: LibraryAssistantFingerprintService
) {
  app.get('/api/admin/library-assistant/fingerprint', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return fingerprints.status();
  });

  app.post<{ Params: { runId: string; suggestionId: string } }>(
    '/api/admin/library-assistant/runs/:runId/suggestions/:suggestionId/fingerprint',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (!validId(request.params.runId) || !validId(request.params.suggestionId)) {
        return reply.code(400).send({ error: 'Sugestão do assistente inválida.' });
      }
      try {
        const result = await fingerprints.identify(request.params.runId, request.params.suggestionId);
        if (!result) return reply.code(404).send({ error: 'Sugestão do assistente não encontrada.' });
        return result;
      } catch (error) {
        if (error instanceof LibraryAssistantFingerprintOperationError) {
          return reply.code(error.statusCode).send({ error: error.message, code: error.code });
        }
        if (error instanceof RangeError || error instanceof TypeError) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    }
  );
}
