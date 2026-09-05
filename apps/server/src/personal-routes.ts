import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { PlaybackState } from '@home-music/shared';
import { registerLibraryViewRoutes } from './library-view-routes.js';
import { registerPlaybackHistoryRoutes } from './playback-history-routes.js';
import { PersonalDataExportService } from './personal-data-export.js';
import { registerPersonalDataExportRoutes } from './personal-data-export-routes.js';
import type { PersonalLibraryService } from './personal-library-service.js';
import { registerSmartPlaylistRoutes } from './smart-playlist-routes.js';

const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));

export function registerPersonalRoutes(
  app: FastifyInstance,
  personal: PersonalLibraryService
) {
  const databasePath = process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath;
  const personalDataExporter = new PersonalDataExportService(personal, databasePath);

  registerLibraryViewRoutes(app, { databasePath });
  registerSmartPlaylistRoutes(app, { databasePath });
  registerPlaybackHistoryRoutes(app);
  registerPersonalDataExportRoutes(app, personalDataExporter);

  app.addHook('onClose', async () => {
    personalDataExporter.close();
  });

  app.get('/api/favorites', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Favoritos pessoais exigem uma identidade persistida.'
      });
    }

    return { trackIds: personal.getFavoriteIds(request.user.id) };
  });

  app.put<{ Params: { id: string }; Body: { favorite?: boolean } }>(
    '/api/favorites/:id',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(409).send({
          error: 'Favoritos pessoais exigem uma identidade persistida.'
        });
      }

      const result = personal.setFavorite(
        request.user.id,
        request.params.id,
        request.body?.favorite
      );
      if (result.status === 'not-found') {
        return reply.code(404).send({ error: 'Música não encontrada.' });
      }
      if (result.status === 'invalid-favorite') {
        return reply.code(400).send({ error: 'Valor de favorito inválido.' });
      }
      return { favorite: result.favorite };
    }
  );

  app.get('/api/playlists', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Playlists pessoais exigem uma identidade persistida.'
      });
    }

    return { playlists: personal.getPlaylists(request.user.id) };
  });

  app.post<{ Body: { name?: string } }>('/api/playlists', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Playlists pessoais exigem uma identidade persistida.'
      });
    }

    const result = personal.createPlaylist(request.user.id, request.body?.name);
    if (result.status === 'invalid-name') {
      return reply.code(400).send({ error: 'Nome da playlist obrigatório.' });
    }
    return reply.code(201).send({ playlist: result.playlist });
  });

  app.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/playlists/:id',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(409).send({
          error: 'Playlists pessoais exigem uma identidade persistida.'
        });
      }

      const result = personal.renamePlaylist(
        request.user.id,
        request.params.id,
        request.body?.name
      );
      if (result.status === 'not-found') {
        return reply.code(404).send({ error: 'Playlist não encontrada.' });
      }
      if (result.status === 'read-only') {
        return reply.code(409).send({ error: 'Playlist importada é somente leitura.' });
      }
      if (result.status === 'invalid-name') {
        return reply.code(400).send({ error: 'Nome da playlist obrigatório.' });
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

    const result = personal.deletePlaylist(request.user.id, request.params.id);
    if (result.status === 'not-found') {
      return reply.code(404).send({ error: 'Playlist não encontrada.' });
    }
    if (result.status === 'read-only') {
      return reply.code(409).send({ error: 'Playlist importada é somente leitura.' });
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

      const result = personal.setPlaylistTracks(
        request.user.id,
        request.params.id,
        request.body?.trackIds
      );
      if (result.status === 'not-found') {
        return reply.code(404).send({ error: 'Playlist não encontrada.' });
      }
      if (result.status === 'read-only') {
        return reply.code(409).send({ error: 'Playlist importada é somente leitura.' });
      }
      if (result.status === 'invalid-tracks') {
        return reply.code(400).send({ error: 'Lista de músicas inválida.' });
      }
      return { trackIds: result.trackIds };
    }
  );

  app.get('/api/player/state', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Estado do player exige uma identidade persistida.'
      });
    }

    reply.header('Cache-Control', 'private, no-store');
    return personal.loadPlaybackState(request.user.id);
  });

  app.put<{ Body: Partial<PlaybackState> }>('/api/player/state', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Estado do player exige uma identidade persistida.'
      });
    }

    const state = personal.savePlaybackState(request.user.id, request.body ?? {});
    if (!state) {
      return reply.code(400).send({ error: 'Estado do player inválido.' });
    }

    reply.header('Cache-Control', 'private, no-store');
    return state;
  });
}
