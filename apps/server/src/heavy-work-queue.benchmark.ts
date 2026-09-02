import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  HeavyWorkQueue,
  HeavyWorkQueueSaturatedError,
  withHeavyWorkRequestContext
} from './heavy-work-queue.js';

const BURST_REQUESTS = 10_000;
const MAX_PENDING = 64;
const MAX_PENDING_PER_OWNER = 16;
const MAX_PERSISTENT_HEAP_GROWTH_MB = 32;
const MAX_BURST_DURATION_MS = 10_000;
const MEBIBYTE = 1024 * 1024;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(next => { resolve = next; });
  return { promise, resolve };
}

function collectGarbage() {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  gc?.();
}

function mb(bytes: number) {
  return Number((bytes / MEBIBYTE).toFixed(2));
}

async function main() {
  const queue = new HeavyWorkQueue({
    name: 'benchmark',
    maxConcurrent: 1,
    maxPending: MAX_PENDING,
    maxPendingPerOwner: MAX_PENDING_PER_OWNER,
    retryAfterSeconds: 2
  });
  const blocker = deferred();
  const running = withHeavyWorkRequestContext({ ownerId: 'active-user' }, () =>
    queue.run(async () => blocker.promise)
  );
  const accepted: Promise<void>[] = [];

  for (let index = 0; index < MAX_PENDING; index += 1) {
    accepted.push(withHeavyWorkRequestContext({ ownerId: `user-${index % 8}` }, () =>
      queue.run(async () => undefined)
    ));
  }

  assert.equal(queue.runtime.active, 1);
  assert.equal(queue.runtime.pending, MAX_PENDING);
  collectGarbage();
  const before = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  let rejected = 0;

  for (let offset = 0; offset < BURST_REQUESTS; offset += 500) {
    const batch = Array.from({ length: Math.min(500, BURST_REQUESTS - offset) }, (_, index) =>
      withHeavyWorkRequestContext({ ownerId: `burst-${offset + index}` }, () =>
        queue.run(async () => undefined)
      ).then(
        () => false,
        error => error instanceof HeavyWorkQueueSaturatedError
      )
    );
    const results = await Promise.all(batch);
    rejected += results.filter(Boolean).length;
  }

  const durationMs = performance.now() - startedAt;
  collectGarbage();
  const after = process.memoryUsage().heapUsed;
  const persistentHeapGrowthMb = mb(Math.max(0, after - before));

  assert.equal(rejected, BURST_REQUESTS);
  assert.equal(queue.runtime.active, 1);
  assert.equal(queue.runtime.pending, MAX_PENDING);
  assert.equal(queue.runtime.rejected, BURST_REQUESTS);
  assert.ok(
    persistentHeapGrowthMb <= MAX_PERSISTENT_HEAP_GROWTH_MB,
    `heap persistente cresceu ${persistentHeapGrowthMb}MB após rajada rejeitada`
  );
  assert.ok(
    durationMs <= MAX_BURST_DURATION_MS,
    `load shedding demorou ${durationMs.toFixed(2)}ms para ${BURST_REQUESTS} requisições`
  );

  blocker.resolve();
  await Promise.all([running, ...accepted]);
  assert.equal(queue.runtime.active, 0);
  assert.equal(queue.runtime.pending, 0);

  console.log(JSON.stringify({
    benchmark: 'heavy-work-backpressure',
    burstRequests: BURST_REQUESTS,
    maxPending: MAX_PENDING,
    rejected,
    durationMs: Number(durationMs.toFixed(2)),
    persistentHeapGrowthMb,
    limits: {
      maxPersistentHeapGrowthMb: MAX_PERSISTENT_HEAP_GROWTH_MB,
      maxBurstDurationMs: MAX_BURST_DURATION_MS
    }
  }, null, 2));
}

await main();
