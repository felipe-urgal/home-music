import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  ACCOUNT_PASSWORD_MIN_LENGTH,
  AccountPasswordService,
  accountPasswordIsStrong
} from './account-password.js';
import { HomeMusicDatabase } from './database.js';
import { hashPassword, verifyPassword } from './password.js';

const TEMP_PASSWORD = 'Temporaria-segura-2026';
const NEW_PASSWORD = 'Nova-senha-segura-2026';

async function withPendingUser(
  run: (databasePath: string, service: AccountPasswordService, revoked: string[]) => Promise<void>
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-account-password-'));
  const databasePath = path.join(directory, 'data', 'test.db');
  const schema = new HomeMusicDatabase(databasePath);
  schema.close();

  const passwordHash = await hashPassword(TEMP_PASSWORD);
  const now = new Date().toISOString();
  const db = new DatabaseSync(databasePath);
  db.prepare(`
    INSERT INTO users (
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, ?, 'user', 1, 1, ?, ?, ?);
  `).run('user-1', 'Maria Silva', 'maria silva', passwordHash, now, now, now);
  db.close();

  const revoked: string[] = [];
  const service = new AccountPasswordService(databasePath, {
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

test('política de senha de conta exige comprimento forte sem alterar semanticamente a senha', () => {
  assert.equal(ACCOUNT_PASSWORD_MIN_LENGTH, 12);
  assert.equal(accountPasswordIsStrong('curta-demais'), false);
  assert.equal(accountPasswordIsStrong('senha-segura-2026'), true);
  assert.equal(accountPasswordIsStrong(' '.repeat(12)), true);
});

test('login transitório aceita somente credencial correta de conta ativa com troca pendente', async () => {
  await withPendingUser(async (databasePath, service) => {
    assert.equal(
      await service.authenticateRequiredPasswordChange('  MARIA SILVA  ', TEMP_PASSWORD),
      'user-1'
    );
    assert.equal(
      await service.authenticateRequiredPasswordChange('Maria Silva', 'senha-incorreta-2026'),
      null
    );
    assert.equal(
      await service.authenticateRequiredPasswordChange('usuario-inexistente', 'senha-incorreta-2026'),
      null
    );

    const db = new DatabaseSync(databasePath);
    db.prepare('UPDATE users SET password_must_change = 0 WHERE id = ?;').run('user-1');
    db.close();
    assert.equal(await service.authenticateRequiredPasswordChange('Maria Silva', TEMP_PASSWORD), null);
  });
});

test('credencial legada vinculada também precisa corresponder ao hash atual e usuário ativo', async () => {
  await withPendingUser(async (databasePath, service) => {
    assert.equal(await service.verifyEnabledUserPassword('user-1', TEMP_PASSWORD), true);
    assert.equal(await service.verifyEnabledUserPassword('user-1', 'senha-incorreta-2026'), false);

    const db = new DatabaseSync(databasePath);
    db.prepare('UPDATE users SET enabled = 0 WHERE id = ?;').run('user-1');
    db.close();
    assert.equal(await service.verifyEnabledUserPassword('user-1', TEMP_PASSWORD), false);
  });
});

test('troca obrigatória valida senha atual, força senha forte, limpa flag e revoga sessões', async () => {
  await withPendingUser(async (databasePath, service, revoked) => {
    assert.deepEqual(
      await service.changeRequiredPassword('user-1', 'senha-incorreta-2026', NEW_PASSWORD),
      { ok: false, error: 'invalid-current-password' }
    );
    assert.deepEqual(
      await service.changeRequiredPassword('user-1', TEMP_PASSWORD, 'curta'),
      { ok: false, error: 'weak-new-password' }
    );
    assert.deepEqual(
      await service.changeRequiredPassword('user-1', TEMP_PASSWORD, TEMP_PASSWORD),
      { ok: false, error: 'same-password' }
    );

    assert.deepEqual(
      await service.changeRequiredPassword('user-1', TEMP_PASSWORD, NEW_PASSWORD),
      { ok: true }
    );
    assert.deepEqual(revoked, ['user-1']);

    const db = new DatabaseSync(databasePath);
    const row = db.prepare(`
      SELECT password_hash, password_must_change, password_changed_at, updated_at
      FROM users
      WHERE id = ?;
    `).get('user-1') as Record<string, unknown>;
    db.close();

    assert.equal(row.password_must_change, 0);
    assert.equal(typeof row.password_changed_at, 'string');
    assert.equal(row.password_changed_at, row.updated_at);
    assert.equal(await verifyPassword(NEW_PASSWORD, String(row.password_hash)), true);
    assert.equal(await verifyPassword(TEMP_PASSWORD, String(row.password_hash)), false);
    assert.equal(await service.authenticateRequiredPasswordChange('Maria Silva', NEW_PASSWORD), null);
    assert.deepEqual(
      await service.changeRequiredPassword('user-1', NEW_PASSWORD, 'Outra-senha-segura-2026'),
      { ok: false, error: 'not-required' }
    );
  });
});

test('login pendente falha fechado se a conta for desativada enquanto scrypt está em andamento', async () => {
  await withPendingUser(async (databasePath, service) => {
    const authentication = service.authenticateRequiredPasswordChange('Maria Silva', TEMP_PASSWORD);
    await new Promise<void>(resolve => setImmediate(resolve));

    const db = new DatabaseSync(databasePath);
    db.prepare('UPDATE users SET enabled = 0 WHERE id = ?;').run('user-1');
    db.close();

    assert.equal(await authentication, null);
  });
});

test('troca obrigatória aborta se o hash mudar enquanto a nova senha é derivada', async () => {
  await withPendingUser(async (databasePath, service, revoked) => {
    const replacementHash = await hashPassword('Reset-concorrente-2026');
    const change = service.changeRequiredPassword('user-1', TEMP_PASSWORD, NEW_PASSWORD);
    await new Promise<void>(resolve => setImmediate(resolve));

    const db = new DatabaseSync(databasePath);
    db.prepare(`
      UPDATE users
      SET password_hash = ?, password_must_change = 1
      WHERE id = ?;
    `).run(replacementHash, 'user-1');
    db.close();

    assert.deepEqual(await change, { ok: false, error: 'stale-account' });
    assert.deepEqual(revoked, []);
  });
});
