import type { FastifyInstance } from 'fastify';
import {
  readCookie,
  SESSION_COOKIE_NAME,
  type SessionManager
} from './auth.js';

type SessionRevoker = Pick<SessionManager, 'revokeUserSessionsExcept'>;

export function registerAccountSessionRoutes(app: FastifyInstance, sessions: SessionRevoker) {
  app.post('/api/auth/sessions/revoke-others', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');

    if (!request.user) {
      return reply.code(409).send({
        error: 'Revogação de outras sessões não está disponível para esta sessão.'
      });
    }

    const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    const revoked = sessions.revokeUserSessionsExcept(request.user.id, token);
    if (revoked === null) {
      return reply.code(401).send({ error: 'Sessão expirada ou autenticação necessária.' });
    }

    return { revoked };
  });
}
