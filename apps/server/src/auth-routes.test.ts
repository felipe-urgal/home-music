import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { AccountPasswordService } from './account-password.js';
import {
  SESSION_CAPACITY_RETRY_AFTER_SECONDS,
  SessionManager
} from './auth.js';
import { registerAuthRoutes } from './auth-routes.js';
import { HomeMusicDatabase } from './database.js';
import {
  DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG,
  LoginAbuseProtection,
  type LoginAbuseProtectionConfig
} from './login-abuse-protection.js';
import { hashPassword } from './password.js';
import { UserAuthStore } from './user-auth-store.js';

const ADMIN_PASSWORD = 'Admin-seguro-2026';
const USER_PASSWORD = 'Usuario-seguro-2026';

function protectionConfig(
  overrides: Partial<LoginAbuseProtectionConfig> = {}
): LoginAbuseProtectionConfig {
  return Object.freeze({ ...DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG, ...overrides });
}

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

async function createAuthTestContext(prefix: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.close();
  const sessions = new SessionManager('', '', 5 * 60 * 1000, 128, { status: 'blocked' });
  const authUsers = new UserAuthStore(databasePath);
  const accountPasswords = new AccountPasswordService(databasePath, sessions);
  const app = Fastify();

  return {
    directory,
    databasePath,
    sessions,
    authUsers,
    accountPasswords,
    app,
    async close() {
      await app.close();
      accountPasswords.close();
      authUsers.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test('login retorna 503 sem expulsar outra conta quando a capacidade global está cheia', async () => {
  const context = await createAuthTestContext('home-music-auth-routes-capacity-');
  await insertUser(context.databasePath, 'admin-1', 'admin', ADMIN_PASSWORD, 'admin');
  await insertUser(context.databasePath, 'user-1', 'user', USER_PASSWORD, 'user');

  const sessions = new SessionManager('', '', 5 * 60 * 1000, 1, { status: 'blocked' });
  const adminToken = sessions.createSessionForUser('admin-1');
  const accountPasswords = new AccountPasswordService(context.databasePath, sessions);

  registerAuthRoutes(context.app, {
    authConfigured: true,
    authUsers: context.authUsers,
    sessions,
    accountPasswords,
    loginAbuseProtection: new LoginAbuseProtection(),
    forceSecureCookie: false,
    trustTailscaleForwardedFor: false
  });

  try {
    assert.equal(sessions.getSession(adminToken)?.userId, 'admin-1');

    const response = await context.app.inject({
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
    assert.equal(sessions.getSession(adminToken)?.userId, 'admin-1');
  } finally {
    accountPasswords.close();
    await context.close();
  }
});

test('login inválido mantém resposta pública igual para usuário existente e inexistente', async () => {
  const context = await createAuthTestContext('home-music-auth-routes-enumeration-');
  await insertUser(context.databasePath, 'user-1', 'user', USER_PASSWORD, 'user');

  registerAuthRoutes(context.app, {
    authConfigured: true,
    authUsers: context.authUsers,
    sessions: context.sessions,
    accountPasswords: context.accountPasswords,
    loginAbuseProtection: new LoginAbuseProtection(),
    forceSecureCookie: false,
    trustTailscaleForwardedFor: false
  });

  try {
    const existing = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'user', password: 'senha-incorreta' }
    });
    const missing = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'usuario-inexistente', password: 'senha-incorreta' }
    });

    assert.equal(existing.statusCode, 401);
    assert.equal(missing.statusCode, 401);
    assert.deepEqual(existing.json(), { error: 'Usuário ou senha inválidos.' });
    assert.deepEqual(missing.json(), existing.json());
    assert.equal(existing.headers['retry-after'], undefined);
    assert.equal(missing.headers['retry-after'], undefined);
  } finally {
    await context.close();
  }
});

test('login limita de forma determinística a concorrência de verificações de senha', async () => {
  const context = await createAuthTestContext('home-music-auth-routes-concurrency-');
  const protection = new LoginAbuseProtection(protectionConfig({
    ipMaxFailures: 100,
    identityMaxFailures: 100,
    maxConcurrentVerifications: 2,
    maxVerificationsPerWindow: 20
  }));
  let active = 0;
  let peak = 0;
  let started = 0;
  let resolveStarted!: () => void;
  let releaseVerifications!: () => void;
  const firstTwoStarted = new Promise<void>(resolve => { resolveStarted = resolve; });
  const release = new Promise<void>(resolve => { releaseVerifications = resolve; });

  context.accountPasswords.authenticate = async () => {
    active += 1;
    peak = Math.max(peak, active);
    started += 1;
    if (started === 2) resolveStarted();
    await release;
    active -= 1;
    return null;
  };

  registerAuthRoutes(context.app, {
    authConfigured: true,
    authUsers: context.authUsers,
    sessions: context.sessions,
    accountPasswords: context.accountPasswords,
    loginAbuseProtection: protection,
    forceSecureCookie: false,
    trustTailscaleForwardedFor: false
  });

  try {
    const first = context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'user-a', password: 'x' }
    });
    const second = context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'user-b', password: 'x' }
    });
    await firstTwoStarted;

    const rejected = await Promise.all(
      Array.from({ length: 4 }, (_, index) => context.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: `user-${index + 3}`, password: 'x' }
      }))
    );

    assert.equal(peak, 2);
    assert.equal(started, 2);
    for (const response of rejected) {
      assert.equal(response.statusCode, 429);
      assert.equal(response.headers['retry-after'], '1');
      assert.deepEqual(response.json(), {
        error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
      });
    }

    releaseVerifications();
    const completed = await Promise.all([first, second]);
    assert.deepEqual(completed.map(response => response.statusCode), [401, 401]);
    assert.equal(protection.metrics().verificationRejectedConcurrency, 4);
  } finally {
    releaseVerifications();
    await context.close();
  }
});
