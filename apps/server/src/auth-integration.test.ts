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
  enabled?: boolean;
  passwordMustChange?: boolean;
};

function insertUser(db: DatabaseSync, user: SeedUser) {
  const now = '2026-08-26T20:00:00.000Z';
  db.prepare(`
    INSERT INTO users (
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, 'hash-for-integration-test', ?, ?, ?, ?, ?, ?);
  `).run(
    user.id,
    user.username,
    user.username.toLowerCase(),
    user.role,
    user.enabled === false ? 0 : 1,
    user.passwordMustChange ? 1 : 0,
    now,
    now,
    now
  );
}

async function buildFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-auth-integration-'));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.close();

  const seed = new DatabaseSync(databasePath);
  insertUser(seed, { id: 'admin-1', username: 'Admin', role: 'admin' });
  insertUser(seed, { id: 'user-1', username: 'Maria', role: 'user' });
  insertUser(seed, {
    id: 'pending-1',
    username: 'Troca Pendente',
    role: 'admin',
    passwordMustChange: true
  });
  insertUser(seed, {
    id: 'disabled-1',
    username: 'Desativado',
    role: 'user',
    enabled: false
  });
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

  app.get('/api/profile', async request => ({ user: request.user }));
  app.patch<{ Params: { id: string }; Body: { name?: unknown } }>(
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
  const pendingToken = sessions.createSessionForUser('pending-1');
  const disabledToken = sessions.createSessionForUser('disabled-1');

  return {
    app,
    database,
    sessions,
    playlistId,
    adminToken,
    userToken,
    pendingToken,
    disabledToken,
    async close() {
      await app.close();
      adminUsers.close();
      authUsers.close();
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test('integra 401, 403 e 404 nas rotas administrativas reais', async () => {
  const fixture = await buildFixture();
  try {
    const unauthenticated = await fixture.app.inject({
      method: 'GET',
      url: '/api/admin/users'
    });
    assert.equal(unauthenticated.statusCode, 401);

    const forbidden = await fixture.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: cookie(fixture.userToken) }
    });
    assert.equal(forbidden.statusCode, 403);
    assert.deepEqual(forbidden.json(), { error: 'Acesso administrativo necessário.' });

    const notFound = await fixture.app.inject({
      method: 'PATCH',
      url: '/api/admin/users/usuario-inexistente/role',
      headers: mutationHeaders(fixture.adminToken),
      payload: { role: 'user' }
    });
    assert.equal(notFound.statusCode, 404);
    assert.deepEqual(notFound.json(), { error: 'Usuário não encontrado.' });

    const allowed = await fixture.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: cookie(fixture.adminToken) }
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().users.length, 4);
  } finally {
    await fixture.close();
  }
});

test('usuário desativado perde acesso e a sessão é invalidada no primeiro request', async () => {
  const fixture = await buildFixture();
  try {
    assert.equal(fixture.sessions.validateSession(fixture.disabledToken), true);

    const response = await fixture.app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { cookie: cookie(fixture.disabledToken) }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(fixture.sessions.validateSession(fixture.disabledToken), false);
  } finally {
    await fixture.close();
  }
});

test('troca obrigatória de senha bloqueia rota autenticada e rota admin antes do handler', async () => {
  const fixture = await buildFixture();
  try {
    const profile = await fixture.app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { cookie: cookie(fixture.pendingToken) }
    });
    assert.equal(profile.statusCode, 403);
    assert.deepEqual(profile.json(), {
      error: 'Troca de senha obrigatória antes de continuar.',
      code: 'PASSWORD_CHANGE_REQUIRED'
    });

    const admin = await fixture.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: cookie(fixture.pendingToken) }
    });
    assert.equal(admin.statusCode, 403);
    assert.equal(admin.json().code, 'PASSWORD_CHANGE_REQUIRED');
  } finally {
    await fixture.close();
  }
});

test('ownership usa userId da sessão e responde 404 sem revelar playlist de outra conta', async () => {
  const fixture = await buildFixture();
  try {
    const crossAccount = await fixture.app.inject({
      method: 'PATCH',
      url: `/api/personal-playlists/${fixture.playlistId}`,
      headers: mutationHeaders(fixture.adminToken),
      payload: { name: 'Tentativa do admin' }
    });
    assert.equal(crossAccount.statusCode, 404);

    const afterCrossAccount = fixture.database.getPlaylists('user-1')
      .find(playlist => playlist.id === fixture.playlistId);
    assert.equal(afterCrossAccount?.name, 'Privada da Maria');

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
