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
  findMusicBrainzArtworkCandidates,
  findMusicBrainzImportMetadataEnrichment,
  needsMusicBrainzEnrichment,
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

test('triagem local seleciona faixas com metadados inválidos ou capa ausente', () => {
  assert.equal(needsMusicBrainzEnrichment(track({ hasCover: true })), false);
  assert.equal(needsMusicBrainzEnrichment(track({ hasCover: false })), true);
  assert.equal(needsMusicBrainzEnrichment(track({ hasCover: true, artist: 'Artista desconhecido' })), true);
  assert.equal(needsMusicBrainzEnrichment(track({ hasCover: true, album: 'Unknown Album' })), true);
  assert.equal(needsMusicBrainzEnrichment(track({ hasCover: true, albumArtist: '' })), true);
  assert.equal(needsMusicBrainzEnrichment(track({ hasCover: true, title: 'Título desconhecido' })), true);
});

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
  assert.equal(coverArtArchiveCalls, 2);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].target.capability, 'metadata');
  assert.equal(drafts[0].target.field, 'title');
  assert.equal(drafts[0].confidence, 'low');
  assert.ok(drafts[0].reasonCodes.includes('human-override'));
  assert.ok(drafts[0].evidence.some(item => item.type === 'human-override'));
  assert.ok(drafts[0].evidence.some(item => item.type === 'external-id' && item.kind === 'recording'));
  assert.ok(drafts[0].evidence.some(item => item.type === 'external-id' && item.kind === 'release-group'));
});

test('busca manual retorna uma lista de capas para a faixa selecionada', async () => {
  const fetchImpl = async (input: string | URL) => {
    const url = new URL(String(input));
    if (isCaaRequest(input)) {
      const releaseId = url.pathname.split('/').filter(Boolean).at(-1) ?? 'release';
      return caaResponse([{
        id: `cover-${releaseId}`,
        front: true,
        image: `https://coverartarchive.org/release/${releaseId}/front`,
        thumbnails: { 500: `https://coverartarchive.org/release/${releaseId}/500` }
      }]);
    }
    return response([recording({
      releases: [
        {
          id: 'release-1',
          title: 'Album',
          'release-group': { id: 'release-group-1' },
          'artist-credit': [{ name: 'Artista', artist: { id: 'artist-1', name: 'Artista' } }]
        },
        {
          id: 'release-2',
          title: 'Album',
          'release-group': { id: 'release-group-2' },
          'artist-credit': [{ name: 'Artista', artist: { id: 'artist-1', name: 'Artista' } }]
        }
      ]
    })]);
  };

  const candidates = await findMusicBrainzArtworkCandidates(
    track(),
    gateway(),
    { fetchImpl }
  );

  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map(candidate => candidate.musicBrainzReleaseId),
    ['release-1', 'release-2']
  );
  assert.ok(candidates.every(candidate => candidate.thumbnailUrl?.endsWith('/500')));
  assert.ok(candidates.every(candidate => candidate.album === 'Album'));
});

