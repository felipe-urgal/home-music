import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AdminUsersService } from './admin-users.js';
import { HomeMusicDatabase } from './database.js';

async function withService(run: (
  databasePath: string,
  service: AdminUsersService,
  revoked: string[]
) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-admin-invariants-'));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.close();

  const now = new Date().toISOString();
  const db = new DatabaseSync(databasePath);
  const insert = db.prepare(`
    INSERT INTO users (
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, 'hash-for-test', ?, 1, 0, ?, ?, ?);
  `);
  insert.run('admin-1', 'Admin Principal', 'admin principal', 'admin', now, now, now);
  insert.run('admin-2', 'Admin Secundario', 'admin secundario', 'admin', now, now, now);
  insert.run('user-1', 'Pessoa', 'pessoa', 'user', now, now, now);
  db.close();

  const revoked: string[] = [];
  const service = new AdminUsersService(databasePath, {
    revokeUserSessions(userId: string) {
      revoked.push(userId);
      return 1;
    }
  });

  try {
    await run(databasePath, service, revoked);
  } finally {
    service.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function activeAdminCount(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE role = 'admin' AND enabled = 1;
    `).get() as { total: number };
    return Number(row.total);
  } finally {
    db.close();
  }
}

test('role e enabled inválidos falham antes de mutar usuário ou revogar sessões', async () => {
  await withService(async (_databasePath, service, revoked) => {
    assert.deepEqual(service.setRole('admin-1', 'user-1', 'owner'), {
      ok: false,
      error: 'invalid-role'
    });
    assert.deepEqual(service.setEnabled('admin-1', 'user-1', 0), {
      ok: false,
      error: 'invalid-enabled'
    });

    assert.equal(service.getUser('user-1')?.role, 'user');
    assert.equal(service.getUser('user-1')?.enabled, true);
    assert.deepEqual(revoked, []);
  });
});

test('rebaixar outro admin revoga suas sessões e preserva pelo menos um admin ativo', async () => {
  await withService(async (databasePath, service, revoked) => {
    const result = service.setRole('admin-1', 'admin-2', 'user');

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.role, 'user');
    assert.equal(activeAdminCount(databasePath), 1);
    assert.deepEqual(revoked, ['admin-2']);
  });
});

test('último admin ativo não consegue se rebaixar nem se desativar pela API administrativa', async () => {
  await withService(async (databasePath, service, revoked) => {
    const demoteOther = service.setRole('admin-1', 'admin-2', 'user');
    assert.equal(demoteOther.ok, true);
    revoked.length = 0;

    assert.equal(activeAdminCount(databasePath), 1);
    assert.deepEqual(service.setRole('admin-1', 'admin-1', 'user'), {
      ok: false,
      error: 'self-management-not-allowed'
    });
    assert.deepEqual(service.setEnabled('admin-1', 'admin-1', false), {
      ok: false,
      error: 'self-management-not-allowed'
    });

    const currentAdmin = service.getUser('admin-1');
    assert.ok(currentAdmin);
    assert.equal(currentAdmin.role, 'admin');
    assert.equal(currentAdmin.enabled, true);
    assert.equal(activeAdminCount(databasePath), 1);
    assert.deepEqual(revoked, []);
  });
});
