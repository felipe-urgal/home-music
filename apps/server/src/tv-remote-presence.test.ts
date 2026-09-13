import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { registerTvRemoteRoutes } from './tv-remote-routes.js';
import { TvRemoteSessionManager } from './tv-remote-session-manager.js';

test('loading a remote session signals presence to the TV event stream', async t => {
  const manager = new TvRemoteSessionManager();
  const sessions = new SessionManager(
    'admin',
    'test-password-only',
    undefined,
    undefined,
    { status: 'legacy-uninitialized' }
  );
  const app = Fastify();
  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: {
      getEnabledUserById: id => ({ id, username: id, role: 'user', passwordMustChange: false })
    }
  });
  registerTvRemoteRoutes(app, manager);
  app.addHook('onClose', async () => manager.shutdown());
  t.after(async () => {
    manager.shutdown();
    await app.close();
  });

  const cookie = `${SESSION_COOKIE_NAME}=${sessions.createSessionForUser('owner')}`;
  const headers = { cookie, 'x-home-music-request': '1' };
  const created = await app.inject({ method: 'POST', url: '/api/tv-remote/sessions', headers });
  assert.equal(created.statusCode, 201);
  const sessionId = created.json<{ id: string }>().id;
  assert.deepEqual(manager.eventsAfter('owner', sessionId, 0), []);

  const loaded = await app.inject({
    method: 'GET',
    url: `/api/tv-remote/sessions/${sessionId}`,
    headers: { cookie }
  });
  assert.equal(loaded.statusCode, 200);
  assert.deepEqual(manager.eventsAfter('owner', sessionId, 0), [
    { id: 1, type: 'remote-connected', data: {} }
  ]);
});