test('busca manual cai para outras edições da mesma gravação quando o álbum exato não tem capa', async () => {
  const queries: string[] = [];
  const caaPaths: string[] = [];

  const fetchImpl = async (input: string | URL) => {
    const url = new URL(String(input));
    if (isCaaRequest(input)) {
      caaPaths.push(url.pathname);
      if (url.pathname === '/release/release-original') {
        return caaResponse([{
          id: 'cover-original',
          front: true,
          image: 'https://coverartarchive.org/release/release-original/front',
          thumbnails: { 500: 'https://coverartarchive.org/release/release-original/500' }
        }]);
      }
      return caaResponse();
    }

    const query = url.searchParams.get('query') ?? '';
    queries.push(query);

    const baseRecording = {
      id: 'recording-construcao',
      title: 'Construção',
      length: 180_500,
      'artist-credit': [{
        name: 'Chico Buarque',
        artist: { id: 'artist-chico', name: 'Chico Buarque' }
      }]
    };

    if (/release:/.test(query)) {
      return response([recording({
        ...baseRecording,
        releases: [{
          id: 'release-aquarela',
          title: 'Aquarela do Brasil',
          'release-group': { id: 'group-aquarela' },
          'artist-credit': [{
            name: 'Chico Buarque',
            artist: { id: 'artist-chico', name: 'Chico Buarque' }
          }]
        }]
      })]);
    }

    return response([recording({
      ...baseRecording,
      releases: [
        {
          id: 'release-aquarela',
          title: 'Aquarela do Brasil',
          'release-group': { id: 'group-aquarela' },
          'artist-credit': [{
            name: 'Chico Buarque',
            artist: { id: 'artist-chico', name: 'Chico Buarque' }
          }]
        },
        {
          id: 'release-original',
          title: 'Construção',
          'release-group': { id: 'group-original' },
          'artist-credit': [{
            name: 'Chico Buarque',
            artist: { id: 'artist-chico', name: 'Chico Buarque' }
          }]
        }
      ]
    })]);
  };

  const candidates = await findMusicBrainzArtworkCandidates(
    track({
      title: 'Construção',
      artist: 'Chico Buarque',
      album: 'Aquarela do Brasil',
      albumArtist: 'Chico Buarque'
    }),
    gateway(),
    { fetchImpl }
  );

  assert.equal(queries.length, 2);
  assert.match(queries[0], /release:"Aquarela do Brasil"/);
  assert.doesNotMatch(queries[1], /release:/);
  assert.deepEqual(
    candidates.map(candidate => ({
      releaseId: candidate.musicBrainzReleaseId,
      album: candidate.album,
      artist: candidate.artist
    })),
    [{
      releaseId: 'release-original',
      album: 'Construção',
      artist: 'Chico Buarque'
    }]
  );
  assert.equal(caaPaths.filter(path => path === '/release/release-aquarela').length, 1);
  assert.ok(caaPaths.includes('/release-group/group-aquarela'));
  assert.ok(caaPaths.includes('/release/release-original'));
});


test('busca manual aceita versão ao vivo com duração diferente sem relaxar artista', async () => {
  let caaCalls = 0;
  const fetchImpl = async (input: string | URL) => {
    const url = new URL(String(input));
    if (isCaaRequest(input)) {
      caaCalls += 1;
      return caaResponse([{
        id: 'cover-skank',
        front: true,
        image: 'https://coverartarchive.org/release/release-skank/front',
        thumbnails: { 500: 'https://coverartarchive.org/release/release-skank/500' }
      }]);
    }

    const query = url.searchParams.get('query') ?? '';
    if (/release:/.test(query)) return response([]);
    return response([recording({
      id: 'recording-vou-deixar',
      title: 'Vou Deixar',
      length: 260_000,
      'artist-credit': [{
        name: 'Skank',
        artist: { id: 'artist-skank', name: 'Skank' }
      }],
      releases: [{
        id: 'release-skank',
        title: 'Cosmotron',
        'release-group': { id: 'group-skank' },
        'artist-credit': [{
          name: 'Skank',
          artist: { id: 'artist-skank', name: 'Skank' }
        }]
      }]
    })]);
  };

  const candidates = await findMusicBrainzArtworkCandidates(
    track({
      title: 'Vou Deixar',
      artist: 'Skank',
      album: 'Luau MTV',
      albumArtist: 'Skank',
      duration: 180
    }),
    gateway(),
    { fetchImpl }
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].musicBrainzReleaseId, 'release-skank');
  assert.equal(caaCalls, 1);
});

test('busca manual aceita título estendido da mesma música', async () => {
  const fetchImpl = async (input: string | URL) => {
    if (isCaaRequest(input)) {
      return caaResponse([{
        id: 'cover-kid-abelha',
        front: true,
        image: 'https://coverartarchive.org/release/release-kid-abelha/front',
        thumbnails: { 500: 'https://coverartarchive.org/release/release-kid-abelha/500' }
      }]);
    }

    const query = new URL(String(input)).searchParams.get('query') ?? '';
    if (/release:/.test(query)) return response([]);
    return response([recording({
      id: 'recording-como-eu-quero',
      title: 'Como eu quero / Os outros',
      length: 245_000,
      'artist-credit': [{
        name: 'Kid Abelha',
        artist: { id: 'artist-kid-abelha', name: 'Kid Abelha' }
      }],
      releases: [{
        id: 'release-kid-abelha',
        title: 'Ao vivo 86',
        'release-group': { id: 'group-kid-abelha' },
        'artist-credit': [{
          name: 'Kid Abelha',
          artist: { id: 'artist-kid-abelha', name: 'Kid Abelha' }
        }]
      }]
    })]);
  };

  const candidates = await findMusicBrainzArtworkCandidates(
    track({
      title: 'Como Eu Quero',
      artist: 'Kid Abelha',
      album: 'Ao Vivo',
      albumArtist: 'Kid Abelha'
    }),
    gateway(),
    { fetchImpl }
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].album, 'Ao vivo 86');
});

