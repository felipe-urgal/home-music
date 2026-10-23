import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const cliPath = fileURLToPath(new URL('./backup-cli.ts', import.meta.url));
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const secret = 'private-test-secret-never-log';

function runCli(databasePath: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME_MUSIC_DATABASE_PATH: databasePath,
      HOME_MUSIC_PASSWORD: secret,
      ...extraEnv
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

    const notDirectory = path.join(root, 'file-instead-of-directory');
    await writeFile(notDirectory, 'this is not a directory');
    const ioFailure = runCli(databasePath, ['create', '--output', path.join(notDirectory, 'backups')]);
    assert.equal(ioFailure.status, 1);
    assert.match(ioFailure.stderr, /Falha no create: Falha de I\/O na operação de backup\/restore/);
    assert.match(ioFailure.stderr, /Backup operation: operation=create status=failed schemaVersion=unknown durationMs=\d+/);
    assert.doesNotMatch(ioFailure.stderr, /home-music-backup-metrics-|private-test-secret|ENOTDIR/);

    for (const result of [created, verified, failed, invalid, ioFailure]) {
      const metrics = result.stderr.split('\n').filter(line => line.startsWith('Backup operation:'));
      assert.equal(metrics.length, 1);
      assert.doesNotMatch(metrics[0], /private-test-secret|home-music\.db|backups|sha256|SHA-256/i);
      assert.doesNotMatch(result.stderr, /private-test-secret-never-log/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('restore refuses an active systemd service even with explicit operator confirmation', async t => {
  if (process.platform === 'win32') {
    t.skip('This test uses a POSIX systemctl double');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-restore-active-service-'));
  const databasePath = path.join(root, 'home-music.db');
  const outputRoot = path.join(root, 'backups');
  try {
    const db = new DatabaseSync(databasePath);
    try {
      db.exec("CREATE TABLE state(value TEXT NOT NULL); INSERT INTO state(value) VALUES ('backup'); PRAGMA user_version = 1;");
    } finally {
      db.close();
    }

    const created = runCli(databasePath, ['create', '--output', outputRoot]);
    assert.equal(created.status, 0, created.stderr);
    const [artifact] = await readdir(outputRoot);
    assert.ok(artifact?.endsWith('.backup'));

    const live = new DatabaseSync(databasePath);
    try {
      live.prepare('UPDATE state SET value = ?').run('must-survive');
    } finally {
      live.close();
    }

    const executableDir = path.join(root, 'commands');
    await mkdir(executableDir);
    const systemctlPath = path.join(executableDir, 'systemctl');
    await writeFile(systemctlPath, [
      '#!/bin/sh',
      'if [ "$1" = "is-active" ] && [ "$2" = "--quiet" ] && [ "$3" = "home-music.service" ]; then',
      '  exit 0',
      'fi',
      'exit 1',
      ''
    ].join('\n'));
    await chmod(systemctlPath, 0o755);

    const result = runCli(
      databasePath,
      ['restore', '--artifact', path.join(outputRoot, artifact), '--confirm-service-stopped'],
      { PATH: executableDir + path.delimiter + (process.env.PATH ?? '') }
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /home-music\.service ainda está ativo/);
    assert.match(result.stderr, /Backup operation: operation=restore status=blocked schemaVersion=unknown durationMs=\d+/);
    assert.doesNotMatch(result.stderr, /home-music-restore-active-service-|private-test-secret-never-log/);

    const unchanged = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const value = unchanged.prepare('SELECT value FROM state').get() as { value: string };
      assert.equal(value.value, 'must-survive');
    } finally {
      unchanged.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
