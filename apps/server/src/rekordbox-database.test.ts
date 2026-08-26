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
    title: `Track ${id}`,
    artist: 'DJ',
    album: 'Set',
    albumArtist: 'DJ',
    folder: 'DJ',
    folderPath: 'DJ',
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

function insertUser(databasePath: string) {
  const raw = new DatabaseSync(databasePath);
  const now = '2026-08-26T10:00:00.000Z';
  try {
    raw.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, 'user', 'user', 'hash-user', 'admin', 1, 0, ?, ?, ?)
    `).run(USER_ID, now, now, now);
  } finally {
    raw.close();
  }
}

test('reimportação Rekordbox é idempotente, não destrutiva e não altera playlists manuais', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-rekordbox-db-'));
  const databasePath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(databasePath);

  try {
    insertUser(databasePath);
    db.syncTracks([indexedTrack('a'), indexedTrack('b'), indexedTrack('c')], '/music', '2026-08-25T12:00:00.000Z');
    const manualId = db.createPlaylist(USER_ID, 'Manual');
    db.setPlaylistTracks(USER_ID, manualId, ['c']);

    const first = db.syncImportedPlaylists('rekordbox', [
      { sourceKey: 'House\u001fWarmup', name: 'House / Warmup', trackIds: ['a', 'b'] },
      { sourceKey: 'House\u001fPeak', name: 'House / Peak', trackIds: ['b'] }
    ]);
    assert.deepEqual(first, { createdPlaylists: 2, updatedPlaylists: 0, removedPlaylists: 0 });

    const importedBefore = db.getPlaylists(USER_ID).filter(playlist => playlist.source === 'rekordbox');
    assert.equal(importedBefore.length, 2);
    const warmupId = importedBefore.find(playlist => playlist.name === 'House / Warmup')?.id;
    assert.ok(warmupId);

    const second = db.syncImportedPlaylists('rekordbox', [
      { sourceKey: 'House\u001fWarmup', name: 'House / Warmup atualizado', trackIds: ['b', 'a', 'b'] },
      { sourceKey: 'House\u001fNew', name: 'House / New', trackIds: ['c'] }
    ]);
    assert.deepEqual(second, { createdPlaylists: 1, updatedPlaylists: 1, removedPlaylists: 0 });

    const playlists = db.getPlaylists(USER_ID);
    const manual = playlists.find(playlist => playlist.id === manualId);
    assert.ok(manual);
    assert.equal(manual.source, 'manual');
    assert.deepEqual(manual.trackIds, ['c']);

    const warmup = playlists.find(playlist => playlist.name === 'House / Warmup atualizado');
    assert.ok(warmup);
    assert.equal(warmup.id, warmupId);
    assert.equal(warmup.source, 'rekordbox');
    assert.deepEqual(warmup.trackIds, ['b', 'a']);

    const omittedFromPartialImport = playlists.find(playlist => playlist.name === 'House / Peak');
    assert.ok(omittedFromPartialImport);
    assert.equal(omittedFromPartialImport.source, 'rekordbox');
    assert.deepEqual(omittedFromPartialImport.trackIds, ['b']);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
