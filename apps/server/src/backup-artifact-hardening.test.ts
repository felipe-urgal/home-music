import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  BACKUP_MANIFEST_FILE,
  BackupValidationError,
  createBackupArtifact,
  restoreBackupArtifact,
  verifyBackupArtifact
} from './backup-restore.js';

function createDatabase(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA user_version = 10;');
    db.exec('CREATE TABLE state(value TEXT NOT NULL);');
    db.prepare('INSERT INTO state(value) VALUES (?)').run('ok');
  } finally {
    db.close();
  }
}

test('colisão de diretório parcial falha sem apagar conteúdo preexistente', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'home-music-backup-collision-'));
  const databasePath = path.join(dir, 'home-music.db');
  const outputRoot = path.join(dir, 'backups');
  const id = 'collision-id';
  const partialPath = path.join(outputRoot, `.home-music-${id}.partial`);
  const sentinelPath = path.join(partialPath, 'preserve.txt');

  try {
    createDatabase(databasePath);
    await mkdir(partialPath, { recursive: true });
    await writeFile(sentinelPath, 'não apagar');

    await assert.rejects(() => createBackupArtifact({
      databasePath,
      outputRoot,
      createId: () => id
    }));

    assert.equal(await readFile(sentinelPath, 'utf8'), 'não apagar');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verify rejeita manifesto acima do limite antes do parse', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'home-music-backup-manifest-limit-'));
  const databasePath = path.join(dir, 'home-music.db');

  try {
    createDatabase(databasePath);
    const result = await createBackupArtifact({
      databasePath,
      outputRoot: path.join(dir, 'backups')
    });
    await writeFile(path.join(result.artifactPath, BACKUP_MANIFEST_FILE), ' '.repeat(70 * 1024));

    await assert.rejects(
      () => verifyBackupArtifact(result.artifactPath),
      (error: unknown) => error instanceof BackupValidationError && /limite de tamanho/i.test(error.message)
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('create rejeita diretório de saída apontado por symlink', async t => {
  if (process.platform === 'win32') {
    t.skip('Criação de symlink de diretório pode exigir privilégios adicionais no Windows.');
    return;
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'home-music-backup-output-symlink-'));
  const databasePath = path.join(dir, 'home-music.db');
  const realOutput = path.join(dir, 'real-backups');
  const linkedOutput = path.join(dir, 'linked-backups');

  try {
    createDatabase(databasePath);
    await mkdir(realOutput);
    await symlink(realOutput, linkedOutput, 'dir');

    await assert.rejects(
      () => createBackupArtifact({ databasePath, outputRoot: linkedOutput }),
      (error: unknown) => error instanceof BackupValidationError && /sem symlink/i.test(error.message)
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test('metadata I/O errors are not mistaken for missing backup files', async t => {
  if (process.platform === 'win32') {
    t.skip('ENOTDIR differs across Windows filesystems');
    return;
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'home-music-backup-metadata-error-'));
  try {
    const notDirectory = path.join(dir, 'file-instead-of-directory');
    await writeFile(notDirectory, 'not a directory');

    const invalidDatabasePath = path.join(notDirectory, 'home-music.db');
    await assert.rejects(
      createBackupArtifact({ databasePath: invalidDatabasePath, outputRoot: path.join(dir, 'backups') }),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOTDIR'
    );
    await assert.rejects(
      verifyBackupArtifact(path.join(notDirectory, 'artifact.backup')),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOTDIR'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('restore aborts before staging when database metadata cannot be read', async t => {
  if (process.platform !== 'linux') {
    t.skip('Filename limit used for deterministic ENAMETOOLONG failure is Linux-specific');
    return;
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'home-music-restore-stat-error-'));
  const liveDatabasePath = path.join(dir, 'home-music.db');
  try {
    createDatabase(liveDatabasePath);
    const backup = await createBackupArtifact({
      databasePath: liveDatabasePath,
      outputRoot: path.join(dir, 'backups')
    });

    let beforeReplaceCalls = 0;
    await assert.rejects(
      restoreBackupArtifact(backup.artifactPath, path.join(dir, 'x'.repeat(256)), {
        beforeReplace: () => { beforeReplaceCalls += 1; }
      }),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENAMETOOLONG'
    );

    assert.equal(beforeReplaceCalls, 0);
    assert.deepEqual(
      (await readdir(dir)).filter(name => name.startsWith('.home-music-restore-')),
      []
    );
    const original = new DatabaseSync(liveDatabasePath, { readOnly: true });
    try {
      assert.deepEqual(original.prepare('SELECT value FROM state').all(), [{ value: 'ok' }]);
    } finally {
      original.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
