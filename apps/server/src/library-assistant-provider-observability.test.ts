import assert from 'node:assert/strict';
import test from 'node:test';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import type { LibraryAssistantProviderObservation } from './library-assistant-run-metrics.js';
import type {
  LibraryAssistantProviderCacheEntry,
  LibraryAssistantProviderCacheKey
} from './library-assistant-store.js';

function cacheId(key: LibraryAssistantProviderCacheKey) {
  return `${key.provider}:${key.providerVersion}:${key.cacheKeyHash}`;
}

function memoryCache() {
  const entries = new Map<string, LibraryAssistantProviderCacheEntry>();
  return {
    getProviderCache(key: LibraryAssistantProviderCacheKey, nowMs: number) {
      const entry = entries.get(cacheId(key)) ?? null;
      return entry && entry.expiresAtMs > nowMs ? entry : null;
    },
    putProviderCache(key: LibraryAssistantProviderCacheKey, payload: unknown, expiresAtMs: number, updatedAt: string) {
      entries.set(cacheId(key), { payload, expiresAtMs, updatedAt });
    },
    deleteProviderCache(key: LibraryAssistantProviderCacheKey) {
      entries.delete(cacheId(key));
    }
  };
}

const provider = {
  source: 'musicbrainz' as const,
  version: 'v1',
  userAgent: 'HomeMusic/1.0 test@example.invalid'
};

function normalize(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('id' in payload) || typeof payload.id !== 'string') {
    throw new TypeError('payload inválido');
  }
  return { id: payload.id };
}

test('provider observations distinguish live requests, cache hits and rate-limit wait', async () => {
  let nowMs = 1_000;
  const observations: LibraryAssistantProviderObservation[] = [];
  const gateway = new LibraryAssistantProviderGateway(memoryCache(), {
    now: () => new Date(nowMs),
    minIntervalMs: 1_000,
    sleep: async delayMs => { nowMs += delayMs; },
    onObservation: observation => observations.push(observation)
  });
  const firstSignal = new AbortController().signal;
  const secondSignal = new AbortController().signal;

  await gateway.query({
    provider,
    cacheKey: 'one',
    signal: firstSignal,
    execute: async () => ({ id: 'one' }),
    normalize
  });
  await gateway.query({
    provider,
    cacheKey: 'two',
    signal: secondSignal,
    execute: async () => ({ id: 'two' }),
    normalize
  });
  await gateway.query({
    provider,
    cacheKey: 'one',
    signal: firstSignal,
    execute: async () => ({ id: 'should-not-run' }),
    normalize
  });

  assert.deepEqual(observations.map(item => ({
    cache: item.cache,
    externalRequest: item.externalRequest,
    rateLimitWaitMs: item.rateLimitWaitMs
  })), [
    { cache: 'miss', externalRequest: true, rateLimitWaitMs: 0 },
    { cache: 'miss', externalRequest: true, rateLimitWaitMs: 1_000 },
    { cache: 'hit', externalRequest: false, rateLimitWaitMs: 0 }
  ]);
  assert.equal(observations[0]?.signal, firstSignal);
  assert.equal(observations[1]?.signal, secondSignal);
});
