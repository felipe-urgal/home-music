import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '@home-music/shared';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import type {
  LibraryAssistantProviderCacheEntry,
  LibraryAssistantProviderCacheKey
} from './library-assistant-store.js';
import {
  createMusicBrainzMetadataAnalyzer,
  normalizeMusicBrainzRecordingSearch,
  rankMusicBrainzCandidate
} from './musicbrainz-metadata-analyzer.js';

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

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Cancao',
    artist: 'Artista',
    album: 'Album',
    albumArtist: 'Artista',
    folder: 'Album',
    folderPath: 'Artista/Album',
    duration: 180,
    format: 'flac',
    hasCover: false,
    ...overrides
  };
}

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recording-1',
    title: 'Canção',
    length: 180_500,
    'artist-credit': [{ name: 'Artista', artist: { id: 'artist-1', name: 'Artista' } }],
    releases: [{
      id: 'release-1',
      title: 'Album',
      'release-group': { id: 'release-group-1' },
      'artist-credit': [{ name: 'Artista', artist: { id: 'artist-1', name: 'Artista' } }]
    }],
    ...overrides
  };
}

function response(recordings: unknown[]) {
  return new Response(JSON.stringify({ recordings }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

test('normaliza somente campos MusicBrainz necessários e mantém ids com escopo', () => {
  const [candidate] = normalizeMusicBrainzRecordingSearch({
    recordings: [recording({ ignored: { raw: 'não persistir' } })]
  });

  assert.deepEqual(candidate, {
    recordingId: 'recording-1',
    title: 'Canção',
    artist: 'Artista',
    artistId: 'artist-1',
    durationSeconds: 180.5,
    releases: [{
      id: 'release-1',
      title: 'Album',
      releaseGroupId: 'release-group-1',
      albumArtist: 'Artista',
      albumArtistId: 'artist-1'
    }]
  });
  assert.throws(() => normalizeMusicBrainzRecordingSearch({ wrong: [] }), /provider/i);
});

test('matching aceita acento/caixa como normalização sem apagar pontuação agressivamente', () => {
  const [candidate] = normalizeMusicBrainzRecordingSearch({ recordings: [recording()] });
  const ranked = rankMusicBrainzCandidate(track(), candidate);
  assert.equal(ranked.blockingConflict, false);
  assert.ok(ranked.reasonCodes.includes('normalized-text-match'));
  assert.ok(ranked.reasonCodes.includes('duration-close'));

  const [punctuationCandidate] = normalizeMusicBrainzRecordingSearch({
    recordings: [recording({ title: 'Cancao!' })]
  });
  const punctuation = rankMusicBrainzCandidate(track(), punctuationCandidate);
  assert.equal(punctuation.blockingConflict, true);
  assert.ok(punctuation.reasonCodes.includes('metadata-conflict'));
});

test('duração incompatível impede confiança elegível mesmo com título e artista compatíveis', () => {
  const [candidate] = normalizeMusicBrainzRecordingSearch({
    recordings: [recording({ length: 225_000 })]
  });
  const ranked = rankMusicBrainzCandidate(track(), candidate);
  assert.equal(ranked.blockingConflict, true);
  assert.ok(ranked.reasonCodes.includes('duration-mismatch'));
});

test('analyzer produz sugestão explicável, ids externos tipados e preserva override humano', async () => {
  let calls = 0;
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async () => {
      calls += 1;
      return response([recording()]);
    },
    getHumanOverrideFields: () => ['title']
  });

  const drafts = await analyzer.analyze({
    runId: 'run-1',
    tracks: [track()],
    providers: gateway()
  });

  assert.equal(calls, 1);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].target.capability, 'metadata');
  assert.equal(drafts[0].target.field, 'title');
  assert.equal(drafts[0].confidence, 'low');
  assert.ok(drafts[0].reasonCodes.includes('human-override'));
  assert.ok(drafts[0].evidence.some(item => item.type === 'human-override'));
  assert.ok(drafts[0].evidence.some(item => item.type === 'external-id' && item.kind === 'recording'));
  assert.ok(drafts[0].evidence.some(item => item.type === 'external-id' && item.kind === 'release-group'));
});

test('duas opções plausíveis permanecem ambíguas e não viram escolha de alta confiança', async () => {
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async () => response([
      recording({
        id: 'recording-a',
        title: 'Cancao',
        releases: [{ id: 'release-a', title: 'Album Deluxe' }]
      }),
      recording({
        id: 'recording-b',
        title: 'Cancao',
        releases: [{ id: 'release-b', title: 'Album Remaster' }]
      })
    ])
  });

  const drafts = await analyzer.analyze({
    runId: 'run-ambiguous',
    tracks: [track()],
    providers: gateway()
  });

  assert.ok(drafts.length > 0);
  assert.ok(drafts.every(draft => draft.confidence === 'low'));
  assert.ok(drafts.every(draft => draft.reasonCodes.includes('ambiguous-candidates')));
});

test('contexto de álbum converge entre faixas e consultas equivalentes reutilizam cache', async () => {
  let calls = 0;
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async () => {
      calls += 1;
      return response([recording({
        title: 'Cancao',
        releases: [{
          id: 'release-shared',
          title: 'Album Deluxe',
          'release-group': { id: 'group-shared' },
          'artist-credit': [{ name: 'Artista', artist: { id: 'artist-1', name: 'Artista' } }]
        }]
      })]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-album',
    tracks: [track({ id: 'track-1' }), track({ id: 'track-2' })],
    providers: gateway()
  });

  assert.equal(calls, 1);
  assert.ok(drafts.some(draft => draft.reasonCodes.includes('album-context')));
  assert.ok(drafts.some(draft => draft.evidence.some(item => item.type === 'album-context' && item.matchedTracks === 2)));
});

test('resposta inválida do provider falha de forma controlada antes de virar candidato', async () => {
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async () => new Response('{invalid-json', { status: 200 })
  });

  await assert.rejects(
    analyzer.analyze({ runId: 'run-invalid', tracks: [track()], providers: gateway() }),
    error => error instanceof Error && error.name === 'LibraryAssistantProviderResponseError'
  );
});
