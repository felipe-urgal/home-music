import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';

function indexedTrack(id: string, filePath: string): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Rock',
    folderPath: 'Rock/Banda',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: -7.2,
    replayGainAlbumDb: -5.8,
    filePath,
    mimeType: 'audio/mpeg',
    fileSize: 123,
    mtimeMs: 456
  };
}

function insertUser(databasePath: string, id = 'user-1') {
  const raw = new DatabaseSync(databasePath);
  const now = '2026-08-26T10:00:00.000Z';
  try {
    raw.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, ?, ?, ?, 'admin', 1, 0, ?, ?, ?)
    `).run(id, id, id, `hash-${id}`, now, now, now);
  } finally {
    raw.close();
  }
}

test('SQLite persiste biblioteca, favoritos, histórico, playlists e estado do player', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-db-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    const first = new HomeMusicDatabase(dbPath);
    insertUser(dbPath);
    const tracks = [
      indexedTrack('a', '/music/Rock/Banda/a.mp3'),
      indexedTrack('b', '/music/Rock/Banda/b.mp3')
    ];

    first.syncTracks(tracks, '/music', '2026-08-24T12:00:00.000Z');
    first.setFavorite('user-1', 'a', true);
    first.recordHistory('user-1', 'a');
    const playlistId = first.createPlaylist('user-1', 'Minha playlist');
    assert.equal(first.setPlaylistTracks('user-1', playlistId, ['a', 'b']), true);
    first.savePlaybackState('user-1', {
      currentTrackId: 'b',
      position: 42.5,
      volume: 0.65,
      shuffle: true,
      repeatMode: 'all',
      wasPlaying: true,
      baseQueueIds: ['a', 'b'],
      queueIds: ['b', 'a']
    });
    first.close();

    const second = new HomeMusicDatabase(dbPath);
    assert.equal(second.getSchemaVersion(), 12);
    assert.equal(second.getMetadata('libraryRoot'), '/music');
    assert.equal(second.loadTracks().length, 2);
    assert.equal(second.loadTracks()[0].replayGainTrackDb, -7.2);
    assert.equal(second.loadTracks()[0].replayGainAlbumDb, -5.8);
    assert.deepEqual(second.getFavoriteIds('user-1'), ['a']);
    assert.equal(second.getHistory('user-1')[0].track.id, 'a');
    assert.deepEqual(second.getPlaylists('user-1')[0].trackIds, ['a', 'b']);
    assert.equal(second.getPlaylists('user-1')[0].source, 'manual');

    const state = second.loadPlaybackState('user-1');
    assert.equal(state.currentTrackId, 'b');
    assert.equal(state.position, 42.5);
    assert.equal(state.volume, 0.65);
    assert.equal(state.shuffle, true);
    assert.equal(state.repeatMode, 'all');
    assert.equal(state.wasPlaying, true);
    assert.deepEqual(state.baseQueueIds, ['a', 'b']);
    assert.deepEqual(state.queueIds, ['b', 'a']);
    second.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('remoção de faixa limpa relacionamentos por foreign key', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    insertUser(dbPath);
    const track = indexedTrack('a', '/music/a.mp3');
    db.syncTracks([track], '/music', '2026-08-24T12:00:00.000Z');
    db.setFavorite('user-1', 'a', true);
    db.recordHistory('user-1', 'a');
    const playlistId = db.createPlaylist('user-1', 'Teste');
    db.setPlaylistTracks('user-1', playlistId, ['a']);

    db.syncTracks([], '/music', '2026-08-24T13:00:00.000Z');

    assert.deepEqual(db.getFavoriteIds('user-1'), []);
    assert.deepEqual(db.getHistory('user-1'), []);
    assert.deepEqual(db.getPlaylists('user-1')[0].trackIds, []);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('migra schema v1 para v12 sem perder estado existente', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-db-'));
  const dbPath = path.join(temp, 'legacy.db');

  try {
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        album_artist TEXT NOT NULL,
        folder TEXT NOT NULL,
        folder_path TEXT NOT NULL DEFAULT '',
        duration REAL,
        format TEXT NOT NULL,
        has_cover INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mtime_ms REAL NOT NULL
      );
      CREATE TABLE favorites (
        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        played_at TEXT NOT NULL
      );
      CREATE TABLE playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, position),
        UNIQUE (playlist_id, track_id)
      );
      CREATE TABLE playback_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_track_id TEXT,
        position REAL NOT NULL DEFAULT 0,
        volume REAL NOT NULL DEFAULT 1,
        shuffle INTEGER NOT NULL DEFAULT 0,
        repeat_mode TEXT NOT NULL DEFAULT 'off',
        queue_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
      INSERT INTO tracks(
        id, file_path, title, artist, album, album_artist, folder, folder_path,
        duration, format, has_cover, mime_type, file_size, mtime_ms
      ) VALUES ('a', '/music/a.mp3', 'A', 'Artista', 'Álbum', 'Artista', 'Rock', 'Rock', 180, 'MP3', 0, 'audio/mpeg', 123, 456);
      INSERT INTO playback_state(
        id, current_track_id, position, volume, shuffle, repeat_mode, queue_json, updated_at
      ) VALUES (1, 'a', 15, 0.5, 1, 'all', '["a"]', '2026-08-24T12:00:00.000Z');
      PRAGMA user_version = 1;
    `);
    legacy.close();

    const migrated = new HomeMusicDatabase(dbPath);
    assert.equal(migrated.getSchemaVersion(), 12);
    const state = migrated.loadPlaybackState('user-1');
    assert.equal(state.currentTrackId, null);
    assert.equal(state.position, 0);
    assert.equal(state.wasPlaying, false);
    assert.deepEqual(state.queueIds, []);
    migrated.close();

    const raw = new DatabaseSync(dbPath);
    const usersTable = raw.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'
    `).get() as { name?: string } | undefined;
    assert.equal(usersTable?.name, 'users');
    const favoriteColumns = raw.prepare('PRAGMA table_info(favorites);').all() as Array<{ name?: string }>;
    assert.deepEqual(favoriteColumns.map(column => column.name), ['user_id', 'track_id', 'created_at']);
    const historyColumns = raw.prepare('PRAGMA table_info(history);').all() as Array<{ name?: string }>;
    assert.deepEqual(historyColumns.map(column => column.name), ['id', 'user_id', 'track_id', 'played_at']);
    const playlistColumns = raw.prepare('PRAGMA table_info(playlists);').all() as Array<{ name?: string }>;
    assert.deepEqual(
      playlistColumns.map(column => column.name),
      ['id', 'name', 'created_at', 'updated_at', 'source', 'source_key', 'owner_user_id']
    );
    const playbackColumns = raw.prepare('PRAGMA table_info(playback_state);').all() as Array<{ name?: string }>;
    assert.deepEqual(
      playbackColumns.map(column => column.name),
      [
        'user_id',
        'current_track_id',
        'position',
        'volume',
        'shuffle',
        'repeat_mode',
        'was_playing',
        'base_queue_json',
        'queue_json',
        'updated_at'
      ]
    );
    const pendingState = raw.prepare(`
      SELECT current_track_id, position, volume, shuffle, repeat_mode, was_playing,
             base_queue_json, queue_json, updated_at
      FROM legacy_playback_state_pending
      WHERE id = 1;
    `).get() as Record<string, unknown>;
    assert.equal(pendingState.current_track_id, 'a');
    assert.equal(pendingState.position, 15);
    assert.equal(pendingState.volume, 0.5);
    assert.equal(pendingState.shuffle, 1);
    assert.equal(pendingState.repeat_mode, 'all');
    assert.equal(pendingState.was_playing, 0);
    assert.equal(pendingState.base_queue_json, '[]');
    assert.equal(pendingState.queue_json, '["a"]');
    assert.equal(pendingState.updated_at, '2026-08-24T12:00:00.000Z');
    raw.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('schema v12 preserva identidade única, papéis e flags válidos de users', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-db-'));
  const dbPath = path.join(temp, 'users.db');

  try {
    const db = new HomeMusicDatabase(dbPath);
    assert.equal(db.getSchemaVersion(), 12);
    db.close();

    const raw = new DatabaseSync(dbPath);
    const columns = raw.prepare('PRAGMA table_info(users);').all() as Array<{ name?: string; notnull?: number }>;
    assert.deepEqual(
      columns.map(column => column.name),
      [
        'id',
        'username',
        'username_normalized',
        'password_hash',
        'role',
        'enabled',
        'password_must_change',
        'created_at',
        'updated_at',
        'password_changed_at'
      ]
    );
    assert.equal(columns.find(column => column.name === 'id')?.notnull, 1);

    const insert = raw.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = '2026-08-26T10:00:00.000Z';
    insert.run('user-1', 'Felipe', 'felipe', 'hash-1', 'admin', 1, 0, now, now, null);

    assert.throws(() => {
      insert.run('user-2', 'FELIPE', 'felipe', 'hash-2', 'user', 1, 1, now, now, null);
    });
    assert.throws(() => {
      insert.run('user-3', 'Outro', 'outro', 'hash-3', 'owner', 1, 0, now, now, null);
    });
    assert.throws(() => {
      insert.run('user-4', 'Outro', 'outro-2', 'hash-4', 'user', 2, 0, now, now, null);
    });
    assert.throws(() => {
      insert.run('user-5', 'Outro', 'outro-3', '', 'user', 1, 0, now, now, null);
    });

    const indexes = raw.prepare("PRAGMA index_list('users');").all() as Array<{ name?: string; unique?: number }>;
    assert.equal(indexes.some(index => index.name === 'idx_users_role_enabled'), true);
    assert.equal(indexes.some(index => index.unique === 1), true);
    raw.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('estatísticas agregam somente o histórico do usuário por período', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    insertUser(dbPath);
    const trackA = indexedTrack('a', '/music/a.mp3');
    const trackB = {
      ...indexedTrack('b', '/music/b.mp3'),
      artist: 'Outro artista',
      album: 'Outro álbum',
      albumArtist: 'Outro artista'
    };
    db.syncTracks([trackA, trackB], '/music', '2026-08-25T12:00:00.000Z');

    db.recordHistory('user-1', 'a', '2026-08-24T12:00:00.000Z');
    db.recordHistory('user-1', 'a', '2026-08-25T10:00:00.000Z');
    db.recordHistory('user-1', 'b', '2026-08-25T11:00:00.000Z');
    db.recordHistory('user-1', 'b', '2026-08-10T12:00:00.000Z');

    const recent = db.getStatistics('user-1', '7d', new Date('2026-08-25T12:00:00.000Z'));
    assert.equal(recent.totalPlays, 3);
    assert.equal(recent.totalMinutes, 9);
    assert.equal(recent.uniqueTracks, 2);
    assert.equal(recent.uniqueArtists, 2);
    assert.equal(recent.topTracks[0].track.id, 'a');
    assert.equal(recent.topTracks[0].plays, 2);
    assert.equal(recent.topArtists[0].artist, 'Artista');
    assert.equal(recent.topAlbums.length, 2);

    const all = db.getStatistics('user-1', 'all', new Date('2026-08-25T12:00:00.000Z'));
    assert.equal(all.totalPlays, 4);
    assert.equal(all.totalMinutes, 12);
    assert.equal(all.firstPlayedAt, '2026-08-10T12:00:00.000Z');
    assert.equal(all.historyCapacity, 2_000);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
