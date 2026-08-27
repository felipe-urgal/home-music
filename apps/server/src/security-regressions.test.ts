import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminUserRoutes } from './admin-user-routes.js';
import { AdminUsersService } from './admin-users.js';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { HomeMusicDatabase } from './database.js';
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

type SeedUser = {
  id: string;
  username: string;
  role: 'admin' | 'user';
};

function insertUser(db: DatabaseSync, user: SeedUser) {
  const now = '2026-08-27T14:00:00.000Z';
  db.prepare(`
    INSERT INTO users (
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, 'hash-for-security-regression-test', ?, 1, 0, ?, ?, ?);
  `).run(
    user.id,
    user.username,
    user.username.toLowerCase(),
    user.role,
    now,
    now,
    now
  );
}

async function buildFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-security-regression-'));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.close();

  const seed = new DatabaseSync(databasePath);
  insertUser(seed, { id: 'admin-1', username: 'Admin', role: 'admin' });
  insertUser(seed, { id: 'user-1', username: 'Maria', role: 'user' });
  insertUser(seed, { id: 'user-2', username: 'Bruno', role: 'user' });
  seed.close();

  const database = new HomeMusicDatabase(databasePath);
  const sessions = new SessionManager('', '', undefined, undefined, { status: 'blocked' });
  const authUsers = new UserAuthStore(databasePath);
  const adminUsers = new AdminUsersService(databasePath, sessions);
  const app = Fastify();

  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: authUsers
  });
  registerAdminUserRoutes(app, adminUsers);

  app.post<{ Body: { id?: unknown; role?: unknown; user?: unknown } }>(
    '/api/security/identity',
    async request => ({ user: request.user })
  );

  // Regressão defensiva: mesmo que alguém configure uma rota admin como public,
  // o namespace /api/admin/* precisa continuar fail-closed na política central.
  app.post(
    '/api/admin/security-probe',
    { config: { auth: 'public' } },
    async () => ({ ok: true })
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: unknown; role?: unknown; user?: unknown };
  }>(
    '/api/personal-playlists/:id',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(409).send({ error: 'Playlist pessoal exige identidade persistida.' });
      }
      const name = typeof request.body?.name === 'string' ? request.body.name : '';
      if (!name || !database.renamePlaylist(request.user.id, request.params.id, name)) {
        return reply.code(404).send({ error: 'Playlist não encontrada.' });
      }
      return { ok: true };
    }
  );

  const playlistId = database.createPlaylist('user-1', 'Privada da Maria');
  const adminToken = sessions.createSessionForUser('admin-1');
  const userToken = sessions.createSessionForUser('user-1');
  const otherUserToken = sessions.createSessionForUser('user-2');

  return {
    app,
    database,
    playlistId,
    adminToken,
    userToken,
    otherUserToken,
    async close() {
      await app.close();
      adminUsers.close();
      authUsers.close();
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test('user não acessa /api/admin/* nem forjando role no payload', async () => {
  const fixture = await buildFixture();
  try {
    const list = await fixture.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: cookie(fixture.userToken) }
    });
    assert.equal(list.statusCode, 403);
    assert.deepEqual(list.json(), { error: 'Acesso administrativo necessário.' });

    const forgedCreate = await fixture.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: mutationHeaders(fixture.userToken),
      payload: { username: 'intruso', role: 'admin' }
    });
    assert.equal(forgedCreate.statusCode, 403);
    assert.deepEqual(forgedCreate.json(), { error: 'Acesso administrativo necessário.' });

    const misconfiguredRoute = await fixture.app.inject({
      method: 'POST',
      url: '/api/admin/security-probe',
      headers: mutationHeaders(fixture.userToken),
      payload: { role: 'admin' }
    });
    assert.equal(misconfiguredRoute.statusCode, 403);
    assert.deepEqual(misconfiguredRoute.json(), { error: 'Acesso administrativo necessário.' });

    const adminList = await fixture.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: cookie(fixture.adminToken) }
    });
    assert.equal(adminList.statusCode, 200);
    assert.equal(adminList.json().users.length, 3);
  } finally {
    await fixture.close();
  }
});

test('role e identidade vêm da sessão e ignoram payload adulterado', async () => {
  const fixture = await buildFixture();
  try {
    const response = await fixture.app.inject({
      method: 'POST',
      url: '/api/security/identity',
      headers: mutationHeaders(fixture.userToken),
      payload: {
        id: 'admin-1',
        role: 'admin',
        user: { id: 'admin-1', username: 'Admin', role: 'admin' }
      }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      user: { id: 'user-1', username: 'Maria', role: 'user' }
    });
  } finally {
    await fixture.close();
  }
});

test('recurso pessoal de outro user responde 404 e permanece inalterado', async () => {
  const fixture = await buildFixture();
  try {
    const crossUser = await fixture.app.inject({
      method: 'PATCH',
      url: `/api/personal-playlists/${fixture.playlistId}`,
      headers: mutationHeaders(fixture.otherUserToken),
      payload: { name: 'Tentativa do Bruno', role: 'admin' }
    });
    assert.equal(crossUser.statusCode, 404);

    const crossAdmin = await fixture.app.inject({
      method: 'PATCH',
      url: `/api/personal-playlists/${fixture.playlistId}`,
      headers: mutationHeaders(fixture.adminToken),
      payload: { name: 'Tentativa do admin' }
    });
    assert.equal(crossAdmin.statusCode, 404);

    const afterCrossAccess = fixture.database.getPlaylists('user-1')
      .find(playlist => playlist.id === fixture.playlistId);
    assert.equal(afterCrossAccess?.name, 'Privada da Maria');

    const owner = await fixture.app.inject({
      method: 'PATCH',
      url: `/api/personal-playlists/${fixture.playlistId}`,
      headers: mutationHeaders(fixture.userToken),
      payload: { name: 'Privada atualizada' }
    });
    assert.equal(owner.statusCode, 200);
    assert.deepEqual(owner.json(), { ok: true });

    const updated = fixture.database.getPlaylists('user-1')
      .find(playlist => playlist.id === fixture.playlistId);
    assert.equal(updated?.name, 'Privada atualizada');
  } finally {
    await fixture.close();
  }
});
