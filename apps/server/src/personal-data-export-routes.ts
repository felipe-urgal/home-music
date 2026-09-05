import type { FastifyInstance } from 'fastify';
import type { PersonalDataExportService } from './personal-data-export.js';

type PersonalDataExporter = Pick<PersonalDataExportService, 'exportForUser'>;

export function registerPersonalDataExportRoutes(
  app: FastifyInstance,
  exporter: PersonalDataExporter
) {
  app.get('/api/account/personal-data/export', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Exportação de dados pessoais exige uma identidade persistida.'
      });
    }

    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header(
      'Content-Disposition',
      'attachment; filename="home-music-personal-data-v1.json"'
    );
    return exporter.exportForUser(request.user.id);
  });
}
