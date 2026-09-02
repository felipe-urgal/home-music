import type { FastifyInstance } from 'fastify';
import {
  ACCOUNT_PASSWORD_MIN_LENGTH,
  type AccountPasswordService
} from './account-password.js';
import { registerAccountSessionRoutes } from './account-session-routes.js';
import {
  buildSessionCookie,
  loginRateLimitKey,
  readCookie,
  SESSION_CAPACITY_RETRY_AFTER_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  SessionCapacityError,
  type LoginRateLimiter,
  type SessionManager
} from './auth.js';
import { resolveAuthStatus } from './auth-status.js';
import type { UserAuthStore } from './user-auth-store.js';

type AuthRouteDependencies = {
  authConfigured: boolean;
  authUsers: UserAuthStore;
  sessions: SessionManager;
  accountPasswords: AccountPasswordService;
  loginRateLimiter: LoginRateLimiter;
  forceSecureCookie: boolean;
  trustTailscaleForwardedFor: boolean;
};

export function registerAuthRoutes(app: FastifyInstance, dependencies: AuthRouteDependencies) {
  const {
    authConfigured,
    authUsers,
    sessions,
    accountPasswords,
    loginRateLimiter,
    forceSecureCookie,
    trustTailscaleForwardedFor
  } = dependencies;

  const requestSessionToken = (cookieHeader: string | undefined) => (
    readCookie(cookieHeader, SESSION_COOKIE_NAME)
  );
  const requestIsSecure = (request: { protocol: string }) => (
    forceSecureCookie || request.protocol === 'https'
  );

  app.get('/api/auth/status', { config: { auth: 'public' } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const token = requestSessionToken(request.headers.cookie);
    return resolveAuthStatus(authConfigured, token, sessions, authUsers);
  });

  app.post<{ Body: { username?: unknown; password?: unknown } }>(
    '/api/auth/login',
    { config: { auth: 'public' } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const key = loginRateLimitKey(
        request.raw.socket.remoteAddress || request.ip,
        request.headers['x-forwarded-for'],
        trustTailscaleForwardedFor
      );

      if (loginRateLimiter.isBlocked(key)) {
        reply.header('Retry-After', '300');
        return reply.code(429).send({
          error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
        });
      }

      const username = typeof request.body?.username === 'string' ? request.body.username : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      const authenticated = await accountPasswords.authenticate(username, password);

      if (!authenticated) {
        loginRateLimiter.recordFailure(key);
        return reply.code(401).send({ error: 'Usuário ou senha inválidos.' });
      }

      loginRateLimiter.clear(key);
      let token: string;
      try {
        token = sessions.createSessionForUser(authenticated.userId);
      } catch (error) {
        if (!(error instanceof SessionCapacityError)) throw error;
        reply.header('Retry-After', String(SESSION_CAPACITY_RETRY_AFTER_SECONDS));
        return reply.code(503).send({
          error: 'Capacidade de sessões temporariamente atingida. Tente novamente em instantes.'
        });
      }

      reply.header(
        'Set-Cookie',
        buildSessionCookie(token, SESSION_TTL_SECONDS, requestIsSecure(request))
      );
      return {
        authenticated: true,
        passwordChangeRequired: authenticated.passwordMustChange
      };
    }
  );

  app.post<{ Body: { currentPassword?: unknown; newPassword?: unknown } }>(
    '/api/auth/password',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!request.user) {
        return reply.code(409).send({
          error: 'Troca de senha não está disponível para esta sessão.'
        });
      }

      const currentPassword = typeof request.body?.currentPassword === 'string'
        ? request.body.currentPassword
        : '';
      const newPassword = typeof request.body?.newPassword === 'string'
        ? request.body.newPassword
        : '';
      const result = await accountPasswords.changeAuthenticatedPassword(
        request.user.id,
        currentPassword,
        newPassword
      );

      if (!result.ok) {
        switch (result.error) {
          case 'invalid-current-password':
            return reply.code(400).send({ error: 'Senha atual inválida.' });
          case 'weak-new-password':
            return reply.code(400).send({
              error: `A nova senha deve ter pelo menos ${ACCOUNT_PASSWORD_MIN_LENGTH} caracteres.`
            });
          case 'same-password':
            return reply.code(400).send({
              error: 'A nova senha precisa ser diferente da senha atual.'
            });
          case 'not-required':
            return reply.code(409).send({
              error: 'Troca de senha não está disponível para esta conta.'
            });
          case 'stale-account':
            return reply.code(409).send({
              error: 'A credencial da conta mudou durante a operação. Faça login novamente.'
            });
        }
      }

      reply.header('Set-Cookie', buildSessionCookie('', 0, requestIsSecure(request)));
      return { passwordChanged: true };
    }
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = requestSessionToken(request.headers.cookie);
    sessions.revokeSession(token);
    reply.header('Set-Cookie', buildSessionCookie('', 0, requestIsSecure(request)));
    reply.header('Cache-Control', 'no-store');
    return reply.code(204).send();
  });

  registerAccountSessionRoutes(app, sessions);
}
