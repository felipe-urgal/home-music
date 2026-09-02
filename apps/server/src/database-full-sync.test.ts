import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';

function track(id: string, filePath: string): IndexedTrack {
  return {
    id,
    title: id,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Pasta',
    folderPath: 'Pasta',
    duration: 1,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath,
    mimeType: 'audio/mpeg',
    fileSize: 1,
    mtimeMs: 1
  };
}

test('syncTracks preserva full rebuild seguro quando a raiz muda', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-full-sync-'));
  const db = new HomeMusicDatabase(path.join(temp, 'home-music.db'));

  try {
    db.syncTracks(
      [track('old', '/music-old/Pasta/old.mp3')],
      '/music-old',
      '2026-09-02T10:00:00.000Z'
    );

    const replacement = track('new', '/music-new/Pasta/new.mp3');
    const metrics = db.syncTracks(
      [replacement],
      '/music-new',
      '2026-09-02T10:05:00.000Z'
    );

    assert.equal(metrics.mode, 'full');
    assert.equal(metrics.upserted, 1);
    assert.equal(metrics.removed, 1);
    assert.deepEqual(db.loadTracks(), [replacement]);
    assert.equal(db.getMetadata('libraryRoot'), '/music-new');
    assert.equal(db.getMetadata('scannedAt'), '2026-09-02T10:05:00.000Z');
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
