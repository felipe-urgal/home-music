import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify, { type InjectOptions } from 'fastify';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { registerTvRemoteRoutes } from './tv-remote-routes.js';
import { TvRemoteSessionManager } from './tv-remote-session-manager.js';

const base = '/api/tv-remote/sessions';

function setup(t: TestContext) {
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

  const cookie = `${SESSION_COOKIE_NAME}=${sessions.createSessionForUser('owner')}`;
  const inject = (method: InjectOptions['method'], url: string, payload?: InjectOptions['payload']) => app.inject({
    method,
    url,
    payload,
    headers: {
      cookie,
      'x-home-music-request': '1'
    }
  });

  t.after(async () => {
    manager.shutdown();
    await app.close();
  });

  return { inject, manager };
}

test('remote protocol accepts shuffle/repeat commands and publishes their snapshot state', async t => {
  const { inject, manager } = setup(t);
  const created = await inject('POST', base);
  assert.equal(created.statusCode, 201);
  const sessionId = created.json<{ id: string }>().id;

  for (const command of [{ type: 'toggle-shuffle' }, { type: 'cycle-repeat' }] as const) {
    const response = await inject('POST', `${base}/${sessionId}/commands`, command);
    assert.equal(response.statusCode, 202);
  }

  assert.deepEqual(
    manager.eventsAfter('owner', sessionId, 0)?.map(event => event.data),
    [{ type: 'toggle-shuffle' }, { type: 'cycle-repeat' }]
  );

  for (const invalid of [
    { type: 'toggle-shuffle', extra: true },
    { type: 'cycle-repeat', extra: true }
  ]) {
    const response = await inject('POST', `${base}/${sessionId}/commands`, invalid);
    assert.equal(response.statusCode, 400);
  }

  const snapshot = {
    trackId: 'track-1',
    title: '  Faixa  ',
    artist: ' Artista ',
    playing: true,
    currentTime: 18,
    duration: 180,
    updatedAt: '2026-09-13T12:00:00Z',
    shuffle: true,
    repeatMode: 'one'
  } as const;

  assert.equal((await inject('PUT', `${base}/${sessionId}/status`, snapshot)).statusCode, 204);
  assert.deepEqual(manager.get('owner', sessionId)?.snapshot, {
    trackId: 'track-1',
    title: 'Faixa',
    artist: 'Artista',
    playing: true,
    currentTime: 18,
    duration: 180,
    updatedAt: '2026-09-13T12:00:00.000Z',
    shuffle: true,
    repeatMode: 'one'
  });

  for (const invalid of [
    { ...snapshot, shuffle: 'true' },
    { ...snapshot, repeatMode: 'track' },
    { ...snapshot, unexpected: true }
  ]) {
    const response = await inject('PUT', `${base}/${sessionId}/status`, invalid);
    assert.equal(response.statusCode, 400);
  }
});