test('busca manual tenta segmentos de título composto quando o medley inteiro não existe', async () => {
  const queries: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    if (isCaaRequest(input)) {
      return caaResponse([{
        id: 'cover-lulu',
        front: true,
        image: 'https://coverartarchive.org/release/release-lulu/front',
        thumbnails: { 500: 'https://coverartarchive.org/release/release-lulu/500' }
      }]);
    }

    const query = new URL(String(input)).searchParams.get('query') ?? '';
    queries.push(query);
    if (!query.includes('Toda Forma de Amor') || query.includes('Um Certo Alguém')) {
      return response([]);
    }
    return response([recording({
      id: 'recording-toda-forma',
      title: 'Toda Forma de Amor',
      'artist-credit': [{
        name: 'Lulu Santos',
        artist: { id: 'artist-lulu', name: 'Lulu Santos' }
      }],
      releases: [{
        id: 'release-lulu',
        title: 'Toda Forma de Amor',
        'release-group': { id: 'group-lulu' },
        'artist-credit': [{
          name: 'Lulu Santos',
          artist: { id: 'artist-lulu', name: 'Lulu Santos' }
        }]
      }]
    })]);
  };

  const candidates = await findMusicBrainzArtworkCandidates(
    track({
      title: 'Toda Forma de Amor, Um Certo Alguém, O Último Romântico',
      artist: 'Lulu Santos',
      album: 'Álbum desconhecido',
      albumArtist: 'Artista desconhecido'
    }),
    gateway(),
    { fetchImpl }
  );

  assert.ok(queries.some(query => /recording:"Toda Forma de Amor"/.test(query)));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].musicBrainzReleaseId, 'release-lulu');
});

test('busca manual não oferece capa quando o artista retornado é diferente', async () => {
  let caaCalls = 0;
  const fetchImpl = async (input: string | URL) => {
    if (isCaaRequest(input)) {
      caaCalls += 1;
      return caaResponse([{
        id: 'cover-wrong-artist',
        front: true,
        image: 'https://coverartarchive.org/release/release-wrong-artist/front',
        thumbnails: {}
      }]);
    }

    return response([recording({
      id: 'recording-menina-veneno',
      title: 'Menina Veneno',
      'artist-credit': [{
        name: 'Ritchie',
        artist: { id: 'artist-ritchie', name: 'Ritchie' }
      }],
      releases: [{
        id: 'release-menina-veneno',
        title: 'Vôo de Coração',
        'release-group': { id: 'group-menina-veneno' },
        'artist-credit': [{
          name: 'Ritchie',
          artist: { id: 'artist-ritchie', name: 'Ritchie' }
        }]
      }]
    })]);
  };

  const candidates = await findMusicBrainzArtworkCandidates(
    track({
      title: 'Menina Veneno',
      artist: 'Rita Lee',
      album: 'Álbum desconhecido',
      albumArtist: 'Artista desconhecido'
    }),
    gateway(),
    { fetchImpl }
  );

  assert.deepEqual(candidates, []);
  assert.equal(caaCalls, 0);
});


