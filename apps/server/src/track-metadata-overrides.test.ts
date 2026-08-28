import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  normalizeMetadataOverridePatch,
  TrackMetadataOverrideStore
} from './track-metadata-overrides.js';

function seedTrack(databasePath: string, id = 'track-a') {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        album_artist TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO tracks(id, title, artist, album, album_artist)
      VALUES (?, 'Título físico', 'Artista físico', 'Álbum físico', 'Artista físico');
    `).run(id);
  } finally {
    db.close();
  }
}

test('override tem precedência sem alterar metadata física e sobrevive a rescan', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-metadata-overrides-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    seedTrack(dbPath);
    const store = new TrackMetadataOverrideStore(dbPath);

    const initial = store.get('track-a');
    assert.deepEqual(initial?.physical, {
      title: 'Título físico',
      artist: 'Artista físico',
      album: 'Álbum físico',
      albumArtist: 'Artista físico'
    });
    assert.equal(initial?.override.updatedAt, null);

    const edited = store.patch('track-a', {
      title: 'Título corrigido',
      artist: 'Artista corrigido'
    });
    assert.equal(edited?.effective.title, 'Título corrigido');
    assert.equal(edited?.effective.artist, 'Artista corrigido');
    assert.equal(edited?.physical.title, 'Título físico');
    assert.equal(edited?.physical.artist, 'Artista físico');

    const raw = new DatabaseSync(dbPath);
    raw.prepare(`
      UPDATE tracks
      SET title = 'Título físico após rescan', artist = 'Artista físico após rescan'
      WHERE id = 'track-a';
    `).run();
    raw.close();

    const afterRescan = store.get('track-a');
    assert.equal(afterRescan?.physical.title, 'Título físico após rescan');
    assert.equal(afterRescan?.physical.artist, 'Artista físico após rescan');
    assert.equal(afterRescan?.effective.title, 'Título corrigido');
    assert.equal(afterRescan?.effective.artist, 'Artista corrigido');

    store.close();
    const reopened = new TrackMetadataOverrideStore(dbPath);
    assert.equal(reopened.get('track-a')?.effective.title, 'Título corrigido');
    reopened.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('valor igual ao arquivo remove override do campo e clear restaura tudo', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-metadata-overrides-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    seedTrack(dbPath);
    const store = new TrackMetadataOverrideStore(dbPath);
    store.patch('track-a', {
      title: 'Título corrigido',
      album: 'Álbum corrigido'
    });

    const partialReset = store.patch('track-a', { title: 'Título físico' });
    assert.equal(partialReset?.override.title, null);
    assert.equal(partialReset?.override.album, 'Álbum corrigido');
    assert.equal(partialReset?.effective.title, 'Título físico');

    const cleared = store.clear('track-a');
    assert.equal(cleared?.override.updatedAt, null);
    assert.deepEqual(cleared?.effective, cleared?.physical);
    assert.equal(store.hasOverride('track-a'), false);
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('override é removido por cascade quando a faixa deixa a biblioteca', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-metadata-overrides-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    seedTrack(dbPath);
    const store = new TrackMetadataOverrideStore(dbPath);
    store.patch('track-a', { title: 'Título corrigido' });
    assert.equal(store.hasOverride('track-a'), true);

    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA foreign_keys = ON;');
    raw.prepare('DELETE FROM tracks WHERE id = ?;').run('track-a');
    raw.close();

    store.refresh();
    assert.equal(store.hasOverride('track-a'), false);
    assert.equal(store.get('track-a'), null);
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('patch inválido falha antes de persistir alteração parcial', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-metadata-overrides-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    seedTrack(dbPath);
    const store = new TrackMetadataOverrideStore(dbPath);

    assert.throws(
      () => normalizeMetadataOverridePatch({ title: 'Título válido', artist: '   ' }),
      /Artista não pode ficar vazio/
    );
    assert.throws(
      () => normalizeMetadataOverridePatch({ title: 'Título', filePath: '/tmp/injetado.mp3' }),
      /Campo de metadados não suportado/
    );
    assert.equal(store.get('track-a')?.override.updatedAt, null);
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
