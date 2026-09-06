import type { FastifyInstance } from 'fastify';
import type {
  AdminLibraryAssistantRunResponse,
  AdminLibraryAssistantRunsResponse,
  AdminLibraryAssistantSuggestionsResponse,
  LibraryAssistantCapability,
  LibraryAssistantSuggestionStatus
} from '@home-music/shared/library-assistant';
import type { LibraryAssistantService } from './library-assistant-service.js';

const CAPABILITIES = new Set<LibraryAssistantCapability>(['metadata', 'artwork', 'lyrics']);
const SUGGESTION_STATUSES = new Set<LibraryAssistantSuggestionStatus>([
  'pending', 'review', 'applied', 'rejected', 'stale', 'failed'
]);
const RUN_ID = /^[A-Za-z0-9._:-]{1,192}$/;

function parseCapability(value: unknown): LibraryAssistantCapability | null {
  return typeof value === 'string' && CAPABILITIES.has(value as LibraryAssistantCapability)
    ? value as LibraryAssistantCapability
    : null;
}

function parseSuggestionStatus(value: unknown): LibraryAssistantSuggestionStatus | undefined | null {
  if (value == null || value === '') return undefined;
  return typeof value === 'string' && SUGGESTION_STATUSES.has(value as LibraryAssistantSuggestionStatus)
    ? value as LibraryAssistantSuggestionStatus
    : null;
}

function parseLimit(value: unknown, fallback: number, maximum: number) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) return null;
  return parsed;
}

function validRunId(value: string) {
  return RUN_ID.test(value);
}

export function registerLibraryAssistantRoutes(
  app: FastifyInstance,
  assistant: LibraryAssistantService
) {
  app.post<{ Body: { capability?: unknown } }>(
    '/api/admin/library-assistant/runs',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const capability = parseCapability(request.body?.capability);
      if (!capability) return reply.code(400).send({ error: 'Capability do assistente inválida.' });

      const response: AdminLibraryAssistantRunResponse = {
        run: assistant.startRun(capability, request.user?.id)
      };
      return reply.code(202).send(response);
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/api/admin/library-assistant/runs',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const limit = parseLimit(request.query.limit, 50, 200);
      if (limit == null) return reply.code(400).send({ error: 'Limite de runs inválido.' });
      const response: AdminLibraryAssistantRunsResponse = { runs: assistant.listRuns(limit) };
      return response;
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/library-assistant/runs/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (!validRunId(request.params.id)) return reply.code(400).send({ error: 'Run inválido.' });
      const run = assistant.getRun(request.params.id);
      if (!run) return reply.code(404).send({ error: 'Run não encontrado.' });
      const response: AdminLibraryAssistantRunResponse = { run };
      return response;
    }
  );

  app.get<{
    Params: { id: string };
    Querystring: { status?: string; limit?: string };
  }>(
    '/api/admin/library-assistant/runs/:id/suggestions',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (!validRunId(request.params.id)) return reply.code(400).send({ error: 'Run inválido.' });
      const status = parseSuggestionStatus(request.query.status);
      if (status === null) return reply.code(400).send({ error: 'Status de sugestão inválido.' });
      const limit = parseLimit(request.query.limit, 200, 500);
      if (limit == null) return reply.code(400).send({ error: 'Limite de sugestões inválido.' });

      const suggestions = assistant.listSuggestions(request.params.id, { status, limit });
      if (!suggestions) return reply.code(404).send({ error: 'Run não encontrado.' });
      const response: AdminLibraryAssistantSuggestionsResponse = { suggestions };
      return response;
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/library-assistant/runs/:id/cancel',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (!validRunId(request.params.id)) return reply.code(400).send({ error: 'Run inválido.' });
      const run = assistant.cancelRun(request.params.id);
      if (!run) return reply.code(404).send({ error: 'Run não encontrado.' });
      const response: AdminLibraryAssistantRunResponse = { run };
      return response;
    }
  );
}
