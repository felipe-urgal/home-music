import assert from 'node:assert/strict';
import { get, type IncomingMessage } from 'node:http';
import test, { type TestContext } from 'node:test';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { registerTvRemoteRoutes } from './tv-remote-routes.js';
import { TvRemoteSessionManager } from './tv-remote-session-manager.js';

const base = '/api/tv-remote/sessions';
const missing = { error: 'Controle remoto não encontrado.' };
const snapshot = {
  trackId: 'track-1', title: '  Title  ', artist: ' Artist ', playing: true,
  currentTime: 130, duration: 120, updatedAt: '2026-09-12T12:00:00+02:00'
};

function setup(t: TestContext) {
  let now = Date.parse('2026-09-12T10:00:00Z');
  const manager = new TvRemoteSessionManager({ now: () => now });
  const sessions = new SessionManager('admin', 'test-password-only', undefined, undefined, { status: 'legacy-uninitialized' });
  const app = Fastify();
  installApiAuthPolicy(app, {
    configured: true, sessions,
    users: { getEnabledUserById: id => ({ id, username: id, role: 'user', passwordMustChange: false }) }
  });
  registerTvRemoteRoutes(app, manager);
  app.addHook('onClose', async () => manager.shutdown());
  const cookies = {
    owner: `${SESSION_COOKIE_NAME}=${sessions.createSessionForUser('owner')}`,
    other: `${SESSION_COOKIE_NAME}=${sessions.createSessionForUser('other')}`,
    legacy: `${SESSION_COOKIE_NAME}=${sessions.createSession()}`
  };
  t.after(async () => { manager.shutdown(); await app.close(); });
  function inject(method: InjectOptions['method'], url: string, options: {
    user?: keyof typeof cookies; csrf?: boolean; payload?: InjectOptions['payload'];
    headers?: Record<string, string>;
  } = {}) {
    return app.inject({ method, url, payload: options.payload, headers: {
      cookie: cookies[options.user ?? 'owner'],
      ...(options.csrf === false ? {} : { 'x-home-music-request': '1' }),
      ...options.headers
    } });
  }
  async function create() {
    const response = await inject('POST', base);
    assert.equal(response.statusCode, 201);
    return response.json<{ id: string }>().id;
  }
  return { app, manager, inject, create, cookies, advance: (ms: number) => { now += ms; } };
}

test('all remote endpoints require central authentication and mutations require CSRF', async t => {
  const { app, inject, create } = setup(t);
  const id = await create();
  for (const [method, url, payload] of [
    ['POST', base, undefined], ['GET', `${base}/${id}`, undefined],
    ['GET', `${base}/${id}/events`, undefined], ['PUT', `${base}/${id}/status`, snapshot],
    ['POST', `${base}/${id}/commands`, { type: 'next' }], ['DELETE', `${base}/${id}`, undefined]
  ] as const) {
    assert.equal((await app.inject({ method, url, payload })).statusCode, 401, `${method} ${url}`);
    assert.equal((await inject(method, url, { user: 'legacy', payload })).statusCode, 401);
    if (method !== 'GET') assert.equal((await inject(method, url, { csrf: false, payload })).statusCode, 403);
  }
});

test('missing, other-owner and expired sessions are indistinguishable across every session endpoint', async t => {
  const { inject, create, advance } = setup(t);
  const id = await create();
  for (const [sessionId, user] of [['missing', 'owner'], [id, 'other'], [id, 'owner']] as const) {
    if (sessionId === id && user === 'owner') advance(60_000);
    for (const [method, suffix, payload] of [
      ['GET', '', undefined], ['GET', '/events', undefined],
      ['PUT', '/status', snapshot], ['POST', '/commands', { type: 'next' }], ['DELETE', '', undefined]
    ] as const) {
      const response = await inject(method, `${base}/${sessionId}${suffix}`, { user, payload });
      assert.equal(response.statusCode, 404);
      assert.deepEqual(response.json(), missing);
    }
  }
});

