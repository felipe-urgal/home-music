import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import { WAVEFORM_ANALYZER_VERSION } from './waveform-analysis.js';

function indexedTrack(id: string, filePath: string, fileSize = 123, mtimeMs = 456): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Rock',
    folderPath: 'Rock',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath,
    mimeType: 'audio/mpeg',
    fileSize,
    mtimeMs
  };
}

test('persiste waveform somente para a assinatura atual e carrega peaks compactados', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-waveform-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const track = indexedTrack('a', '/music/a.mp3');
    db.syncTracks([track], '/music', '2026-09-26T12:00:00.000Z');

    assert.equal(db.saveTrackWaveformAnalysis(
      track.id,
      track.fileSize,
      track.mtimeMs,
      {
        version: WAVEFORM_ANALYZER_VERSION,
        durationSeconds: 3,
        peaks: [0, 0.25, 0.5, 0.75, 1]
      }
    ), true);

    const waveform = db.loadTrackWaveform(track.id);
    assert.ok(waveform);
    assert.equal(waveform.version, WAVEFORM_ANALYZER_VERSION);
    assert.equal(waveform.durationSeconds, 3);
    assert.equal(waveform.peaks.length, 5);
    assert.equal(waveform.peaks[0], 0);
    assert.equal(waveform.peaks[4], 1);
    assert.ok(Math.abs((waveform.peaks[1] ?? 0) - 0.25) < 0.01);

    const loaded = db.loadTracks().find(item => item.id === track.id);
    assert.equal(loaded?.waveformAnalysisCurrent, true);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('waveform obsoleto não é publicado após mudança da assinatura', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-waveform-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const original = indexedTrack('a', '/music/a.mp3');
    db.syncTracks([original], '/music', '2026-09-26T12:00:00.000Z');
    db.saveTrackWaveformAnalysis(
      original.id,
      original.fileSize,
      original.mtimeMs,
      {
        version: WAVEFORM_ANALYZER_VERSION,
        durationSeconds: 1,
        peaks: [0.2, 1]
      }
    );

    const changed = indexedTrack('a', '/music/a.mp3', 999, 1000);
    db.syncTracks([changed], '/music', '2026-09-26T12:01:00.000Z');

    assert.equal(db.loadTrackWaveform(changed.id), null);
    const loaded = db.loadTracks().find(item => item.id === changed.id);
    assert.equal(loaded?.waveformAnalysisCurrent, undefined);
    assert.equal(db.saveTrackWaveformAnalysis(
      changed.id,
      original.fileSize,
      original.mtimeMs,
      {
        version: WAVEFORM_ANALYZER_VERSION,
        durationSeconds: 1,
        peaks: [1]
      }
    ), false);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('schema v15 contém tabela derivada de waveform', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-waveform-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    assert.equal(db.getSchemaVersion(), 15);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
