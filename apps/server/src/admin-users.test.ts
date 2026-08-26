import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AdminUsersService } from './admin-users.js';
import { HomeMusicDatabase } from './database.js';
import { verifyPassword } from './password.js';

async function withDatabase(run: (databasePath: string, revoked: string[]) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-admin-users-'));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.close();
  const revoked: string[] = [];

  const seed = new DatabaseSync(databasePath);
  const now = new Date().toISOString();
  seed.prepare(`
    INSERT INTO users (
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES ('admin-1', 'Admin', 'admin', 'hash-for-test', 'admin', 1, 0, ?, ?, ?);
  `).run(now, now, now);
  seed.close();

  try {
    await run(databasePath, revoked);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function serviceFor(databasePath: string, revoked: string[]) {
  return new AdminUsersService(databasePath, {
    revokeUserSessions(userId: string) {
      revoked.push(userId);
      return 1;
    }
  });
}

test('cria usuário normalizado com senha temporária forte sem expor hash', async () => {
  await withDatabase(async (databasePath, revoked) => {
    const service = serviceFor(databasePath, revoked);
    try {
      const result = await service.createUser('admin-1', '  Maria Silva  ', 'user');
      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.user.username, 'Maria Silva');
      assert.equal(result.value.user.role, 'user');
      assert.equal(result.value.user.enabled, true);
      assert.equal(result.value.user.passwordMustChange, true);
      assert.equal(result.value.temporaryPassword.length, 24);
      assert.equal('passwordHash' in result.value.user, false);
      assert.deepEqual(revoked, []);

      const db = new DatabaseSync(databasePath);
      const row = db.prepare(`
        SELECT username_normalized, password_hash, password_must_change
        FROM users
        WHERE id = ?;
      `).get(result.value.user.id) as Record<string, unknown>;
      db.close();

      assert.equal(row.username_normalized, 'maria silva');
      assert.equal(row.password_must_change, 1);
      assert.equal(typeof row.password_hash, 'string');
      assert.equal(await verifyPassword(result.value.temporaryPassword, String(row.password_hash)), true);
    } finally {
      service.close();
    }
  });
});

test('recusa username duplicado após normalização', async () => {
  await withDatabase(async (databasePath, revoked) => {
    const service = serviceFor(databasePath, revoked);
    try {
      const first = await service.createUser('admin-1', 'Felipe', 'admin');
      assert.equal(first.ok, true);
      const duplicate = await service.createUser('admin-1', '  FELIPE  ', 'user');
      assert.deepEqual(duplicate, { ok: false, error: 'duplicate-username' });
    } finally {
      service.close();
    }
  });
});

test('alterações sensíveis revogam sessões do alvo e bloqueiam auto-operação', async () => {
  await withDatabase(async (databasePath, revoked) => {
    const service = serviceFor(databasePath, revoked);
    try {
      const target = await service.createUser('admin-1', 'Convidado', 'user');
      assert.equal(target.ok, true);
      if (!target.ok) return;

      const targetId = target.value.user.id;

      assert.deepEqual(service.setRole('admin-1', 'admin-1', 'user'), {
        ok: false,
        error: 'self-management-not-allowed'
      });
      assert.deepEqual(service.setEnabled('admin-1', 'admin-1', false), {
        ok: false,
        error: 'self-management-not-allowed'
      });

      const role = service.setRole('admin-1', targetId, 'admin');
      assert.equal(role.ok, true);
      if (role.ok) assert.equal(role.value.role, 'admin');

      const disabled = service.setEnabled('admin-1', targetId, false);
      assert.equal(disabled.ok, true);
      if (disabled.ok) assert.equal(disabled.value.enabled, false);

      const reset = await service.resetPassword('admin-1', targetId);
      assert.equal(reset.ok, true);
      if (reset.ok) {
        assert.equal(reset.value.user.passwordMustChange, true);
        assert.equal(reset.value.temporaryPassword.length, 24);
      }

      const sessions = service.revokeSessions('admin-1', targetId);
      assert.deepEqual(sessions, { ok: true, value: { revokedSessions: 1 } });
      assert.deepEqual(revoked, [targetId, targetId, targetId, targetId]);
    } finally {
      service.close();
    }
  });
});

test('ator que deixou de ser admin não conclui mutação administrativa', async () => {
  await withDatabase(async (databasePath, revoked) => {
    const service = serviceFor(databasePath, revoked);
    try {
      const target = await service.createUser('admin-1', 'Pessoa', 'user');
      assert.equal(target.ok, true);
      if (!target.ok) return;

      const db = new DatabaseSync(databasePath);
      db.prepare("UPDATE users SET role = 'user' WHERE id = 'admin-1';").run();
      db.close();

      assert.deepEqual(service.setEnabled('admin-1', target.value.user.id, false), {
        ok: false,
        error: 'actor-no-longer-admin'
      });
      assert.deepEqual(revoked, []);
    } finally {
      service.close();
    }
  });
});
