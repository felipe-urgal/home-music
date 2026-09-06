import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LibraryAssistantProviderAbortedError,
  LibraryAssistantProviderGateway,
  LibraryAssistantProviderResponseError,
  LibraryAssistantProviderTimeoutError
} from './library-assistant-provider.js';
import type {
  LibraryAssistantProviderCacheEntry,
  LibraryAssistantProviderCacheKey
} from './library-assistant-store.js';

function cacheKeyId(key: LibraryAssistantProviderCacheKey) {
  return `${key.provider}:${key.providerVersion}:${key.cacheKeyHash}`;
}

function memoryCache() {
  const entries = new Map<string, LibraryAssistantProviderCacheEntry>();
  const seenKeys: LibraryAssistantProviderCacheKey[] = [];
  return {
    entries,
    seenKeys,
    port: {
      getProviderCache(key: LibraryAssistantProviderCacheKey, nowMs: number) {
        seenKeys.push(key);
        const entry = entries.get(cacheKeyId(key)) ?? null;
        return entry && entry.expiresAtMs > nowMs ? entry : null;
      },
      putProviderCache(
        key: LibraryAssistantProviderCacheKey,
        payload: unknown,
        expiresAtMs: number,
        updatedAt: string
      ) {
        seenKeys.push(key);
        entries.set(cacheKeyId(key), { payload, expiresAtMs, updatedAt });
      },
      deleteProviderCache(key: LibraryAssistantProviderCacheKey) {
        entries.delete(cacheKeyId(key));
      }
    }
  };
}

const provider = {
  source: 'musicbrainz' as const,
  version: 'v1',
  userAgent: 'HomeMusic/1.0 test@example.invalid'
};

function normalizeRecording(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('id' in payload) || typeof payload.id !== 'string') {
    throw new TypeError('payload inválido');
  }
  return { id: payload.id };
}

test('provider gateway caches normalized payload using only a deterministic hashed key', async () => {
  const cache = memoryCache();
  let calls = 0;
  const gateway = new LibraryAssistantProviderGateway(cache.port, { minIntervalMs: 0 });
  const query = {
    provider,
    cacheKey: 'title=Faixa|artist=Artista',
    execute: async ({ userAgent }: { signal: AbortSignal; userAgent: string }) => {
      calls += 1;
      assert.equal(userAgent, provider.userAgent);
      return { id: 'recording-1', ignoredRawField: 'não persistir se normalize remover' };
    },
    normalize: normalizeRecording
  };

  const first = await gateway.query(query);
  const second = await gateway.query(query);

  assert.deepEqual(first, { value: { id: 'recording-1' }, cache: 'miss' });
  assert.deepEqual(second, { value: { id: 'recording-1' }, cache: 'hit' });
  assert.equal(calls, 1);
  assert.match(cache.seenKeys[0].cacheKeyHash, /^[a-f0-9]{64}$/);
  assert.notEqual(cache.seenKeys[0].cacheKeyHash, query.cacheKey);
  assert.deepEqual([...cache.entries.values()][0].payload, { id: 'recording-1' });
});

test('provider gateway deduplicates concurrent equivalent requests', async () => {
  const cache = memoryCache();
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const gateway = new LibraryAssistantProviderGateway(cache.port, { minIntervalMs: 0 });
  const query = {
    provider,
    cacheKey: 'same-query',
    execute: async () => {
      calls += 1;
      await blocked;
      return { id: 'recording-1' };
    },
    normalize: normalizeRecording
  };

  const first = gateway.query(query);
  const second = gateway.query(query);
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
});

test('provider gateway lets a deduplicated consumer cancel without aborting shared work', async () => {
  const cache = memoryCache();
  let calls = 0;
  let release!: (value: { id: string }) => void;
  const blocked = new Promise<{ id: string }>(resolve => { release = resolve; });
  const gateway = new LibraryAssistantProviderGateway(cache.port, { minIntervalMs: 0 });

  const first = gateway.query({
    provider,
    cacheKey: 'shared-cancel',
    execute: async () => {
      calls += 1;
      return blocked;
    },
    normalize: normalizeRecording
  });

  const controller = new AbortController();
  const second = gateway.query({
    provider,
    cacheKey: 'shared-cancel',
    signal: controller.signal,
    execute: async () => {
      calls += 1;
      return { id: 'should-not-run' };
    },
    normalize: normalizeRecording
  });

  controller.abort();
  await assert.rejects(second, LibraryAssistantProviderAbortedError);
  release({ id: 'recording-1' });
  assert.deepEqual(await first, { value: { id: 'recording-1' }, cache: 'miss' });
  assert.equal(calls, 1);
});

