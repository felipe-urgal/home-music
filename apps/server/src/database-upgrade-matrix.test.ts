import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import { OpenSubsonicCredentialStore } from './open-subsonic-credentials.js';
import { CURRENT_SCHEMA_VERSION } from './sqlite-settings.js';
import { TrackLyricsOverrideStore } from './track-lyrics-overrides.js';

// Versões anteriores a v12 já possuem testes específicos: v1/v4/v8/v10/v11.
// Estas fixtures são snapshots isolados do schema vigente com DDL posterior removido.
// Não representam backups históricos nem alteram arquivos de produção.
const HISTORICAL_VERSIONS = [12, 14, 16, 18, 19, CURRENT_SCHEMA_VERSION] as const;
const USER_A = 'matrix-user-a';
const USER_B = 'matrix-user-b';
const SCANNED_AT = '2026-09-01T10:00:00.000Z';

function track(id: string): IndexedTrack {
  return {
    id, filePath: '/music/' + id + '.mp3', title: 'Faixa ' + id,
    artist: 'Artista', album: 'Álbum', albumArtist: 'Artista',
    folder: 'Matriz', folderPath: 'Matriz', duration: 180, format: 'MP3',
    hasCover: false, replayGainTrackDb: null, replayGainAlbumDb: null,
    mimeType: 'audio/mpeg', fileSize: 123, mtimeMs: 456
  };
}

function insertUser(db: DatabaseSync, id: string) {
  db.prepare(
    'INSERT INTO users(id, username, username_normalized, password_hash, role, enabled, password_must_change, created_at, updated_at, password_changed_at) ' +
    "VALUES (?, ?, ?, ?, 'user', 1, 0, ?, ?, NULL)"
  ).run(id, id, id, 'test-hash-' + id, SCANNED_AT, SCANNED_AT);
}

function personalSnapshot(db: HomeMusicDatabase) {
  const account = (userId: string) => ({
    favorites: db.getFavoriteIds(userId),
    history: db.getHistory(userId),
    playlists: db.getPlaylists(userId),
    playback: db.loadPlaybackState(userId)
  });
  return {
    tracks: db.loadTracks().map(item => item.id).sort(),
    libraryRoot: db.getMetadata('libraryRoot'),
    scannedAt: db.getMetadata('scannedAt'),
    a: account(USER_A),
    b: account(USER_B)
  };
}

function assertIntegrity(db: DatabaseSync) {
  assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}

function physicalSchemaAtVersion(db: DatabaseSync, version: number) {
  db.exec('PRAGMA foreign_keys = ON;');
  // Estas migrations só criam tabelas ou adicionam colunas opcionais.
  // Não tocar em users, playlists, history, playback, OpenSubsonic ou lyrics.
  if (version < 20) {
    db.exec('ALTER TABLE track_hot_cues DROP COLUMN labels_json;');
    db.exec('ALTER TABLE track_hot_cues DROP COLUMN colors_json;');
  }
  if (version < 19) db.exec('DROP TABLE track_key_analysis;');
  if (version < 18) db.exec('DROP TABLE track_hot_cues;');
  if (version < 17) db.exec('DROP TABLE track_rhythm_overrides;');
  if (version < 16) db.exec('ALTER TABLE track_rhythm_analysis DROP COLUMN beat_grid_json;');
  if (version < 15) db.exec('DROP TABLE track_waveform_analysis;');
  if (version < 14) {
    db.exec('ALTER TABLE track_rhythm_analysis DROP COLUMN downbeat_confidence;');
    db.exec('ALTER TABLE track_rhythm_analysis DROP COLUMN beats_per_bar;');
    db.exec('ALTER TABLE track_rhythm_analysis DROP COLUMN downbeat_seconds;');
  }
  if (version < 13) db.exec('DROP TABLE track_rhythm_analysis;');
  db.exec('PRAGMA user_version = ' + version + ';');
  assertIntegrity(db);
}

