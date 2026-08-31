import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import {
  LibraryViewStore,
  normalizeLibraryViewDefinition
} from './library-views.js';

function insertUser(db: DatabaseSync, id: string) {
  const now = '2026-08-31T12:00:00.000Z';
  db.prepare(`
    INSERT INTO users(
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, ?, 'user', 1, 0, ?, ?, ?)
  `).run(id, id, id, `hash-${id}`, now, now, now);
}

const definition = {
  query: 'house',
  format: 'FLAC',
  cover: 'with-cover' as const,
  sort: 'artist-asc' as const
};

test('normalização aceita apenas definição completa e limitada', () => {
  assert.deepEqual(normalizeLibraryViewDefinition(definition), definition);
  assert.deepEqual(normalizeLibraryViewDefinition({ ...definition, query: '  house  ' }), definition);
  assert.equal(normalizeLibraryViewDefinition({ ...definition, cover: 'invalid' }), null);
  assert.equal(normalizeLibraryViewDefinition({ ...definition, sort: 'invalid' }), null);
  assert.equal(normalizeLibraryViewDefinition({ ...definition, format: '' }), null);
  assert.equal(normalizeLibraryViewDefinition({ ...definition, query: 'x'.repeat(161) }), null);
});

test('views persistem entre reaberturas e ficam isoladas por usuário', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-library-views-'));
  const databasePath = path.join(directory, 'data', 'test.db');

  try {
    const schema = new HomeMusicDatabase(databasePath);
    schema.close();

    const seed = new DatabaseSync(databasePath);
    insertUser(seed, 'user-a');
    insertUser(seed, 'user-b');
    seed.close();

    const first = new LibraryViewStore(databasePath);
    const id = first.create('user-a', '  House com capa  ', definition);
    assert.equal(first.list('user-b').length, 0);
    assert.equal(first.get('user-b', id), null);
    assert.equal(first.update('user-b', id, { name: 'Tentativa' }), false);
    assert.equal(first.delete('user-b', id), false);
    first.close();

    const reopened = new LibraryViewStore(databasePath);
    const saved = reopened.get('user-a', id);
    assert.equal(saved?.name, 'House com capa');
    assert.deepEqual(saved?.definition, definition);

    assert.equal(reopened.update('user-a', id, { name: 'House FLAC' }), true);
    assert.equal(reopened.get('user-a', id)?.name, 'House FLAC');
    assert.equal(reopened.delete('user-a', id), true);
    assert.equal(reopened.get('user-a', id), null);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