test('provider gateway rate limits requests from the same provider with fake clock', async () => {
  const cache = memoryCache();
  let nowMs = 1_000;
  const sleeps: number[] = [];
  const gateway = new LibraryAssistantProviderGateway(cache.port, {
    now: () => new Date(nowMs),
    minIntervalMs: 1_000,
    sleep: async delayMs => {
      sleeps.push(delayMs);
      nowMs += delayMs;
    }
  });

  await gateway.query({
    provider,
    cacheKey: 'one',
    execute: async () => ({ id: 'one' }),
    normalize: normalizeRecording
  });
  await gateway.query({
    provider,
    cacheKey: 'two',
    execute: async () => ({ id: 'two' }),
    normalize: normalizeRecording
  });

  assert.deepEqual(sleeps, [1_000]);
});

test('provider gateway cancellation interrupts the rate-limit wait before execute', async () => {
  const cache = memoryCache();
  let calls = 0;
  const gateway = new LibraryAssistantProviderGateway(cache.port, { minIntervalMs: 1_000 });

  await gateway.query({
    provider,
    cacheKey: 'prime-rate-limit',
    execute: async () => ({ id: 'first' }),
    normalize: normalizeRecording
  });

  const controller = new AbortController();
  const pending = gateway.query({
    provider,
    cacheKey: 'cancel-during-rate-limit',
    signal: controller.signal,
    execute: async () => {
      calls += 1;
      return { id: 'should-not-run' };
    },
    normalize: normalizeRecording
  });
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(pending, LibraryAssistantProviderAbortedError);
  assert.equal(calls, 0);
});

test('provider gateway rejects malformed response and sensitive cache keys', async () => {
  const cache = memoryCache();
  const gateway = new LibraryAssistantProviderGateway(cache.port, { minIntervalMs: 0 });

  await assert.rejects(
    gateway.query({
      provider,
      cacheKey: 'malformed',
      execute: async () => ({ wrong: true }),
      normalize: normalizeRecording
    }),
    LibraryAssistantProviderResponseError
  );

  assert.throws(
    () => gateway.query({
      provider,
      cacheKey: 'token=secret-value',
      execute: async () => ({ id: 'never' }),
      normalize: normalizeRecording
    }),
    /dado sensível/
  );
});

test('provider gateway enforces wall-clock timeout even when execute ignores AbortSignal', async () => {
  const cache = memoryCache();
  const gateway = new LibraryAssistantProviderGateway(cache.port, { minIntervalMs: 0 });
  let providerSignal: AbortSignal | null = null;

  await assert.rejects(
    gateway.query({
      provider,
      cacheKey: 'timeout',
      timeoutMs: 100,
      execute: async ({ signal }) => {
        providerSignal = signal;
        return new Promise<unknown>(() => {});
      },
      normalize: normalizeRecording
    }),
    LibraryAssistantProviderTimeoutError
  );

  assert.equal(providerSignal?.aborted, true);
});

test('provider gateway caller cancellation returns promptly even when execute ignores AbortSignal', async () => {
  const cache = memoryCache();
  const gateway = new LibraryAssistantProviderGateway(cache.port, { minIntervalMs: 0 });
  const controller = new AbortController();
  let providerSignal: AbortSignal | null = null;

  const pending = gateway.query({
    provider,
    cacheKey: 'cancel',
    signal: controller.signal,
    execute: async ({ signal }) => {
      providerSignal = signal;
      return new Promise<unknown>(() => {});
    },
    normalize: normalizeRecording
  });
  controller.abort();

  await assert.rejects(pending, LibraryAssistantProviderAbortedError);
  assert.equal(providerSignal?.aborted, true);
});

test('provider cache failures degrade to a live normalized result', async () => {
  const gateway = new LibraryAssistantProviderGateway({
    getProviderCache() { throw new Error('cache offline'); },
    putProviderCache() { throw new Error('cache offline'); },
    deleteProviderCache() { throw new Error('cache offline'); }
  }, { minIntervalMs: 0 });

  const result = await gateway.query({
    provider,
    cacheKey: 'cache-failure',
    execute: async () => ({ id: 'recording-1' }),
    normalize: normalizeRecording
  });

  assert.deepEqual(result, { value: { id: 'recording-1' }, cache: 'miss' });
});
