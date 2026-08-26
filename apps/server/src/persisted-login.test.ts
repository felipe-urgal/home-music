import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AccountPasswordService } from './account-password.js';
import { bootstrapInitialAdmin } from './bootstrap-admin.js';
import { hashPassword } from './password.js';
import { SessionManager } from './auth.js';
import { UserAuthStore } from './user-auth-store.js';

test('login usa SQLite para admin e user mesmo sem credenciais no env', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'home-music-persisted-login-'));
  const databasePath = join(directory, 'home-music.db');
  try {
    const adminPassword = 'senha-admin-persistida';
    const bootstrap = await bootstrapInitialAdmin({
      databasePath,
      username: 'Admin',
      password: adminPassword
    });
    assert.equal(bootstrap.status, 'created');
    if (bootstrap.status !== 'created') return;

    const userPassword = 'senha-user-persistida';
    const userHash = await hashPassword(userPassword);
    const db = new DatabaseSync(databasePath);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES ('user-2', 'Pessoa', 'pessoa', ?, 'user', 1, 0, ?, ?, ?);
    `).run(userHash, now, now, now);
    db.close();

    const sessions = new SessionManager('', '', 10_000, 128, { status: 'blocked' });
    const passwords = new AccountPasswordService(databasePath, sessions);
    const users = new UserAuthStore(databasePath);
    try {
      assert.equal(users.isConfigured(), true);
      assert.deepEqual(
        await passwords.authenticate(' admin ', adminPassword),
        { userId: bootstrap.userId, passwordMustChange: false }
      );
      assert.deepEqual(
        await passwords.authenticate('PESSOA', userPassword),
        { userId: 'user-2', passwordMustChange: false }
      );
      assert.equal(await passwords.authenticate('Pessoa', 'senha-incorreta'), null);
      assert.equal(await passwords.authenticate('inexistente', userPassword), null);
    } finally {
      passwords.close();
      users.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('login persistido informa troca obrigatória da senha temporária', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'home-music-required-login-'));
  const databasePath = join(directory, 'home-music.db');
  try {
    await bootstrapInitialAdmin({
      databasePath,
      username: 'Admin',
      password: 'senha-admin-persistida'
    });

    const password = 'senha-temporaria-pessoa';
    const passwordHash = await hashPassword(password);
    const db = new DatabaseSync(databasePath);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES ('user-temp', 'Temporario', 'temporario', ?, 'user', 1, 1, ?, ?, ?);
    `).run(passwordHash, now, now, now);
    db.close();

    const sessions = new SessionManager('', '', 10_000, 128, { status: 'blocked' });
    const passwords = new AccountPasswordService(databasePath, sessions);
    try {
      assert.deepEqual(
        await passwords.authenticate('temporario', password),
        { userId: 'user-temp', passwordMustChange: true }
      );
    } finally {
      passwords.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
