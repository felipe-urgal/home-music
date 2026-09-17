import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { installApiAuthPolicy } from './auth-policy.js';
import { SESSION_CAPACITY_RETRY_AFTER_SECONDS, SessionManager } from './auth.js';
import { TvDeviceLoginManager } from './tv-device-login-manager.js';
import {
  registerTvDeviceLoginRoutes,
  TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER
} from './tv-device-login-routes.js';

const CSRF_HEADERS = { 'x-home-music-request': '1' };

function deterministicManager() {
  let token = 0;
  return new TvDeviceLoginManager({
    now: () => 1_000,
    randomToken: bytes => `token_${bytes}_${String(++token).padStart(12, '0')}`,
    randomCode: () => '654321',
    startRateLimitMax: 100
  });
}

function createContext(maxSessions = 128) {
  const app = Fastify();
  const sessions = new SessionManager(
    '',
    '',
    5 * 60 * 1000,
    maxSessions,
    { status: 'blocked' },
    16
  );
  const users = {
    getEnabledUserById(userId: string) {
      if (userId !== 'user-1') return null;
      return {
        id: 'user-1',
        username: 'user',
        role: 'user' as const,
        passwordMustChange: false
      };
    }
  };
  const manager = deterministicManager();

  installApiAuthPolicy(app, { configured: true, sessions, users });
  registerTvDeviceLoginRoutes(app, {
    manager,
    sessions,
    forceSecureCookie: false,
    trustTailscaleForwardedFor: false,
    sessionCookieMaxAgeSeconds: 400 * 24 * 60 * 60
  });

  return { app, sessions, manager };
}

async function startDevice(app: ReturnType<typeof Fastify>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/device/start',
    headers: CSRF_HEADERS
  });
  assert.equal(response.statusCode, 200);
  return response.json() as {
    requestId: string;
    deviceToken: string;
    approvalToken: string;
    displayCode: string;
    expiresAt: string;
  };
}

function sessionTokenFromSetCookie(value: string | string[] | undefined) {
  if (typeof value !== 'string') throw new Error('Set-Cookie de sessão ausente.');
  const match = /^home_music_session=([^;]+)/.exec(value);
  if (!match) throw new Error('Cookie de sessão inválido.');
  return match[1];
}

test('start exige header de mutação e devolve contrato sem cache', async () => {
  const context = createContext();
  try {
    const blocked = await context.app.inject({
      method: 'POST',
      url: '/api/auth/device/start'
    });
    assert.equal(blocked.statusCode, 403);

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/device/start',
      headers: CSRF_HEADERS
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), {
      requestId: 'token_18_000000000001',
      deviceToken: 'token_32_000000000002',
      approvalToken: 'token_32_000000000003',
      displayCode: '654321',
      expiresAt: '1970-01-01T00:05:01.000Z'
    });
  } finally {
    await context.app.close();
  }
});

test('status exige o segredo da TV, não expõe identidade e não diferencia request inexistente', async () => {
  const context = createContext();
  try {
    const started = await startDevice(context.app);
    const valid = await context.app.inject({
      method: 'GET',
      url: `/api/auth/device/${started.requestId}/status`,
      headers: { [TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER]: started.deviceToken }
    });
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.headers['cache-control'], 'no-store');
    assert.deepEqual(valid.json(), { state: 'pending' });

    const wrongSecret = await context.app.inject({
      method: 'GET',
      url: `/api/auth/device/${started.requestId}/status`,
      headers: { [TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER]: 'token_32_999999999999' }
    });
    const missing = await context.app.inject({
      method: 'GET',
      url: '/api/auth/device/token_18_999999999999/status',
      headers: { [TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER]: started.deviceToken }
    });
    assert.equal(wrongSecret.statusCode, 404);
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(wrongSecret.json(), missing.json());
  } finally {
    await context.app.close();
  }
});