test('command validation accepts only the five controls and publishes no invalid events', async t => {
  const { inject, create, manager } = setup(t);
  const id = await create();
  for (const payload of [null, [], {}, { type: 'seek', deltaSeconds: 11 },
    { type: 'seek', deltaSeconds: '10' }, { type: 'seek' }, { type: 'next', userId: 'other' },
    { type: 'seek', deltaSeconds: 10, extra: true }, { type: 'volume' }]) {
    assert.equal((await inject('POST', `${base}/${id}/commands`, { payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' } })).statusCode, 400);
  }
  assert.deepEqual(manager.eventsAfter('owner', id, 0), []);
  const commands = [{ type: 'toggle-play' }, { type: 'previous' }, { type: 'next' },
    { type: 'seek', deltaSeconds: -10 }, { type: 'seek', deltaSeconds: 10 }];
  for (const payload of commands) {
    assert.equal((await inject('POST', `${base}/${id}/commands`, { payload })).statusCode, 202);
  }
  assert.deepEqual(manager.eventsAfter('owner', id, 0)?.map(event => event.data), commands);
});

test('snapshot validation trims presentation, normalizes timestamps and clamps time without persisting invalid input', async t => {
  const { inject, create, manager } = setup(t);
  const id = await create();
  for (const payload of [null, [], {}, { ...snapshot, playing: 'true' },
    { ...snapshot, trackId: 2 }, { ...snapshot, title: false }, { ...snapshot, artist: [] },
    { ...snapshot, currentTime: '10' }, { ...snapshot, duration: null },
    { ...snapshot, updatedAt: 'invalid' }, { ...snapshot, updatedAt: 123 },
    { ...snapshot, userId: 'other' }]) {
    assert.equal((await inject('PUT', `${base}/${id}/status`, { payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' } })).statusCode, 400);
  }
  const nonFinite = JSON.stringify(snapshot).replace('130', '1e400');
  assert.equal((await inject('PUT', `${base}/${id}/status`, { payload: nonFinite,
    headers: { 'content-type': 'application/json' } })).statusCode, 400);
  assert.equal(manager.get('owner', id)?.snapshot, null);
  assert.equal((await inject('PUT', `${base}/${id}/status`, { payload: snapshot })).statusCode, 204);
  const result = await inject('GET', `${base}/${id}`);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json().snapshot, {
    trackId: 'track-1', title: 'Title', artist: 'Artist', playing: true,
    currentTime: 120, duration: 120, updatedAt: '2026-09-12T10:00:00.000Z'
  });
  for (const [currentTime, duration, expectedTime, expectedDuration] of [[-5, -9, 0, 0], [12, 0, 12, 0]]) {
    assert.equal((await inject('PUT', `${base}/${id}/status`, { payload: {
      ...snapshot, trackId: null, title: null, artist: null, currentTime, duration
    } })).statusCode, 204);
    assert.deepEqual(manager.get('owner', id)?.snapshot, {
      trackId: null, title: null, artist: null, playing: true,
      currentTime: expectedTime, duration: expectedDuration, updatedAt: '2026-09-12T10:00:00.000Z'
    });
  }
});

test('create rejects an arbitrary owner and DELETE invalidates the session', async t => {
  const { inject, create } = setup(t);
  assert.equal((await inject('POST', base, { payload: { userId: 'other' } })).statusCode, 400);
  const id = await create();
  assert.equal((await inject('DELETE', `${base}/${id}`)).statusCode, 204);
  const result = await inject('GET', `${base}/${id}`);
  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.json(), missing);
});

test('Last-Event-ID rejects partial, signed, fractional and unsafe integers', async t => {
  const { inject, create } = setup(t);
  const id = await create();
  for (const lastId of ['-1', '+1', '1.5', '1junk', '1e2', 'NaN', 'Infinity', '9007199254740992', '']) {
    assert.equal((await inject('GET', `${base}/${id}/events`, {
      headers: { 'last-event-id': lastId }
    })).statusCode, 400, lastId);
  }
});

// A real HTTP subscription exercises frames and socket lifecycle, not Fastify source text.
async function subscribe(app: FastifyInstance, url: string, cookie: string, lastId?: string) {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(`http://127.0.0.1:${address.port}${url}`, {
      headers: { cookie, ...(lastId === undefined ? {} : { 'last-event-id': lastId }) }
    }, resolve);
    request.on('error', reject);
  });
  response.setEncoding('utf8');
  let data = '';
  const waiters = new Set<() => void>();
  response.on('data', (chunk: string) => { data += chunk; for (const waiter of waiters) waiter(); });
  return {
    response,
    read: () => data,
    close: () => response.destroy(),
    until: (text: string, timeoutMs = 2000) => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { waiters.delete(check); reject(new Error(`Missing SSE frame ${text}: ${data}`)); }, timeoutMs);
      function check() {
        if (!data.includes(text)) return;
        clearTimeout(timeout); waiters.delete(check); resolve();
      }
      waiters.add(check); check();
    })
  };
}

test('SSE replays only newer events, delivers live normalized snapshots and ends on DELETE', async t => {
  const { app, inject, create, cookies } = setup(t);
  const id = await create();
  await inject('POST', `${base}/${id}/commands`, { payload: { type: 'previous' } });
  await inject('POST', `${base}/${id}/commands`, { payload: { type: 'next' } });
  const stream = await subscribe(app, `${base}/${id}/events`, cookies.owner, '1');
  t.after(stream.close);
  assert.equal(stream.response.statusCode, 200);
  assert.equal(stream.response.headers['content-type'], 'text/event-stream');
  assert.equal(stream.response.headers['cache-control'], 'no-cache, no-transform');
  assert.equal(stream.response.headers.connection, 'keep-alive');
  await stream.until('id: 2\nevent: command\ndata: {"type":"next"}\n\n');
  assert.match(stream.read(), /retry: \d+\n\n/);
  assert.doesNotMatch(stream.read(), /id: 1\n/);
  await inject('PUT', `${base}/${id}/status`, { payload: snapshot });
  await stream.until('id: 3\nevent: snapshot\ndata: {"trackId":"track-1","title":"Title","artist":"Artist","playing":true,"currentTime":120,"duration":120,"updatedAt":"2026-09-12T10:00:00.000Z"}\n\n');
  const ended = new Promise(resolve => stream.response.once('end', resolve));
  await inject('DELETE', `${base}/${id}`);
  await stream.until('id: 4\nevent: closed\ndata: {"reason":"closed"}\n\n');
  await ended;
});

test('SSE accepts zero or absent replay ID and manager shutdown closes active streams', async t => {
  const { app, inject, create, cookies, manager } = setup(t);
  const id = await create();
  await inject('POST', `${base}/${id}/commands`, { payload: { type: 'toggle-play' } });
  for (const lastId of [undefined, '0']) {
    const stream = await subscribe(app, `${base}/${id}/events`, cookies.owner, lastId);
    t.after(stream.close);
    await stream.until('id: 1\nevent: command\ndata: {"type":"toggle-play"}\n\n');
    if (lastId === undefined) stream.close();
    else {
      const ended = new Promise(resolve => stream.response.once('end', resolve));
      manager.shutdown();
      await stream.until('event: closed');
      await ended;
    }
  }
});

test('Fastify shutdown drains live SSE before onClose and releases the manager', { timeout: 2000 }, async t => {
  const { app, create, cookies, manager } = setup(t);
  const id = await create();
  const stream = await subscribe(app, `${base}/${id}/events`, cookies.owner);
  t.after(stream.close);
  await stream.until('retry:');
  const ended = new Promise(resolve => stream.response.once('end', resolve));
  await app.close();
  await ended;
  assert.equal(manager.get('owner', id), null);
});

test('SSE sends heartbeat comments without renewing the TV session and unsubscribes on disconnect', async t => {
  const { app, create, cookies, manager, advance } = setup(t);
  const id = await create();
  let delivered = 0;
  let onUnsubscribe = () => {};
  const unsubscribed = new Promise<void>(resolve => { onUnsubscribe = resolve; });
  const realSubscribe = manager.subscribe.bind(manager);
  t.mock.method(manager, 'subscribe', (ownerId: string, sessionId: string,
    listener: Parameters<TvRemoteSessionManager['subscribe']>[2]) => {
    const unsubscribe = realSubscribe(ownerId, sessionId, event => { delivered += 1; listener(event); });
    return unsubscribe && (() => { unsubscribe(); onUnsubscribe(); });
  });
  const stream = await subscribe(app, `${base}/${id}/events`, cookies.owner);
  t.after(stream.close);
  advance(5000);
  await stream.until(': heartbeat\n\n', 16_000);
  assert.equal(manager.get('owner', id)?.expiresAt, '2026-09-12T10:01:00.000Z');
  stream.close();
  await unsubscribed;
  manager.publishCommand('owner', id, { type: 'next' });
  assert.equal(delivered, 0);
});

test('SSE backpressure releases the listener and transport without closing the remote session', { timeout: 2000 }, async t => {
  const { app, create, cookies, manager } = setup(t);
  let writes = 0;
  let delivered = 0;
  const realSubscribe = manager.subscribe.bind(manager);
  t.mock.method(manager, 'subscribe', (ownerId: string, sessionId: string,
    listener: Parameters<TvRemoteSessionManager['subscribe']>[2]) => realSubscribe(ownerId, sessionId, event => {
    delivered += 1;
    listener(event);
  }));
  // Only transport backpressure is simulated; actual HTTP writes and subscription remain real.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.endsWith('/events')) return;
    const write = reply.raw.write.bind(reply.raw);
    t.mock.method(reply.raw, 'write', (...args: Parameters<typeof reply.raw.write>) => {
      writes += 1;
      const result = write(...args);
      return String(args[0]).includes('event: command') ? false : result;
    });
  });
  const id = await create();
  const stream = await subscribe(app, `${base}/${id}/events`, cookies.owner);
  t.after(stream.close);
  stream.response.on('error', () => {}); // Destruction of a congested socket may abort the response.
  await stream.until('retry:');
  const closed = new Promise(resolve => stream.response.once('close', resolve));
  assert.equal(manager.publishCommand('owner', id, { type: 'next' }), true);
  await closed;
  const writesAtClose = writes;
  assert.equal(manager.publishCommand('owner', id, { type: 'previous' }), true);
  assert.equal(delivered, 1);
  assert.equal(writes, writesAtClose);
  assert.notEqual(manager.get('owner', id), null);
  assert.deepEqual(manager.eventsAfter('owner', id, 0)?.map(event => event.id), [1, 2]);
});
