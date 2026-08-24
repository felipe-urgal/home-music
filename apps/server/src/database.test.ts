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
    filePath,
    mimeType: 'audio/mpeg',
    fileSize: 123,
    mtimeMs: 456
  };
}

test('SQLite persiste biblioteca, favoritos, histórico, playlists e estado do player', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-db-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    const first = new HomeMusicDatabase(dbPath);
    const tracks = [
      indexedTrack('a', '/music/Rock/Banda/a.mp3'),
      indexedTrack('b', '/music/Rock/Banda/b.mp3')
    ];

    first.syncTracks(tracks, '/music', '2026-08-24T12:00:00.000Z');
    first.setFavorite('a', true);
    first.recordHistory('a');
    const playlistId = first.createPlaylist('Minha playlist');
    assert.equal(first.setPlaylistTracks(playlistId, ['a', 'b']), true);
    first.savePlaybackState({
      currentTrackId: 'b',
      position: 42.5,
      volume: 0.65,
      shuffle: true,
      repeatMode: 'all',
      baseQueueIds: ['a', 'b'],
      queueIds: ['b', 'a']
    });
    first.close();

    const second = new HomeMusicDatabase(dbPath);
    assert.equal(second.getSchemaVersion(), 2);
    assert.equal(second.getMetadata('libraryRoot'), '/music');
    assert.equal(second.loadTracks().length, 2);
    assert.deepEqual(second.getFavoriteIds(), ['a']);
    assert.equal(second.getHistory()[0].track.id, 'a');
    assert.deepEqual(second.getPlaylists()[0].trackIds, ['a', 'b']);

    const state = second.loadPlaybackState();
    assert.equal(state.currentTrackId, 'b');
    assert.equal(state.position, 42.5);
    assert.equal(state.volume, 0.65);
    assert.equal(state.shuffle, true);
    assert.equal(state.repeatMode, 'all');
    assert.deepEqual(state.baseQueueIds, ['a', 'b']);
    assert.deepEqual(state.queueIds, ['b', 'a']);
    second.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('remoção de faixa limpa relacionamentos por foreign key', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-db-'));
  const db = new HomeMusicDatabase(path.join(temp, 'home-music.db'));

  try {
    const track = indexedTrack('a', '/music/a.mp3');
    db.syncTracks([track], '/music', '2026-08-24T12:00:00.000Z');
    db.setFavorite('a', true);
    db.recordHistory('a');
    const playlistId = db.createPlaylist('Teste');
    db.setPlaylistTracks(playlistId, ['a']);

    db.syncTracks([], '/music', '2026-08-24T13:00:00.000Z');

    assert.deepEqual(db.getFavoriteIds(), []);
    assert.deepEqual(db.getHistory(), []);
    assert.deepEqual(db.getPlaylists()[0].trackIds, []);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('migra schema v1 para v2 sem perder estado existente', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-db-'));
  const dbPath = path.join(temp, 'legacy.db');

  try {
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
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
      INSERT INTO playback_state(
        id, current_track_id, position, volume, shuffle, repeat_mode, queue_json, updated_at
      ) VALUES (1, 'a', 15, 0.5, 1, 'all', '["a"]', '2026-08-24T12:00:00.000Z');
      PRAGMA user_version = 1;
    `);
    legacy.close();

    const migrated = new HomeMusicDatabase(dbPath);
    assert.equal(migrated.getSchemaVersion(), 2);
    const state = migrated.loadPlaybackState();
    assert.equal(state.currentTrackId, 'a');
    assert.equal(state.position, 15);
    assert.deepEqual(state.queueIds, ['a']);
    assert.deepEqual(state.baseQueueIds, []);
    migrated.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
