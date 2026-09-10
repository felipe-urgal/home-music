import assert from 'node:assert/strict';
import test from 'node:test';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import type {
  LibraryAssistantProviderCacheEntry,
  LibraryAssistantProviderCacheKey
} from './library-assistant-store.js';
import {
  lookupAcoustIdFingerprint,
  normalizeAcoustIdFingerprintLookup
} from './acoustid-fingerprint-lookup.js';

function cacheKey(value: LibraryAssistantProviderCacheKey) {
  return `${value.provider}:${value.providerVersion}:${value.cacheKeyHash}`;
}

function gateway(onKey?: (key: LibraryAssistantProviderCacheKey) => void) {
  const cache = new Map<string, LibraryAssistantProviderCacheEntry>();
  return new LibraryAssistantProviderGateway({
    getProviderCache(key, nowMs) {
      onKey?.(key);
      const value = cache.get(cacheKey(key)) ?? null;
      return value && value.expiresAtMs > nowMs ? value : null;
    },
    putProviderCache(key, payload, expiresAtMs, updatedAt) {
      onKey?.(key);
      cache.set(cacheKey(key), { payload, expiresAtMs, updatedAt });
    },
    deleteProviderCache(key) {
      cache.delete(cacheKey(key));
    }
  }, { minIntervalMs: 0 });
}

const payload = {
  status: 'ok',
  results: [{
    id: '11111111-1111-4111-8111-111111111111',
    score: 0.99,
    recordings: [{
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Canção correta',
      duration: 180.3,
      artists: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Artista correto' }],
      releasegroups: [{ id: '44444444-4444-4444-8444-444444444444', title: 'Álbum correto' }]
    }]
  }]
};

test('normaliza apenas metadata mínima de identificação', () => {
  assert.deepEqual(normalizeAcoustIdFingerprintLookup(payload), [{
    acoustId: '11111111-1111-4111-8111-111111111111',
    score: 0.99,
    recordings: [{
      recordingId: '22222222-2222-4222-8222-222222222222',
      title: 'Canção correta',
      artist: 'Artista correto',
      artistId: '33333333-3333-4333-8333-333333333333',
      durationSeconds: 180.3,
      releaseGroupId: '44444444-4444-4444-8444-444444444444',
      releaseGroupTitle: 'Álbum correto'
    }]
  }]);
});

test('lookup usa POST server-side e não coloca segredo/fingerprint na URL ou chave de cache persistida', async () => {
  const observedKeys: LibraryAssistantProviderCacheKey[] = [];
  let requestUrl = '';
  let requestBody = '';
  const apiKey = 'app-secret-key';
  const fingerprint = 'AQAB_private_fingerprint_123';
  const result = await lookupAcoustIdFingerprint(gateway(key => observedKeys.push(key)), {
    apiKey,
    durationSeconds: 180,
    fingerprint
  }, {
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body ?? '');
      return new Response(JSON.stringify(payload), { status: 200 });
    }
  });

  assert.equal(result.length, 1);
  assert.equal(requestUrl, 'https://api.acoustid.org/v2/lookup');
  assert.equal(requestUrl.includes(apiKey), false);
  assert.equal(requestUrl.includes(fingerprint), false);
  assert.match(requestBody, /client=app-secret-key/);
  assert.match(requestBody, /fingerprint=AQAB_private_fingerprint_123/);
  assert.ok(observedKeys.length > 0);
  assert.ok(observedKeys.every(key => key.cacheKeyHash.length === 64));
  assert.ok(observedKeys.every(key => !cacheKey(key).includes(apiKey) && !cacheKey(key).includes(fingerprint)));
});

test('múltiplos resultados válidos permanecem disponíveis para classificação de ambiguidade', () => {
  const normalized = normalizeAcoustIdFingerprintLookup({
    status: 'ok',
    results: [
      payload.results[0],
      {
        ...payload.results[0],
        id: '55555555-5555-4555-8555-555555555555',
        score: 0.98,
        recordings: [{ ...payload.results[0].recordings[0], id: '66666666-6666-4666-8666-666666666666' }]
      }
    ]
  });
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].score, 0.99);
  assert.equal(normalized[1].score, 0.98);
});

test('payload malformed é rejeitado e rate limit permanece erro recuperável do provider', async () => {
  assert.throws(() => normalizeAcoustIdFingerprintLookup({ status: 'wat' }), /provider/i);

  await assert.rejects(
    lookupAcoustIdFingerprint(gateway(), {
      apiKey: 'app-key', durationSeconds: 180, fingerprint: 'AQAB_test'
    }, { fetchImpl: async () => new Response('', { status: 429 }) }),
    error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'provider-rate-limited')
  );
});
