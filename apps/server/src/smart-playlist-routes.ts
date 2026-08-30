import { fileURLToPath } from 'node:url';
import type { SmartPlaylistRule } from '@home-music/shared';
import type { FastifyInstance } from 'fastify';
import { normalizeSmartPlaylistRule, SmartPlaylistStore } from './smart-playlists.js';

type SmartPlaylistBody = {
  name?: unknown;
  rule?: unknown;
};

type SmartPlaylistRouteOptions = {
  databasePath?: string;
};

const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));

function cleanName(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 120 ? normalized : null;
}

function cleanRule(value: unknown): SmartPlaylistRule | null {
  return normalizeSmartPlaylistRule(value);
}

export function registerSmartPlaylistRoutes(
  app: FastifyInstance,
  options: SmartPlaylistRouteOptions = {}
) {
  const databasePath = options.databasePath
    || process.env.HOME_MUSIC_DATABASE_PATH
    || defaultDatabasePath;
  let store: SmartPlaylistStore | null = null;
  const getStore = () => {
    store ??= new SmartPlaylistStore(databasePath);
    return store;
  };

  app.addHook('onClose', async () => {
    store?.close();
  });

  app.get('/api/smart-playlists', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Playlists inteligentes exigem uma identidade persistida.' });
    }

    reply.header('Cache-Control', 'private, no-store');
    return { playlists: getStore().list(request.user.id) };
  });

  app.post<{ Body: SmartPlaylistBody }>('/api/smart-playlists/preview', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Playlists inteligentes exigem uma identidade persistida.' });
    }

    const rule = cleanRule(request.body?.rule);
    if (!rule) return reply.code(400).send({ error: 'Regra da playlist inteligente inválida.' });

    reply.header('Cache-Control', 'private, no-store');
    return { trackIds: getStore().evaluate(request.user.id, rule) };
  });

  app.post<{ Body: SmartPlaylistBody }>('/api/smart-playlists', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Playlists inteligentes exigem uma identidade persistida.' });
    }

    const name = cleanName(request.body?.name);
    const rule = cleanRule(request.body?.rule);
    if (!name) return reply.code(400).send({ error: 'Nome da playlist inteligente obrigatório.' });
    if (!rule) return reply.code(400).send({ error: 'Regra da playlist inteligente inválida.' });

    const id = getStore().create(request.user.id, name, rule);
    const playlist = getStore().get(request.user.id, id);
    return reply.code(201).send({ playlist });
  });

  app.patch<{ Params: { id: string }; Body: SmartPlaylistBody }>(
    '/api/smart-playlists/:id',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(409).send({ error: 'Playlists inteligentes exigem uma identidade persistida.' });
      }

      const patch: { name?: string; rule?: SmartPlaylistRule } = {};
      if (request.body?.name !== undefined) {
        const name = cleanName(request.body.name);
        if (!name) return reply.code(400).send({ error: 'Nome da playlist inteligente inválido.' });
        patch.name = name;
      }
      if (request.body?.rule !== undefined) {
        const rule = cleanRule(request.body.rule);
        if (!rule) return reply.code(400).send({ error: 'Regra da playlist inteligente inválida.' });
        patch.rule = rule;
      }
      if (!patch.name && !patch.rule) {
        return reply.code(400).send({ error: 'Nenhuma alteração informada.' });
      }

      if (!getStore().update(request.user.id, request.params.id, patch)) {
        return reply.code(404).send({ error: 'Playlist inteligente não encontrada.' });
      }

      return { playlist: getStore().get(request.user.id, request.params.id) };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/smart-playlists/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Playlists inteligentes exigem uma identidade persistida.' });
    }

    if (!getStore().delete(request.user.id, request.params.id)) {
      return reply.code(404).send({ error: 'Playlist inteligente não encontrada.' });
    }
    return reply.code(204).send();
  });
}
