import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';

function seedVersion11(databasePath: string, withExistingCredentials: boolean) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL CHECK(length(username) BETWEEN 1 AND 120),
      username_normalized TEXT NOT NULL UNIQUE CHECK(length(username_normalized) BETWEEN 1 AND 120),
      password_hash TEXT NOT NULL CHECK(length(password_hash) > 0),
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      password_must_change INTEGER NOT NULL DEFAULT 0 CHECK(password_must_change IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      password_changed_at TEXT
    );
  `);
  db.prepare(`
    INSERT INTO users(
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, ?, 'user', 1, 0, ?, ?, NULL);
  `).run(
    'user-a',
    'alice',
    'alice',
    'test-hash',
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:00.000Z'
  );

  if (withExistingCredentials) {
    db.exec(`
      CREATE TABLE open_subsonic_api_keys (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
        key_hash TEXT NOT NULL UNIQUE CHECK(length(key_hash) = 64),
        key_hint TEXT NOT NULL CHECK(length(key_hint) BETWEEN 1 AND 24),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_open_subsonic_api_keys_user_created
      ON open_subsonic_api_keys(user_id, created_at DESC, id DESC);
    `);
    db.prepare(`
      INSERT INTO open_subsonic_api_keys(id, user_id, name, key_hash, key_hint, created_at)
      VALUES (?, ?, ?, ?, ?, ?);
    `).run(
      'legacy-key',
      'user-a',
      'Cliente existente',
      'a'.repeat(64),
      'hm_os_…legacy',
      '2026-09-05T00:00:00.000Z'
    );
  }

  db.exec('PRAGMA user_version = 11;');
  db.close();
}

async function withTempDatabase(run: (databasePath: string) => void | Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-open-subsonic-schema-'));
  const databasePath = path.join(root, 'home-music.db');
  try {
    await run(databasePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('migration v12 cria schema OpenSubsonic em banco v11 sem tabela', async () => {
  await withTempDatabase(databasePath => {
    seedVersion11(databasePath, false);

    const database = new HomeMusicDatabase(databasePath);
    assert.equal(database.getSchemaVersion(), 12);
    database.close();

    const db = new DatabaseSync(databasePath);
    const table = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'open_subsonic_api_keys';
    `).get() as { name?: string } | undefined;
    const index = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_open_subsonic_api_keys_user_created';
    `).get() as { name?: string } | undefined;
    assert.equal(table?.name, 'open_subsonic_api_keys');
    assert.equal(index?.name, 'idx_open_subsonic_api_keys_user_created');
    db.close();
  });
});

test('migration v12 preserva tabela e credenciais já criadas pelo store legado', async () => {
  await withTempDatabase(databasePath => {
    seedVersion11(databasePath, true);

    let database = new HomeMusicDatabase(databasePath);
    assert.equal(database.getSchemaVersion(), 12);
    database.close();

    let db = new DatabaseSync(databasePath);
    const row = db.prepare(`
      SELECT id, user_id, name, key_hash, key_hint, created_at
      FROM open_subsonic_api_keys
      WHERE id = 'legacy-key';
    `).get() as Record<string, unknown> | undefined;
    assert.equal(row?.id, 'legacy-key');
    assert.equal(row?.user_id, 'user-a');
    assert.equal(row?.name, 'Cliente existente');
    assert.equal(row?.key_hash, 'a'.repeat(64));
    db.close();

    database = new HomeMusicDatabase(databasePath);
    assert.equal(database.getSchemaVersion(), 12);
    database.close();

    db = new DatabaseSync(databasePath);
    assert.equal(
      Number((db.prepare(`SELECT COUNT(*) AS count FROM open_subsonic_api_keys WHERE id = 'legacy-key';`).get() as { count: number }).count),
      1
    );
    db.close();
  });
});
