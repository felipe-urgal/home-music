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
      {
        bpm: 128,
        firstBeatSeconds: 0.31,
        confidence: 0.92,
        downbeatSeconds: 0.31,
        beatsPerBar: 4,
        downbeatConfidence: 0.81
      }
    ), true);
    assert.deepEqual(db.loadTracks()[0]?.rhythm, {
      bpm: 128,
      firstBeatSeconds: 0.31,
      confidence: 0.92,
      downbeatSeconds: 0.31,
      beatsPerBar: 4,
      downbeatConfidence: 0.81
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

test('persiste análise concluída sem ritmo para não repetir trabalho até o arquivo mudar', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-rhythm-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const original = indexedTrack('ambient', '/music/ambient.mp3');
    db.syncTracks([original], '/music', '2026-09-25T12:00:00.000Z');

    assert.equal(db.saveTrackRhythmAnalysis(
      original.id,
      original.fileSize,
      original.mtimeMs,
      null
    ), true);

    const analyzed = db.loadTracks()[0];
    assert.equal(analyzed?.rhythm, undefined);
    assert.equal(analyzed?.rhythmAnalysisCurrent, true);

    const changed = indexedTrack('ambient', '/music/ambient.mp3', 999, 1000);
    db.applyTrackDelta(
      { added: [], updated: [changed], removedIds: [] },
      '/music',
      '2026-09-25T12:03:00.000Z'
    );

    const invalidated = db.loadTracks()[0];
    assert.equal(invalidated?.rhythm, undefined);
    assert.equal(invalidated?.rhythmAnalysisCurrent, undefined);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('troca da raiz da biblioteca invalida análise mesmo com assinatura de arquivo igual', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-rhythm-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const original = indexedTrack('same-id', '/music-a/album/a.mp3');
    db.syncTracks([original], '/music-a', '2026-09-25T12:00:00.000Z');
    assert.equal(db.saveTrackRhythmAnalysis(
      original.id,
      original.fileSize,
      original.mtimeMs,
      { bpm: 120, firstBeatSeconds: 0.2, confidence: 0.9 }
    ), true);

    const replacement = indexedTrack('same-id', '/music-b/album/a.mp3');
    db.syncTracks([replacement], '/music-b', '2026-09-25T12:04:00.000Z');

    const loaded = db.loadTracks()[0];
    assert.equal(loaded?.rhythm, undefined);
    assert.equal(loaded?.rhythmAnalysisCurrent, undefined);
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
    assert.equal(db.getSchemaVersion(), 15);
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


test('migra schema rítmico v13 adicionando campos opcionais de downbeat', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-rhythm-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const legacy = new DatabaseSync(dbPath);

  try {
    legacy.exec(`
      CREATE TABLE track_rhythm_analysis (
        track_id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ready', 'unavailable')),
        bpm REAL,
        first_beat_seconds REAL,
        confidence REAL,
        source TEXT NOT NULL,
        analyzer_version INTEGER NOT NULL,
        source_file_size INTEGER NOT NULL,
        source_mtime_ms REAL NOT NULL,
        analyzed_at TEXT NOT NULL
      );
      PRAGMA user_version = 13;
    `);
  } finally {
    legacy.close();
  }

  const db = new HomeMusicDatabase(dbPath);
  try {
    assert.equal(db.getSchemaVersion(), 15);
    const raw = new DatabaseSync(dbPath);
    try {
      const columns = raw.prepare('PRAGMA table_info(track_rhythm_analysis)').all() as Array<{ name?: string }>;
      const names = columns.map(column => column.name);
      assert.ok(names.includes('downbeat_seconds'));
      assert.ok(names.includes('beats_per_bar'));
      assert.ok(names.includes('downbeat_confidence'));
    } finally {
      raw.close();
    }
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
