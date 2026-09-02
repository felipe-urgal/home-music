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
    folderPath: 'Rock',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath,
    mimeType: 'audio/mpeg',
    fileSize: 123,
    mtimeMs: 456
  };
}

test('applyTrackDelta sem mudanças atualiza metadata sem executar upsert de faixa', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-delta-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    db.syncTracks([indexedTrack('a', '/music/a.mp3')], '/music', '2026-09-02T10:00:00.000Z');
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TRIGGER reject_track_insert BEFORE INSERT ON tracks
      BEGIN SELECT RAISE(ABORT, 'unexpected track insert'); END;
      CREATE TRIGGER reject_track_update BEFORE UPDATE ON tracks
      BEGIN SELECT RAISE(ABORT, 'unexpected track update'); END;
    `);
    raw.close();

    const metrics = db.applyTrackDelta(
      { added: [], updated: [], removedIds: [] },
      '/music',
      '2026-09-02T10:01:00.000Z'
    );

    assert.equal(metrics.mode, 'delta');
    assert.equal(metrics.upserted, 0);
    assert.equal(metrics.removed, 0);
    assert.equal(db.getMetadata('scannedAt'), '2026-09-02T10:01:00.000Z');
    assert.equal(db.loadTracks().length, 1);
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('applyTrackDelta atualiza somente a faixa alterada e preserva as demais', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-delta-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const trackA = indexedTrack('a', '/music/a.mp3');
    const trackB = indexedTrack('b', '/music/b.mp3');
    db.syncTracks([trackA, trackB], '/music', '2026-09-02T10:00:00.000Z');

    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TRIGGER reject_unchanged_track_update BEFORE UPDATE ON tracks
      WHEN OLD.id = 'b'
      BEGIN SELECT RAISE(ABORT, 'unchanged track was rewritten'); END;
    `);
    raw.close();

    const updatedA = { ...trackA, title: 'Faixa A atualizada', mtimeMs: 999 };
    const metrics = db.applyTrackDelta(
      { added: [], updated: [updatedA], removedIds: [] },
      '/music',
      '2026-09-02T10:02:00.000Z'
    );

    assert.equal(metrics.upserted, 1);
    assert.equal(db.loadTracks().find(track => track.id === 'a')?.title, 'Faixa A atualizada');
    assert.equal(db.loadTracks().find(track => track.id === 'b')?.title, 'Faixa b');
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('applyTrackDelta persiste remoção e snapshot idêntico após restart', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-delta-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    const first = new HomeMusicDatabase(dbPath);
    const trackA = indexedTrack('a', '/music/a.mp3');
    const trackB = indexedTrack('b', '/music/b.mp3');
    first.syncTracks([trackA, trackB], '/music', '2026-09-02T10:00:00.000Z');
    const updatedA = { ...trackA, album: 'Álbum novo', mtimeMs: 777 };

    const metrics = first.applyTrackDelta(
      { added: [], updated: [updatedA], removedIds: ['b'] },
      '/music',
      '2026-09-02T10:03:00.000Z'
    );
    assert.equal(metrics.upserted, 1);
    assert.equal(metrics.removed, 1);
    const beforeRestart = first.loadTracks();
    first.close();

    const second = new HomeMusicDatabase(dbPath);
    assert.deepEqual(second.loadTracks(), beforeRestart);
    assert.equal(second.loadTracks()[0].album, 'Álbum novo');
    assert.equal(second.getMetadata('libraryRoot'), '/music');
    assert.equal(second.getMetadata('scannedAt'), '2026-09-02T10:03:00.000Z');
    second.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('applyTrackDelta faz rollback integral de faixas e metadata em falha', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-delta-'));
  const dbPath = path.join(temp, 'home-music.db');
  const db = new HomeMusicDatabase(dbPath);

  try {
    const original = indexedTrack('a', '/music/a.mp3');
    db.syncTracks([original], '/music', '2026-09-02T10:00:00.000Z');
    const added = indexedTrack('b', '/music/shared.mp3');
    const conflictingUpdate = { ...original, filePath: '/music/shared.mp3', title: 'Não deve persistir' };

    assert.throws(() => db.applyTrackDelta(
      { added: [added], updated: [conflictingUpdate], removedIds: [] },
      '/music',
      '2026-09-02T10:04:00.000Z'
    ));

    assert.deepEqual(db.loadTracks(), [original]);
    assert.equal(db.getMetadata('scannedAt'), '2026-09-02T10:00:00.000Z');
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