test('upgrade matrix v12/v14/v16/v18/v19/v20 preserves users, personal data, API keys and lyrics', async t => {
  for (const version of HISTORICAL_VERSIONS) {
    await t.test('SQLite v' + version + ' → v' + CURRENT_SCHEMA_VERSION, async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-db-upgrade-matrix-'));
      const databasePath = path.join(directory, 'home-music.db');
      try {
        const original = new HomeMusicDatabase(databasePath);
        let expected: ReturnType<typeof personalSnapshot>;
        try {
          const raw = new DatabaseSync(databasePath);
          try {
            raw.exec('PRAGMA foreign_keys = ON;');
            insertUser(raw, USER_A);
            insertUser(raw, USER_B);
          } finally {
            raw.close();
          }
          original.syncTracks([track('song-a'), track('song-b')], '/music', SCANNED_AT);
          original.setFavorite(USER_A, 'song-a', true);
          original.setFavorite(USER_B, 'song-b', true);
          original.recordHistory(USER_A, 'song-a', SCANNED_AT);
          original.recordHistory(USER_B, 'song-b', SCANNED_AT);
          const playlistA = original.createPlaylist(USER_A, 'Pessoal A');
          const playlistB = original.createPlaylist(USER_B, 'Pessoal B');
          assert.equal(original.setPlaylistTracks(USER_A, playlistA, ['song-a']), true);
          assert.equal(original.setPlaylistTracks(USER_B, playlistB, ['song-b']), true);
          original.savePlaybackState(USER_A, {
            currentTrackId: 'song-a', position: 32, volume: 0.5,
            shuffle: true, repeatMode: 'all', wasPlaying: false,
            baseQueueIds: ['song-a'], queueIds: ['song-a']
          });
          original.savePlaybackState(USER_B, {
            currentTrackId: 'song-b', position: 63, volume: 0.7,
            shuffle: false, repeatMode: 'one', wasPlaying: true,
            baseQueueIds: ['song-b'], queueIds: ['song-b']
          });
          expected = personalSnapshot(original);
        } finally {
          original.close();
        }

        const tokens = new Map<string, string>();
        const credentials = new OpenSubsonicCredentialStore(databasePath);
        try {
          for (const id of [USER_A, USER_B]) {
            const created = credentials.create(id, 'Cliente ' + id);
            assert.ok(created);
            tokens.set(id, created.token);
            assert.equal(credentials.authenticate(created.token)?.user.id, id);
          }
        } finally {
          credentials.close();
        }

        const lyrics = new TrackLyricsOverrideStore(databasePath);
        let expectedLyrics: ReturnType<TrackLyricsOverrideStore['get']>;
        try {
          assert.ok(lyrics.save('song-a', {
            mode: 'plain', text: 'Letra persistida',
            origin: 'manual', provider: null, externalId: null, language: 'pt-BR'
          }));
          expectedLyrics = lyrics.get('song-a');
        } finally {
          lyrics.close();
        }

        const snapshot = new DatabaseSync(databasePath);
        let schemaCookie: number;
        try {
          physicalSchemaAtVersion(snapshot, version);
          schemaCookie = (snapshot.prepare('PRAGMA schema_version').get() as { schema_version: number }).schema_version;
        } finally {
          snapshot.close();
        }

        for (let reopening = 0; reopening < 2; reopening++) {
          const upgraded = new HomeMusicDatabase(databasePath);
          try {
            assert.equal(upgraded.getSchemaVersion(), CURRENT_SCHEMA_VERSION);
            assert.deepEqual(personalSnapshot(upgraded), expected);
            assert.deepEqual(upgraded.getFavoriteIds(USER_A), ['song-a']);
            assert.deepEqual(upgraded.getFavoriteIds(USER_B), ['song-b']);
            assert.deepEqual(upgraded.getPlaylists(USER_A).flatMap(item => item.trackIds), ['song-a']);
            assert.deepEqual(upgraded.getPlaylists(USER_B).flatMap(item => item.trackIds), ['song-b']);
          } finally {
            upgraded.close();
          }

          const currentKeys = new OpenSubsonicCredentialStore(databasePath);
          try {
            assert.equal(currentKeys.list(USER_A).length, 1);
            assert.equal(currentKeys.list(USER_B).length, 1);
            for (const [userId, token] of tokens) {
              assert.equal(currentKeys.authenticate(token)?.user.id, userId);
            }
          } finally {
            currentKeys.close();
          }

          const currentLyrics = new TrackLyricsOverrideStore(databasePath);
          try {
            assert.deepEqual(currentLyrics.get('song-a'), expectedLyrics);
            assert.equal(currentLyrics.get('song-b'), null);
          } finally {
            currentLyrics.close();
          }

          const verify = new DatabaseSync(databasePath);
          try {
            assertIntegrity(verify);
            assert.equal((verify.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, CURRENT_SCHEMA_VERSION);
            if (version === CURRENT_SCHEMA_VERSION) {
              assert.equal(
                (verify.prepare('PRAGMA schema_version').get() as { schema_version: number }).schema_version,
                schemaCookie,
                'reabrir versão vigente não deve reaplicar DDL'
              );
            }
          } finally {
            verify.close();
          }
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
