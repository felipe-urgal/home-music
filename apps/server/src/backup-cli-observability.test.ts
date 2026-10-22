import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const cliPath = fileURLToPath(new URL('./backup-cli.ts', import.meta.url));
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const secret = 'private-test-secret-never-log';

function runCli(databasePath: string, args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME_MUSIC_DATABASE_PATH: databasePath,
      HOME_MUSIC_PASSWORD: secret
    },
    encoding: 'utf8',
    timeout: 30_000
  });
  assert.ifError(result.error);
  return result;
}

test('CLI reports backup metrics without exposing paths or secrets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-backup-metrics-'));
  const databasePath = path.join(root, 'home-music.db');
  const outputRoot = path.join(root, 'backups');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('CREATE TABLE probe(value TEXT); PRAGMA user_version = 1;');
  } finally {
    database.close();
  }

  try {
    const created = runCli(databasePath, ['create', '--output', outputRoot]);
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stderr, /Backup operation: operation=create status=success schemaVersion=1 durationMs=\d+/);

    const [artifactName] = await readdir(outputRoot);
    assert.ok(artifactName?.endsWith('.backup'));
    const artifactPath = path.join(outputRoot, artifactName);
    const verified = runCli(databasePath, ['verify', '--artifact', artifactPath]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stderr, /Backup operation: operation=verify status=success schemaVersion=1 durationMs=\d+/);

    const failed = runCli(databasePath, ['verify', '--artifact', path.join(root, 'absent.backup')]);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Backup operation: operation=verify status=failed schemaVersion=unknown durationMs=\d+/);

    const invalid = runCli(databasePath, ['restore', '--artifact', artifactPath]);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /Backup operation: operation=restore status=failed schemaVersion=unknown durationMs=\d+/);

    for (const result of [created, verified, failed, invalid]) {
      const metrics = result.stderr.split('\n').filter(line => line.startsWith('Backup operation:'));
      assert.equal(metrics.length, 1);
      assert.doesNotMatch(metrics[0], /private-test-secret|home-music\.db|backups|sha256|SHA-256/i);
      assert.doesNotMatch(result.stderr, /private-test-secret-never-log/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
