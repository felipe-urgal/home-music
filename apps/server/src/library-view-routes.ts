import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import {
  LibraryViewStore,
  normalizeLibraryViewDefinition,
  normalizeLibraryViewName,
  type LibraryViewDefinition
} from './library-views.js';

type LibraryViewBody = {
  name?: unknown;
  definition?: unknown;
};

type LibraryViewRouteOptions = {
  databasePath?: string;
};

const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));

export function registerLibraryViewRoutes(
  app: FastifyInstance,
  options: LibraryViewRouteOptions = {}
) {
  const databasePath = options.databasePath
    || process.env.HOME_MUSIC_DATABASE_PATH
    || defaultDatabasePath;
  let store: LibraryViewStore | null = null;
  const getStore = () => {
    store ??= new LibraryViewStore(databasePath);
    return store;
  };

  app.addHook('onClose', async () => {
    store?.close();
  });

  app.get('/api/library-views', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Views inteligentes exigem uma identidade persistida.' });
    }

    reply.header('Cache-Control', 'private, no-store');
    return { views: getStore().list(request.user.id) };
  });

  app.post<{ Body: LibraryViewBody }>('/api/library-views', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Views inteligentes exigem uma identidade persistida.' });
    }

    const name = normalizeLibraryViewName(request.body?.name);
    const definition = normalizeLibraryViewDefinition(request.body?.definition);
    if (!name) return reply.code(400).send({ error: 'Nome da view inteligente obrigatório.' });
    if (!definition) return reply.code(400).send({ error: 'Filtros da view inteligente inválidos.' });

    const id = getStore().create(request.user.id, name, definition);
    return reply.code(201).send({ view: getStore().get(request.user.id, id) });
  });

  app.patch<{ Params: { id: string }; Body: LibraryViewBody }>(
    '/api/library-views/:id',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(409).send({ error: 'Views inteligentes exigem uma identidade persistida.' });
      }

      const patch: { name?: string; definition?: LibraryViewDefinition } = {};
      if (request.body?.name !== undefined) {
        const name = normalizeLibraryViewName(request.body.name);
        if (!name) return reply.code(400).send({ error: 'Nome da view inteligente inválido.' });
        patch.name = name;
      }
      if (request.body?.definition !== undefined) {
        const definition = normalizeLibraryViewDefinition(request.body.definition);
        if (!definition) return reply.code(400).send({ error: 'Filtros da view inteligente inválidos.' });
        patch.definition = definition;
      }
      if (patch.name === undefined && patch.definition === undefined) {
        return reply.code(400).send({ error: 'Nenhuma alteração informada.' });
      }

      if (!getStore().update(request.user.id, request.params.id, patch)) {
        return reply.code(404).send({ error: 'View inteligente não encontrada.' });
      }

      return { view: getStore().get(request.user.id, request.params.id) };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/library-views/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Views inteligentes exigem uma identidade persistida.' });
    }

    if (!getStore().delete(request.user.id, request.params.id)) {
      return reply.code(404).send({ error: 'View inteligente não encontrada.' });
    }
    return reply.code(204).send();
  });
}
