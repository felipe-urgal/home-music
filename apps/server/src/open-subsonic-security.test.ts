import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import { OpenSubsonicCredentialStore } from './open-subsonic-credentials.js';
import { sanitizeRequestUrl } from './request-log.js';

function createUsers(databasePath: string) {
  const canonical = new HomeMusicDatabase(databasePath);
  canonical.close();

  const db = new DatabaseSync(databasePath);
  const now = '2026-09-05T00:00:00.000Z';
  db.prepare(`
    INSERT INTO users(
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES
      (?, ?, ?, ?, ?, 1, 0, ?, ?, NULL),
      (?, ?, ?, ?, ?, 1, 0, ?, ?, NULL);
  `).run(
    'user-a', 'alice', 'alice', 'test-hash-a', 'user', now, now,
    'user-b', 'bob', 'bob', 'test-hash-b', 'admin', now, now
  );
  db.close();
}

test('OpenSubsonic persiste somente hash da chave e preserva ownership ao reabrir', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-open-subsonic-key-'));
  const databasePath = path.join(root, 'home-music.db');
  createUsers(databasePath);

  try {
    let store = new OpenSubsonicCredentialStore(databasePath);
    const created = store.create('user-a', 'Meu celular');
    assert.ok(created);
    assert.match(created.token, /^hm_os_[A-Za-z0-9_-]+$/);
    assert.equal(created.key.name, 'Meu celular');
    assert.equal(store.list('user-a').length, 1);
    assert.deepEqual(store.list('user-b'), []);
    assert.deepEqual(store.authenticate(created.token), {
      keyId: created.key.id,
      user: { id: 'user-a', username: 'alice', role: 'user' }
    });
    store.close();

    const db = new DatabaseSync(databasePath);
    const row = db.prepare(`
      SELECT key_hash, key_hint
      FROM open_subsonic_api_keys
      WHERE id = ?;
    `).get(created.key.id) as { key_hash: string; key_hint: string };
    assert.equal(row.key_hash.length, 64);
    assert.notEqual(row.key_hash, created.token);
    assert.equal(JSON.stringify(row).includes(created.token), false);
    assert.equal(row.key_hint.includes(created.token), false);
    db.close();

    store = new OpenSubsonicCredentialStore(databasePath);
    assert.equal(store.authenticate(created.token)?.user.id, 'user-a');
    assert.equal(store.revoke('user-b', created.key.id), false);
    assert.equal(store.authenticate(created.token)?.user.id, 'user-a');
    assert.equal(store.revoke('user-a', created.key.id), true);
    assert.equal(store.authenticate(created.token), null);
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('OpenSubsonic invalida a chave quando a conta deixa de poder autenticar', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-open-subsonic-user-'));
  const databasePath = path.join(root, 'home-music.db');
  createUsers(databasePath);
  const store = new OpenSubsonicCredentialStore(databasePath);

  try {
    const created = store.create('user-a', 'Desktop');
    assert.ok(created);
    assert.equal(store.authenticate(created.token)?.user.username, 'alice');

    const db = new DatabaseSync(databasePath);
    db.prepare('UPDATE users SET enabled = 0 WHERE id = ?').run('user-a');
    assert.equal(store.authenticate(created.token), null);
    db.prepare('UPDATE users SET enabled = 1, password_must_change = 1 WHERE id = ?').run('user-a');
    assert.equal(store.authenticate(created.token), null);
    db.close();
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('logger HTTP remove apiKey e qualquer query string antes de registrar URL', () => {
  const raw = '/rest/getArtists.view?apiKey=hm_os_super-secret&c=test&v=1.16.1';
  const sanitized = sanitizeRequestUrl(raw);
  assert.equal(sanitized, '/rest/getArtists.view');
  assert.equal(sanitized.includes('hm_os_super-secret'), false);
});
