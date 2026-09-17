import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { installApiAuthPolicy } from './auth-policy.js';
import { SessionManager } from './auth.js';
import { TvDeviceLoginManager } from './tv-device-login-manager.js';
import { registerTvDeviceLoginRoutes } from './tv-device-login-routes.js';

const CSRF_HEADERS = { 'x-home-music-request': '1' };

function createContext() {
  const app = Fastify();
  let token = 0;
  const manager = new TvDeviceLoginManager({
    now: () => 1_000,
    randomToken: bytes => `token_${bytes}_${String(++token).padStart(12, '0')}`,
    randomCode: () => '654321',
    startRateLimitMax: 100
  });
  const sessions = new SessionManager('', '', 5 * 60 * 1000, 128, { status: 'blocked' }, 16);
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

  installApiAuthPolicy(app, { configured: true, sessions, users });
  registerTvDeviceLoginRoutes(app, {
    manager,
    sessions,
    forceSecureCookie: false,
    trustTailscaleForwardedFor: false,
    sessionCookieMaxAgeSeconds: 400 * 24 * 60 * 60
  });

  return { app, manager, sessions };
}

test('preview autenticado mostra o código sem aprovar a solicitação', async () => {
  const context = createContext();
  try {
    const started = context.manager.start('origin-a');
    const mobileToken = context.sessions.createSessionForUser('user-1');

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/device/preview',
      headers: {
        ...CSRF_HEADERS,
        cookie: `home_music_session=${mobileToken}`
      },
      payload: { approvalToken: started.approvalToken }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), { displayCode: '654321' });
    assert.equal(context.manager.status(started.requestId, started.deviceToken), 'pending');
  } finally {
    await context.app.close();
  }
});

test('preview exige sessão e não diferencia token inválido', async () => {
  const context = createContext();
  try {
    const started = context.manager.start('origin-a');

    const anonymous = await context.app.inject({
      method: 'POST',
      url: '/api/auth/device/preview',
      headers: CSRF_HEADERS,
      payload: { approvalToken: started.approvalToken }
    });
    assert.equal(anonymous.statusCode, 401);

    const mobileToken = context.sessions.createSessionForUser('user-1');
    const invalid = await context.app.inject({
      method: 'POST',
      url: '/api/auth/device/preview',
      headers: {
        ...CSRF_HEADERS,
        cookie: `home_music_session=${mobileToken}`
      },
      payload: { approvalToken: 'token_32_999999999999' }
    });
    assert.equal(invalid.statusCode, 404);
    assert.deepEqual(invalid.json(), { error: 'Solicitação de login da TV indisponível.' });
  } finally {
    await context.app.close();
  }
});
