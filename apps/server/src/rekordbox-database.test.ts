import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';

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

test('sincronização Rekordbox é idempotente e não altera playlists manuais', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-rekordbox-db-'));
  const db = new HomeMusicDatabase(path.join(temp, 'home-music.db'));

  try {
    db.syncTracks([indexedTrack('a'), indexedTrack('b'), indexedTrack('c')], '/music', '2026-08-25T12:00:00.000Z');
    const manualId = db.createPlaylist('Manual');
    db.setPlaylistTracks(manualId, ['c']);

    const first = db.syncImportedPlaylists('rekordbox', [
      { sourceKey: 'House\u001fWarmup', name: 'House / Warmup', trackIds: ['a', 'b'] },
      { sourceKey: 'House\u001fPeak', name: 'House / Peak', trackIds: ['b'] }
    ]);
    assert.deepEqual(first, { createdPlaylists: 2, updatedPlaylists: 0, removedPlaylists: 0 });

    const importedBefore = db.getPlaylists().filter(playlist => playlist.source === 'rekordbox');
    assert.equal(importedBefore.length, 2);
    const warmupId = importedBefore.find(playlist => playlist.name === 'House / Warmup')?.id;
    assert.ok(warmupId);

    const second = db.syncImportedPlaylists('rekordbox', [
      { sourceKey: 'House\u001fWarmup', name: 'House / Warmup atualizado', trackIds: ['b', 'a', 'b'] },
      { sourceKey: 'House\u001fNew', name: 'House / New', trackIds: ['c'] }
    ]);
    assert.deepEqual(second, { createdPlaylists: 1, updatedPlaylists: 1, removedPlaylists: 1 });

    const playlists = db.getPlaylists();
    const manual = playlists.find(playlist => playlist.id === manualId);
    assert.ok(manual);
    assert.equal(manual.source, 'manual');
    assert.deepEqual(manual.trackIds, ['c']);

    const warmup = playlists.find(playlist => playlist.name === 'House / Warmup atualizado');
    assert.ok(warmup);
    assert.equal(warmup.id, warmupId);
    assert.equal(warmup.source, 'rekordbox');
    assert.deepEqual(warmup.trackIds, ['b', 'a']);
    assert.equal(playlists.some(playlist => playlist.name === 'House / Peak'), false);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
