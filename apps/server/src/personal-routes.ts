import type { FastifyInstance } from 'fastify';
import type { PlaybackState, RepeatMode } from '@home-music/shared';
import type { HomeMusicDatabase } from './database.js';
import type { LibraryService } from './library-service.js';

export function registerPersonalRoutes(
  app: FastifyInstance,
  database: HomeMusicDatabase,
  library: LibraryService
) {
  app.get('/api/favorites', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Favoritos pessoais exigem uma identidade persistida.'
      });
    }

    return { trackIds: database.getFavoriteIds(request.user.id) };
  });

  app.put<{ Params: { id: string }; Body: { favorite?: boolean } }>(
    '/api/favorites/:id',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(409).send({
          error: 'Favoritos pessoais exigem uma identidade persistida.'
        });
      }
      if (!library.getTrack(request.params.id)) {
        return reply.code(404).send({ error: 'Música não encontrada.' });
      }
      if (typeof request.body?.favorite !== 'boolean') {
        return reply.code(400).send({ error: 'Valor de favorito inválido.' });
      }

      database.setFavorite(request.user.id, request.params.id, request.body.favorite);
      return { favorite: request.body.favorite };
    }
  );

  app.get('/api/playlists', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Playlists pessoais exigem uma identidade persistida.'
      });
    }

    return { playlists: database.getPlaylists(request.user.id) };
  });

  app.post<{ Body: { name?: string } }>('/api/playlists', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Playlists pessoais exigem uma identidade persistida.'
      });
    }

    const name = cleanName(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'Nome da playlist obrigatório.' });

    const id = database.createPlaylist(request.user.id, name);
    const playlist = database.getPlaylists(request.user.id).find(item => item.id === id);
    return reply.code(201).send({ playlist });
  });

  app.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/playlists/:id',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(409).send({
          error: 'Playlists pessoais exigem uma identidade persistida.'
        });
      }

      const source = database.getPlaylistSource(request.user.id, request.params.id);
      if (!source) return reply.code(404).send({ error: 'Playlist não encontrada.' });
      if (source !== 'manual') {
        return reply.code(409).send({ error: 'Playlist importada é somente leitura.' });
      }

      const name = cleanName(request.body?.name);
      if (!name) return reply.code(400).send({ error: 'Nome da playlist obrigatório.' });
      if (!database.renamePlaylist(request.user.id, request.params.id, name)) {
        return reply.code(404).send({ error: 'Playlist não encontrada.' });
      }
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/playlists/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Playlists pessoais exigem uma identidade persistida.'
      });
    }

    const source = database.getPlaylistSource(request.user.id, request.params.id);
    if (!source) return reply.code(404).send({ error: 'Playlist não encontrada.' });
    if (source !== 'manual') {
      return reply.code(409).send({ error: 'Playlist importada é somente leitura.' });
    }

    if (!database.deletePlaylist(request.user.id, request.params.id)) {
      return reply.code(404).send({ error: 'Playlist não encontrada.' });
    }
    return reply.code(204).send();
  });

  app.put<{ Params: { id: string }; Body: { trackIds?: unknown } }>(
    '/api/playlists/:id/tracks',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(409).send({
          error: 'Playlists pessoais exigem uma identidade persistida.'
        });
      }

      const source = database.getPlaylistSource(request.user.id, request.params.id);
      if (!source) return reply.code(404).send({ error: 'Playlist não encontrada.' });
      if (source !== 'manual') {
        return reply.code(409).send({ error: 'Playlist importada é somente leitura.' });
      }
      if (!Array.isArray(request.body?.trackIds)) {
        return reply.code(400).send({ error: 'Lista de músicas inválida.' });
      }
      const trackIds = library.cleanTrackIds(request.body.trackIds);

      if (!database.setPlaylistTracks(request.user.id, request.params.id, trackIds)) {
        return reply.code(404).send({ error: 'Playlist não encontrada.' });
      }

      return { trackIds };
    }
  );

  app.get('/api/player/state', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Estado do player exige uma identidade persistida.'
      });
    }

    reply.header('Cache-Control', 'private, no-store');
    return database.loadPlaybackState(request.user.id);
  });

  app.put<{ Body: Partial<PlaybackState> }>('/api/player/state', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Estado do player exige uma identidade persistida.'
      });
    }

    const body = request.body ?? {};
    const currentTrackId = typeof body.currentTrackId === 'string'
      && library.getTrack(body.currentTrackId)
      ? body.currentTrackId
      : null;
    const position = Number(body.position);
    const volume = Number(body.volume);
    const baseQueueIds = library.cleanTrackIds(body.baseQueueIds);
    const queueIds = library.cleanTrackIds(body.queueIds);

    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(volume)) {
      return reply.code(400).send({ error: 'Estado do player inválido.' });
    }

    if (currentTrackId && !queueIds.includes(currentTrackId)) queueIds.unshift(currentTrackId);
    if (currentTrackId && !baseQueueIds.includes(currentTrackId)) baseQueueIds.unshift(currentTrackId);

    const state = database.savePlaybackState(request.user.id, {
      currentTrackId,
      position,
      volume: Math.max(0, Math.min(1, volume)),
      shuffle: Boolean(body.shuffle),
      repeatMode: cleanRepeatMode(body.repeatMode),
      wasPlaying: Boolean(body.wasPlaying),
      baseQueueIds,
      queueIds
    });

    reply.header('Cache-Control', 'private, no-store');
    return state;
  });
}

function cleanName(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function cleanRepeatMode(value: unknown): RepeatMode {
  return value === 'one' || value === 'all' ? value : 'off';
}
