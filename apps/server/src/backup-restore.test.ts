import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { HomeMusicDatabase } from './database.js';
import {
  BACKUP_DATABASE_FILE,
  BACKUP_MANIFEST_FILE,
  BackupValidationError,
  MAX_SUPPORTED_SCHEMA_VERSION,
  createBackupArtifact,
  restoreBackupArtifact,
  verifyBackupArtifact
} from './backup-restore.js';

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'home-music-backup-'));
}

function createDatabase(databasePath: string, value: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA user_version = 10;');
    db.exec('CREATE TABLE state(value TEXT NOT NULL);');
    db.prepare('INSERT INTO state(value) VALUES (?)').run(value);
  } finally {
    db.close();
  }
}

function readState(databasePath: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return String((db.prepare('SELECT value FROM state LIMIT 1').get() as { value: string }).value);
  } finally {
    db.close();
  }
}

test('limite de schema do backup acompanha o schema atual do Home Music', async () => {
  const dir = await tempDir();
  const databasePath = path.join(dir, 'home-music.db');
  try {
    const db = new HomeMusicDatabase(databasePath);
    assert.equal(db.getSchemaVersion(), MAX_SUPPORTED_SCHEMA_VERSION);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cria snapshot SQLite consistente e inclui somente configuração operacional allowlisted', async () => {
  const dir = await tempDir();
  const databasePath = path.join(dir, 'home-music.db');
  const outputRoot = path.join(dir, 'backups');
  createDatabase(databasePath, 'antes');

  const writer = new DatabaseSync(databasePath);
  try {
    writer.prepare('UPDATE state SET value = ?').run('estado-no-wal');

    const result = await createBackupArtifact({
      databasePath,
      outputRoot,
      env: {
        MUSIC_DIR: '/srv/music',
        PORT: '8787',
        HOME_MUSIC_PASSWORD: 'nao-pode-vazar',
        API_TOKEN: 'nao-pode-vazar'
      },
      now: () => new Date('2026-08-28T18:40:00.000Z'),
      createId: () => '12345678-aaaa-bbbb-cccc-dddddddddddd'
    });

    assert.equal(readState(path.join(result.artifactPath, BACKUP_DATABASE_FILE)), 'estado-no-wal');
    assert.deepEqual(result.manifest.config, {
      MUSIC_DIR: '/srv/music',
      PORT: '8787'
    });
    const manifestText = await readFile(path.join(result.artifactPath, BACKUP_MANIFEST_FILE), 'utf8');
    assert.doesNotMatch(manifestText, /nao-pode-vazar|HOME_MUSIC_PASSWORD|API_TOKEN/);
    await verifyBackupArtifact(result.artifactPath);
  } finally {
    writer.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('falha na criação remove diretório parcial', async () => {
  const dir = await tempDir();
  const databasePath = path.join(dir, 'home-music.db');
  const outputRoot = path.join(dir, 'backups');
  try {
    await writeFile(databasePath, 'não é sqlite');
    await assert.rejects(() => createBackupArtifact({
      databasePath,
      outputRoot,
      createId: () => 'partial-cleanup-id'
    }));
    assert.deepEqual(await readdir(outputRoot), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verify detecta alteração do SQLite antes de qualquer restore', async () => {
  const dir = await tempDir();
  const databasePath = path.join(dir, 'home-music.db');
  createDatabase(databasePath, 'original');
  try {
    const result = await createBackupArtifact({ databasePath, outputRoot: path.join(dir, 'backups') });
    await writeFile(path.join(result.artifactPath, BACKUP_DATABASE_FILE), 'corrompido');
    await assert.rejects(
      () => verifyBackupArtifact(result.artifactPath),
      (error: unknown) => error instanceof BackupValidationError && /tamanho|SHA-256/i.test(error.message)
    );
    assert.equal(readState(databasePath), 'original');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verify rejeita configuração fora da allowlist mesmo com SQLite intacto', async () => {
  const dir = await tempDir();
  const databasePath = path.join(dir, 'home-music.db');
  createDatabase(databasePath, 'original');
  try {
    const result = await createBackupArtifact({ databasePath, outputRoot: path.join(dir, 'backups') });
    const manifestPath = path.join(result.artifactPath, BACKUP_MANIFEST_FILE);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.config = { HOME_MUSIC_PASSWORD: 'segredo' };
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await assert.rejects(
      () => verifyBackupArtifact(result.artifactPath),
      (error: unknown) => error instanceof BackupValidationError && /não permitida/i.test(error.message)
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('restore substitui o banco somente depois da validação e preserva o artefato', async () => {
  const dir = await tempDir();
  const databasePath = path.join(dir, 'home-music.db');
  createDatabase(databasePath, 'backup');
  try {
    const backupResult = await createBackupArtifact({ databasePath, outputRoot: path.join(dir, 'backups') });

    const live = new DatabaseSync(databasePath);
    live.prepare('UPDATE state SET value = ?').run('atual');
    live.close();
    assert.equal(readState(databasePath), 'atual');

    const restored = await restoreBackupArtifact(backupResult.artifactPath, databasePath);
    assert.equal(readState(databasePath), 'backup');
    assert.equal(restored.manifest.database.sha256, backupResult.manifest.database.sha256);
    await verifyBackupArtifact(backupResult.artifactPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('artefato inválido não toca no banco atual', async () => {
  const dir = await tempDir();
  const databasePath = path.join(dir, 'home-music.db');
  createDatabase(databasePath, 'valido');
  try {
    const backupResult = await createBackupArtifact({ databasePath, outputRoot: path.join(dir, 'backups') });
    await writeFile(path.join(backupResult.artifactPath, BACKUP_DATABASE_FILE), 'quebrado');

    await assert.rejects(() => restoreBackupArtifact(backupResult.artifactPath, databasePath));
    assert.equal(readState(databasePath), 'valido');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('falha depois da troca aciona rollback automático para o estado anterior', async () => {
  const dir = await tempDir();
  const databasePath = path.join(dir, 'home-music.db');
  createDatabase(databasePath, 'backup');
  try {
    const backupResult = await createBackupArtifact({ databasePath, outputRoot: path.join(dir, 'backups') });
    const live = new DatabaseSync(databasePath);
    live.prepare('UPDATE state SET value = ?').run('estado-atual');
    live.close();

    await assert.rejects(
      () => restoreBackupArtifact(backupResult.artifactPath, databasePath, {
        afterReplace: () => {
          throw new Error('falha simulada pós-troca');
        }
      }),
      /falha simulada/
    );
    assert.equal(readState(databasePath), 'estado-atual');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
