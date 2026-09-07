import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '@home-music/shared';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import type {
  LibraryAssistantProviderCacheEntry,
  LibraryAssistantProviderCacheKey
} from './library-assistant-store.js';
import { createBatchedLibraryAssistantAnalyzer } from './library-assistant-batched-analyzer.js';
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
    album: 'Album',
    albumArtist: 'Artista',
    folder: 'Album',
    folderPath: 'Artista/Album',
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

test('duas falhas consecutivas fazem backoff mas todas as faixas restantes ainda são tentadas', async () => {
  const attempted: string[] = [];
  const failures: string[] = [];
  const backoffs: number[] = [];
  const progress: Array<{ processedTracks: number; failedTracks: number }> = [];

  const base: LibraryAssistantAnalyzer = {
    id: 'base-backoff',
    capability: 'metadata',
    async analyze({ tracks }) {
      if (tracks.length > 1) throw timeout();
      const item = tracks[0];
      attempted.push(item.id);
      if (item.id === 'track-1' || item.id === 'track-2') throw timeout();
      return [draft(item)];
    }
  };

  const analyzer = createBatchedLibraryAssistantAnalyzer(base, {
    batchSize: 5,
    failureBackoffMs: 25,
    sleep: async delayMs => { backoffs.push(delayMs); },
    onTrackFailure: failure => failures.push(failure.trackId),
    onProgress: item => progress.push({
      processedTracks: item.processedTracks,
      failedTracks: item.failedTracks
    })
  });

  const result = await analyzer.analyze({
    runId: 'run-backoff',
    tracks: Array.from({ length: 5 }, (_, index) => track(index + 1)),
    providers: gateway()
  });

  assert.deepEqual(attempted, ['track-1', 'track-2', 'track-3', 'track-4', 'track-5']);
  assert.deepEqual(failures, ['track-1', 'track-2']);
  assert.deepEqual(backoffs, [25]);
  assert.deepEqual(progress, [{ processedTracks: 5, failedTracks: 2 }]);
  assert.deepEqual(result.map(item => item.target.trackId), ['track-3', 'track-4', 'track-5']);
});
