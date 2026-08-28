import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBackupArtifact, restoreBackupArtifact, verifyBackupArtifact } from './backup-restore.js';

const dir = await mkdtemp(path.join(os.tmpdir(), 'home-music-backup-smoke-'));
const databasePath = path.join(dir, 'home-music.db');
const outputRoot = path.join(dir, 'backups');

try {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA user_version = 10;');
  db.exec('CREATE TABLE smoke(value TEXT NOT NULL);');
  db.prepare('INSERT INTO smoke(value) VALUES (?)').run('backup');
  db.close();

  const created = await createBackupArtifact({ databasePath, outputRoot, env: { PORT: '8787' } });
  await verifyBackupArtifact(created.artifactPath);

  const changed = new DatabaseSync(databasePath);
  changed.prepare('UPDATE smoke SET value = ?').run('alterado');
  changed.close();

  await restoreBackupArtifact(created.artifactPath, databasePath);

  const restored = new DatabaseSync(databasePath, { readOnly: true });
  const row = restored.prepare('SELECT value FROM smoke LIMIT 1').get() as { value: string };
  restored.close();
  assert.equal(row.value, 'backup');
  console.log('Backup/restore smoke OK');
} finally {
  await rm(dir, { recursive: true, force: true });
}
