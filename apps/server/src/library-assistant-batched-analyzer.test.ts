import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '@home-music/shared';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import type {
  LibraryAssistantProviderCacheEntry,
  LibraryAssistantProviderCacheKey
} from './library-assistant-store.js';
import {
  createBatchedLibraryAssistantAnalyzer
} from './library-assistant-batched-analyzer.js';
import type {
  LibraryAssistantAnalyzer,
  LibraryAssistantSuggestionDraft
} from './library-assistant-service.js';

function key(value: LibraryAssistantProviderCacheKey) {
  return `${value.provider}:${value.providerVersion}:${value.cacheKeyHash}`;
}

function gateway() {
  const cache = new Map<string, LibraryAssistantProviderCacheEntry>();
  return new LibraryAssistantProviderGateway({
    getProviderCache(cacheKey, nowMs) {
      const entry = cache.get(key(cacheKey)) ?? null;
      return entry && entry.expiresAtMs > nowMs ? entry : null;
    },
    putProviderCache(cacheKey, payload, expiresAtMs, updatedAt) {
      cache.set(key(cacheKey), { payload, expiresAtMs, updatedAt });
    },
    deleteProviderCache(cacheKey) {
      cache.delete(key(cacheKey));
    }
  }, { minIntervalMs: 0 });
}

function track(index: number): Track {
  return {
    id: `track-${index}`,
    title: `Faixa ${index}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Álbum',
    folderPath: 'Artista/Álbum',
    duration: 180,
    format: 'mp3',
    hasCover: false
  };
}

function draft(item: Track): LibraryAssistantSuggestionDraft {
  return {
    capability: 'metadata',
    confidence: 'high',
    reasonCodes: ['provider-match'],
    evidence: [{
      type: 'text-match',
      version: 1,
      field: 'title',
      match: 'different',
      sourceValue: item.title,
      candidateValue: `${item.title} correta`
    }],
    provenance: { source: 'musicbrainz', providerVersion: 'v1', externalId: item.id },
    target: {
      capability: 'metadata',
      trackId: item.id,
      field: 'title',
      currentValue: item.title,
      suggestedValue: `${item.title} correta`
    }
  };
}

function timeout() {
  return Object.assign(new Error('timeout'), { code: 'provider-timeout' });
}

test('wrapper envia no máximo 10 faixas por chamada e preserva todas as sugestões', async () => {
  const calls: number[] = [];
  const base: LibraryAssistantAnalyzer = {
    id: 'base',
    capability: 'metadata',
    async analyze({ tracks }) {
      calls.push(tracks.length);
      return tracks.map(draft);
    }
  };
  const analyzer = createBatchedLibraryAssistantAnalyzer(base, { batchSize: 10 });
  const tracks = Array.from({ length: 23 }, (_, index) => track(index + 1));

  const result = await analyzer.analyze({
    runId: 'run-1',
    tracks,
    providers: gateway()
  });

  assert.deepEqual(calls, [10, 10, 3]);
  assert.equal(result.length, 23);
});

test('falha temporária é adiada e recuperada em nova passada sem virar falha definitiva', async () => {
  const deferred: string[] = [];
  const failures: string[] = [];
  let singleTrackThreeAttempts = 0;
  const base: LibraryAssistantAnalyzer = {
    id: 'base',
    capability: 'metadata',
    async analyze({ tracks }) {
      if (tracks.length > 1 && tracks.some(item => item.id === 'track-3')) throw timeout();
      if (tracks[0]?.id === 'track-3') {
        singleTrackThreeAttempts += 1;
        if (singleTrackThreeAttempts === 1) throw timeout();
      }
      return tracks.map(draft);
    }
  };
  const analyzer = createBatchedLibraryAssistantAnalyzer(base, {
    batchSize: 10,
    failureBackoffMs: 0,
    maxRetryPasses: 1,
    onTrackDeferred: attempt => deferred.push(attempt.trackId),
    onTrackFailure: failure => failures.push(failure.trackId)
  });
  const tracks = Array.from({ length: 6 }, (_, index) => track(index + 1));

  const result = await analyzer.analyze({
    runId: 'run-1',
    tracks,
    providers: gateway()
  });

  assert.deepEqual(deferred, ['track-3']);
  assert.deepEqual(failures, []);
  assert.deepEqual(result.map(item => item.target.trackId), [
    'track-1', 'track-2', 'track-4', 'track-5', 'track-6', 'track-3'
  ]);
});

test('wrapper preserva consulta do provider quando timeout específico está habilitado', async () => {
  const cache = new Map<string, LibraryAssistantProviderCacheEntry>();
  const providers = new LibraryAssistantProviderGateway({
    getProviderCache(cacheKey, nowMs) {
      const entry = cache.get(key(cacheKey)) ?? null;
      return entry && entry.expiresAtMs > nowMs ? entry : null;
    },
    putProviderCache(cacheKey, payload, expiresAtMs, updatedAt) {
      cache.set(key(cacheKey), { payload, expiresAtMs, updatedAt });
    },
    deleteProviderCache(cacheKey) {
      cache.delete(key(cacheKey));
    }
  }, { minIntervalMs: 0 });

  const base: LibraryAssistantAnalyzer = {
    id: 'provider-test',
    capability: 'metadata',
    async analyze({ tracks, providers: wrappedProviders }) {
      const response = await wrappedProviders.query({
        provider: { source: 'musicbrainz', version: 'v1', userAgent: 'HomeMusic test' },
        cacheKey: tracks[0].id,
        execute: async () => ({ id: tracks[0].id }),
        normalize: payload => payload as { id: string }
      });
      return response.value.id ? [draft(tracks[0])] : [];
    }
  };

  const analyzer = createBatchedLibraryAssistantAnalyzer(base, { providerTimeoutMs: 10_000 });
  const result = await analyzer.analyze({ runId: 'run-1', tracks: [track(1)], providers });
  assert.equal(result.length, 1);
});
