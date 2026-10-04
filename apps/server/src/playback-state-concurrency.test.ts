import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { LibraryService } from './library-service.js';
import { HomeMusicDatabase } from './database.js';
import { PersonalLibraryService } from './personal-library-service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function insertUser(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, 'player', 'player', 'hash', 'user', 1, 0, ?, ?, ?)
    `).run(
      USER_ID,
      '2026-10-04T18:00:00.000Z',
      '2026-10-04T18:00:00.000Z',
      '2026-10-04T18:00:00.000Z'
    );
  } finally {
    db.close();
  }
}

function fakeLibrary() {
  return {
    getTrack(trackId: string) {
      return trackId === 'track-a' ? { id: trackId } : undefined;
    },
    cleanTrackIds(value: unknown) {
      return Array.isArray(value)
        ? value.filter((item): item is string => item === 'track-a')
        : [];
    }
  } as unknown as LibraryService;
}

function body(updatedAt: string, position: number) {
  return {
    currentTrackId: 'track-a',
    position,
    volume: 0.8,
    shuffle: false,
    repeatMode: 'off' as const,
    wasPlaying: true,
    baseQueueIds: ['track-a'],
    queueIds: ['track-a'],
    updatedAt
  };
}

test('playback state versionado rejeita write obsoleto sem sobrescrever estado novo', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-playback-concurrency-'));
  const databasePath = path.join(directory, 'home-music.db');

  try {
    const database = new HomeMusicDatabase(databasePath);
    insertUser(databasePath);
    const personal = new PersonalLibraryService(database, fakeLibrary());

    const initial = personal.loadPlaybackState(USER_ID);
    const first = personal.savePlaybackStateVersioned(USER_ID, body(initial.updatedAt, 10));
    assert.equal(first.status, 'ok');
    if (first.status !== 'ok') throw new Error('save inicial deveria funcionar');

    const stale = personal.savePlaybackStateVersioned(USER_ID, body(initial.updatedAt, 99));
    assert.equal(stale.status, 'conflict');
    if (stale.status !== 'conflict') throw new Error('write obsoleto deveria conflitar');
    assert.equal(stale.state.position, 10);
    assert.equal(personal.loadPlaybackState(USER_ID).position, 10);

    const latest = personal.savePlaybackStateVersioned(USER_ID, body(stale.state.updatedAt, 20));
    assert.equal(latest.status, 'ok');
    if (latest.status !== 'ok') throw new Error('write com versão atual deveria funcionar');
    assert.equal(latest.state.position, 20);
    assert.ok(latest.state.updatedAt > first.state.updatedAt);

    database.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
