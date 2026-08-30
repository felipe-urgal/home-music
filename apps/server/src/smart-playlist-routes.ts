import type { SmartPlaylistRule } from '@home-music/shared';
import type { FastifyInstance } from 'fastify';
import { normalizeSmartPlaylistRule, SmartPlaylistStore } from './smart-playlists.js';

type SmartPlaylistBody = {
  name?: unknown;
  rule?: unknown;
};

type SmartPlaylistRouteOptions = {
  eligibleTrackIds: () => ReadonlySet<string>;
};

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
  store: SmartPlaylistStore,
  options: SmartPlaylistRouteOptions
) {
  app.post<{ Body: SmartPlaylistBody }>('/api/smart-playlists/preview', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Playlists inteligentes exigem uma identidade persistida.' });
    }

    const rule = cleanRule(request.body?.rule);
    if (!rule) return reply.code(400).send({ error: 'Regra da playlist inteligente inválida.' });

    reply.header('Cache-Control', 'private, no-store');
    return {
      trackIds: store.evaluate(request.user.id, rule, options.eligibleTrackIds())
    };
  });

  app.post<{ Body: SmartPlaylistBody }>('/api/smart-playlists', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Playlists inteligentes exigem uma identidade persistida.' });
    }

    const name = cleanName(request.body?.name);
    const rule = cleanRule(request.body?.rule);
    if (!name) return reply.code(400).send({ error: 'Nome da playlist inteligente obrigatório.' });
    if (!rule) return reply.code(400).send({ error: 'Regra da playlist inteligente inválida.' });

    const id = store.create(request.user.id, name, rule);
    const playlist = store.get(request.user.id, id, options.eligibleTrackIds());
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

      if (!store.update(request.user.id, request.params.id, patch)) {
        return reply.code(404).send({ error: 'Playlist inteligente não encontrada.' });
      }

      const playlist = store.get(request.user.id, request.params.id, options.eligibleTrackIds());
      return { playlist };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/smart-playlists/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Playlists inteligentes exigem uma identidade persistida.' });
    }

    if (!store.delete(request.user.id, request.params.id)) {
      return reply.code(404).send({ error: 'Playlist inteligente não encontrada.' });
    }
    return reply.code(204).send();
  });
}