test('approve deriva usuário da sessão autenticada e consume cria sessão independente para a TV', async () => {
  const context = createContext();
  try {
    const started = await startDevice(context.app);
    const mobileToken = context.sessions.createSessionForUser('user-1');

    const anonymous = await context.app.inject({
      method: 'POST',
      url: '/api/auth/device/approve',
      headers: CSRF_HEADERS,
      payload: { approvalToken: started.approvalToken, userId: 'attacker' }
    });
    assert.equal(anonymous.statusCode, 401);

    const approved = await context.app.inject({
      method: 'POST',
      url: '/api/auth/device/approve',
      headers: {
        ...CSRF_HEADERS,
        cookie: `home_music_session=${mobileToken}`
      },
      payload: { approvalToken: started.approvalToken, userId: 'attacker' }
    });
    assert.equal(approved.statusCode, 200);
    assert.deepEqual(approved.json(), { approved: true, displayCode: '654321' });

    const status = await context.app.inject({
      method: 'GET',
      url: `/api/auth/device/${started.requestId}/status`,
      headers: { [TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER]: started.deviceToken }
    });
    assert.deepEqual(status.json(), { state: 'approved' });

    const consumed = await context.app.inject({
      method: 'POST',
      url: `/api/auth/device/${started.requestId}/consume`,
      headers: {
        ...CSRF_HEADERS,
        [TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER]: started.deviceToken
      }
    });
    assert.equal(consumed.statusCode, 200);
    assert.equal(consumed.headers['cache-control'], 'no-store');
    assert.deepEqual(consumed.json(), { authenticated: true });

    const tvToken = sessionTokenFromSetCookie(consumed.headers['set-cookie']);
    assert.notEqual(tvToken, mobileToken);
    assert.equal(context.sessions.getSession(tvToken)?.userId, 'user-1');
    assert.equal(context.sessions.getSession(mobileToken)?.userId, 'user-1');

    const replay = await context.app.inject({
      method: 'POST',
      url: `/api/auth/device/${started.requestId}/consume`,
      headers: {
        ...CSRF_HEADERS,
        [TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER]: started.deviceToken
      }
    });
    assert.equal(replay.statusCode, 409);
    assert.deepEqual(replay.json(), {
      error: 'Solicitação de login da TV indisponível.',
      state: 'consumed'
    });
    assert.equal(replay.headers['set-cookie'], undefined);
  } finally {
    await context.app.close();
  }
});

test('falha de capacidade faz rollback da reserva e permite consumir depois', async () => {
  const context = createContext(2);
  try {
    const started = await startDevice(context.app);
    const mobileToken = context.sessions.createSessionForUser('user-1');
    const blocker = context.sessions.createSessionForUser('user-2');

    const approved = await context.app.inject({
      method: 'POST',
      url: '/api/auth/device/approve',
      headers: {
        ...CSRF_HEADERS,
        cookie: `home_music_session=${mobileToken}`
      },
      payload: { approvalToken: started.approvalToken }
    });
    assert.equal(approved.statusCode, 200);

    const saturated = await context.app.inject({
      method: 'POST',
      url: `/api/auth/device/${started.requestId}/consume`,
      headers: {
        ...CSRF_HEADERS,
        [TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER]: started.deviceToken
      }
    });
    assert.equal(saturated.statusCode, 503);
    assert.equal(
      saturated.headers['retry-after'],
      String(SESSION_CAPACITY_RETRY_AFTER_SECONDS)
    );
    assert.equal(context.manager.status(started.requestId, started.deviceToken), 'approved');

    context.sessions.revokeSession(blocker);
    const retried = await context.app.inject({
      method: 'POST',
      url: `/api/auth/device/${started.requestId}/consume`,
      headers: {
        ...CSRF_HEADERS,
        [TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER]: started.deviceToken
      }
    });
    assert.equal(retried.statusCode, 200);
    const tvToken = sessionTokenFromSetCookie(retried.headers['set-cookie']);
    assert.notEqual(tvToken, mobileToken);
    assert.equal(context.sessions.getSession(mobileToken)?.userId, 'user-1');
  } finally {
    await context.app.close();
  }
});

test('deny e cancelamento respeitam autenticação, CSRF e segredo da TV', async () => {
  const context = createContext();
  try {
    const deniedRequest = await startDevice(context.app);
    const mobileToken = context.sessions.createSessionForUser('user-1');

    const denied = await context.app.inject({
      method: 'POST',
      url: '/api/auth/device/deny',
      headers: {
        ...CSRF_HEADERS,
        cookie: `home_music_session=${mobileToken}`
      },
      payload: { approvalToken: deniedRequest.approvalToken }
    });
    assert.equal(denied.statusCode, 204);
    assert.equal(context.manager.status(deniedRequest.requestId, deniedRequest.deviceToken), 'denied');

    const cancelRequest = await startDevice(context.app);
    const wrongSecret = await context.app.inject({
      method: 'DELETE',
      url: `/api/auth/device/${cancelRequest.requestId}`,
      headers: {
        ...CSRF_HEADERS,
        [TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER]: 'token_32_999999999999'
      }
    });
    assert.equal(wrongSecret.statusCode, 404);

    const cancelled = await context.app.inject({
      method: 'DELETE',
      url: `/api/auth/device/${cancelRequest.requestId}`,
      headers: {
        ...CSRF_HEADERS,
        [TV_DEVICE_LOGIN_DEVICE_TOKEN_HEADER]: cancelRequest.deviceToken
      }
    });
    assert.equal(cancelled.statusCode, 204);
    assert.equal(context.manager.status(cancelRequest.requestId, cancelRequest.deviceToken), null);
  } finally {
    await context.app.close();
  }
});

test('tokens grandes ou malformados são rejeitados antes de lookup sem detalhes internos', async () => {
  const context = createContext();
  try {
    const mobileToken = context.sessions.createSessionForUser('user-1');
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/device/approve',
      headers: {
        ...CSRF_HEADERS,
        cookie: `home_music_session=${mobileToken}`
      },
      payload: { approvalToken: 'x'.repeat(500) }
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'Solicitação de login da TV indisponível.' });
  } finally {
    await context.app.close();
  }
});
