import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { SmartPlaylistRule } from '@home-music/shared';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import { normalizeSmartPlaylistRule, SmartPlaylistStore } from './smart-playlists.js';

function track(id: string, overrides: Partial<IndexedTrack> = {}): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista A',
    album: 'Álbum A',
    albumArtist: 'Artista A',
    folder: 'Rock',
    folderPath: 'Rock/Artista A',
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
  const now = '2026-08-01T00:00:00.000Z';
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

test('normaliza regras estritas e rejeita payload fora dos limites', () => {
  assert.deepEqual(normalizeSmartPlaylistRule(baseRule), baseRule);
  assert.equal(normalizeSmartPlaylistRule({ ...baseRule, history: 'recent-ish' }), null);
  assert.equal(normalizeSmartPlaylistRule({ ...baseRule, limit: 0 }), null);
  assert.equal(normalizeSmartPlaylistRule({ ...baseRule, periodDays: 5000 }), null);
  assert.equal(normalizeSmartPlaylistRule({ ...baseRule, favorite: 'yes' }), null);
});

test('combina artista, pasta, favorito, histórico e período sem materializar playlist_tracks', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-smart-'));
  const databasePath = path.join(temp, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);

  try {
    insertUser(databasePath, 'user-a');
    insertUser(databasePath, 'user-b');
    database.syncTracks([
      track('a'),
      track('b', { album: 'Álbum B', folderPath: 'Rock/Artista A/Discografia' }),
      track('c', { artist: 'Artista C', album: 'Álbum C', albumArtist: 'Artista C', folder: 'Jazz', folderPath: 'Jazz/Artista C' })
    ], '/music', '2026-08-30T12:00:00.000Z');

    database.setFavorite('user-a', 'a', true);
    database.setFavorite('user-a', 'b', true);
    database.setFavorite('user-b', 'c', true);
    database.recordHistory('user-a', 'a', '2026-08-29T10:00:00.000Z');
    database.recordHistory('user-a', 'a', '2026-08-29T11:00:00.000Z');
    database.recordHistory('user-a', 'b', '2026-06-01T10:00:00.000Z');
    for (let index = 0; index < 5; index += 1) {
      database.recordHistory('user-b', 'b', `2026-08-29T1${index}:00:00.000Z`);
    }

    const store = new SmartPlaylistStore(databasePath);
    try {
      const result = store.evaluate('user-a', {
        ...baseRule,
        artist: 'Artista A',
        folderPath: 'Rock/Artista A',
        favorite: true,
        history: 'played',
        periodDays: 30,
        sort: 'most-played'
      }, undefined, new Date('2026-08-30T12:00:00.000Z'));
      assert.deepEqual(result, ['a']);

      const neverPlayed = store.evaluate('user-a', {
        ...baseRule,
        history: 'never'
      });
      assert.deepEqual(neverPlayed, ['c']);

      const raw = new DatabaseSync(databasePath);
      try {
        const before = Number((raw.prepare('SELECT COUNT(*) AS total FROM playlist_tracks').get() as { total: number }).total);
        store.create('user-a', 'Mais tocadas', {
          ...baseRule,
          history: 'played',
          sort: 'most-played'
        });
        const after = Number((raw.prepare('SELECT COUNT(*) AS total FROM playlist_tracks').get() as { total: number }).total);
        assert.equal(after, before);
      } finally {
        raw.close();
      }
    } finally {
      store.close();
    }
  } finally {
    database.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('ordena favoritas antigas e isola definições e histórico entre usuários', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-smart-'));
  const databasePath = path.join(temp, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);

  try {
    insertUser(databasePath, 'user-a');
    insertUser(databasePath, 'user-b');
    database.syncTracks([track('a'), track('b'), track('c')], '/music', '2026-08-30T12:00:00.000Z');

    const raw = new DatabaseSync(databasePath);
    try {
      raw.prepare('INSERT INTO favorites(user_id, track_id, created_at) VALUES (?, ?, ?)')
        .run('user-a', 'b', '2026-01-01T00:00:00.000Z');
      raw.prepare('INSERT INTO favorites(user_id, track_id, created_at) VALUES (?, ?, ?)')
        .run('user-a', 'a', '2026-07-01T00:00:00.000Z');
    } finally {
      raw.close();
    }
    database.recordHistory('user-b', 'c', '2026-08-30T10:00:00.000Z');

    const store = new SmartPlaylistStore(databasePath);
    try {
      const favorites = store.evaluate('user-a', {
        ...baseRule,
        favorite: true,
        sort: 'oldest-favorite'
      });
      assert.deepEqual(favorites, ['b', 'a']);

      const idA = store.create('user-a', 'Nunca ouvi', { ...baseRule, history: 'never' });
      store.create('user-b', 'Recentes', { ...baseRule, history: 'played', sort: 'recently-played' });

      assert.equal(store.list('user-a').length, 1);
      assert.equal(store.list('user-b').length, 1);
      assert.equal(store.get('user-b', idA), null);
      assert.equal(store.update('user-b', idA, { name: 'Ataque' }), false);
      assert.equal(store.delete('user-b', idA), false);
      assert.equal(store.get('user-a', idA)?.source, 'smart');
      assert.deepEqual(store.get('user-a', idA)?.trackIds, ['a', 'b', 'c']);
      assert.deepEqual(store.list('user-b')[0].trackIds, ['c']);
    } finally {
      store.close();
    }
  } finally {
    database.close();
    await rm(temp, { recursive: true, force: true });
  }
});