test('enriquecimento da importação resolve contexto ao vivo e retorna álbum, artista do álbum e capa', async () => {
  const queries: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    const url = new URL(String(input));
    if (isCaaRequest(input)) {
      if (url.pathname === '/release/release-oceano') {
        return caaResponse([{
          id: 'cover-oceano',
          front: true,
          image: 'https://coverartarchive.org/release/release-oceano/front',
          thumbnails: { 500: 'https://coverartarchive.org/release/release-oceano/500' }
        }]);
      }
      return caaResponse();
    }

    const query = url.searchParams.get('query') ?? '';
    queries.push(query);
    if (query.includes('Oceano (Ao Vivo)')) return response([]);
    return response([recording({
      id: 'recording-oceano',
      title: 'Oceano',
      length: 250_000,
      'artist-credit': [{
        name: 'Djavan',
        artist: { id: 'artist-djavan', name: 'Djavan' }
      }],
      releases: [{
        id: 'release-oceano',
        title: 'Ao Vivo',
        'release-group': { id: 'group-oceano' },
        'artist-credit': [{
          name: 'Djavan',
          artist: { id: 'artist-djavan', name: 'Djavan' }
        }]
      }]
    })]);
  };

  const enrichment = await findMusicBrainzImportMetadataEnrichment(
    track({
      title: 'Oceano (Ao Vivo)',
      artist: 'Djavan',
      album: '',
      albumArtist: 'Djavan',
      duration: 245
    }),
    gateway(),
    { fetchImpl }
  );

  assert.ok(queries.some(query => /recording:"Oceano"/.test(query)));
  assert.equal(enrichment.album, 'Ao Vivo');
  assert.equal(enrichment.albumArtist, 'Djavan');
  assert.equal(enrichment.coverCandidates.length, 1);
  assert.equal(enrichment.coverCandidates[0].musicBrainzReleaseId, 'release-oceano');
});


test('enriquecimento recupera artista de título combinado do provider antes do aceite manual', async () => {
  const queries: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    if (isCaaRequest(input)) return caaResponse();
    const query = new URL(String(input)).searchParams.get('query') ?? '';
    queries.push(query);
    if (query.includes('Oceano (Ao Vivo)')) return response([]);
    return response([recording({
      id: 'recording-provider-oceano',
      title: 'Oceano',
      'artist-credit': [{
        name: 'Djavan',
        artist: { id: 'artist-djavan', name: 'Djavan' }
      }],
      releases: [{
        id: 'release-provider-oceano',
        title: 'Ao Vivo',
        'release-group': { id: 'group-provider-oceano' },
        'artist-credit': [{
          name: 'Djavan',
          artist: { id: 'artist-djavan', name: 'Djavan' }
        }]
      }]
    })]);
  };

  const enrichment = await findMusicBrainzImportMetadataEnrichment(
    track({
      title: 'Djavan - Oceano (Ao Vivo)',
      artist: 'Artista desconhecido',
      album: '',
      albumArtist: 'Artista desconhecido'
    }),
    gateway(),
    { fetchImpl }
  );

  assert.ok(queries.some(query => /artist:"Djavan"/.test(query)));
  assert.ok(queries.some(query => /recording:"Oceano"/.test(query)));
  assert.equal(enrichment.album, 'Ao Vivo');
  assert.equal(enrichment.albumArtist, 'Djavan');
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

test('usa release-group quando a edição identificada não tem capa própria', async () => {
  const caaPaths: string[] = [];
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      const url = new URL(String(input));
      if (isCaaRequest(input)) {
        caaPaths.push(url.pathname);
        if (url.pathname.startsWith('/release-group/')) {
          return caaResponse([{
            id: 'cover-group-1',
            front: true,
            image: 'https://coverartarchive.org/release-group/release-group-1/front',
            thumbnails: { 500: 'https://coverartarchive.org/release-group/release-group-1/500' }
          }]);
        }
        return caaResponse();
      }
      return response([recording()]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-artwork-release-group',
    tracks: [track()],
    providers: gateway()
  });

  assert.deepEqual(caaPaths, [
    '/release/release-1',
    '/release-group/release-group-1'
  ]);
  const artwork = drafts.find(draft => draft.target.capability === 'artwork');
  assert.ok(artwork && artwork.target.capability === 'artwork');
  assert.equal(
    artwork.target.sourceUrl,
    'https://coverartarchive.org/release-group/release-group-1/front'
  );
});

test('artwork não exige álbum nem duração compatíveis quando título e artista batem', async () => {
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      if (isCaaRequest(input)) {
        return caaResponse([{
          id: 'cover-title-artist',
          front: true,
          image: 'https://coverartarchive.org/release/release-title-artist/front',
          thumbnails: {}
        }]);
      }
      const query = new URL(String(input)).searchParams.get('query') ?? '';
      if (/release:/.test(query)) return response([]);
      return response([recording({
        id: 'recording-title-artist',
        title: 'Cancao',
        length: 260_000,
        releases: [{
          id: 'release-title-artist',
          title: 'Outro Album',
          'release-group': { id: 'group-title-artist' },
          'artist-credit': [{ name: 'Artista', artist: { id: 'artist-1', name: 'Artista' } }]
        }]
      })]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-title-artist-only',
    tracks: [track({ title: 'Cancao', album: 'Album local', duration: 180 })],
    providers: gateway()
  });

  const artwork = drafts.find(draft => draft.target.capability === 'artwork');
  assert.ok(artwork && artwork.target.capability === 'artwork');
  assert.equal(artwork.confidence, 'high');
  assert.equal(artwork.target.musicBrainzReleaseId, 'release-title-artist');
});

