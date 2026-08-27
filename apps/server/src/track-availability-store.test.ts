import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { TrackAvailabilityStore } from './track-availability-store.js';

function seedTrack(databasePath: string, id: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY);');
    db.prepare('INSERT INTO tracks(id) VALUES (?);').run(id);
  } finally {
    db.close();
  }
}

test('disponibilidade é reversível e persiste entre reinicializações', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-track-availability-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    seedTrack(dbPath, 'track-a');

    const first = new TrackAvailabilityStore(dbPath);
    assert.equal(first.isEnabled('track-a'), true);
    first.setEnabled('track-a', false);
    assert.equal(first.isEnabled('track-a'), false);
    first.close();

    const second = new TrackAvailabilityStore(dbPath);
    assert.equal(second.isEnabled('track-a'), false);
    second.setEnabled('track-a', true);
    assert.equal(second.isEnabled('track-a'), true);
    second.close();

    const third = new TrackAvailabilityStore(dbPath);
    assert.equal(third.isEnabled('track-a'), true);
    third.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('refresh remove estado órfão após exclusão física da faixa', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-track-availability-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    seedTrack(dbPath, 'track-a');
    const store = new TrackAvailabilityStore(dbPath);
    store.setEnabled('track-a', false);
    assert.equal(store.isEnabled('track-a'), false);

    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA foreign_keys = ON;');
    raw.prepare('DELETE FROM tracks WHERE id = ?;').run('track-a');
    raw.close();

    store.refresh();
    assert.equal(store.isEnabled('track-a'), true);
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
