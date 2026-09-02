import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { AccountPasswordService } from './account-password.js';
import {
  LoginRateLimiter,
  SESSION_CAPACITY_RETRY_AFTER_SECONDS,
  SessionManager
} from './auth.js';
import { registerAuthRoutes } from './auth-routes.js';
import { HomeMusicDatabase } from './database.js';
import { hashPassword } from './password.js';
import { UserAuthStore } from './user-auth-store.js';

const ADMIN_PASSWORD = 'Admin-seguro-2026';
const USER_PASSWORD = 'Usuario-seguro-2026';

async function insertUser(
  databasePath: string,
  id: string,
  username: string,
  password: string,
  role: 'admin' | 'user'
) {
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const db = new DatabaseSync(databasePath);
  db.prepare(`
    INSERT INTO users (
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?);
  `).run(id, username, username.toLowerCase(), passwordHash, role, now, now, now);
  db.close();
}

test('login retorna 503 sem expulsar outra conta quando a capacidade global está cheia', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-auth-routes-'));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.close();

  await insertUser(databasePath, 'admin-1', 'admin', ADMIN_PASSWORD, 'admin');
  await insertUser(databasePath, 'user-1', 'user', USER_PASSWORD, 'user');

  const sessions = new SessionManager('', '', 10_000, 1, { status: 'blocked' });
  const adminToken = sessions.createSessionForUser('admin-1', 100);
  const authUsers = new UserAuthStore(databasePath);
  const accountPasswords = new AccountPasswordService(databasePath, sessions);
  const app = Fastify();

  registerAuthRoutes(app, {
    authConfigured: true,
    authUsers,
    sessions,
    accountPasswords,
    loginRateLimiter: new LoginRateLimiter(),
    forceSecureCookie: false,
    trustTailscaleForwardedFor: false
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'user', password: USER_PASSWORD }
    });

    assert.equal(response.statusCode, 503);
    assert.equal(
      response.headers['retry-after'],
      String(SESSION_CAPACITY_RETRY_AFTER_SECONDS)
    );
    assert.equal(response.headers['set-cookie'], undefined);
    assert.deepEqual(response.json(), {
      error: 'Capacidade de sessões temporariamente atingida. Tente novamente em instantes.'
    });
    assert.equal(sessions.getSession(adminToken, 200)?.userId, 'admin-1');
  } finally {
    await app.close();
    accountPasswords.close();
    authUsers.close();
    await rm(directory, { recursive: true, force: true });
  }
});
