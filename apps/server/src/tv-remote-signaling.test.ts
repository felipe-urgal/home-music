import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify, { type InjectOptions } from 'fastify';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { registerTvRemoteRoutes } from './tv-remote-routes.js';
import { TvRemoteSessionManager } from './tv-remote-session-manager.js';

const base = '/api/tv-remote/sessions';
const missing = { error: 'Controle remoto não encontrado.' };

function setup(t: TestContext) {
  const manager = new TvRemoteSessionManager({ setInterval: () => ({}), clearInterval: () => undefined });
  const sessions = new SessionManager('admin', 'test-password-only', undefined, undefined, { status: 'legacy-uninitialized' });
  const app = Fastify();
  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: { getEnabledUserById: id => ({ id, username: id, role: 'user', passwordMustChange: false }) }
  });
  registerTvRemoteRoutes(app, manager);
  app.addHook('onClose', async () => manager.shutdown());
  const cookies = {
    owner: `${SESSION_COOKIE_NAME}=${sessions.createSessionForUser('owner')}`,
    other: `${SESSION_COOKIE_NAME}=${sessions.createSessionForUser('other')}`
  };
  t.after(async () => { manager.shutdown(); await app.close(); });

  function inject(method: InjectOptions['method'], url: string, options: {
    user?: keyof typeof cookies;
    csrf?: boolean;
    payload?: InjectOptions['payload'];
  } = {}) {
    return app.inject({
      method,
      url,
      payload: options.payload,
      headers: {
        cookie: cookies[options.user ?? 'owner'],
        ...(options.csrf === false ? {} : { 'x-home-music-request': '1' })
      }
    });
  }

  async function create() {
    const response = await inject('POST', base);
    assert.equal(response.statusCode, 201);
    return response.json<{ id: string }>().id;
  }

  return { manager, inject, create };
}

const offer = {
  from: 'remote',
  type: 'description',
  description: { type: 'offer', sdp: 'v=0\r\n' }
} as const;

const candidate = {
  from: 'tv',
  type: 'ice-candidate',
  candidate: {
    candidate: 'candidate:1 1 UDP 2122252543 192.0.2.1 54400 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
    usernameFragment: 'abc'
  }
} as const;

test('WebRTC signaling is authenticated, CSRF protected and ownership scoped', async t => {
  const { inject, create } = setup(t);
  const id = await create();
  const path = `${base}/${id}/signals`;

  assert.equal((await inject('POST', path, { csrf: false, payload: offer })).statusCode, 403);
  const other = await inject('POST', path, { user: 'other', payload: offer });
  assert.equal(other.statusCode, 404);
  assert.deepEqual(other.json(), missing);
});

test('WebRTC signaling rejects malformed or oversized messages without publishing events', async t => {
  const { inject, create, manager } = setup(t);
  const id = await create();
  const path = `${base}/${id}/signals`;
  const invalid = [
    null,
    {},
    { ...offer, from: 'other' },
    { ...offer, extra: true },
    { ...offer, description: { type: 'pranswer', sdp: 'v=0' } },
    { ...offer, description: { type: 'offer', sdp: '' } },
    { ...offer, description: { type: 'offer', sdp: 'x'.repeat(256 * 1024 + 1) } },
    { ...candidate, candidate: { ...candidate.candidate, sdpMLineIndex: -1 } },
    { ...candidate, candidate: { ...candidate.candidate, candidate: 'x'.repeat(8 * 1024 + 1) } }
  ];

  for (const payload of invalid) {
    const response = await inject('POST', path, { payload });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'Sinalização WebRTC inválida.' });
  }
  assert.deepEqual(manager.eventsAfter('owner', id, 0), []);
});

test('valid offer/answer/ICE messages are published as typed session events without renewing TV heartbeat', async t => {
  const { inject, create, manager } = setup(t);
  const id = await create();
  const path = `${base}/${id}/signals`;
  const before = manager.get('owner', id)?.expiresAt;
  const answer = {
    from: 'tv',
    type: 'description',
    description: { type: 'answer', sdp: 'v=0\r\na=answer\r\n' }
  } as const;

  for (const payload of [offer, answer, candidate]) {
    assert.equal((await inject('POST', path, { payload })).statusCode, 202);
  }

  assert.deepEqual(manager.eventsAfter('owner', id, 0), [
    { id: 1, type: 'signal', data: offer },
    { id: 2, type: 'signal', data: answer },
    { id: 3, type: 'signal', data: candidate }
  ]);
  assert.equal(manager.get('owner', id)?.expiresAt, before);
});
