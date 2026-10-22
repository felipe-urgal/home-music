import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readAdminLibraryOverviewRows } from './admin-library-overview-rows.js';
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

const integrity = {
  checkedAt: '2026-08-27T15:00:00.000Z',
  mediaProbe: { available: true, message: null },
  counts: {
    total: 0,
    scannerFailures: 0,
    mediaProbeFailures: 0,
    missingFiles: 0,
    unindexedFiles: 0
  },
  issues: []
};

const deterministicOptions = {
  databaseBytes: 4_096,
  integrity,
  resolveTrack: (item: IndexedTrack) => item,
  isTrackHidden: () => false,
  hasTitleOverride: () => false,
  resolveTitleTagPresent: () => true
};

test('agrega total, armazenamento, integridade e scanner sem inventar problemas', async () => {
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
    integrity,
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
  ], scanner, {
    ...deterministicOptions,
    resolveTitleTagPresent: item => item.id !== 'track-1'
  });

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

test('não confunde título legítimo igual ao nome do arquivo com tag ausente', async () => {
  const overview = await buildAdminLibraryOverview([
    track({ title: 'track' })
  ], scanner, deterministicOptions);

  assert.equal(overview.problems.missingTitle, 0);
  assert.deepEqual(overview.problems.trackIds.missingTitle, []);
});

test('detecta título ausente usando a tag real, inclusive com extensão em caixa alta', async () => {
  const overview = await buildAdminLibraryOverview([
    track({ title: 'track.MP3', filePath: '/music/track.MP3' })
  ], scanner, {
    ...deterministicOptions,
    resolveTitleTagPresent: () => false
  });

  assert.equal(overview.problems.missingTitle, 1);
  assert.deepEqual(overview.problems.trackIds.missingTitle, ['track-1']);
});

test('considera overrides efetivos ao calcular qualidade sem reprovar título já corrigido', async () => {
  const source = track({
    id: 'track-1',
    title: 'track',
    artist: 'Artista desconhecido',
    album: 'Álbum desconhecido',
    hasCover: false
  });
  let titleProbeCalls = 0;

  const overview = await buildAdminLibraryOverview([source], scanner, {
    databaseBytes: 1,
    integrity,
    isTrackHidden: () => false,
    hasTitleOverride: () => true,
    resolveTitleTagPresent: () => {
      titleProbeCalls += 1;
      return false;
    },
    resolveTrack: item => ({
      ...item,
      title: 'Título corrigido',
      artist: 'Artista corrigido',
      album: 'Álbum corrigido',
      hasCover: true
    })
  });

  assert.equal(titleProbeCalls, 0);
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

test('override explícito de título igual ao fallback não é problema', async () => {
  let titleProbeCalls = 0;
  const overview = await buildAdminLibraryOverview([
    track({ title: 'track' })
  ], scanner, {
    ...deterministicOptions,
    hasTitleOverride: () => true,
    resolveTitleTagPresent: () => {
      titleProbeCalls += 1;
      return false;
    }
  });

  assert.equal(titleProbeCalls, 0);
  assert.equal(overview.problems.missingTitle, 0);
  assert.deepEqual(overview.problems.trackIds.missingTitle, []);
});

test('exclui faixas da lixeira das métricas e dos filtros', async () => {
  const overview = await buildAdminLibraryOverview([
    track({ id: 'visible', fileSize: 500, hasCover: false }),
    track({ id: 'trash', title: 'Trash', filePath: '/music/trash.mp3', fileSize: 2_000, hasCover: false })
  ], scanner, {
    ...deterministicOptions,
    isTrackHidden: item => item.id === 'trash'
  });

  assert.deepEqual(overview.tracks, { total: 1 });
  assert.equal(overview.storage.libraryBytes, 500);
  assert.equal(overview.problems.missingCover, 1);
  assert.deepEqual(overview.problems.trackIds.missingCover, ['visible']);
});

test('não permite tamanho negativo contaminar o armazenamento', async () => {
  const overview = await buildAdminLibraryOverview([
    track({ fileSize: -10 }),
    track({ id: 'track-2', title: 'Second', filePath: '/music/second.mp3', fileSize: 500 })
  ], scanner, deterministicOptions);

  assert.equal(overview.storage.libraryBytes, 500);
});

// The production overview consumes the rows read by the existing SQLite owner,
// instead of constructing a separate read-only connection per HTTP request.
test('usa snapshot SQLite do owner e preserva overrides, capas e quarentena', async () => {
  const db = new DatabaseSync(':memory:');
  let rows;
  try {
    db.exec(`
      CREATE TABLE track_metadata_overrides (
        track_id TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT, album_artist TEXT
      );
      CREATE TABLE track_cover_overrides (track_id TEXT PRIMARY KEY);
      CREATE TABLE media_quarantine (track_id TEXT PRIMARY KEY);
      INSERT INTO track_metadata_overrides (track_id, title, artist, album, album_artist)
      VALUES ('edited', 'Título corrigido', NULL, 'Álbum corrigido', NULL);
      INSERT INTO track_cover_overrides (track_id) VALUES ('edited');
      INSERT INTO media_quarantine (track_id) VALUES ('hidden');
    `);
    rows = readAdminLibraryOverviewRows(db);
  } finally {
    db.close();
  }

  const overview = await buildAdminLibraryOverview([
    track({
      id: 'edited', title: 'track', artist: 'Artista desconhecido',
      album: 'Álbum desconhecido', hasCover: false
    }),
    track({
      id: 'hidden', title: 'hidden', filePath: '/music/hidden.mp3',
      hasCover: false, fileSize: 99
    })
  ], scanner, {
    databaseRows: rows,
    databasePath: '/not-a-real-directory/home-music.db',
    databaseBytes: 10,
    integrity,
    resolveTitleTagPresent: () => false
  });

  assert.deepEqual(overview.tracks, { total: 1 });
  assert.equal(overview.storage.libraryBytes, 1_000);
  assert.equal(overview.problems.missingTitle, 0);
  assert.equal(overview.problems.missingCover, 0);
  assert.equal(overview.problems.unknownArtist, 1);
  assert.equal(overview.problems.unknownAlbum, 0);
  assert.deepEqual(overview.problems.trackIds.unknownArtist, ['edited']);
});
