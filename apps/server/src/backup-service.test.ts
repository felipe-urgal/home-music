import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { BackupService, BackupValidationError } from './backup-service.js';

function writeDatabase(databasePath: string, value: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS service_test (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    db.prepare('INSERT OR REPLACE INTO service_test (id, value) VALUES (1, ?)').run(value);
  } finally {
    db.close();
  }
}

function readDatabase(databasePath: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM service_test WHERE id = 1').get() as { value: string };
    return row.value;
  } finally {
    db.close();
  }
}

test('backup service rechecks offline guard immediately before restore replacement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-backup-service-'));
  try {
    const databasePath = path.join(root, 'home-music.db');
    writeDatabase(databasePath, 'backup-state');

    let blockerCalls = 0;
    const service = new BackupService({
      databasePath,
      defaultOutputRoot: path.join(root, 'backups'),
      env: { MUSIC_DIR: '/music', HOME_MUSIC_PASSWORD: 'must-not-leak' },
      restoreOfflineBlocker: async () => {
        blockerCalls += 1;
        return blockerCalls === 1 ? null : 'restore bloqueado antes da troca';
      }
    });

    const backup = await service.create();
    writeDatabase(databasePath, 'current-state');

    await assert.rejects(
      service.restore(backup.artifactPath),
      (error: unknown) => {
        assert.ok(error instanceof BackupValidationError);
        assert.equal(error.message, 'restore bloqueado antes da troca');
        return true;
      }
    );

    assert.equal(blockerCalls, 2);
    assert.equal(readDatabase(databasePath), 'current-state');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
