import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { bootstrapInitialAdmin } from './bootstrap-admin.js';
import { verifyPassword } from './password.js';
import { normalizeUsername } from './user-identity.js';

async function withDatabase(run: (databasePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-bootstrap-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readUsers(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(`
      SELECT id, username, username_normalized, password_hash, role, enabled,
             password_must_change, created_at, updated_at, password_changed_at
      FROM users
      ORDER BY created_at, id;
    `).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

test('normalizeUsername aplica trim, NFKC e lowercase sem aceitar controles', () => {
  assert.deepEqual(normalizeUsername('  Ｆｅｌｉｐｅ  '), {
    username: 'Felipe',
    usernameNormalized: 'felipe'
  });
  assert.equal(normalizeUsername(''), null);
  assert.equal(normalizeUsername('nome\nadmin'), null);
  assert.equal(normalizeUsername('a'.repeat(121)), null);
});

test('bootstrap cria exatamente o primeiro admin com hash e sem exigir troca de senha', async () => {
  await withDatabase(async databasePath => {
    const result = await bootstrapInitialAdmin({
      databasePath,
      username: 'Felipe',
      password: 'senha-bootstrap-segura-123',
      createId: () => '11111111-1111-4111-8111-111111111111',
      now: () => new Date('2026-08-26T12:00:00.000Z')
    });

    assert.deepEqual(result, {
      status: 'created',
      userId: '11111111-1111-4111-8111-111111111111'
    });

    const users = readUsers(databasePath);
    assert.equal(users.length, 1);
    assert.equal(users[0]?.id, '11111111-1111-4111-8111-111111111111');
    assert.equal(users[0]?.username, 'Felipe');
    assert.equal(users[0]?.username_normalized, 'felipe');
    assert.equal(users[0]?.role, 'admin');
    assert.equal(users[0]?.enabled, 1);
    assert.equal(users[0]?.password_must_change, 0);
    assert.equal(users[0]?.created_at, '2026-08-26T12:00:00.000Z');
    assert.equal(users[0]?.updated_at, '2026-08-26T12:00:00.000Z');
    assert.equal(users[0]?.password_changed_at, '2026-08-26T12:00:00.000Z');
    assert.notEqual(users[0]?.password_hash, 'senha-bootstrap-segura-123');
    assert.equal(
      await verifyPassword('senha-bootstrap-segura-123', String(users[0]?.password_hash)),
      true
    );
  });
});

test('bootstrap é idempotente e nunca sobrescreve o admin após inicialização', async () => {
  await withDatabase(async databasePath => {
    const first = await bootstrapInitialAdmin({
      databasePath,
      username: 'admin-original',
      password: 'senha-original-segura-123'
    });
    assert.equal(first.status, 'created');

    const before = readUsers(databasePath);
    const originalHash = String(before[0]?.password_hash);

    const second = await bootstrapInitialAdmin({
      databasePath,
      username: 'outro-admin',
      password: 'outra-senha-segura-456'
    });

    assert.deepEqual(second, { status: 'already-initialized' });
    const after = readUsers(databasePath);
    assert.equal(after.length, 1);
    assert.equal(after[0]?.username, 'admin-original');
    assert.equal(after[0]?.password_hash, originalHash);
    assert.equal(await verifyPassword('senha-original-segura-123', originalHash), true);
    assert.equal(await verifyPassword('outra-senha-segura-456', originalHash), false);
  });
});

test('bootstrap não cria usuário quando as credenciais legadas não cabem nas regras seguras', async () => {
  await withDatabase(async databasePath => {
    const invalidUsername = await bootstrapInitialAdmin({
      databasePath,
      username: '   ',
      password: 'senha-bootstrap-segura-123'
    });
    assert.deepEqual(invalidUsername, {
      status: 'credentials-not-bootstrapable',
      reason: 'username'
    });
    assert.equal(readUsers(databasePath).length, 0);

    const invalidPassword = await bootstrapInitialAdmin({
      databasePath,
      username: 'admin',
      password: 'curta'
    });
    assert.deepEqual(invalidPassword, {
      status: 'credentials-not-bootstrapable',
      reason: 'password'
    });
    assert.equal(readUsers(databasePath).length, 0);
  });
});

test('bootstrap concorrente continua criando no máximo um administrador', async () => {
  await withDatabase(async databasePath => {
    const [first, second] = await Promise.all([
      bootstrapInitialAdmin({
        databasePath,
        username: 'admin-a',
        password: 'senha-admin-a-segura-123'
      }),
      bootstrapInitialAdmin({
        databasePath,
        username: 'admin-b',
        password: 'senha-admin-b-segura-123'
      })
    ]);

    assert.deepEqual(
      [first.status, second.status].sort(),
      ['already-initialized', 'created']
    );
    assert.equal(readUsers(databasePath).length, 1);
  });
});
