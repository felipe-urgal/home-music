import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import { AccountPasswordService } from './account-password.js';
import { hashPassword } from './password.js';
import {
  PERSISTENT_SESSION_EXPIRES_AT,
  PersistentSessionManager
} from './persistent-session-manager.js';

function insertUser(databasePath: string, id = 'user-1') {
  const db = new DatabaseSync(databasePath);
  const now = '2026-09-09T12:00:00.000Z';
  try {
    db.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, ?, ?, ?, 'admin', 1, 0, ?, ?, ?)
    `).run(id, id, id, `hash-${id}`, now, now, now);
  } finally {
    db.close();
  }
}

test('sessão persistente sobrevive ao restart e não armazena o token bruto', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-persistent-session-'));
  const databasePath = path.join(directory, 'home-music.db');

  try {
    const schema = new HomeMusicDatabase(databasePath);
    schema.close();
    insertUser(databasePath);

    const first = new PersistentSessionManager(databasePath);
    const token = first.createSessionForUser('user-1', 1_000);
    assert.equal(first.getSession(token, 2_000)?.userId, 'user-1');
    assert.equal(first.getSession(token, 2_000)?.expiresAt, PERSISTENT_SESSION_EXPIRES_AT);
    first.close();

    const raw = new DatabaseSync(databasePath);
    const row = raw.prepare(`
      SELECT token_hash FROM auth_sessions WHERE user_id = ?
    `).get('user-1') as { token_hash?: string } | undefined;
    raw.close();

    assert.equal(
      row?.token_hash,
      createHash('sha256').update(token).digest('hex')
    );
    assert.notEqual(row?.token_hash, token);

    const second = new PersistentSessionManager(databasePath);
    assert.equal(second.validateSession(token, Date.UTC(9999, 0, 1)), true);
    const sessions = second.listUserSessions('user-1', token, 5_000);
    assert.equal(sessions?.length, 1);
    assert.equal(sessions?.[0]?.current, true);
    assert.equal(sessions?.[0]?.expiresAt, PERSISTENT_SESSION_EXPIRES_AT);

    second.revokeSession(token);
    second.close();

    const third = new PersistentSessionManager(databasePath);
    assert.equal(third.validateSession(token), false);
    third.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sessão persistente mantém limite por usuário e revogação das outras sessões', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-persistent-session-limit-'));
  const databasePath = path.join(directory, 'home-music.db');

  try {
    const schema = new HomeMusicDatabase(databasePath);
    schema.close();
    insertUser(databasePath);

    const sessions = new PersistentSessionManager(databasePath, 8, 2);
    const first = sessions.createSessionForUser('user-1', 1_000);
    const second = sessions.createSessionForUser('user-1', 2_000);
    const third = sessions.createSessionForUser('user-1', 3_000);

    assert.equal(sessions.validateSession(first), false);
    assert.equal(sessions.validateSession(second), true);
    assert.equal(sessions.validateSession(third), true);
    assert.equal(sessions.listUserSessions('user-1', third)?.length, 2);
    assert.equal(sessions.revokeUserSessionsExcept('user-1', third), 1);
    assert.equal(sessions.validateSession(second), false);
    assert.equal(sessions.validateSession(third), true);
    sessions.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration mantém sessões existentes e preenche metadado somente em novas sessões', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-session-migration-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    const schema = new HomeMusicDatabase(databasePath);
    schema.close();
    insertUser(databasePath);

    const oldToken = 'token-da-sessao-antes-da-migration';
    const oldHash = createHash('sha256').update(oldToken).digest('hex');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE auth_sessions (
        token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash) = 64),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        authenticated_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
    `);
    legacy.prepare(`
      INSERT INTO auth_sessions(token_hash, user_id, created_at, authenticated_at, last_seen_at)
      VALUES (?, 'user-1', 1000, 1000, 1000)
    `).run(oldHash);
    legacy.close();

    const migrated = new PersistentSessionManager(databasePath);
    const oldSession = migrated.listUserSessions('user-1', oldToken, 2000);
    assert.equal(oldSession?.[0]?.clientName, null);
    assert.equal(oldSession?.[0]?.current, true);
    const fresh = migrated.createSessionForUser('user-1', 3000, 'Chrome · Linux');
    assert.equal(
      migrated.listUserSessions('user-1', fresh, 4000)?.find(s => s.current)?.clientName,
      'Chrome · Linux'
    );
    migrated.close();

    const restarted = new PersistentSessionManager(databasePath);
    assert.equal(restarted.validateSession(oldToken, 5000), true);
    assert.equal(restarted.validateSession(fresh, 5000), true);
    restarted.close();

    const raw = new DatabaseSync(databasePath);
    const rows = raw.prepare('SELECT token_hash, client_name FROM auth_sessions ORDER BY created_at').all() as
      Array<{ token_hash: string; client_name: string | null }>;
    assert.equal(rows[0]?.client_name, null);
    assert.equal(rows[1]?.client_name, 'Chrome · Linux');
    assert.ok(rows.every(row => row.token_hash.length === 64));
    raw.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('metadado de dispositivo não modifica ownership nem autorização das sessões', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-session-owner-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    const schema = new HomeMusicDatabase(databasePath);
    schema.close();
    insertUser(databasePath);
    insertUser(databasePath, 'user-2');

    const manager = new PersistentSessionManager(databasePath);
    const first = manager.createSessionForUser('user-1', 1000, 'Chrome · Linux');
    const second = manager.createSessionForUser('user-2', 2000, 'Chrome · Linux');
    const publicId = manager.listUserSessions('user-1', first)?.[0]?.id;
    assert.ok(publicId);
    assert.equal(manager.listUserSessions('user-1', second), null);
    assert.equal(manager.revokeUserSession('user-2', publicId, second), false);
    assert.equal(manager.revokeUserSession('user-1', publicId, second), null);
    assert.equal(manager.validateSession(first), true);
    assert.equal(manager.validateSession(second), true);
    manager.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('alterar senha revoga todas as sessões persistidas, inclusive atual', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-session-password-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    const schema = new HomeMusicDatabase(databasePath);
    schema.close();
    insertUser(databasePath);
    const raw = new DatabaseSync(databasePath);
    raw.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(await hashPassword('senha-antiga-segura-2026'), 'user-1');
    raw.close();

    const manager = new PersistentSessionManager(databasePath);
    const current = manager.createSessionForUser('user-1', 1000);
    const other = manager.createSessionForUser('user-1', 2000);
    const passwords = new AccountPasswordService(databasePath, manager);
    assert.deepEqual(
      await passwords.changeAuthenticatedPassword(
        'user-1', 'senha-antiga-segura-2026', 'senha-nova-segura-2026'
      ),
      { ok: true }
    );
    assert.equal(manager.validateSession(current), false);
    assert.equal(manager.validateSession(other), false);
    passwords.close();
    manager.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
