import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HeavyWorkQueue,
  HeavyWorkQueueAbortedError,
  HeavyWorkQueueSaturatedError,
  parseHeavyWorkLimits,
  withHeavyWorkRequestContext
} from './heavy-work-queue.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(next => { resolve = next; });
  return { promise, resolve };
}

test('rejects work beyond global and per-user pending limits', async () => {
  const queue = new HeavyWorkQueue({
    name: 'test',
    maxConcurrent: 1,
    maxPending: 2,
    maxPendingPerOwner: 1,
    retryAfterSeconds: 3
  });
  const running = deferred();
  const first = withHeavyWorkRequestContext({ ownerId: 'user-a' }, () =>
    queue.run(async () => running.promise)
  );
  const queued = withHeavyWorkRequestContext({ ownerId: 'user-a' }, () =>
    queue.run(async () => undefined)
  );

  await assert.rejects(
    withHeavyWorkRequestContext({ ownerId: 'user-a' }, () =>
      queue.run(async () => undefined)
    ),
    (error: unknown) => error instanceof HeavyWorkQueueSaturatedError
      && error.statusCode === 503
      && error.retryAfterSeconds === 3
  );

  const otherQueued = withHeavyWorkRequestContext({ ownerId: 'user-b' }, () =>
    queue.run(async () => undefined)
  );
  await assert.rejects(
    withHeavyWorkRequestContext({ ownerId: 'user-c' }, () =>
      queue.run(async () => undefined)
    ),
    HeavyWorkQueueSaturatedError
  );

  const runtime = queue.runtime;
  assert.equal(runtime.active, 1);
  assert.equal(runtime.pending, 2);
  assert.equal(runtime.rejected, 2);
  assert.ok(runtime.oldestPendingMs >= 0);
  assert.equal(runtime.lastQueueWaitMs, 0);

  running.resolve();
  await Promise.all([first, queued, otherQueued]);
  assert.equal(queue.runtime.active, 0);
  assert.equal(queue.runtime.pending, 0);
});

test('dispatches queued owners round-robin instead of draining one user first', async () => {
  const queue = new HeavyWorkQueue({
    name: 'fair',
    maxConcurrent: 1,
    maxPending: 6,
    maxPendingPerOwner: 3,
    retryAfterSeconds: 1
  });
  const blocker = deferred();
  const order: string[] = [];
  const active = withHeavyWorkRequestContext({ ownerId: 'user-a' }, () =>
    queue.run(async () => blocker.promise)
  );
  const queued = [
    withHeavyWorkRequestContext({ ownerId: 'user-a' }, () => queue.run(async () => { order.push('a1'); })),
    withHeavyWorkRequestContext({ ownerId: 'user-a' }, () => queue.run(async () => { order.push('a2'); })),
    withHeavyWorkRequestContext({ ownerId: 'user-b' }, () => queue.run(async () => { order.push('b1'); })),
    withHeavyWorkRequestContext({ ownerId: 'user-b' }, () => queue.run(async () => { order.push('b2'); }))
  ];

  blocker.resolve();
  await Promise.all([active, ...queued]);
  assert.deepEqual(order, ['a1', 'b1', 'a2', 'b2']);
});

test('removes an aborted waiter before execution', async () => {
  const queue = new HeavyWorkQueue({
    name: 'abortable',
    maxConcurrent: 1,
    maxPending: 2,
    maxPendingPerOwner: 2,
    retryAfterSeconds: 1
  });
  const blocker = deferred();
  const running = withHeavyWorkRequestContext({ ownerId: 'user-a' }, () =>
    queue.run(async () => blocker.promise)
  );
  const controller = new AbortController();
  let executed = false;
  const waiting = withHeavyWorkRequestContext(
    { ownerId: 'user-b', signal: controller.signal },
    () => queue.run(async () => { executed = true; })
  );
  assert.equal(queue.runtime.pending, 1);

  controller.abort();
  await assert.rejects(waiting, HeavyWorkQueueAbortedError);
  assert.equal(queue.runtime.pending, 0);
  assert.equal(executed, false);

  blocker.resolve();
  await running;
});

test('parses bounded environment limits', () => {
  const limits = parseHeavyWorkLimits({
    HOME_MUSIC_TRANSCODE_MAX_CONCURRENT: '2',
    HOME_MUSIC_TRANSCODE_MAX_PENDING: '10',
    HOME_MUSIC_TRANSCODE_MAX_PENDING_PER_USER: '3',
    HOME_MUSIC_COVER_MAX_CONCURRENT: '3',
    HOME_MUSIC_COVER_MAX_PENDING: '20',
    HOME_MUSIC_COVER_MAX_PENDING_PER_USER: '4',
    HOME_MUSIC_IMPORT_MAX_NON_TERMINAL: '40',
    HOME_MUSIC_IMPORT_MAX_NON_TERMINAL_PER_USER: '8',
    HOME_MUSIC_INTEGRITY_MAX_PENDING: '4',
    HOME_MUSIC_INTEGRITY_MAX_PENDING_PER_USER: '2',
    HOME_MUSIC_HEAVY_WORK_RETRY_AFTER_SECONDS: '5'
  });

  assert.equal(limits.retryAfterSeconds, 5);
  assert.deepEqual(limits.transcode, { maxConcurrent: 2, maxPending: 10, maxPendingPerOwner: 3 });
  assert.deepEqual(limits.cover, { maxConcurrent: 3, maxPending: 20, maxPendingPerOwner: 4 });
  assert.deepEqual(limits.imports, { maxNonTerminal: 40, maxNonTerminalPerOwner: 8 });
  assert.deepEqual(limits.integrity, { maxConcurrent: 1, maxPending: 4, maxPendingPerOwner: 2 });

  const clampedDefaults = parseHeavyWorkLimits({
    HOME_MUSIC_TRANSCODE_MAX_PENDING: '2',
    HOME_MUSIC_IMPORT_MAX_NON_TERMINAL: '4'
  });
  assert.equal(clampedDefaults.transcode.maxPendingPerOwner, 2);
  assert.equal(clampedDefaults.imports.maxNonTerminalPerOwner, 4);

  assert.throws(
    () => parseHeavyWorkLimits({ HOME_MUSIC_TRANSCODE_MAX_PENDING: '513' }),
    /HOME_MUSIC_TRANSCODE_MAX_PENDING/
  );
});