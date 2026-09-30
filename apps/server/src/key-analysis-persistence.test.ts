import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { djKeyFromPitchClass } from '@home-music/shared';
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

test('persiste tonalidade somente para a assinatura atual do arquivo', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-key-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const original = indexedTrack('a', '/music/a.mp3');
    db.syncTracks([original], '/music', '2026-09-29T12:00:00.000Z');

    const cMajor = djKeyFromPitchClass(0, 'major', 0.82);
    assert.equal(db.saveTrackKeyAnalysis(
      original.id,
      original.fileSize,
      original.mtimeMs,
      cMajor
    ), true);
    assert.deepEqual(db.loadTracks()[0]?.key, cMajor);
    assert.equal(db.loadTracks()[0]?.keyAnalysisCurrent, true);

    const changed = indexedTrack('a', '/music/a.mp3', 456, 789);
    db.applyTrackDelta(
      { added: [], updated: [changed], removedIds: [] },
      '/music',
      '2026-09-29T12:01:00.000Z'
    );
    assert.equal(db.loadTracks()[0]?.key, undefined);
    assert.equal(db.loadTracks()[0]?.keyAnalysisCurrent, undefined);
    assert.equal(db.saveTrackKeyAnalysis(
      original.id,
      original.fileSize,
      original.mtimeMs,
      cMajor
    ), false);

    const aMinor = djKeyFromPitchClass(9, 'minor', 0.74);
    assert.equal(db.saveTrackKeyAnalysis(
      changed.id,
      changed.fileSize,
      changed.mtimeMs,
      aMinor
    ), true);
    assert.deepEqual(db.loadTracks()[0]?.key, aMinor);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('marca análise tonal indisponível sem repetir trabalho até o arquivo mudar', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-key-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const track = indexedTrack('noise', '/music/noise.mp3');
    db.syncTracks([track], '/music', '2026-09-29T12:00:00.000Z');

    assert.equal(db.saveTrackKeyAnalysis(
      track.id,
      track.fileSize,
      track.mtimeMs,
      null
    ), true);

    const loaded = db.loadTracks()[0];
    assert.equal(loaded?.key, undefined);
    assert.equal(loaded?.keyAnalysisCurrent, true);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('troca da raiz invalida tonalidade derivada e remoção usa cascade', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-key-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const original = indexedTrack('same-id', '/music-a/a.mp3');
    db.syncTracks([original], '/music-a', '2026-09-29T12:00:00.000Z');
    db.saveTrackKeyAnalysis(
      original.id,
      original.fileSize,
      original.mtimeMs,
      djKeyFromPitchClass(4, 'major', 0.9)
    );

    const replacement = indexedTrack('same-id', '/music-b/a.mp3');
    db.syncTracks([replacement], '/music-b', '2026-09-29T12:10:00.000Z');
    assert.equal(db.loadTracks()[0]?.key, undefined);
    assert.equal(db.loadTracks()[0]?.keyAnalysisCurrent, undefined);

    db.saveTrackKeyAnalysis(
      replacement.id,
      replacement.fileSize,
      replacement.mtimeMs,
      djKeyFromPitchClass(4, 'major', 0.9)
    );
    db.syncTracks([], '/music-b', '2026-09-29T12:11:00.000Z');

    const raw = new DatabaseSync(dbPath);
    try {
      const row = raw.prepare('SELECT COUNT(*) AS count FROM track_key_analysis').get() as { count: number };
      assert.equal(Number(row.count), 0);
    } finally {
      raw.close();
    }
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('schema inclui cache derivado de tonalidade', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-key-db-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    assert.equal(db.getSchemaVersion(), 20);
    const raw = new DatabaseSync(dbPath);
    try {
      const row = raw.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'track_key_analysis'"
      ).get() as { name?: string } | undefined;
      assert.equal(row?.name, 'track_key_analysis');
    } finally {
      raw.close();
    }
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
