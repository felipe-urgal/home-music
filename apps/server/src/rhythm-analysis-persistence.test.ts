import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';

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

test('persiste análise rítmica somente para a assinatura atual do arquivo', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-rhythm-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const original = indexedTrack('a', '/music/a.mp3');
    db.syncTracks([original], '/music', '2026-09-25T12:00:00.000Z');

    assert.equal(db.loadTracks()[0]?.rhythm, undefined)
    assert.equal(db.saveTrackRhythmAnalysis(
      original.id,
      original.fileSize,
      original.mtimeMs,
      { bpm: 128, firstBeatSeconds: 0.31, confidence: 0.92 }
    ), true);
    assert.deepEqual(db.loadTracks()[0]?.rhythm, {
      bpm: 128,
      firstBeatSeconds: 0.31,
      confidence: 0.92
    });

    const changed = indexedTrack('a', '/music/a.mp3', 456, 789);
    db.applyTrackDelta(
      { added: [], updated: [changed], removedIds: [] },
      '/music',
      '2026-09-25T12:01:00.000Z'
    );

    assert.equal(db.loadTracks()[0]?.rhythm, undefined)
    assert.equal(db.saveTrackRhythmAnalysis(
      original.id,
      original.fileSize,
      original.mtimeMs,
      { bpm: 128, firstBeatSeconds: 0.31, confidence: 0.92 }
    ), false);
    assert.equal(db.saveTrackRhythmAnalysis(
      changed.id,
      changed.fileSize,
      changed.mtimeMs,
      { bpm: 127.9, firstBeatSeconds: 0.29, confidence: 0.88 }
    ), true);
    assert.deepEqual(db.loadTracks()[0]?.rhythm, {
      bpm: 127.9,
      firstBeatSeconds: 0.29,
      confidence: 0.88
    });
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('remoção da faixa remove análise rítmica derivada por cascade', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-rhythm-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const track = indexedTrack('a', '/music/a.mp3');
    db.syncTracks([track], '/music', '2026-09-25T12:00:00.000Z');
    db.saveTrackRhythmAnalysis(
      track.id,
      track.fileSize,
      track.mtimeMs,
      { bpm: 120, firstBeatSeconds: 0.2, confidence: 0.8 }
    );

    db.syncTracks([], '/music', '2026-09-25T12:02:00.000Z');

    const raw = new DatabaseSync(dbPath);
    try {
      const row = raw.prepare('SELECT COUNT(*) AS count FROM track_rhythm_analysis').get() as { count: number };
      assert.equal(Number(row.count), 0);
    } finally {
      raw.close();
    }
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('schema novo contém tabela derivada de análise rítmica', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-rhythm-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    assert.equal(db.getSchemaVersion(), 13);
    const raw = new DatabaseSync(dbPath);
    try {
      const row = raw.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'track_rhythm_analysis'
      `).get() as { name?: string } | undefined;
      assert.equal(row?.name, 'track_rhythm_analysis');
    } finally {
      raw.close();
    }
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
