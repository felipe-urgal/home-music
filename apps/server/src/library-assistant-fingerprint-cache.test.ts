import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LibraryAssistantFingerprintCache } from './library-assistant-fingerprint-cache.js';

test('cache reutiliza apenas a assinatura física atual e acompanha remoção da faixa', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-fingerprint-cache-'));
  const databasePath = path.join(temp, 'home-music.db');
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON; CREATE TABLE tracks (id TEXT PRIMARY KEY);');
    db.prepare('INSERT INTO tracks(id) VALUES (?)').run('track-1');
    const cache = new LibraryAssistantFingerprintCache(databasePath);
    cache.put('track-1', {
      signature: 'a'.repeat(64),
      durationSeconds: 180,
      fingerprint: 'AQAB_cached'
    }, '2026-09-10T10:00:00.000Z');

    assert.deepEqual(cache.get('track-1', 'a'.repeat(64)), {
      signature: 'a'.repeat(64),
      durationSeconds: 180,
      fingerprint: 'AQAB_cached'
    });
    assert.equal(cache.get('track-1', 'b'.repeat(64)), null);

    db.prepare('DELETE FROM tracks WHERE id = ?').run('track-1');
    assert.equal(cache.get('track-1', 'a'.repeat(64)), null);
    cache.close();
  } finally {
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