test('cai para busca ampla quando o álbum local não encontra gravação e duração confirma a faixa', async () => {
  let coverArtArchiveCalls = 0;
  const queries: string[] = [];
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      if (isCaaRequest(input)) {
        coverArtArchiveCalls += 1;
        return caaResponse([{
          id: 'cover-original',
          front: true,
          image: 'https://coverartarchive.org/release/release-original/front',
          thumbnails: { 500: 'https://coverartarchive.org/release/release-original/500' }
        }]);
      }
      const query = new URL(String(input)).searchParams.get('query') ?? '';
      queries.push(query);
      if (/release:/.test(query)) return response([]);
      return response([recording({
        id: 'recording-original',
        title: 'Cancao',
        length: 180_200,
        releases: [{
          id: 'release-original',
          title: 'Album Original',
          'release-group': { id: 'release-group-original' },
          'artist-credit': [{ name: 'Artista', artist: { id: 'artist-1', name: 'Artista' } }]
        }]
      })]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-artwork-wrong-album',
    tracks: [track({ title: 'Cancao', album: 'Coletânea local' })],
    providers: gateway()
  });

  assert.equal(queries.length, 2);
  assert.match(queries[0], /release:"Coletânea local"/);
  assert.doesNotMatch(queries[1], /release:/);
  assert.equal(coverArtArchiveCalls, 1);
  const artwork = drafts.find(draft => draft.target.capability === 'artwork');
  assert.ok(artwork && artwork.target.capability === 'artwork');
  assert.equal(artwork.confidence, 'high');
  assert.equal(artwork.target.musicBrainzReleaseId, 'release-original');
});

test('artwork aceita o primeiro release coerente quando título e artista batem mesmo com edições ambíguas', async () => {
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      if (isCaaRequest(input)) {
        return caaResponse([{
          id: 'cover-a',
          front: true,
          image: 'https://coverartarchive.org/release/release-a/front',
          thumbnails: {}
        }]);
      }
      return response([
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
      ]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-ambiguous-artwork',
    tracks: [track()],
    providers: gateway()
  });

  const artwork = drafts.find(draft => draft.target.capability === 'artwork');
  assert.ok(artwork && artwork.target.capability === 'artwork');
  assert.equal(artwork.confidence, 'high');
  assert.ok(artwork.reasonCodes.includes('ambiguous-candidates'));
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

test('busca usa álbum confiável no MusicBrainz antes do ranking e encontra artwork da edição correta', async () => {
  const queries: string[] = [];
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      if (isCaaRequest(input)) {
        return caaResponse([{
          id: 'cover-right',
          front: true,
          image: 'https://coverartarchive.org/release/release-right/front',
          thumbnails: { 500: 'https://coverartarchive.org/release/release-right/500' }
        }]);
      }
      const url = new URL(String(input));
      queries.push(url.searchParams.get('query') ?? '');
      return response([recording({
        title: 'Cancao',
        releases: [{
          id: 'release-right',
          title: 'Album Correto',
          'release-group': { id: 'release-group-right' }
        }]
      })]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-album-aware-search',
    tracks: [track({ album: 'Album Correto' })],
    providers: gateway()
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0], /recording:"Cancao"/);
  assert.match(queries[0], /artist:"Artista"/);
  assert.match(queries[0], /release:"Album Correto"/);
  const artwork = drafts.find(draft => draft.target.capability === 'artwork');
  assert.ok(artwork && artwork.target.capability === 'artwork');
  assert.equal(artwork.target.musicBrainzReleaseId, 'release-right');
});

test('busca ampla vira fallback quando a consulta com álbum não retorna gravações', async () => {
  const queries: string[] = [];
  const analyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: async input => {
      const query = new URL(String(input)).searchParams.get('query') ?? '';
      queries.push(query);
      return response([]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-empty-scoped-search',
    tracks: [track({ album: 'Album conhecido' })],
    providers: gateway()
  });

  assert.equal(queries.length, 2);
  assert.match(queries[0], /release:"Album conhecido"/);
  assert.doesNotMatch(queries[1], /release:/);
  assert.deepEqual(drafts, []);
});

