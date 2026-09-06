import type { FastifyError, FastifyInstance } from 'fastify';
import { PERSONAL_DATA_IMPORT_LIMITS } from '@home-music/shared/personal-data';
import { personalDataImportConfirmationToken } from './personal-data-import-confirmation.js';
import type { PersonalDataImportPlanner } from './personal-data-import-plan.js';
import { PersonalDataImportValidationError } from './personal-data-import-parser.js';

type ImportPlanner = Pick<PersonalDataImportPlanner, 'plan'>;

export function registerPersonalDataImportPreviewRoutes(
  app: FastifyInstance,
  planner: ImportPlanner
) {
  app.post<{ Body: unknown }>(
    '/api/account/personal-data/import/preview',
    {
      bodyLimit: PERSONAL_DATA_IMPORT_LIMITS.maxBytes,
      errorHandler(error: FastifyError, _request, reply) {
        if (error.statusCode === 413 || error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
          return reply.code(413).send({
            error: 'Bundle de dados pessoais excede o limite permitido.',
            code: 'payload-too-large',
            field: '$'
          });
        }
        if (error.statusCode === 400) {
          return reply.code(400).send({
            error: 'JSON de dados pessoais inválido.',
            code: 'invalid-json',
            field: '$'
          });
        }
        return reply.code(500).send({ error: 'Falha ao processar preview de dados pessoais.' });
      }
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(409).send({
          error: 'Importação de dados pessoais exige uma identidade persistida.'
        });
      }

      try {
        const plan = planner.plan(request.body);
        reply.header('Cache-Control', 'private, no-store');
        return {
          ...plan.preview,
          confirmationToken: personalDataImportConfirmationToken(request.user.id, plan)
        };
      } catch (error) {
        if (error instanceof PersonalDataImportValidationError) {
          const statusCode = error.code === 'payload-too-large' ? 413 : 400;
          return reply.code(statusCode).send({
            error: 'Bundle de dados pessoais inválido.',
            code: error.code,
            field: error.field
          });
        }
        throw error;
      }
    }
  );
}
