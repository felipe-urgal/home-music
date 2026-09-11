import type { FastifyInstance } from 'fastify';
import type {
  LocalLyricsEligibleTracksResponse,
  LocalLyricsJobResponse,
  LocalLyricsStartJobRequest
} from '@home-music/shared/library-assistant';
import type { LocalLyricsWhisperService } from './local-lyrics-whisper.js';

const JOB_ID = /^localjob:[A-Za-z0-9-]{1,64}$/;

function parseLimit(value: unknown) {
  if (value == null || value === '') return 50;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

function statusCode(error: unknown) {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const value = Number(error.statusCode);
    if (Number.isInteger(value) && value >= 400 && value <= 599) return value;
  }
  return error instanceof TypeError || error instanceof RangeError ? 400 : 500;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 320) : 'Falha no processamento local de lyrics.';
}

export function registerLocalLyricsRoutes(app: FastifyInstance, service: LocalLyricsWhisperService) {
  app.get('/api/admin/library-assistant/local-lyrics/capability', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return service.capability();
  });

  app.get<{ Querystring: { query?: string; limit?: string } }>(
    '/api/admin/library-assistant/local-lyrics/tracks',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const limit = parseLimit(request.query.limit);
      if (limit == null) return reply.code(400).send({ error: 'Limite inválido.' });
      const query = typeof request.query.query === 'string' ? request.query.query.trim().slice(0, 120) : '';
      const response: LocalLyricsEligibleTracksResponse = await service.eligibleTracks(query, limit);
      return response;
    }
  );

  app.post<{ Body: Partial<LocalLyricsStartJobRequest> }>(
    '/api/admin/library-assistant/local-lyrics/jobs',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      try {
        const job = await service.startJob({
          trackId: request.body?.trackId as string,
          mode: request.body?.mode as LocalLyricsStartJobRequest['mode'],
          languageHint: request.body?.languageHint
        }, request.user?.id);
        const response: LocalLyricsJobResponse = { job };
        return reply.code(202).send(response);
      } catch (error) {
        return reply.code(statusCode(error)).send({ error: errorMessage(error) });
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/library-assistant/local-lyrics/jobs/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (!JOB_ID.test(request.params.id)) return reply.code(400).send({ error: 'Job inválido.' });
      const job = service.getJob(request.params.id);
      if (!job) return reply.code(404).send({ error: 'Job não encontrado.' });
      const response: LocalLyricsJobResponse = { job };
      return response;
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/library-assistant/local-lyrics/jobs/:id/cancel',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (!JOB_ID.test(request.params.id)) return reply.code(400).send({ error: 'Job inválido.' });
      const job = service.cancelJob(request.params.id);
      if (!job) return reply.code(404).send({ error: 'Job não encontrado.' });
      const response: LocalLyricsJobResponse = { job };
      return response;
    }
  );
}