test('metadata ausente pode usar filename seguro como apoio sem enviar path ou elevar confiança', async () => {
  const requests: URL[] = [];
  const analyzer = createMusicBrainzMetadataAnalyzer({
    includeArtwork: false,
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
  assert.ok(requests.every(url => !/\brelease:/.test(url.searchParams.get('query') ?? '')));
  assert.ok(drafts.length >= 3);
  assert.ok(drafts.every(draft => draft.confidence === 'low'));
  assert.ok(drafts.every(draft => draft.reasonCodes.includes('metadata-missing')));
  assert.ok(drafts.every(draft => draft.evidence.some(
    item => item.type === 'file-context' && item.fileName === 'Artista - Cancao.flac'
  )));
});

test('título combinado recupera artista ausente e permite identificar álbum e capa', async () => {
  const queries: string[] = [];
  let coverArtArchiveCalls = 0;
  const analyzer = createMusicBrainzMetadataAnalyzer({
    getFileContext: () => ({
      fileName: 'Legião Urbana - Ainda É Cedo.mp3',
      folderName: 'Rock nacional'
    }),
    fetchImpl: async input => {
      if (isCaaRequest(input)) {
        coverArtArchiveCalls += 1;
        return caaResponse([{
          id: 'cover-legiao',
          front: true,
          image: 'https://coverartarchive.org/release/release-legiao/front',
          thumbnails: { 500: 'https://coverartarchive.org/release/release-legiao/500' }
        }]);
      }
      const query = new URL(String(input)).searchParams.get('query') ?? '';
      queries.push(query);
      return response([recording({
        id: 'recording-legiao',
        title: 'Ainda É Cedo',
        'artist-credit': [{
          name: 'Legião Urbana',
          artist: { id: 'artist-legiao', name: 'Legião Urbana' }
        }],
        releases: [{
          id: 'release-legiao',
          title: 'Legião Urbana',
          'release-group': { id: 'release-group-legiao' },
          'artist-credit': [{
            name: 'Legião Urbana',
            artist: { id: 'artist-legiao', name: 'Legião Urbana' }
          }]
        }]
      })]);
    }
  });

  const drafts = await analyzer.analyze({
    runId: 'run-title-artist',
    tracks: [track({
      title: 'Legião Urbana - Ainda É Cedo',
      artist: 'Artista desconhecido',
      album: 'Álbum desconhecido',
      albumArtist: 'Artista desconhecido',
      folder: 'Rock nacional',
      folderPath: 'Rock nacional'
    })],
    providers: gateway()
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0], /recording:"Ainda É Cedo"/);
  assert.match(queries[0], /artist:"Legião Urbana"/);
  assert.doesNotMatch(queries[0], /Legião Urbana - Ainda É Cedo/);
  assert.equal(coverArtArchiveCalls, 1);

  const metadata = drafts.filter(draft => draft.target.capability === 'metadata');
  assert.ok(metadata.some(draft => (
    draft.target.capability === 'metadata'
    && draft.target.field === 'title'
    && draft.target.suggestedValue === 'Ainda É Cedo'
  )));
  assert.ok(metadata.some(draft => (
    draft.target.capability === 'metadata'
    && draft.target.field === 'artist'
    && draft.target.suggestedValue === 'Legião Urbana'
  )));
  assert.ok(metadata.some(draft => (
    draft.target.capability === 'metadata'
    && draft.target.field === 'album'
    && draft.target.suggestedValue === 'Legião Urbana'
  )));
  assert.ok(metadata.some(draft => (
    draft.target.capability === 'metadata'
    && draft.target.field === 'albumArtist'
    && draft.target.suggestedValue === 'Legião Urbana'
  )));
  assert.ok(metadata.every(draft => draft.reasonCodes.includes('metadata-missing')));
  assert.ok(metadata.every(draft => draft.confidence === 'high'));

  const artwork = drafts.find(draft => draft.target.capability === 'artwork');
  assert.ok(artwork && artwork.target.capability === 'artwork');
  assert.equal(artwork.confidence, 'high');
  assert.equal(artwork.target.musicBrainzReleaseId, 'release-legiao');
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
