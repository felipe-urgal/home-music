import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { MAX_MANAGED_LYRICS_BYTES, TrackLyricsOverrideStore } from './track-lyrics-overrides.js';

async function databaseWithTrack(trackId = 'track-1') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-lyrics-store-'));
  const databasePath = path.join(root, 'library.db');
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE tracks(id TEXT PRIMARY KEY);');
  db.prepare('INSERT INTO tracks(id) VALUES (?);').run(trackId);
  db.close();
  return { databasePath, trackId };
}

describe('TrackLyricsOverrideStore', () => {
  it('persists normalized lyrics across reopen and clears back to no override', async () => {
    const { databasePath, trackId } = await databaseWithTrack();
    const first = new TrackLyricsOverrideStore(databasePath);
    const saved = first.save(trackId, {
      mode: 'synced',
      text: '  [00:01.00]linha sintética  ',
      origin: 'external',
      provider: 'lrclib',
      externalId: 'lrclib:123',
      language: null
    });
    assert.equal(saved?.text, '[00:01.00]linha sintética');
    first.close();

    const reopened = new TrackLyricsOverrideStore(databasePath);
    assert.deepEqual(reopened.get(trackId), saved);
    assert.equal(reopened.clear(trackId), true);
    assert.equal(reopened.get(trackId), null);
    assert.equal(reopened.clear(trackId), false);
    reopened.close();
  });

  it('cascades managed lyrics when the track is removed', async () => {
    const { databasePath, trackId } = await databaseWithTrack();
    const store = new TrackLyricsOverrideStore(databasePath);
    assert.ok(store.save(trackId, {
      mode: 'plain',
      text: 'conteúdo criado para teste',
      origin: 'manual',
      provider: null,
      externalId: null,
      language: 'pt-BR'
    }));

    const db = new DatabaseSync(databasePath);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare('DELETE FROM tracks WHERE id = ?;').run(trackId);
    db.close();
    assert.equal(store.get(trackId), null);
    store.close();
  });

  it('rejects oversized content by UTF-8 byte size', async () => {
    const { databasePath, trackId } = await databaseWithTrack();
    const store = new TrackLyricsOverrideStore(databasePath);
    assert.throws(() => store.save(trackId, {
      mode: 'plain',
      text: 'á'.repeat(Math.floor(MAX_MANAGED_LYRICS_BYTES / 2) + 1),
      origin: 'external',
      provider: 'lrclib',
      externalId: 'lrclib:999',
      language: null
    }), /no máximo/);
    store.close();
  });

  it('does not create an override for a missing track', async () => {
    const { databasePath } = await databaseWithTrack();
    const store = new TrackLyricsOverrideStore(databasePath);
    assert.equal(store.save('missing', {
      mode: 'plain',
      text: 'linha sintética',
      origin: 'external',
      provider: 'lrclib',
      externalId: 'lrclib:1',
      language: null
    }), null);
    store.close();
  });
});
