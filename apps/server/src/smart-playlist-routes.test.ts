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

function track(id: string, artist: string): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist,
    album: 'Álbum',
    albumArtist: artist,
    folder: 'Biblioteca',
    folderPath: `Biblioteca/${artist}`,
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

const rule = {
  artist: null,
  album: null,
  folderPath: null,
  favorite: null,
  history: 'any' as const,
  periodDays: null,
  sort: 'title' as const,
  limit: 100
};

async function buildApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-smart-routes-'));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.close();

  const seed = new DatabaseSync(databasePath);
  insertUser(seed, 'user-a');
  insertUser(seed, 'user-b');
  seed.close();

  const database = new HomeMusicDatabase(databasePath);
  database.syncTracks([track('a', 'Artista A'), track('b', 'Artista B')], '/music', '2026-08-30T12:00:00.000Z');
  database.close();

  const sessions = new SessionManager('legacy-admin', 'password-segura-2026');
  const authUsers = new UserAuthStore(databasePath);
  const app = Fastify();
  installApiAuthPolicy(app, { configured: true, sessions, users: authUsers });
  registerSmartPlaylistRoutes(app, { databasePath });

  const tokenA = sessions.createSessionForUser('user-a');
  const tokenB = sessions.createSessionForUser('user-b');

  return {
    app,
    tokenA,
    tokenB,
    async close() {
      await app.close();
      authUsers.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test('preview e criação exigem sessão e header de mutação', async () => {
  const fixture = await buildApp();
  try {
    const unauthenticated = await fixture.app.inject({
      method: 'POST',
      url: '/api/smart-playlists/preview',
      headers: { 'x-home-music-request': '1' },
      payload: { rule }
    });
    assert.equal(unauthenticated.statusCode, 401);

    const noCsrfHeader = await fixture.app.inject({
      method: 'POST',
      url: '/api/smart-playlists/preview',
      headers: { cookie: cookie(fixture.tokenA) },
      payload: { rule }
    });
    assert.equal(noCsrfHeader.statusCode, 403);

    const preview = await fixture.app.inject({
      method: 'POST',
      url: '/api/smart-playlists/preview',
      headers: mutationHeaders(fixture.tokenA),
      payload: { rule: { ...rule, artist: 'Artista A' } }
    });
    assert.equal(preview.statusCode, 200);
    assert.deepEqual(preview.json().trackIds, ['a']);

    const created = await fixture.app.inject({
      method: 'POST',
      url: '/api/smart-playlists',
      headers: mutationHeaders(fixture.tokenA),
      payload: { name: 'Artista A', rule: { ...rule, artist: 'Artista A' } }
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().playlist.source, 'smart');
    assert.deepEqual(created.json().playlist.trackIds, ['a']);
  } finally {
    await fixture.close();
  }
});

test('CRUD mantém definições isoladas por usuário', async () => {
  const fixture = await buildApp();
  try {
    const created = await fixture.app.inject({
      method: 'POST',
      url: '/api/smart-playlists',
      headers: mutationHeaders(fixture.tokenA),
      payload: { name: 'Minha smart', rule }
    });
    const id = created.json().playlist.id as string;

    const listA = await fixture.app.inject({
      method: 'GET',
      url: '/api/smart-playlists',
      headers: { cookie: cookie(fixture.tokenA) }
    });
    const listB = await fixture.app.inject({
      method: 'GET',
      url: '/api/smart-playlists',
      headers: { cookie: cookie(fixture.tokenB) }
    });
    assert.equal(listA.json().playlists.length, 1);
    assert.equal(listB.json().playlists.length, 0);

    const foreignUpdate = await fixture.app.inject({
      method: 'PATCH',
      url: `/api/smart-playlists/${id}`,
      headers: mutationHeaders(fixture.tokenB),
      payload: { name: 'Ataque' }
    });
    assert.equal(foreignUpdate.statusCode, 404);

    const updated = await fixture.app.inject({
      method: 'PATCH',
      url: `/api/smart-playlists/${id}`,
      headers: mutationHeaders(fixture.tokenA),
      payload: { name: 'Atualizada' }
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().playlist.name, 'Atualizada');

    const foreignDelete = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/smart-playlists/${id}`,
      headers: mutationHeaders(fixture.tokenB)
    });
    assert.equal(foreignDelete.statusCode, 404);

    const deleted = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/smart-playlists/${id}`,
      headers: mutationHeaders(fixture.tokenA)
    });
    assert.equal(deleted.statusCode, 204);
  } finally {
    await fixture.close();
  }
});
