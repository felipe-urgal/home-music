import type { FastifyInstance } from 'fastify';
import type { OpenSubsonicKeysResponse } from '@home-music/shared/open-subsonic';
import type { OpenSubsonicCredentialStore } from './open-subsonic-credentials.js';

type AccountKeyRoutesStore = Pick<OpenSubsonicCredentialStore, 'list' | 'create' | 'revoke'>;

export function registerOpenSubsonicAccountRoutes(
  app: FastifyInstance,
  credentials: AccountKeyRoutesStore
) {
  app.get('/api/auth/open-subsonic/keys', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Autenticação necessária.' });
    }

    reply.header('Cache-Control', 'private, no-store');
    return reply.send({ keys: credentials.list(request.user.id) } satisfies OpenSubsonicKeysResponse);
  });

  app.post<{ Body: { name?: unknown } }>('/api/auth/open-subsonic/keys', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Autenticação necessária.' });
    }

    const created = credentials.create(request.user.id, request.body?.name);
    if (!created) {
      return reply.code(400).send({ error: 'Informe um nome para identificar o aplicativo.' });
    }

    reply.header('Cache-Control', 'private, no-store');
    return reply.code(201).send(created);
  });

  app.delete<{ Params: { id: string } }>('/api/auth/open-subsonic/keys/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Autenticação necessária.' });
    }

    if (!credentials.revoke(request.user.id, request.params.id)) {
      return reply.code(404).send({ error: 'Chave de aplicativo não encontrada.' });
    }

    reply.header('Cache-Control', 'private, no-store');
    return reply.code(204).send();
  });
}
