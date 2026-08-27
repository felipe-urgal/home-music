import type { FastifyInstance } from 'fastify';
import type { AdminTrack, AdminTracksResponse } from '@home-music/shared';

type AdminTrackService = {
  listTracks: () => AdminTrack[];
  setEnabled: (trackId: string, enabled: boolean) => AdminTrack | null;
};

export function registerAdminTrackRoutes(app: FastifyInstance, service: AdminTrackService) {
  app.get('/api/admin/tracks', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const tracks = service.listTracks();
    const response: AdminTracksResponse = {
      tracks,
      active: tracks.filter(track => track.enabled).length,
      inactive: tracks.filter(track => !track.enabled).length
    };
    return response;
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: unknown } }>(
    '/api/admin/tracks/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (typeof request.body?.enabled !== 'boolean') {
        return reply.code(400).send({ error: 'Estado da música inválido.' });
      }

      const track = service.setEnabled(request.params.id, request.body.enabled);
      if (!track) return reply.code(404).send({ error: 'Música não encontrada.' });
      return { track };
    }
  );
}
