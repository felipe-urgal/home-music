import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  buildSessionCookie,
  loginRateLimitKey,
  SESSION_CAPACITY_RETRY_AFTER_SECONDS,
  SessionCapacityError,
  type SessionManager
} from './auth.js';
import {
  TvDeviceLoginCapacityError,
  type TvDeviceLoginConsumeResult,
  TvDeviceLoginManager,
  TvDeviceLoginRateLimitError
} from './tv-device-login-manager.js';

export const TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER = 'x-home-music-device-token';

const DEVICE_LOGIN_UNAVAILABLE = 'Solicitação de login da TV indisponível.';
const DEVICE_LOGIN_BUSY = 'Solicitação de login da TV temporariamente ocupada.';
const DEVICE_LOGIN_CAPACITY = 'Capacidade de login da TV temporariamente atingida.';

type TvDeviceLoginRouteDependencies = {
  manager: TvDeviceLoginManager;
  sessions: SessionManager;
  forceSecureCookie: boolean;
  trustTailscaleForwardedFor: boolean;
  sessionCookieMaxAgeSeconds: number;
};

function noStore(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
}

function singleHeader(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function requestIsSecure(request: { protocol: string }, forceSecureCookie: boolean) {
  return forceSecureCookie || request.protocol === 'https';
}

function unavailable(reply: FastifyReply) {
  return reply.code(404).send({ error: DEVICE_LOGIN_UNAVAILABLE });
}

function consumeUnavailable(reply: FastifyReply, result: Exclude<TvDeviceLoginConsumeResult, { ok: true }>) {
  if (result.reason === 'invalid') return unavailable(reply);
  if (result.reason === 'busy') {
    reply.header('Retry-After', '1');
    return reply.code(409).send({ error: DEVICE_LOGIN_BUSY, state: 'approved' });
  }
  return reply.code(409).send({ error: DEVICE_LOGIN_UNAVAILABLE, state: result.reason });
}

export function registerTvDeviceLoginRoutes(
  app: FastifyInstance,
  dependencies: TvDeviceLoginRouteDependencies
) {
  const {
    manager,
    sessions,
    forceSecureCookie,
    trustTailscaleForwardedFor,
    sessionCookieMaxAgeSeconds
  } = dependencies;

  app.post(
    '/api/auth/device/start',
    { config: { auth: 'public' } },
    async (request, reply) => {
      noStore(reply);
      const originKey = loginRateLimitKey(
        request.raw.socket.remoteAddress || request.ip,
        request.headers['x-forwarded-for'],
        trustTailscaleForwardedFor
      );

      try {
        const started = manager.start(originKey);
        return {
          requestId: started.requestId,
          deviceToken: started.deviceToken,
          approvalToken: started.approvalToken,
          displayCode: started.displayCode,
          expiresAt: new Date(started.expiresAt).toISOString()
        };
      } catch (error) {
        if (error instanceof TvDeviceLoginRateLimitError) {
          reply.header('Retry-After', String(error.retryAfterSeconds));
          return reply.code(429).send({ error: DEVICE_LOGIN_CAPACITY });
        }
        if (error instanceof TvDeviceLoginCapacityError) {
          reply.header('Retry-After', String(error.retryAfterSeconds));
          return reply.code(error.scope === 'origin' ? 429 : 503).send({
            error: DEVICE_LOGIN_CAPACITY
          });
        }
        throw error;
      }
    }
  );

  app.get<{ Params: { requestId: string } }>(
    '/api/auth/device/:requestId/status',
    { config: { auth: 'public' } },
    async (request, reply) => {
      noStore(reply);
      const state = manager.status(
        request.params.requestId,
        singleHeader(request.headers[TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER])
      );
      if (!state) return unavailable(reply);
      return { state };
    }
  );

  app.post<{ Body: { approvalToken?: unknown } }>(
    '/api/auth/device/preview',
    async (request, reply) => {
      noStore(reply);
      if (!request.user) return reply.code(401).send({ error: 'Autenticação necessária.' });
      const preview = manager.preview(request.body?.approvalToken);
      if (!preview) return unavailable(reply);
      return { displayCode: preview.displayCode };
    }
  );

  app.post<{ Body: { approvalToken?: unknown } }>(
    '/api/auth/device/approve',
    async (request, reply) => {
      noStore(reply);
      if (!request.user) return reply.code(401).send({ error: 'Autenticação necessária.' });
      const approved = manager.approve(request.body?.approvalToken, request.user.id);
      if (!approved) return unavailable(reply);
      return { approved: true, displayCode: approved.displayCode };
    }
  );

  app.post<{ Body: { approvalToken?: unknown } }>(
    '/api/auth/device/deny',
    async (request, reply) => {
      noStore(reply);
      if (!request.user) return reply.code(401).send({ error: 'Autenticação necessária.' });
      if (!manager.deny(request.body?.approvalToken)) return unavailable(reply);
      return reply.code(204).send();
    }
  );

  app.post<{ Params: { requestId: string } }>(
    '/api/auth/device/:requestId/consume',
    { config: { auth: 'public' } },
    async (request, reply) => {
      noStore(reply);
      const reserved = manager.reserveConsume(
        request.params.requestId,
        singleHeader(request.headers[TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER])
      );
      if (!reserved.ok) return consumeUnavailable(reply, reserved);

      let sessionToken: string;
      try {
        sessionToken = sessions.createSessionForUser(reserved.lease.userId);
      } catch (error) {
        reserved.lease.rollback();
        if (!(error instanceof SessionCapacityError)) throw error;
        reply.header('Retry-After', String(SESSION_CAPACITY_RETRY_AFTER_SECONDS));
        return reply.code(503).send({ error: DEVICE_LOGIN_CAPACITY });
      }

      reserved.lease.commit();
      reply.header(
        'Set-Cookie',
        buildSessionCookie(
          sessionToken,
          sessionCookieMaxAgeSeconds,
          requestIsSecure(request, forceSecureCookie)
        )
      );
      return { authenticated: true };
    }
  );

  app.delete<{ Params: { requestId: string } }>(
    '/api/auth/device/:requestId',
    { config: { auth: 'public' } },
    async (request, reply) => {
      noStore(reply);
      const cancelled = manager.cancel(
        request.params.requestId,
        singleHeader(request.headers[TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER])
      );
      if (!cancelled) return unavailable(reply);
      return reply.code(204).send();
    }
  );
}
