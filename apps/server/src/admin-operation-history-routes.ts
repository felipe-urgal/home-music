import type { FastifyInstance } from 'fastify';
import type {
  AdminOperationHistoryResponse,
  AdminOperationKind,
  AdminOperationStatus
} from '@home-music/shared';
import type { AdminOperationHistoryStore } from './admin-operation-history.js';

const KINDS = new Set<AdminOperationKind>(['scan', 'import']);
const STATUSES = new Set<AdminOperationStatus>(['pending', 'running', 'completed', 'failed', 'cancelled']);

function parseKind(value: unknown): AdminOperationKind | undefined {
  if (value == null || value === '') return undefined;
  return typeof value === 'string' && KINDS.has(value as AdminOperationKind)
    ? value as AdminOperationKind
    : undefined;
}

function parseStatus(value: unknown): AdminOperationStatus | undefined {
  if (value == null || value === '') return undefined;
  return typeof value === 'string' && STATUSES.has(value as AdminOperationStatus)
    ? value as AdminOperationStatus
    : undefined;
}

function parseLimit(value: unknown) {
  if (value == null || value === '') return 200;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) return null;
  return parsed;
}

export function registerAdminOperationHistoryRoutes(
  app: FastifyInstance,
  history: AdminOperationHistoryStore
) {
  app.get<{ Querystring: { kind?: string; status?: string; limit?: string } }>(
    '/api/admin/operations',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const kind = parseKind(request.query.kind);
      const status = parseStatus(request.query.status);
      const limit = parseLimit(request.query.limit);

      if (request.query.kind && !kind) {
        return reply.code(400).send({ error: 'Tipo de operação inválido.' });
      }
      if (request.query.status && !status) {
        return reply.code(400).send({ error: 'Status de operação inválido.' });
      }
      if (limit == null) {
        return reply.code(400).send({ error: 'Limite de histórico inválido.' });
      }

      const response: AdminOperationHistoryResponse = {
        items: history.list({ kind, status, limit })
      };
      return response;
    }
  );
}
