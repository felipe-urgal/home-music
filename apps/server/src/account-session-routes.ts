import type { FastifyInstance } from 'fastify';
import {
  readCookie,
  SESSION_COOKIE_NAME,
  type SessionManager
} from './auth.js';
import { registerPlaybackHistoryRoutes } from './playback-history-routes.js';
import { registerSmartPlaylistRoutes } from './smart-playlist-routes.js';

type SessionAccess = Pick<
  SessionManager,
  'listUserSessions' | 'revokeUserSession' | 'revokeUserSessionsExcept'
>;

function currentSession(request: { headers: { cookie?: string } }) {
  return readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
}

export function registerAccountSessionRoutes(app: FastifyInstance, sessions: SessionAccess) {
  app.get('/api/auth/sessions', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!request.user) {
      return reply.code(409).send({ error: 'Sessões não estão disponíveis para esta autenticação.' });
    }

    const items = sessions.listUserSessions(request.user.id, currentSession(request));
    if (!items) return reply.code(401).send({ error: 'Sessão expirada ou autenticação necessária.' });
    return { sessions: items };
  });

  app.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!request.user) {
      return reply.code(409).send({ error: 'Sessões não estão disponíveis para esta autenticação.' });
    }

    const revoked = sessions.revokeUserSession(request.user.id, request.params.id, currentSession(request));
    if (revoked === null) return reply.code(401).send({ error: 'Sessão expirada ou autenticação necessária.' });
    if (!revoked) return reply.code(404).send({ error: 'Sessão não encontrada ou não pode ser encerrada.' });
    return { revoked: 1 };
  });

  app.post('/api/auth/sessions/revoke-others', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');

    if (!request.user) {
      return reply.code(409).send({
        error: 'Revogação de outras sessões não está disponível para esta sessão.'
      });
    }

    const revoked = sessions.revokeUserSessionsExcept(request.user.id, currentSession(request));
    if (revoked === null) {
      return reply.code(401).send({ error: 'Sessão expirada ou autenticação necessária.' });
    }

    return { revoked };
  });

  registerSmartPlaylistRoutes(app);
  registerPlaybackHistoryRoutes(app);
}
