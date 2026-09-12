import assert from 'node:assert/strict';
import test from 'node:test';
import type { TvRemoteEvent, TvRemotePlaybackSnapshot } from '@home-music/shared';
import { TvRemoteSessionManager } from './tv-remote-session-manager.js';

function managerAt(value: number | (() => number)) {
  let nextId = 1;
  return new TvRemoteSessionManager({
    now: typeof value === 'number' ? () => value : value,
    randomId: () => `session-${nextId++}`,
    setInterval: () => ({}),
    clearInterval: () => undefined
  });
}

function snapshot(overrides: Partial<TvRemotePlaybackSnapshot> = {}): TvRemotePlaybackSnapshot {
  return {
    trackId: 'track-4',
    title: 'Track Four',
    artist: 'Artist',
    playing: true,
    currentTime: 12,
    duration: 180,
    updatedAt: '2026-09-12T10:00:00.000Z',
    ...overrides
  };
}

test('create returns an opaque summary with the initial expiration', () => {
  const manager = managerAt(0);

  assert.deepEqual(manager.create('user-7'), {
    id: 'session-1',
    expiresAt: '1970-01-01T00:01:00.000Z',
    snapshot: null
  });
});

test('a fourth session evicts the oldest session owned by the user', () => {
  const manager = managerAt(0);
  const first = manager.create('user-7');
  manager.create('user-7');
  manager.create('user-7');
  manager.create('user-7');

  assert.equal(manager.get('user-7', first.id), null);
});

test('the per-user cap does not evict another user session', () => {
  const manager = managerAt(0);
  const other = manager.create('user-8');
  manager.create('user-7');
  manager.create('user-7');
  manager.create('user-7');
  manager.create('user-7');

  assert.notEqual(manager.get('user-8', other.id), null);
});

test('another user cannot observe or command a session', () => {
  const manager = managerAt(0);
  const session = manager.create('user-7');

  assert.equal(manager.get('user-8', session.id), null);
  assert.equal(manager.publishCommand('user-8', session.id, { type: 'next' }), false);
  assert.equal(manager.eventsAfter('user-8', session.id, 0), null);
  assert.equal(manager.subscribe('user-8', session.id, () => undefined), null);
  assert.equal(manager.close('user-8', session.id), false);
  assert.equal(manager.publishSnapshot('user-8', session.id, snapshot()), false);
});

test('a session expires 60 seconds after its last TV heartbeat', () => {
  let now = 0;
  const manager = managerAt(() => now);
  const session = manager.create('user-7');

  now = 59_999;
  assert.notEqual(manager.get('user-7', session.id), null);
  now = 60_000;
  assert.equal(manager.get('user-7', session.id), null);
});

test('publishing a snapshot updates the TV heartbeat, summary and expiration', () => {
  let now = 1_000;
  const manager = managerAt(() => now);
  const session = manager.create('user-7');
  const current = snapshot();

  now = 40_000;
  assert.equal(manager.publishSnapshot('user-7', session.id, current), true);
  now = 99_999;
  assert.deepEqual(manager.get('user-7', session.id), {
    id: session.id,
    expiresAt: '1970-01-01T00:01:40.000Z',
    snapshot: current
  });
  now = 100_000;
  assert.equal(manager.get('user-7', session.id), null);
});

test('replay returns only events newer than Last-Event-ID', () => {
  const manager = managerAt(0);
  const session = manager.create('user-7');
  manager.publishCommand('user-7', session.id, { type: 'previous' });
  manager.publishCommand('user-7', session.id, { type: 'next' });

  assert.deepEqual(manager.eventsAfter('user-7', session.id, 1)?.map(event => event.id), [2]);
});

test('replay retains only the latest 32 events with monotonic session IDs', () => {
  const manager = managerAt(0);
  const session = manager.create('user-7');
  for (let index = 0; index < 40; index += 1) {
    manager.publishCommand('user-7', session.id, { type: 'next' });
  }

  assert.deepEqual(
    manager.eventsAfter('user-7', session.id, 0)?.map(event => event.id),
    Array.from({ length: 32 }, (_, index) => index + 9)
  );
});

test('subscribers receive events until their unsubscribe function is called', () => {
  const manager = managerAt(0);
  const session = manager.create('user-7');
  const received: TvRemoteEvent[] = [];
  const unsubscribe = manager.subscribe('user-7', session.id, event => received.push(event));
  assert.notEqual(unsubscribe, null);

  manager.publishCommand('user-7', session.id, { type: 'toggle-play' });
  unsubscribe?.();
  manager.publishCommand('user-7', session.id, { type: 'next' });

  assert.deepEqual(received, [
    { id: 1, type: 'command', data: { type: 'toggle-play' } }
  ]);
});

test('closing a session notifies current subscribers and removes it', () => {
  const manager = managerAt(0);
  const session = manager.create('user-7');
  const received: TvRemoteEvent[] = [];
  manager.subscribe('user-7', session.id, event => received.push(event));

  assert.equal(manager.close('user-7', session.id), true);
  assert.equal(manager.get('user-7', session.id), null);
  assert.deepEqual(received, [
    { id: 1, type: 'closed', data: { reason: 'closed' } }
  ]);
});

test('a failing subscriber cannot block other listeners or session cleanup', () => {
  const manager = managerAt(0);
  const session = manager.create('user-7');
  const received: TvRemoteEvent[] = [];
  manager.subscribe('user-7', session.id, () => {
    throw new Error('disconnected stream');
  });
  manager.subscribe('user-7', session.id, event => received.push(event));

  assert.doesNotThrow(() => manager.close('user-7', session.id));
  assert.equal(manager.get('user-7', session.id), null);
  assert.deepEqual(received, [
    { id: 1, type: 'closed', data: { reason: 'closed' } }
  ]);
});

test('the owned cleanup timer expires sessions and shutdown clears that timer and listeners', () => {
  let now = 0;
  let cleanup: (() => void) | null = null;
  const ownedTimer = {};
  const cleared: unknown[] = [];
  const manager = new TvRemoteSessionManager({
    now: () => now,
    randomId: () => 'session-1',
    setInterval: callback => {
      cleanup = callback;
      return ownedTimer;
    },
    clearInterval: timer => cleared.push(timer)
  });
  const session = manager.create('user-7');
  const received: TvRemoteEvent[] = [];
  manager.subscribe('user-7', session.id, event => received.push(event));

  now = 60_000;
  assert.notEqual(cleanup, null);
  (cleanup as unknown as () => void)();
  assert.deepEqual(received, [
    { id: 1, type: 'closed', data: { reason: 'expired' } }
  ]);
  assert.equal(manager.get('user-7', session.id), null);

  const active = manager.create('user-7');
  manager.subscribe('user-7', active.id, event => received.push(event));
  manager.shutdown();
  manager.shutdown();
  assert.deepEqual(cleared, [ownedTimer]);
  assert.equal(manager.get('user-7', active.id), null);
  assert.deepEqual(received.at(-1), {
    id: 1,
    type: 'closed',
    data: { reason: 'closed' }
  });
});
