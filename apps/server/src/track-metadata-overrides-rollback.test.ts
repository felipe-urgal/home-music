import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { TrackMetadataOverrideStore } from './track-metadata-overrides.js';

test('falha de constraint reverte a transação e preserva override anterior', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-metadata-rollback-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        album_artist TEXT NOT NULL
      );
      INSERT INTO tracks(id, title, artist, album, album_artist)
      VALUES ('track-a', 'Título físico', 'Artista físico', 'Álbum físico', 'Artista físico');
    `);
    db.close();

    const store = new TrackMetadataOverrideStore(dbPath);
    store.patch('track-a', { title: 'Override válido' });

    assert.throws(
      () => store.patch('track-a', { title: 'x'.repeat(241) }),
      /constraint/i
    );

    const afterFailure = store.get('track-a');
    assert.equal(afterFailure?.override.title, 'Override válido');
    assert.equal(afterFailure?.effective.title, 'Override válido');
    assert.equal(afterFailure?.physical.title, 'Título físico');
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
