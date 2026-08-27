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

test('agrega total, bytes e scanner sem inventar problemas', () => {
  const overview = buildAdminLibraryOverview([
    track(),
    track({ id: 'track-2', fileSize: 2_500 })
  ], scanner);

  assert.deepEqual(overview, {
    tracks: { total: 2 },
    storage: { libraryBytes: 3_500 },
    problems: {
      affectedTracks: 0,
      missingCover: 0,
      unknownArtist: 0,
      unknownAlbum: 0,
      missingDuration: 0
    },
    scanner
  });
});

test('conta cada problema e deduplica faixas afetadas', () => {
  const overview = buildAdminLibraryOverview([
    track({
      id: 'track-1',
      hasCover: false,
      artist: 'Artista desconhecido',
      album: 'Álbum desconhecido',
      duration: null
    }),
    track({ id: 'track-2', hasCover: false }),
    track({ id: 'track-3', album: 'Álbum desconhecido' })
  ], scanner);

  assert.deepEqual(overview.problems, {
    affectedTracks: 3,
    missingCover: 2,
    unknownArtist: 1,
    unknownAlbum: 2,
    missingDuration: 1
  });
});

test('não permite tamanho negativo contaminar o armazenamento', () => {
  const overview = buildAdminLibraryOverview([
    track({ fileSize: -10 }),
    track({ id: 'track-2', fileSize: 500 })
  ], scanner);

  assert.equal(overview.storage.libraryBytes, 500);
});
