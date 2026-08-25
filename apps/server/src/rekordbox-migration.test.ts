import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';

test('schema v4 migra playlists existentes para origem manual sem perder dados', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-rekordbox-migration-'));
  const dbPath = path.join(temp, 'legacy-v4.db');

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
        mtime_ms REAL NOT NULL,
        replaygain_track_db REAL,
        replaygain_album_db REAL
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
        updated_at TEXT NOT NULL,
        base_queue_json TEXT NOT NULL DEFAULT '[]',
        was_playing INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO tracks(
        id, file_path, title, artist, album, album_artist, folder, folder_path,
        duration, format, has_cover, mime_type, file_size, mtime_ms
      ) VALUES ('a', '/music/a.mp3', 'A', 'DJ', 'Set', 'DJ', 'DJ', 'DJ', 180, 'MP3', 0, 'audio/mpeg', 123, 456);
      INSERT INTO playlists(id, name, created_at, updated_at)
      VALUES ('legacy-playlist', 'Playlist antiga', '2026-08-25T12:00:00.000Z', '2026-08-25T12:00:00.000Z');
      INSERT INTO playlist_tracks(playlist_id, track_id, position)
      VALUES ('legacy-playlist', 'a', 0);
      PRAGMA user_version = 4;
    `);
    legacy.close();

    const migrated = new HomeMusicDatabase(dbPath);
    assert.equal(migrated.getSchemaVersion(), 5);
    const playlists = migrated.getPlaylists();
    assert.equal(playlists.length, 1);
    assert.equal(playlists[0].id, 'legacy-playlist');
    assert.equal(playlists[0].name, 'Playlist antiga');
    assert.deepEqual(playlists[0].trackIds, ['a']);
    assert.equal(playlists[0].source, 'manual');
    migrated.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
