import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  AdminLibraryAssistantBatchDecisionRequest,
  AdminLibraryAssistantDecisionRequest,
  AdminLibraryAssistantDecisionResponse,
  AdminLibraryAssistantReviewResponse
} from '@home-music/shared';
import type { LibraryAssistantReviewService } from './library-assistant-review-service.js';

const SUGGESTION_ID = /^[A-Za-z0-9._:-]{1,192}$/;

function parseLimit(value: unknown) {
  if (value == null || value === '') return 200;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 500 ? parsed : null;
}

function sendValidationError(reply: FastifyReply, error: unknown) {
  if (error instanceof TypeError || error instanceof RangeError) {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
}

function objectBody(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function registerLibraryAssistantReviewRoutes(
  app: FastifyInstance,
  review: LibraryAssistantReviewService
) {
  app.get<{ Querystring: { limit?: string } }>(
    '/api/admin/library-assistant/review',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const limit = parseLimit(request.query.limit);
      if (limit == null) return reply.code(400).send({ error: 'Limite de revisão inválido.' });
      const response: AdminLibraryAssistantReviewResponse = review.getReviewQueue(limit);
      return response;
    }
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/library-assistant/suggestions/:id/decision',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (!SUGGESTION_ID.test(request.params.id)) {
        return reply.code(400).send({ error: 'Sugestão inválida.' });
      }
      const body = objectBody(request.body);
      if (!body) return reply.code(400).send({ error: 'Decisão inválida.' });
      try {
        const decision = {
          ...body,
          suggestionId: request.params.id
        } as AdminLibraryAssistantDecisionRequest;
        const response: AdminLibraryAssistantDecisionResponse = {
          result: await review.decide(decision)
        };
        return response;
      } catch (error) {
        return sendValidationError(reply, error);
      }
    }
  );

  app.post<{ Body: unknown }>(
    '/api/admin/library-assistant/decisions',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const body = objectBody(request.body);
      if (!body || !Array.isArray(body.decisions)) {
        return reply.code(400).send({ error: 'Lote de decisões inválido.' });
      }
      try {
        return await review.decideBatch(
          (body as unknown as AdminLibraryAssistantBatchDecisionRequest).decisions
        );
      } catch (error) {
        return sendValidationError(reply, error);
      }
    }
  );
}