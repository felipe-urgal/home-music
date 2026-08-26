import type { AuthenticatedUser } from '@home-music/shared';
import type { FastifyInstance } from 'fastify';
import {
  readCookie,
  SESSION_COOKIE_NAME,
  type SessionManager
} from './auth.js';
import { resolveSessionIdentity, type UserIdentityReader } from './auth-context.js';

export type AuthAccess = 'public' | 'authenticated' | 'admin';

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function requestPath(url: string) {
  return url.split('?', 1)[0];
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }

  interface FastifyContextConfig {
    auth?: AuthAccess;
  }
}

type InstallApiAuthPolicyOptions = {
  configured: boolean;
  sessions: Pick<SessionManager, 'getSession' | 'revokeSession'>;
  users: UserIdentityReader;
};

export function installApiAuthPolicy(
  app: FastifyInstance,
  options: InstallApiAuthPolicyOptions
) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request, reply) => {
    request.user = null;
    if (!request.url.startsWith('/api/')) return;

    const path = requestPath(request.url);
    const access = request.routeOptions.config.auth ?? 'authenticated';

    // Status precisa continuar disponível para informar configuração incompleta.
    if (!options.configured && path !== '/api/auth/status') {
      return reply.code(503).send({ error: 'Autenticação do Home Music não configurada.' });
    }

    if (path === '/api/auth/login' && request.headers['x-home-music-request'] !== '1') {
      return reply.code(403).send({ error: 'Requisição de login não autorizada.' });
    }

    if (access !== 'public') {
      const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
      const identity = resolveSessionIdentity(token, options.sessions, options.users);

      if (identity.kind === 'unauthenticated') {
        return reply.code(401).send({ error: 'Sessão expirada ou autenticação necessária.' });
      }

      if (identity.kind === 'user') request.user = identity.user;

      if (access === 'admin' && request.user?.role !== 'admin') {
        return reply.code(403).send({ error: 'Acesso administrativo necessário.' });
      }
    }

    if (mutatingMethods.has(request.method) && request.headers['x-home-music-request'] !== '1') {
      return reply.code(403).send({ error: 'Requisição de alteração não autorizada.' });
    }
  });
}
