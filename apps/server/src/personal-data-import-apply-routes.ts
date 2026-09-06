import type { FastifyError, FastifyInstance } from 'fastify';
import { PERSONAL_DATA_IMPORT_LIMITS } from '@home-music/shared/personal-data';
import type { PersonalDataImportApplyStore } from './personal-data-import-apply-store.js';
import { personalDataImportConfirmationToken } from './personal-data-import-confirmation.js';
import type { PersonalDataImportPlanner } from './personal-data-import-plan.js';
import {
  assertPersonalDataImportSize,
  PersonalDataImportValidationError
} from './personal-data-import-parser.js';

type ImportPlanner = Pick<PersonalDataImportPlanner, 'plan'>;
type ImportApplier = Pick<PersonalDataImportApplyStore, 'apply'>;

type ApplyBody = {
  bundle?: unknown;
  confirmationToken?: unknown;
  confirmed?: unknown;
};

const APPLY_BODY_OVERHEAD_BYTES = 64 * 1024;

export function registerPersonalDataImportApplyRoutes(
  app: FastifyInstance,
  planner: ImportPlanner,
  applier: ImportApplier
) {
  app.post<{ Body: ApplyBody }>(
    '/api/account/personal-data/import/apply',
    {
      bodyLimit: PERSONAL_DATA_IMPORT_LIMITS.maxBytes + APPLY_BODY_OVERHEAD_BYTES,
      errorHandler(error: FastifyError, _request, reply) {
        if (error.statusCode === 413 || error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
          return reply.code(413).send({
            error: 'Bundle de dados pessoais excede o limite permitido.',
            code: 'payload-too-large',
            field: '$.bundle'
          });
        }
        if (error.statusCode === 400) {
          return reply.code(400).send({
            error: 'JSON de dados pessoais inválido.',
            code: 'invalid-json',
            field: '$'
          });
        }
        return reply.code(500).send({ error: 'Falha ao aplicar dados pessoais.' });
      }
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(409).send({
          error: 'Importação de dados pessoais exige uma identidade persistida.'
        });
      }
      if (request.body?.confirmed !== true) {
        return reply.code(409).send({
          error: 'Confirme explicitamente o preview antes de aplicar os dados pessoais.',
          code: 'confirmation-required'
        });
      }
      if (
        typeof request.body?.confirmationToken !== 'string'
        || !/^[a-f0-9]{64}$/.test(request.body.confirmationToken)
      ) {
        return reply.code(400).send({
          error: 'Token de confirmação do preview inválido.',
          code: 'invalid-confirmation-token'
        });
      }

      try {
        const serializedBundle = JSON.stringify(request.body.bundle);
        if (typeof serializedBundle === 'string') {
          assertPersonalDataImportSize(Buffer.byteLength(serializedBundle));
        }
        const plan = planner.plan(request.body.bundle);
        const expectedToken = personalDataImportConfirmationToken(request.user.id, plan);
        if (request.body.confirmationToken !== expectedToken) {
          return reply.code(409).send({
            error: 'O bundle ou a biblioteca mudou depois do preview. Gere um novo preview antes de aplicar.',
            code: 'preview-changed'
          });
        }

        const summary = applier.apply(request.user.id, plan);
        reply.header('Cache-Control', 'private, no-store');
        return {
          preview: plan.preview,
          summary
        };
      } catch (error) {
        if (error instanceof PersonalDataImportValidationError) {
          const statusCode = error.code === 'payload-too-large' ? 413 : 400;
          return reply.code(statusCode).send({
            error: 'Bundle de dados pessoais inválido.',
            code: error.code,
            field: error.field === '$' ? '$.bundle' : `$.bundle${error.field.slice(1)}`
          });
        }
        throw error;
      }
    }
  );
}
