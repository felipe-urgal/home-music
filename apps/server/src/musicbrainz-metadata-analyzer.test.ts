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

function response(recordings: unknown[], status = 200) {
  return new Response(JSON.stringify({ recordings }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function caaResponse(images: unknown[] = []) {
  return new Response(JSON.stringify({ images }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function isCaaRequest(input: string | URL) {
  return new URL(String(input)).origin === 'https://coverartarchive.org';
}

test('normaliza somente campos MusicBrainz necessários, mantém ids com escopo e é idempotente no cache', () => {
  const normalized = normalizeMusicBrainzRecordingSearch({
    recordings: [recording({ ignored: { raw: 'não persistir' } })]
  });

  assert.deepEqual(normalized, [{
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
  }]);
  assert.deepEqual(normalizeMusicBrainzRecordingSearch(normalized), normalized);
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
  let musicBrainzCalls = 0;
  let coverArtArchiveCalls = 0;
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      if (isCaaRequest(input)) {
        coverArtArchiveCalls += 1;
        return caaResponse();
      }
      musicBrainzCalls += 1;
      return response([recording()]);
    },
    getHumanOverrideFields: () => ['title']
  });

  const drafts = await analyzer.analyze({
    runId: 'run-1',
    tracks: [track()],
    providers: gateway()
  });

  assert.equal(musicBrainzCalls, 1);
  assert.equal(coverArtArchiveCalls, 1);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].target.capability, 'metadata');
  assert.equal(drafts[0].target.field, 'title');
  assert.equal(drafts[0].confidence, 'low');
  assert.ok(drafts[0].reasonCodes.includes('human-override'));
  assert.ok(drafts[0].evidence.some(item => item.type === 'human-override'));
  assert.ok(drafts[0].evidence.some(item => item.type === 'external-id' && item.kind === 'recording'));
  assert.ok(drafts[0].evidence.some(item => item.type === 'external-id' && item.kind === 'release-group'));
});

test('analyzer propõe capa CAA somente depois de identificação MusicBrainz confiável', async () => {
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      if (isCaaRequest(input)) {
        return caaResponse([{
          id: 'cover-1',
          front: true,
          image: 'https://coverartarchive.org/release/release-1/front',
          thumbnails: { 500: 'https://coverartarchive.org/release/release-1/500' }
        }]);
      }
      return response([recording()]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-artwork',
    tracks: [track()],
    providers: gateway()
  });

  const artwork = drafts.find(draft => draft.target.capability === 'artwork');
  assert.ok(artwork && artwork.target.capability === 'artwork');
  assert.equal(artwork.capability, 'artwork');
  assert.equal(artwork.confidence, 'high');
  assert.equal(artwork.provenance.source, 'cover-art-archive');
  assert.ok(artwork.reasonCodes.includes('artwork-missing'));
  assert.ok(artwork.reasonCodes.includes('strong-external-id'));
  assert.equal(artwork.target.sourceUrl, 'https://coverartarchive.org/release/release-1/front');
  assert.equal(artwork.target.thumbnailUrl, 'https://coverartarchive.org/release/release-1/500');
  assert.equal(artwork.target.musicBrainzReleaseId, 'release-1');
  assert.equal(artwork.target.musicBrainzReleaseGroupId, 'release-group-1');

  const withPhysicalCover = await analyzer.analyze({
    runId: 'run-artwork-skip',
    tracks: [track({ hasCover: true, coverVersion: 'physical-v1' })],
    providers: gateway()
  });
  assert.equal(withPhysicalCover.some(draft => draft.target.capability === 'artwork'), false);
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

test('contexto de álbum converge entre faixas e consultas equivalentes reutilizam cache normalizado', async () => {
  let musicBrainzCalls = 0;
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      if (isCaaRequest(input)) return caaResponse();
      musicBrainzCalls += 1;
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

  assert.equal(musicBrainzCalls, 1);
  assert.ok(drafts.some(draft => draft.reasonCodes.includes('album-context')));
  assert.ok(drafts.some(draft => draft.evidence.some(
    item => item.type === 'album-context' && item.matchedTracks === 2 && item.totalTracks === 2
  )));
});

test('busca faz uma única consulta por título + artista e usa álbum apenas no ranking local', async () => {
  const queries: string[] = [];
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      if (isCaaRequest(input)) return caaResponse();
      const url = new URL(String(input));
      queries.push(url.searchParams.get('query') ?? '');
      return response([recording({
        title: 'Cancao',
        releases: [{ id: 'release-right', title: 'Album Correto' }]
      })]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-single-search',
    tracks: [track({ album: 'Album Errado' })],
    providers: gateway()
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0], /recording:/);
  assert.match(queries[0], /artist:/);
  assert.doesNotMatch(queries[0], /release:/);
  assert.ok(drafts.some(draft => draft.target.capability === 'metadata' && draft.target.field === 'album'));
});

test('resposta vazia com álbum não repete a mesma consulta externa', async () => {
  let calls = 0;
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async () => {
      calls += 1;
      return response([]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-empty-single-search',
    tracks: [track({ album: 'Album conhecido' })],
    providers: gateway()
  });

  assert.equal(calls, 1);
  assert.deepEqual(drafts, []);
});

test('metadata ausente pode usar filename seguro como apoio sem enviar path ou elevar confiança', async () => {
  const requests: URL[] = [];
  const analyzer = createMusicBrainzMetadataAnalyzer({
    getFileContext: () => ({ fileName: 'Artista - Cancao.flac', folderName: 'Album' }),
    fetchImpl: async input => {
      const url = new URL(String(input));
      requests.push(url);
      return response([recording()]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-file-context',
    tracks: [track({
      title: 'Unknown Title',
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      albumArtist: 'Unknown Artist'
    })],
    providers: gateway()
  });

  assert.ok(requests.length >= 1);
  assert.ok(requests.every(url => url.origin === 'https://musicbrainz.org'));
  assert.ok(requests.every(url => !url.toString().includes('.flac')));
  assert.ok(requests.every(url => !url.toString().includes('Artista%20-%20Cancao')));
  assert.ok(drafts.length >= 3);
  assert.ok(drafts.every(draft => draft.confidence === 'low'));
  assert.ok(drafts.every(draft => draft.reasonCodes.includes('metadata-missing')));
  assert.ok(drafts.every(draft => draft.evidence.some(
    item => item.type === 'file-context' && item.fileName === 'Artista - Cancao.flac'
  )));
});

test('filename enganoso ou sem estrutura conservadora não dispara consulta externa', async () => {
  let calls = 0;
  const analyzer = createMusicBrainzMetadataAnalyzer({
    getFileContext: () => ({ fileName: 'final-master-v7.flac', folderName: 'Downloads' }),
    fetchImpl: async () => {
      calls += 1;
      return response([recording()]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-misleading-file',
    tracks: [track({ title: 'Unknown Title', artist: 'Unknown Artist' })],
    providers: gateway()
  });

  assert.equal(calls, 0);
  assert.deepEqual(drafts, []);
});

test('outlier com conflito forte não é forçado pelo contexto coletivo do álbum', async () => {
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      if (isCaaRequest(input)) return caaResponse();
      const query = new URL(String(input)).searchParams.get('query') ?? '';
      if (query.includes('Faixa 3')) {
        return response([recording({
          id: 'recording-3-wrong',
          title: 'Outra Faixa',
          releases: [{ id: 'release-shared', title: 'Album Deluxe' }]
        })]);
      }
      const title = query.includes('Faixa 2') ? 'Faixa 2' : 'Faixa 1';
      return response([recording({
        id: title === 'Faixa 1' ? 'recording-1' : 'recording-2',
        title,
        releases: [{ id: 'release-shared', title: 'Album Deluxe' }]
      })]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-outlier',
    tracks: [
      track({ id: 'track-1', title: 'Faixa 1' }),
      track({ id: 'track-2', title: 'Faixa 2' }),
      track({ id: 'track-3', title: 'Faixa 3' })
    ],
    providers: gateway()
  });

  assert.ok(drafts.some(draft => draft.reasonCodes.includes('album-context')));
  assert.equal(drafts.some(draft => draft.target.trackId === 'track-3'), false);
});

test('resposta vazia é segura e rate limit externo é recuperável sem mutação silenciosa', async () => {
  const empty = createMusicBrainzMetadataAnalyzer({ fetchImpl: async () => response([]) });
  assert.deepEqual(await empty.analyze({ runId: 'run-empty', tracks: [track()], providers: gateway() }), []);

  const rateLimited = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async () => new Response('', { status: 429 })
  });
  await assert.rejects(
    rateLimited.analyze({ runId: 'run-rate-limit', tracks: [track()], providers: gateway() }),
    error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'provider-rate-limited')
  );
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
