import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CURRENT_SCHEMA_VERSION } from './sqlite-settings.js';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const databaseModuleUrl = new URL('./database.ts', import.meta.url).href;
const secret = 'private-migration-test-secret-never-log';

function startWithMetrics(databasePath: string) {
  const script = `import { HomeMusicDatabase } from ${JSON.stringify(databaseModuleUrl)};
const database = new HomeMusicDatabase(process.env.HOME_MUSIC_TEST_DATABASE_PATH);
database.close();`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    cwd: projectRoot,
    env: { ...process.env, HOME_MUSIC_TEST_DATABASE_PATH: databasePath, HOME_MUSIC_PASSWORD: secret },
    encoding: 'utf8',
    timeout: 30_000
  });
  assert.ifError(result.error);
  const lines = result.stderr.split(/\r?\n/).filter(line => line.startsWith('SQLite migration:'));
  assert.equal(lines.length, 1, result.stderr);
  assert.doesNotMatch(lines[0], /private-migration-test-secret|home-music\.db|sha256|password_hash/i);
  assert.doesNotMatch(result.stderr, /private-migration-test-secret-never-log/);
  return { ...result, metric: lines[0] };
}

function assertMetric(metric: string, status: 'success' | 'skipped' | 'failed', from: number, to: number | 'unknown') {
  assert.match(metric, new RegExp(
    `^SQLite migration: status=${status} fromVersion=${from} toVersion=${to} durationMs=\\d+$`
  ));
}

test('SQLite startup reports upgrade and skipped migration without secrets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-migration-metrics-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    const created = startWithMetrics(databasePath);
    assert.equal(created.status, 0, created.stderr);
    assertMetric(created.metric, 'success', 0, CURRENT_SCHEMA_VERSION);

    const reopened = startWithMetrics(databasePath);
    assert.equal(reopened.status, 0, reopened.stderr);
    assertMetric(reopened.metric, 'skipped', CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);

    const raw = new DatabaseSync(databasePath);
    try {
      assert.equal((raw.prepare('PRAGMA user_version;').get() as { user_version: number }).user_version, CURRENT_SCHEMA_VERSION);
      assert.equal((raw.prepare('PRAGMA integrity_check;').get() as { integrity_check: string }).integrity_check, 'ok');
    } finally {
      raw.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed SQLite migration reports unknown target and preserves the original error', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-migration-failure-'));
  const databasePath = path.join(directory, 'home-music.db');
  const raw = new DatabaseSync(databasePath);
  try {
    // Inconsistent historical fixture: version 19 without the table required by v20.
    raw.exec('PRAGMA user_version = 19;');
  } finally {
    raw.close();
  }
  try {
    const failed = startWithMetrics(databasePath);
    assert.notEqual(failed.status, 0);
    assertMetric(failed.metric, 'failed', 19, 'unknown');
    assert.match(failed.stderr, /no such table: track_hot_cues/i);

    const inspected = new DatabaseSync(databasePath);
    try {
      assert.equal((inspected.prepare('PRAGMA user_version;').get() as { user_version: number }).user_version, 19);
      assert.equal((inspected.prepare('PRAGMA integrity_check;').get() as { integrity_check: string }).integrity_check, 'ok');
    } finally {
      inspected.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('future SQLite schema stays fail-closed and reports failed migration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-migration-future-'));
  const databasePath = path.join(directory, 'home-music.db');
  const raw = new DatabaseSync(databasePath);
  try {
    raw.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION + 1};`);
  } finally {
    raw.close();
  }
  try {
    const failed = startWithMetrics(databasePath);
    assert.notEqual(failed.status, 0);
    assertMetric(failed.metric, 'failed', CURRENT_SCHEMA_VERSION + 1, 'unknown');
    assert.match(failed.stderr, /Versão de schema SQLite não suportada/);

    const inspected = new DatabaseSync(databasePath);
    try {
      assert.equal((inspected.prepare('PRAGMA user_version;').get() as { user_version: number }).user_version, CURRENT_SCHEMA_VERSION + 1);
    } finally {
      inspected.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
