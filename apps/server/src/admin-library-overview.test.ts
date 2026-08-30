import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminLibraryOverview } from './admin-library-overview.js';
import type { IndexedTrack } from './library.js';

function track(overrides: Partial<IndexedTrack> = {}): IndexedTrack {
  return {
    id: 'track-1',
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    albumArtist: 'Artist',
    folder: 'Music',
    folderPath: 'Music',
    duration: 180,
    format: 'MP3',
    hasCover: true,
    filePath: '/music/track.mp3',
    mimeType: 'audio/mpeg',
    fileSize: 1_000,
    mtimeMs: 1,
    ...overrides
  };
}

const scanner = {
  ready: true,
  scanning: false,
  scannedAt: '2026-08-27T15:00:00.000Z',
  autoRescan: { enabled: true, intervalSeconds: 300 }
};

const deterministicOptions = {
  databaseBytes: 4_096,
  resolveTrack: (item: IndexedTrack) => item
};

test('agrega total, armazenamento e scanner sem inventar problemas', async () => {
  const overview = await buildAdminLibraryOverview([
    track(),
    track({ id: 'track-2', title: 'Outra faixa', filePath: '/music/outra-faixa.mp3', fileSize: 2_500 })
  ], scanner, deterministicOptions);

  assert.deepEqual(overview, {
    tracks: { total: 2 },
    storage: { libraryBytes: 3_500, databaseBytes: 4_096 },
    problems: {
      affectedTracks: 0,
      missingTitle: 0,
      missingCover: 0,
      unknownArtist: 0,
      unknownAlbum: 0,
      missingDuration: 0,
      trackIds: {
        missingTitle: [],
        missingCover: [],
        unknownArtist: [],
        unknownAlbum: [],
        missingDuration: []
      }
    },
    scanner
  });
});

test('conta cada problema, expõe ids filtráveis e deduplica faixas afetadas', async () => {
  const overview = await buildAdminLibraryOverview([
    track({
      id: 'track-1',
      title: 'track',
      hasCover: false,
      artist: 'Artista desconhecido',
      album: 'Álbum desconhecido',
      duration: null
    }),
    track({ id: 'track-2', title: 'Second', filePath: '/music/second.mp3', hasCover: false }),
    track({ id: 'track-3', title: 'Third', filePath: '/music/third.mp3', album: 'Álbum desconhecido' })
  ], scanner, deterministicOptions);

  assert.deepEqual(overview.problems, {
    affectedTracks: 3,
    missingTitle: 1,
    missingCover: 2,
    unknownArtist: 1,
    unknownAlbum: 2,
    missingDuration: 1,
    trackIds: {
      missingTitle: ['track-1'],
      missingCover: ['track-1', 'track-2'],
      unknownArtist: ['track-1'],
      unknownAlbum: ['track-1', 'track-3'],
      missingDuration: ['track-1']
    }
  });
});

test('considera overrides efetivos ao calcular qualidade', async () => {
  const source = track({
    id: 'track-1',
    title: 'track',
    artist: 'Artista desconhecido',
    album: 'Álbum desconhecido',
    hasCover: false
  });

  const overview = await buildAdminLibraryOverview([source], scanner, {
    databaseBytes: 1,
    resolveTrack: item => ({
      ...item,
      title: 'Título corrigido',
      artist: 'Artista corrigido',
      album: 'Álbum corrigido',
      hasCover: true
    })
  });

  assert.deepEqual(overview.problems, {
    affectedTracks: 0,
    missingTitle: 0,
    missingCover: 0,
    unknownArtist: 0,
    unknownAlbum: 0,
    missingDuration: 0,
    trackIds: {
      missingTitle: [],
      missingCover: [],
      unknownArtist: [],
      unknownAlbum: [],
      missingDuration: []
    }
  });
});

test('não permite tamanho negativo contaminar o armazenamento', async () => {
  const overview = await buildAdminLibraryOverview([
    track({ fileSize: -10 }),
    track({ id: 'track-2', title: 'Second', filePath: '/music/second.mp3', fileSize: 500 })
  ], scanner, deterministicOptions);

  assert.equal(overview.storage.libraryBytes, 500);
});
