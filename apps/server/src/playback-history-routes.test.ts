import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import { registerPlaybackHistoryRoutes } from './playback-history-routes.js';
import { registerSmartPlaylistRoutes } from './smart-playlist-routes.js';
import { UserAuthStore } from './user-auth-store.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function mutationHeaders(token: string) {
  return {
    cookie: cookie(token),
    'x-home-music-request': '1'
  };
}

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

function insertUser(db: DatabaseSync, id: string) {
  const now = '2026-08-30T00:00:00.000Z';
  db.prepare(`
    INSERT INTO users(
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, ?, 'user', 1, 0, ?, ?, ?)
  `).run(id, id, id, `hash-${id}`, now, now, now);
}

const playedRule = {
  artist: null,
  album: null,
  folderPath: null,
  favorite: null,
  history: 'played' as const,
  periodDays: null,
  sort: 'recently-played' as const,
  limit: 100
};

async function buildApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-playback-history-'));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.syncTracks([track('a'), track('b')], '/music', '2026-08-30T12:00:00.000Z');
  schema.close();

  const seed = new DatabaseSync(databasePath);
  insertUser(seed, 'user-a');
  insertUser(seed, 'user-b');
  seed.close();

  const sessions = new SessionManager('legacy-admin', 'password-segura-2026');
  const authUsers = new UserAuthStore(databasePath);
  const app = Fastify();
  installApiAuthPolicy(app, { configured: true, sessions, users: authUsers });
  registerPlaybackHistoryRoutes(app, { databasePath });
  registerSmartPlaylistRoutes(app, { databasePath });

  const tokenA = sessions.createSessionForUser('user-a');
  const tokenB = sessions.createSessionForUser('user-b');

  return {
    app,
    databasePath,
    tokenA,
    tokenB,
    async close() {
      await app.close();
      authUsers.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test('registro de conclusão exige sessão, header de mutação e faixa existente', async () => {
  const fixture = await buildApp();
  try {
    const unauthenticated = await fixture.app.inject({
      method: 'POST',
      url: '/api/history/a',
      headers: { 'x-home-music-request': '1' }
    });
    assert.equal(unauthenticated.statusCode, 401);

    const noCsrfHeader = await fixture.app.inject({
      method: 'POST',
      url: '/api/history/a',
      headers: { cookie: cookie(fixture.tokenA) }
    });
    assert.equal(noCsrfHeader.statusCode, 403);

    const missingTrack = await fixture.app.inject({
      method: 'POST',
      url: '/api/history/inexistente',
      headers: mutationHeaders(fixture.tokenA)
    });
    assert.equal(missingTrack.statusCode, 404);

    const recorded = await fixture.app.inject({
      method: 'POST',
      url: '/api/history/a',
      headers: mutationHeaders(fixture.tokenA)
    });
    assert.equal(recorded.statusCode, 201);
    assert.deepEqual(recorded.json(), { recorded: true });
  } finally {
    await fixture.close();
  }
});

test('reprodução concluída alimenta smart playlist e preserva isolamento por usuário', async () => {
  const fixture = await buildApp();
  try {
    const created = await fixture.app.inject({
      method: 'POST',
      url: '/api/smart-playlists',
      headers: mutationHeaders(fixture.tokenA),
      payload: { name: 'Já tocadas', rule: playedRule }
    });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json().playlist.trackIds, []);

    const recordA = await fixture.app.inject({
      method: 'POST',
      url: '/api/history/a',
      headers: mutationHeaders(fixture.tokenA)
    });
    assert.equal(recordA.statusCode, 201);

    const recordB = await fixture.app.inject({
      method: 'POST',
      url: '/api/history/b',
      headers: mutationHeaders(fixture.tokenB)
    });
    assert.equal(recordB.statusCode, 201);

    const listA = await fixture.app.inject({
      method: 'GET',
      url: '/api/smart-playlists',
      headers: { cookie: cookie(fixture.tokenA) }
    });
    assert.equal(listA.statusCode, 200);
    assert.deepEqual(listA.json().playlists[0].trackIds, ['a']);

    const database = new HomeMusicDatabase(fixture.databasePath);
    try {
      assert.deepEqual(database.getHistory('user-a').map(item => item.track.id), ['a']);
      assert.deepEqual(database.getHistory('user-b').map(item => item.track.id), ['b']);
    } finally {
      database.close();
    }
  } finally {
    await fixture.close();
  }
});
