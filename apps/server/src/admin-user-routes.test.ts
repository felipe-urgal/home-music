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

function insertUser(db: DatabaseSync, id: string, username: string, role: 'admin' | 'user') {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, 'hash-for-route-test', ?, 1, 0, ?, ?, ?);
  `).run(id, username, username.toLowerCase(), role, now, now, now);
}

async function buildApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-admin-routes-'));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.close();

  const seed = new DatabaseSync(databasePath);
  insertUser(seed, 'admin-1', 'Admin', 'admin');
  insertUser(seed, 'user-1', 'Usuario', 'user');
  insertUser(seed, 'target-1', 'Convidado', 'user');
  seed.close();

  const sessions = new SessionManager('legacy-admin', 'password-segura-2026');
  const authUsers = new UserAuthStore(databasePath);
  const adminUsers = new AdminUsersService(databasePath, sessions);
  const app = Fastify();

  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: authUsers
  });
  registerAdminUserRoutes(app, adminUsers);

  const adminToken = sessions.createSessionForUser('admin-1');
  const userToken = sessions.createSessionForUser('user-1');

  return {
    app,
    sessions,
    adminToken,
    userToken,
    async close() {
      await app.close();
      adminUsers.close();
      authUsers.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test('user comum recebe 403 e admin lista usuários sem campos sensíveis', async () => {
  const fixture = await buildApp();
  try {
    const forbidden = await fixture.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: cookie(fixture.userToken) }
    });
    assert.equal(forbidden.statusCode, 403);

    const response = await fixture.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: cookie(fixture.adminToken) }
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.users.length, 3);
    for (const user of body.users) {
      assert.deepEqual(
        Object.keys(user).sort(),
        ['createdAt', 'enabled', 'id', 'passwordChangedAt', 'passwordMustChange', 'role', 'updatedAt', 'username'].sort()
      );
      assert.equal('password_hash' in user, false);
      assert.equal('passwordHash' in user, false);
    }
  } finally {
    await fixture.close();
  }
});

test('admin cria usuário com senha temporária e rejeita duplicata normalizada', async () => {
  const fixture = await buildApp();
  try {
    const created = await fixture.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: mutationHeaders(fixture.adminToken),
      payload: { username: '  Nova Pessoa  ', role: 'user' }
    });
    assert.equal(created.statusCode, 201);
    const body = created.json();
    assert.equal(body.user.username, 'Nova Pessoa');
    assert.equal(body.user.role, 'user');
    assert.equal(body.user.passwordMustChange, true);
    assert.equal(body.temporaryPassword.length, 24);
    assert.equal('passwordHash' in body.user, false);

    const duplicate = await fixture.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: mutationHeaders(fixture.adminToken),
      payload: { username: 'NOVA PESSOA' }
    });
    assert.equal(duplicate.statusCode, 409);

    const invalidRole = await fixture.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: mutationHeaders(fixture.adminToken),
      payload: { username: 'Outro', role: 'owner' }
    });
    assert.equal(invalidRole.statusCode, 400);
  } finally {
    await fixture.close();
  }
});

test('admin altera outro usuário e sessões são revogadas imediatamente', async () => {
  const fixture = await buildApp();
  try {
    const targetToken = fixture.sessions.createSessionForUser('target-1');
    assert.equal(fixture.sessions.validateSession(targetToken), true);

    const role = await fixture.app.inject({
      method: 'PATCH',
      url: '/api/admin/users/target-1/role',
      headers: mutationHeaders(fixture.adminToken),
      payload: { role: 'admin' }
    });
    assert.equal(role.statusCode, 200);
    assert.equal(role.json().user.role, 'admin');
    assert.equal(fixture.sessions.validateSession(targetToken), false);

    const enabled = await fixture.app.inject({
      method: 'PATCH',
      url: '/api/admin/users/target-1/enabled',
      headers: mutationHeaders(fixture.adminToken),
      payload: { enabled: false }
    });
    assert.equal(enabled.statusCode, 200);
    assert.equal(enabled.json().user.enabled, false);

    const reset = await fixture.app.inject({
      method: 'POST',
      url: '/api/admin/users/target-1/password-reset',
      headers: mutationHeaders(fixture.adminToken)
    });
    assert.equal(reset.statusCode, 200);
    assert.equal(reset.json().temporaryPassword.length, 24);
    assert.equal(reset.json().user.passwordMustChange, true);

    const anotherTargetToken = fixture.sessions.createSessionForUser('target-1');
    const revoke = await fixture.app.inject({
      method: 'POST',
      url: '/api/admin/users/target-1/sessions/revoke',
      headers: mutationHeaders(fixture.adminToken)
    });
    assert.equal(revoke.statusCode, 200);
    assert.equal(revoke.json().revokedSessions, 1);
    assert.equal(fixture.sessions.validateSession(anotherTargetToken), false);
  } finally {
    await fixture.close();
  }
});

test('operações administrativas na própria conta são bloqueadas provisoriamente', async () => {
  const fixture = await buildApp();
  try {
    for (const request of [
      { method: 'PATCH' as const, url: '/api/admin/users/admin-1/role', payload: { role: 'user' } },
      { method: 'PATCH' as const, url: '/api/admin/users/admin-1/enabled', payload: { enabled: false } },
      { method: 'POST' as const, url: '/api/admin/users/admin-1/password-reset' },
      { method: 'POST' as const, url: '/api/admin/users/admin-1/sessions/revoke' }
    ]) {
      const response = await fixture.app.inject({
        ...request,
        headers: mutationHeaders(fixture.adminToken)
      });
      assert.equal(response.statusCode, 409, `${request.method} ${request.url}`);
    }
  } finally {
    await fixture.close();
  }
});
