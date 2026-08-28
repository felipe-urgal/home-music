import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { BackupValidationError, createBackupArtifact, restoreBackupArtifact } from './backup-restore.js';

function writeDatabase(databasePath: string, value: string) {
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

function readValue(databasePath: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return String((db.prepare('SELECT value FROM state LIMIT 1').get() as { value: string }).value);
  } finally {
    db.close();
  }
}

test('beforeReplace pode abortar o restore sem tocar no banco atual', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'home-music-backup-before-replace-'));
  const databasePath = path.join(dir, 'home-music.db');
  writeDatabase(databasePath, 'backup');

  try {
    const artifact = await createBackupArtifact({
      databasePath,
      outputRoot: path.join(dir, 'backups')
    });

    const live = new DatabaseSync(databasePath);
    live.prepare('UPDATE state SET value = ?').run('estado-atual');
    live.close();

    let guardCalls = 0;
    await assert.rejects(
      () => restoreBackupArtifact(artifact.artifactPath, databasePath, {
        beforeReplace: () => {
          guardCalls += 1;
          throw new BackupValidationError('processo abriu o banco durante a preparação');
        }
      }),
      /processo abriu o banco/
    );

    assert.equal(guardCalls, 1);
    assert.equal(readValue(databasePath), 'estado-atual');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
