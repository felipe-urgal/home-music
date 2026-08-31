import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { SmartPlaylistRule } from '@home-music/shared';
import { HomeMusicDatabase } from './database.js';
import { LibraryMetadataNormalizationStore } from './library-metadata-normalization.js';
import type { IndexedTrack } from './library.js';
import { SmartPlaylistStore } from './smart-playlists.js';
import { TrackMetadataOverrideStore } from './track-metadata-overrides.js';

function track(id: string, overrides: Partial<IndexedTrack> = {}): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Beyonce',
    album: 'Lemonade',
    albumArtist: 'Beyonce',
    folder: 'Pop',
    folderPath: 'Pop/Beyonce',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath: `/music/${id}.mp3`,
    mimeType: 'audio/mpeg',
    fileSize: 100,
    mtimeMs: 1,
    ...overrides
  };
}

function insertUser(databasePath: string, id: string) {
  const raw = new DatabaseSync(databasePath);
  const now = '2026-08-31T00:00:00.000Z';
  try {
    raw.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, ?, ?, ?, 'user', 1, 0, ?, ?, ?)
    `).run(id, id, id, `hash-${id}`, now, now, now);
  } finally {
    raw.close();
  }
}

const baseRule: SmartPlaylistRule = {
  artist: null,
  album: null,
  folderPath: null,
  favorite: null,
  history: 'any',
  periodDays: null,
  sort: 'title',
  limit: 100
};

test('playlist inteligente usa override e aliases canônicos sem alterar metadata física', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-smart-normalization-'));
  const databasePath = path.join(temp, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  let overrides: TrackMetadataOverrideStore | null = null;
  let normalization: LibraryMetadataNormalizationStore | null = null;
  let smart: SmartPlaylistStore | null = null;

  try {
    insertUser(databasePath, 'user-a');
    database.syncTracks([
      track('a', { title: 'Zulu' }),
      track('b', {
        title: 'Beta',
        artist: 'Beyoncé',
        album: 'Lémonade',
        albumArtist: 'Beyoncé',
        folderPath: 'Pop/Beyoncé'
      })
    ], '/music', '2026-08-31T12:00:00.000Z');

    overrides = new TrackMetadataOverrideStore(databasePath);
    overrides.patch('a', { title: 'Alpha' });

    normalization = new LibraryMetadataNormalizationStore(databasePath);
    normalization.associate({
      kind: 'artist',
      canonicalValue: 'Beyoncé',
      sourceValues: ['Beyonce']
    });
    normalization.associate({
      kind: 'album',
      scope: 'Beyoncé',
      canonicalValue: 'Lémonade',
      sourceValues: ['Lemonade']
    });

    smart = new SmartPlaylistStore(databasePath);
    const canonical = smart.evaluate('user-a', {
      ...baseRule,
      artist: 'Beyoncé',
      album: 'Lémonade'
    });
    assert.deepEqual(canonical, ['a', 'b']);

    const projected = normalization.canonicalMetadataByTrackId();
    assert.equal(projected.get('a')?.title, 'Alpha');
    assert.equal(projected.get('a')?.artist, 'Beyoncé');
    assert.equal(projected.get('a')?.album, 'Lémonade');

    const physical = new DatabaseSync(databasePath);
    try {
      const row = physical.prepare('SELECT title, artist, album, album_artist FROM tracks WHERE id = ?')
        .get('a') as { title: string; artist: string; album: string; album_artist: string };
      assert.deepEqual(row, {
        title: 'Zulu',
        artist: 'Beyonce',
        album: 'Lemonade',
        album_artist: 'Beyonce'
      });
    } finally {
      physical.close();
    }

    const artistAlias = normalization.listAliases().find(alias => alias.kind === 'artist');
    assert.ok(artistAlias);
    assert.equal(normalization.remove(artistAlias.id), true);

    const afterUndo = smart.evaluate('user-a', {
      ...baseRule,
      artist: 'Beyoncé',
      album: null
    });
    assert.deepEqual(afterUndo, ['b']);
  } finally {
    smart?.close();
    normalization?.close();
    overrides?.close();
    database.close();
    await rm(temp, { recursive: true, force: true });
  }
});
