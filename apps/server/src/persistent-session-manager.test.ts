import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
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
