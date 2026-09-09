import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  AdminLibraryAssistantPolicyResponse,
  AdminLibraryAssistantPolicyUpdateRequest,
  LibraryAssistantReviewPolicy
} from '@home-music/shared/library-assistant';

type LibraryAssistantReviewPolicyPort = {
  get: () => LibraryAssistantReviewPolicy;
  set: (policy: unknown) => LibraryAssistantReviewPolicy;
};

function objectBody(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sendValidationError(reply: FastifyReply, error: unknown) {
  if (error instanceof TypeError || error instanceof RangeError) {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
}

export function registerLibraryAssistantPolicyRoutes(
  app: FastifyInstance,
  policy: LibraryAssistantReviewPolicyPort
) {
  app.get(
    '/api/admin/library-assistant/policy',
    async (_request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const response: AdminLibraryAssistantPolicyResponse = { policy: policy.get() };
      return response;
    }
  );

  app.put<{ Body: unknown }>(
    '/api/admin/library-assistant/policy',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const body = objectBody(request.body);
      if (!body || !('policy' in body)) {
        return reply.code(400).send({ error: 'Política de revisão inválida.' });
      }
      try {
        const input = body as unknown as AdminLibraryAssistantPolicyUpdateRequest;
        const response: AdminLibraryAssistantPolicyResponse = { policy: policy.set(input.policy) };
        return response;
      } catch (error) {
        return sendValidationError(reply, error);
      }
    }
  );
}
