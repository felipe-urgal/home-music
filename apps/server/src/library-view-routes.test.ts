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
import { registerLibraryViewRoutes } from './library-view-routes.js';
import { UserAuthStore } from './user-auth-store.js';

function insertUser(db: DatabaseSync, id: string) {
  const now = '2026-08-31T12:00:00.000Z';
  db.prepare(`
    INSERT INTO users(
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, ?, 'user', 1, 0, ?, ?, ?)
  `).run(id, id, id, `hash-${id}`, now, now, now);
}

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function mutationHeaders(token: string) {
  return {
    cookie: cookie(token),
    'x-home-music-request': '1'
  };
}

const definition = {
  query: 'jazz',
  format: 'all',
  cover: 'all',
  sort: 'album-asc'
};

async function buildApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-library-view-routes-'));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.close();

  const seed = new DatabaseSync(databasePath);
  insertUser(seed, 'user-a');
  insertUser(seed, 'user-b');
  seed.close();

  const sessions = new SessionManager('legacy-admin', 'password-segura-2026');
  const users = new UserAuthStore(databasePath);
  const app = Fastify();
  installApiAuthPolicy(app, { configured: true, sessions, users });
  registerLibraryViewRoutes(app, { databasePath });

  return {
    app,
    users,
    directory,
    tokenA: sessions.createSessionForUser('user-a'),
    tokenB: sessions.createSessionForUser('user-b'),
    async close() {
      await app.close();
      users.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test('CRUD exige autenticação e header de mutação', async () => {
  const fixture = await buildApp();
  try {
    const unauthenticated = await fixture.app.inject({ method: 'GET', url: '/api/library-views' });
    assert.equal(unauthenticated.statusCode, 401);

    const missingMutationHeader = await fixture.app.inject({
      method: 'POST',
      url: '/api/library-views',
      headers: { cookie: cookie(fixture.tokenA) },
      payload: { name: 'Jazz', definition }
    });
    assert.equal(missingMutationHeader.statusCode, 403);

    const invalidDefinition = await fixture.app.inject({
      method: 'POST',
      url: '/api/library-views',
      headers: mutationHeaders(fixture.tokenA),
      payload: { name: 'Jazz', definition: { ...definition, sort: 'invalido' } }
    });
    assert.equal(invalidDefinition.statusCode, 400);
  } finally {
    await fixture.close();
  }
});

test('CRUD preserva ownership e não expõe views entre usuários', async () => {
  const fixture = await buildApp();
  try {
    const created = await fixture.app.inject({
      method: 'POST',
      url: '/api/library-views',
      headers: mutationHeaders(fixture.tokenA),
      payload: { name: 'Jazz', definition }
    });
    assert.equal(created.statusCode, 201);
    const id = created.json().view.id as string;

    const listA = await fixture.app.inject({
      method: 'GET',
      url: '/api/library-views',
      headers: { cookie: cookie(fixture.tokenA) }
    });
    assert.equal(listA.statusCode, 200);
    assert.equal(listA.json().views.length, 1);

    const listB = await fixture.app.inject({
      method: 'GET',
      url: '/api/library-views',
      headers: { cookie: cookie(fixture.tokenB) }
    });
    assert.equal(listB.statusCode, 200);
    assert.deepEqual(listB.json().views, []);

    const crossUserRename = await fixture.app.inject({
      method: 'PATCH',
      url: `/api/library-views/${id}`,
      headers: mutationHeaders(fixture.tokenB),
      payload: { name: 'Roubada' }
    });
    assert.equal(crossUserRename.statusCode, 404);

    const renamed = await fixture.app.inject({
      method: 'PATCH',
      url: `/api/library-views/${id}`,
      headers: mutationHeaders(fixture.tokenA),
      payload: { name: 'Jazz favorito' }
    });
    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.json().view.name, 'Jazz favorito');

    const crossUserDelete = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/library-views/${id}`,
      headers: mutationHeaders(fixture.tokenB)
    });
    assert.equal(crossUserDelete.statusCode, 404);

    const deleted = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/library-views/${id}`,
      headers: mutationHeaders(fixture.tokenA)
    });
    assert.equal(deleted.statusCode, 204);
  } finally {
    await fixture.close();
  }
});
