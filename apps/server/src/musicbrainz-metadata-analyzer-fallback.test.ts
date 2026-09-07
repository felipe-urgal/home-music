import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '@home-music/shared';
import {
  LibraryAssistantProviderGateway,
  LibraryAssistantProviderTimeoutError
} from './library-assistant-provider.js';
import type {
  LibraryAssistantProviderCacheEntry,
  LibraryAssistantProviderCacheKey
} from './library-assistant-store.js';
import { createMusicBrainzMetadataAnalyzer } from './musicbrainz-metadata-analyzer.js';

function key(value: LibraryAssistantProviderCacheKey) {
  return `${value.provider}:${value.providerVersion}:${value.cacheKeyHash}`;
}

function gateway() {
  const cache = new Map<string, LibraryAssistantProviderCacheEntry>();
  return new LibraryAssistantProviderGateway({
    getProviderCache(cacheKey, nowMs) {
      const value = cache.get(key(cacheKey)) ?? null;
      return value && value.expiresAtMs > nowMs ? value : null;
    },
    putProviderCache(cacheKey, payload, expiresAtMs, updatedAt) {
      cache.set(key(cacheKey), { payload, expiresAtMs, updatedAt });
    },
    deleteProviderCache(cacheKey) {
      cache.delete(key(cacheKey));
    }
  }, { minIntervalMs: 0 });
}

function track(): Track {
  return {
    id: 'track-1',
    title: 'Cancao',
    artist: 'Artista',
    album: 'Album Antigo',
    albumArtist: 'Artista',
    folder: 'Album Antigo',
    folderPath: 'Artista/Album Antigo',
    duration: 180,
    format: 'flac',
    hasCover: false
  };
}

function response() {
  return new Response(JSON.stringify({
    recordings: [{
      id: 'recording-1',
      title: 'Cancao',
      length: 180_000,
      'artist-credit': [{ name: 'Artista', artist: { id: 'artist-1', name: 'Artista' } }],
      releases: [{
        id: 'release-1',
        title: 'Album Correto',
        'release-group': { id: 'release-group-1' },
        'artist-credit': [{ name: 'Artista', artist: { id: 'artist-1', name: 'Artista' } }]
      }]
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('timeout na busca com album relaxa para titulo + artista antes de falhar a faixa', async () => {
  const queries: string[] = [];
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      const query = new URL(String(input)).searchParams.get('query') ?? '';
      queries.push(query);
      if (query.includes('release:')) throw new LibraryAssistantProviderTimeoutError('musicbrainz');
      return response();
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-fallback-timeout',
    tracks: [track()],
    providers: gateway()
  });

  assert.equal(queries.length, 2);
  assert.match(queries[0], /release:/);
  assert.doesNotMatch(queries[1], /release:/);
  assert.ok(drafts.some(draft => (
    draft.target.capability === 'metadata'
    && draft.target.field === 'album'
    && draft.target.currentValue === 'Album Antigo'
    && draft.target.suggestedValue === 'Album Correto'
  )));
});

test('timeout na busca ampla continua sendo reportado ao isolamento por faixa', async () => {
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async () => {
      throw new LibraryAssistantProviderTimeoutError('musicbrainz');
    }
  });

  await assert.rejects(
    analyzer.analyze({
      runId: 'run-fallback-exhausted',
      tracks: [track()],
      providers: gateway()
    }),
    error => Boolean(
      error instanceof Error
      && 'code' in error
      && error.code === 'provider-timeout'
    )
  );
});
