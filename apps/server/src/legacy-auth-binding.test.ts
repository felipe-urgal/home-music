import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import {
  readLegacyAuthBindingFromEnvironment,
  resolveLegacyAuthBinding
} from './legacy-auth-binding.js';

async function withDatabase(run: (databasePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-auth-binding-'));
  const databasePath = path.join(directory, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  database.close();

  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function insertUser(databasePath: string, options: { id: string; username: string; normalized: string; enabled?: boolean }) {
  const db = new DatabaseSync(databasePath);
  try {
    const now = '2026-08-26T12:00:00.000Z';
    db.prepare(`
      INSERT INTO users (
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, ?, ?, 'hash-placeholder', 'admin', ?, 0, ?, ?, ?);
    `).run(options.id, options.username, options.normalized, options.enabled === false ? 0 : 1, now, now, now);
  } finally {
    db.close();
  }
}

test('binding preserva fallback legado somente enquanto users estiver vazio', async () => {
  await withDatabase(async databasePath => {
    assert.deepEqual(resolveLegacyAuthBinding(databasePath, 'felipe'), {
      status: 'legacy-uninitialized'
    });
  });
});

test('binding associa username legado ao usuário ativo persistido', async () => {
  await withDatabase(async databasePath => {
    insertUser(databasePath, {
      id: '11111111-1111-4111-8111-111111111111',
      username: 'Felipe',
      normalized: 'felipe'
    });

    assert.deepEqual(resolveLegacyAuthBinding(databasePath, '  Ｆｅｌｉｐｅ  '), {
      status: 'bound',
      userId: '11111111-1111-4111-8111-111111111111'
    });
  });
});

test('binding bloqueia credencial do env sem usuário ativo correspondente', async () => {
  await withDatabase(async databasePath => {
    insertUser(databasePath, {
      id: '11111111-1111-4111-8111-111111111111',
      username: 'Felipe',
      normalized: 'felipe',
      enabled: false
    });

    assert.deepEqual(resolveLegacyAuthBinding(databasePath, 'Felipe'), { status: 'blocked' });
    assert.deepEqual(resolveLegacyAuthBinding(databasePath, 'Outro'), { status: 'blocked' });
  });
});

test('binding bloqueia userId persistido fora do limite defensivo', async () => {
  await withDatabase(async databasePath => {
    insertUser(databasePath, {
      id: 'x'.repeat(129),
      username: 'Felipe',
      normalized: 'felipe'
    });

    assert.deepEqual(resolveLegacyAuthBinding(databasePath, 'Felipe'), { status: 'blocked' });
  });
});

test('produção sem estado calculado pelo preload falha fechado', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousState = process.env.HOME_MUSIC_INTERNAL_LEGACY_BINDING_STATE;
  const previousUserId = process.env.HOME_MUSIC_INTERNAL_LEGACY_BINDING_USER_ID;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.HOME_MUSIC_INTERNAL_LEGACY_BINDING_STATE;
    delete process.env.HOME_MUSIC_INTERNAL_LEGACY_BINDING_USER_ID;
    assert.deepEqual(readLegacyAuthBindingFromEnvironment(), { status: 'blocked' });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousState === undefined) delete process.env.HOME_MUSIC_INTERNAL_LEGACY_BINDING_STATE;
    else process.env.HOME_MUSIC_INTERNAL_LEGACY_BINDING_STATE = previousState;
    if (previousUserId === undefined) delete process.env.HOME_MUSIC_INTERNAL_LEGACY_BINDING_USER_ID;
    else process.env.HOME_MUSIC_INTERNAL_LEGACY_BINDING_USER_ID = previousUserId;
  }
});
