import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminLibraryNormalizationRoutes } from './admin-library-normalization-routes.js';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { LibraryMetadataNormalizationStore } from './library-metadata-normalization.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

function seedTracks(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        album_artist TEXT NOT NULL
      );
      INSERT INTO tracks(id, title, artist, album, album_artist)
      VALUES
        ('a', 'Faixa A', 'Beyonce', 'Lemonade', 'Beyonce'),
        ('b', 'Faixa B', 'Beyoncé', 'Lémonade', 'Beyoncé');
    `);
  } finally {
    db.close();
  }
}

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function buildApp(databasePath: string) {
  const sessions = new SessionManager('legacy-admin', 'password-segura-2026');
  const users = new Map<string, AuthenticatedUserState>();
  const app = Fastify();
  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: { getEnabledUserById: userId => users.get(userId) ?? null }
  });
  const store = new LibraryMetadataNormalizationStore(databasePath);
  registerAdminLibraryNormalizationRoutes(app, store);
  app.addHook('onClose', async () => { store.close(); });
  await app.ready();
  return { app, sessions, users };
}

test('normalização administrativa exige admin e header de mutação', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-normalization-routes-'));
  const databasePath = path.join(temp, 'home-music.db');
  seedTracks(databasePath);
  const { app, sessions, users } = await buildApp(databasePath);

  users.set('user-a', {
    id: 'user-a',
    username: 'maria',
    role: 'user',
    passwordMustChange: false
  });
  users.set('admin-a', {
    id: 'admin-a',
    username: 'felipe',
    role: 'admin',
    passwordMustChange: false
  });
  const userToken = sessions.createSessionForUser('user-a');
  const adminToken = sessions.createSessionForUser('admin-a');

  try {
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/admin/library/normalization',
      headers: { cookie: cookie(userToken) }
    });
    assert.equal(forbidden.statusCode, 403);
    assert.deepEqual(forbidden.json(), { error: 'Acesso administrativo necessário.' });

    const missingMutationHeader = await app.inject({
      method: 'POST',
      url: '/api/admin/library/normalization/aliases',
      headers: {
        cookie: cookie(adminToken),
        'content-type': 'application/json'
      },
      payload: {
        kind: 'artist',
        canonicalValue: 'Beyoncé',
        sourceValues: ['Beyonce']
      }
    });
    assert.equal(missingMutationHeader.statusCode, 403);
    assert.deepEqual(missingMutationHeader.json(), { error: 'Requisição de alteração não autorizada.' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/library/normalization/aliases',
      headers: {
        cookie: cookie(adminToken),
        'x-home-music-request': '1',
        'content-type': 'application/json'
      },
      payload: {
        kind: 'artist',
        canonicalValue: 'Beyoncé',
        sourceValues: ['Beyonce']
      }
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().counts.aliases, 1);

    const aliasId = created.json().aliases[0].id as string;
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/admin/library/normalization/aliases/${encodeURIComponent(aliasId)}`,
      headers: {
        cookie: cookie(adminToken),
        'x-home-music-request': '1'
      }
    });
    assert.equal(removed.statusCode, 204);

    const review = await app.inject({
      method: 'GET',
      url: '/api/admin/library/normalization',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(review.statusCode, 200);
    assert.equal(review.json().counts.aliases, 0);
    assert.equal(review.json().counts.artistCandidates, 1);
  } finally {
    await app.close();
    await rm(temp, { recursive: true, force: true });
  }
});
