import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function indexedTrack(id: string): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Playlists',
    folderPath: 'Playlists',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath: `/music/${id}.mp3`,
    mimeType: 'audio/mpeg',
    fileSize: 123,
    mtimeMs: 456
  };
}

test('migration v9 é idempotente quando user_version fica atrasado após o schema já estar aplicado', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-playlist-idempotency-'));
  const databasePath = path.join(directory, 'home-music.db');

  try {
    const database = new HomeMusicDatabase(databasePath);
    const raw = new DatabaseSync(databasePath);
    const now = '2026-08-26T10:00:00.000Z';
    try {
      raw.prepare(`
        INSERT INTO users(
          id, username, username_normalized, password_hash, role, enabled,
          password_must_change, created_at, updated_at, password_changed_at
        ) VALUES (?, 'admin', 'admin', 'hash-admin', 'admin', 1, 0, ?, ?, ?)
      `).run(USER_ID, now, now, now);
    } finally {
      raw.close();
    }

    database.syncTracks([indexedTrack('a')], '/music', '2026-08-26T12:00:00.000Z');
    const manualId = database.createPlaylist(USER_ID, 'Manual');
    assert.equal(database.setPlaylistTracks(USER_ID, manualId, ['a']), true);
    database.syncImportedPlaylists('rekordbox', [
      { sourceKey: 'DJ\u001fShared', name: 'DJ compartilhada', trackIds: ['a'] }
    ]);
    database.close();

    const downgraded = new DatabaseSync(databasePath);
    try {
      downgraded.exec('PRAGMA user_version = 8;');
    } finally {
      downgraded.close();
    }

    const recovered = new HomeMusicDatabase(databasePath);
    assert.equal(recovered.getSchemaVersion(), 10);
    const playlists = recovered.getPlaylists(USER_ID);
    assert.equal(playlists.filter(item => item.source === 'manual').length, 1);
    assert.equal(playlists.filter(item => item.source === 'rekordbox').length, 1);
    assert.deepEqual(playlists.find(item => item.id === manualId)?.trackIds, ['a']);
    recovered.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
