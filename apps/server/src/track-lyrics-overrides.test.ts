import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readTrackLyrics } from './lyrics.js';
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

  it('restores the previous managed source after a generated override is cleared', async () => {
    const { databasePath, trackId } = await databaseWithTrack();
    const store = new TrackLyricsOverrideStore(databasePath);
    const previous = store.save(trackId, {
      mode: 'plain',
      text: 'letra original',
      origin: 'external',
      provider: 'lrclib',
      externalId: 'lrclib:123',
      language: 'pt-BR'
    });
    assert.ok(previous);

    const generated = store.save(trackId, {
      mode: 'synced',
      text: '[00:01.00]letra original',
      origin: 'generated',
      provider: 'local-alignment',
      externalId: 'whisper.cpp:model.bin',
      language: 'pt-BR'
    }, { preservePrevious: true });
    assert.equal(generated?.origin, 'generated');
    assert.equal(generated?.mode, 'synced');

    assert.equal(store.clear(trackId), true);
    const restored = store.get(trackId);
    assert.deepEqual(
      { ...restored, updatedAt: previous.updatedAt },
      previous
    );
    assert.ok(restored?.updatedAt);
    store.close();
  });

  it('returns to sidecar after clearing a managed override without history', async () => {
    const { databasePath, trackId } = await databaseWithTrack();
    const audio = path.join(path.dirname(databasePath), 'track.mp3');
    await writeFile(audio, 'audio');
    await writeFile(path.join(path.dirname(databasePath), 'track.lrc'), '[00:01.00]sidecar original');
    const store = new TrackLyricsOverrideStore(databasePath);
    try {
      assert.ok(store.save(trackId, {
        mode: 'plain', text: 'letra manual', origin: 'manual',
        provider: null, externalId: null, language: null
      }));
      assert.equal((await readTrackLyrics(path.dirname(databasePath), audio, store.get(trackId)))?.source, 'txt');
      assert.equal(store.clear(trackId), true);
      assert.equal((await readTrackLyrics(path.dirname(databasePath), audio, store.get(trackId)))?.lines[0]?.text, 'sidecar original');
    } finally {
      store.close();
    }
  });

  it('updates effective override A → B and returns to sidecar without modifying audio', async () => {
    const { databasePath, trackId } = await databaseWithTrack();
    const root = path.dirname(databasePath);
    const audio = path.join(root, 'track.mp3');
    await writeFile(audio, 'original audio bytes');
    await writeFile(path.join(root, 'track.lrc'), '[00:01.00]sidecar original');
    const store = new TrackLyricsOverrideStore(databasePath);
    try {
      const save = (text: string) => store.save(trackId, {
        mode: 'plain', text, origin: 'manual', provider: null, externalId: null, language: null
      });
      assert.ok(save('override A'));
      const initial = await readTrackLyrics(root, audio, store.get(trackId));
      assert.equal(initial?.lines[0]?.text, 'override A');

      assert.ok(save('override B'));
      const updated = await readTrackLyrics(root, audio, store.get(trackId));
      assert.equal(updated?.lines[0]?.text, 'override B');
      assert.notDeepEqual(updated, initial);
      assert.equal(await readFile(audio, 'utf8'), 'original audio bytes');

      assert.equal(store.clear(trackId), true);
      const restored = await readTrackLyrics(root, audio, store.get(trackId));
      assert.equal(restored?.lines[0]?.text, 'sidecar original');
      assert.equal(await readFile(audio, 'utf8'), 'original audio bytes');
    } finally {
      store.close();
    }
  });

  it('removes generated lyrics when there is no previous managed source', async () => {
    const { databasePath, trackId } = await databaseWithTrack();
    const store = new TrackLyricsOverrideStore(databasePath);
    assert.ok(store.save(trackId, {
      mode: 'synced',
      text: '[00:01.00]transcrição local',
      origin: 'generated',
      provider: 'local-transcription',
      externalId: 'whisper.cpp:model.bin',
      language: null
    }, { preservePrevious: true }));

    assert.equal(store.clear(trackId), true);
    assert.equal(store.get(trackId), null);
    store.close();
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
