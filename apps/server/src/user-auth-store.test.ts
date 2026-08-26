import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import { UserAuthStore } from './user-auth-store.js';

test('UserAuthStore retorna somente identidade mínima de usuário ativo', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-auth-user-'));
  const dbPath = path.join(temp, 'home-music.db');

  try {
    const schema = new HomeMusicDatabase(dbPath);
    schema.close();

    const raw = new DatabaseSync(dbPath);
    const now = '2026-08-26T12:00:00.000Z';
    raw.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run('admin-1', 'Felipe', 'felipe', 'hash-admin', 'admin', 1, now, now, now);
    raw.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run('user-2', 'Maria', 'maria', 'hash-user', 'user', 0, now, now, now);
    raw.close();

    const store = new UserAuthStore(dbPath);
    assert.deepEqual(store.getEnabledUserById('admin-1'), {
      id: 'admin-1',
      username: 'Felipe',
      role: 'admin'
    });
    assert.equal(store.getEnabledUserById('user-2'), null);
    assert.equal(store.getEnabledUserById('missing'), null);
    assert.equal(store.getEnabledUserById('x'.repeat(129)), null);
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
