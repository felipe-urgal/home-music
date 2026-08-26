import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { recoverLocalAdmin } from './admin-recovery.js';
import { bootstrapInitialAdmin } from './bootstrap-admin.js';
import { verifyPassword } from './password.js';

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'home-music-admin-recovery-'));
  return {
    directory,
    databasePath: join(directory, 'home-music.db')
  };
}

test('recuperação local redefine credencial e mantém a conta existente', async () => {
  const fixture = temporaryDatabase();
  try {
    await bootstrapInitialAdmin({
      databasePath: fixture.databasePath,
      username: 'Administrador',
      password: 'senha-original-segura'
    });

    const db = new DatabaseSync(fixture.databasePath);
    db.prepare(`
      UPDATE users
      SET role = 'user', enabled = 0
      WHERE username_normalized = 'administrador';
    `).run();
    const before = db.prepare(`
      SELECT id, password_hash
      FROM users
      WHERE username_normalized = 'administrador';
    `).get() as { id: string; password_hash: string };
    db.close();

    const result = await recoverLocalAdmin(fixture.databasePath, '  ADMINISTRADOR  ');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.username, 'Administrador');
    assert.equal(result.temporaryPassword.length >= 20, true);

    const verifyDb = new DatabaseSync(fixture.databasePath);
    const after = verifyDb.prepare(`
      SELECT id, role, enabled, password_must_change, password_hash
      FROM users
      WHERE username_normalized = 'administrador';
    `).get() as {
      id: string;
      role: string;
      enabled: number;
      password_must_change: number;
      password_hash: string;
    };
    verifyDb.close();

    assert.equal(after.id, before.id);
    assert.equal(after.role, 'admin');
    assert.equal(after.enabled, 1);
    assert.equal(after.password_must_change, 1);
    assert.notEqual(after.password_hash, before.password_hash);
    assert.equal(await verifyPassword(result.temporaryPassword, after.password_hash), true);
    assert.equal(await verifyPassword('senha-original-segura', after.password_hash), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('recuperação local não cria usuário inexistente', async () => {
  const fixture = temporaryDatabase();
  try {
    await bootstrapInitialAdmin({
      databasePath: fixture.databasePath,
      username: 'admin',
      password: 'senha-original-segura'
    });

    assert.deepEqual(
      await recoverLocalAdmin(fixture.databasePath, 'inexistente'),
      { ok: false, error: 'not-found' }
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
