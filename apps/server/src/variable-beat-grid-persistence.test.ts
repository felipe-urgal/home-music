import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';

function indexedTrack(): IndexedTrack {
  return {
    id: 'variable-grid-track',
    title: 'Variable Grid',
    artist: 'Test',
    album: 'Test',
    albumArtist: 'Test',
    folder: 'DJ',
    folderPath: 'DJ',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath: '/music/variable-grid.mp3',
    mimeType: 'audio/mpeg',
    fileSize: 123,
    mtimeMs: 456
  };
}

test('persiste e recarrega beat grid variável no schema v16', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-variable-grid-'));
  const db = new HomeMusicDatabase(path.join(temp, 'home-music.db'));

  try {
    const track = indexedTrack();
    db.syncTracks([track], '/music', '2026-09-26T12:00:00.000Z');

    assert.equal(db.saveTrackRhythmAnalysis(
      track.id,
      track.fileSize,
      track.mtimeMs,
      {
        bpm: 120,
        firstBeatSeconds: 0.25,
        confidence: 0.95,
        beatGrid: {
          version: 1,
          segments: [
            { startSeconds: 0, bpm: 118, firstBeatSeconds: 0.25, confidence: 0.9 },
            { startSeconds: 45, bpm: 120, firstBeatSeconds: 45.18, confidence: 0.91 },
            { startSeconds: 90, bpm: 122, firstBeatSeconds: 90.12, confidence: 0.92 }
          ]
        }
      }
    ), true);

    const loaded = db.loadTracks().find(item => item.id === track.id);
    assert.ok(loaded?.rhythm?.beatGrid);
    assert.equal(loaded.rhythm.beatGrid.version, 1);
    assert.deepEqual(
      loaded.rhythm.beatGrid.segments.map(segment => segment.bpm),
      [118, 120, 122]
    );
    assert.equal(db.getSchemaVersion(), 20);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('rejeita beat grid variável inválido', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-variable-grid-'));
  const db = new HomeMusicDatabase(path.join(temp, 'home-music.db'));

  try {
    const track = indexedTrack();
    db.syncTracks([track], '/music', '2026-09-26T12:00:00.000Z');

    assert.throws(() => db.saveTrackRhythmAnalysis(
      track.id,
      track.fileSize,
      track.mtimeMs,
      {
        bpm: 120,
        firstBeatSeconds: 0.25,
        confidence: 0.95,
        beatGrid: {
          version: 1,
          segments: [
            { startSeconds: 30, bpm: 120, firstBeatSeconds: 30, confidence: 0.9 },
            { startSeconds: 10, bpm: 121, firstBeatSeconds: 10, confidence: 0.9 }
          ]
        }
      }
    ), /Análise rítmica inválida/);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
