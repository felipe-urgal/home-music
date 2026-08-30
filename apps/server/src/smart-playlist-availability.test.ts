import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { SmartPlaylistRule } from '@home-music/shared';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import { SmartPlaylistStore } from './smart-playlists.js';
import { TrackAvailabilityStore } from './track-availability-store.js';

function track(id: string): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Biblioteca',
    folderPath: 'Biblioteca',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath: `/music/${id}.mp3`,
    mimeType: 'audio/mpeg',
    fileSize: 100,
    mtimeMs: 1
  };
}

function insertUser(databasePath: string, id: string) {
  const raw = new DatabaseSync(databasePath);
  const now = '2026-08-30T00:00:00.000Z';
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

const rule: SmartPlaylistRule = {
  artist: null,
  album: null,
  folderPath: null,
  favorite: null,
  history: 'any',
  periodDays: null,
  sort: 'title',
  limit: 100
};

test('smart playlists excluem faixas administrativamente desativadas', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-smart-availability-'));
  const databasePath = path.join(temp, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);

  try {
    insertUser(databasePath, 'user-a');
    database.syncTracks([track('a'), track('b')], '/music', '2026-08-30T12:00:00.000Z');

    const availability = new TrackAvailabilityStore(databasePath);
    try {
      availability.setEnabled('b', false);

      const smart = new SmartPlaylistStore(databasePath);
      try {
        assert.deepEqual(smart.evaluate('user-a', rule), ['a']);

        availability.setEnabled('b', true);
        assert.deepEqual(smart.evaluate('user-a', rule), ['a', 'b']);
      } finally {
        smart.close();
      }
    } finally {
      availability.close();
    }
  } finally {
    database.close();
    await rm(temp, { recursive: true, force: true });
  }
});
