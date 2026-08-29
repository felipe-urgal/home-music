import type { FastifyInstance } from 'fastify';
import type {
  AdminOperationHistoryResponse,
  AdminOperationKind,
  AdminOperationStatus
} from '@home-music/shared';
import {
  AdminOperationHistoryStore,
  AdminOperationRetryError
} from './admin-operation-history.js';
import {
  getImportRetryStarter,
  ImportRetryStartError,
  type ImportRetryInput
} from './import-retry.js';

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

  app.post<{ Params: { id: string }; Body: ImportRetryInput }>(
    '/api/admin/operations/:id/retry',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      let context;
      try {
        context = history.prepareImportRetry(request.params.id);
      } catch (error) {
        if (error instanceof AdminOperationRetryError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        throw error;
      }

      const starter = getImportRetryStarter(app);
      if (!starter) {
        history.releaseImportRetry(context);
        return reply.code(503).send({ error: 'Retry de importação indisponível neste processo.' });
      }

      let result;
      try {
        result = await starter(context, request.body ?? {});
      } catch (error) {
        if (error instanceof ImportRetryStartError) {
          if (error.job) {
            try {
              history.bindRetryAttempt(error.job.id, context);
            } catch (bindError) {
              app.log.warn(
                { err: bindError, importJobId: error.job.id },
                'Falha ao vincular tentativa de retry que não iniciou corretamente.'
              );
            }
          } else {
            history.releaseImportRetry(context);
          }
          return reply.code(error.statusCode).send({ error: error.message });
        }
        history.releaseImportRetry(context);
        if (error instanceof AdminOperationRetryError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        throw error;
      }

      try {
        history.bindRetryAttempt(result.job.id, context);
      } catch (error) {
        if (error instanceof AdminOperationRetryError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        throw error;
      }
      return reply.code(context.source.type === 'url' ? 202 : 201).send(result);
    }
  );
}
