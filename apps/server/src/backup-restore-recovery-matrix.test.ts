import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  BACKUP_DATABASE_FILE,
  BACKUP_MANIFEST_FILE,
  BackupValidationError,
  RestoreRollbackError,
  createBackupArtifact,
  restoreBackupArtifact,
  verifyBackupArtifact
} from './backup-restore.js';
import { HomeMusicDatabase } from './database.js';
import { CURRENT_SCHEMA_VERSION } from './sqlite-settings.js';

async function inTemporaryDatabase(run: (databasePath: string, outputRoot: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-backup-failure-matrix-'));
  try {
    await run(path.join(root, 'home-music.db'), path.join(root, 'backups'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function seedDatabase(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA user_version = 10;');
    db.exec('CREATE TABLE state(value TEXT NOT NULL);');
    db.prepare('INSERT INTO state(value) VALUES (?)').run('committed-before');
  } finally {
    db.close();
  }
}

function valueOf(databasePath: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return (db.prepare('SELECT value FROM state').get() as { value: string }).value;
  } finally {
    db.close();
  }
}

test('SQLite backup in WAL includes committed pages but excludes an open writer transaction', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    const writer = new DatabaseSync(databasePath);
    try {
      writer.exec('BEGIN IMMEDIATE;');
      writer.prepare('UPDATE state SET value = ?').run('uncommitted-writer');

      const first = await createBackupArtifact({
        databasePath, outputRoot, createId: () => 'wal-before-commit'
      });
      assert.equal(valueOf(path.join(first.artifactPath, BACKUP_DATABASE_FILE)), 'committed-before');
      await verifyBackupArtifact(first.artifactPath);

      writer.exec('COMMIT;');
      const second = await createBackupArtifact({
        databasePath, outputRoot, createId: () => 'wal-after-commit'
      });
      assert.equal(valueOf(path.join(second.artifactPath, BACKUP_DATABASE_FILE)), 'uncommitted-writer');
      await verifyBackupArtifact(second.artifactPath);
    } finally {
      if (writer.isTransaction) writer.exec('ROLLBACK;');
      writer.close();
    }
  });
});

test('manifest verification failure removes partial output and does not publish a final artifact', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    await assert.rejects(
      createBackupArtifact({
        databasePath, outputRoot,
        createId: () => 'oversized-manifest',
        env: { PORT: 'x'.repeat(70 * 1024) }
      }),
      (error: unknown) => error instanceof BackupValidationError && /limite de tamanho/i.test(error.message)
    );
    assert.deepEqual(await readdir(outputRoot), []);
    assert.equal(valueOf(databasePath), 'committed-before');
  });
});

test('backup artifacts are private and a second backup does not overwrite the first', async t => {
  if (process.platform === 'win32') {
    t.skip('POSIX file modes are not portable to Windows');
    return;
  }
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    const options = {
      databasePath, outputRoot,
      createId: () => 'stable-artifact',
      now: () => new Date('2026-10-20T11:00:00.000Z')
    };
    const first = await createBackupArtifact(options);
    for (const [filePath, expected] of [
      [outputRoot, 0o700],
      [first.artifactPath, 0o700],
      [path.join(first.artifactPath, BACKUP_DATABASE_FILE), 0o600],
      [path.join(first.artifactPath, BACKUP_MANIFEST_FILE), 0o600]
    ] as const) {
      assert.equal((await lstat(filePath)).mode & 0o777, expected, filePath);
    }

    await assert.rejects(createBackupArtifact(options));
    assert.deepEqual(await readdir(outputRoot), [path.basename(first.artifactPath)]);
    await verifyBackupArtifact(first.artifactPath);
    assert.equal(valueOf(path.join(first.artifactPath, BACKUP_DATABASE_FILE)), 'committed-before');
  });
});

test('verify rejects mismatched byte counts and same-length SHA tampering; restore leaves live DB untouched', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    const first = await createBackupArtifact({
      databasePath, outputRoot, createId: () => 'bytes-mismatch'
    });
    const second = await createBackupArtifact({
      databasePath, outputRoot, createId: () => 'hash-mismatch'
    });
    const live = new DatabaseSync(databasePath);
    try {
      live.prepare('UPDATE state SET value = ?').run('current-not-backup');
    } finally {
      live.close();
    }

    const manifestPath = path.join(first.artifactPath, BACKUP_MANIFEST_FILE);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      database: { bytes: number };
    };
    manifest.database.bytes += 1;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyBackupArtifact(first.artifactPath),
      (error: unknown) => error instanceof BackupValidationError && /Tamanho.*diverge/i.test(error.message)
    );
    await assert.rejects(restoreBackupArtifact(first.artifactPath, databasePath));
    assert.equal(valueOf(databasePath), 'current-not-backup');

    const snapshotPath = path.join(second.artifactPath, BACKUP_DATABASE_FILE);
    const original = await readFile(snapshotPath);
    const tampered = Buffer.from(original);
    const offset = tampered.indexOf('committed-before');
    assert.ok(offset >= 0, 'test fixture content must appear in SQLite file');
    tampered[offset] = 'C'.charCodeAt(0);
    assert.equal(tampered.length, original.length);
    await writeFile(snapshotPath, tampered);
    await assert.rejects(
      verifyBackupArtifact(second.artifactPath),
      (error: unknown) => error instanceof BackupValidationError && /SHA-256.*diverge/i.test(error.message)
    );
    await assert.rejects(restoreBackupArtifact(second.artifactPath, databasePath));
    assert.equal(valueOf(databasePath), 'current-not-backup');
  });
});

test('verification rejects symlinked manifest and database before touching the live DB', async t => {
  if (process.platform === 'win32') {
    t.skip('Creating symlinks can require elevated privileges on Windows');
    return;
  }
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    for (const filename of [BACKUP_MANIFEST_FILE, BACKUP_DATABASE_FILE]) {
      const artifact = await createBackupArtifact({
        databasePath, outputRoot, createId: () => 'symlink-' + filename.replace(/\W/g, '-')
      });
      const filePath = path.join(artifact.artifactPath, filename);
      const outside = path.join(path.dirname(databasePath), 'outside-' + filename);
      await copyFile(filePath, outside);
      await rm(filePath);
      await symlink(outside, filePath);
      await assert.rejects(
        verifyBackupArtifact(artifact.artifactPath),
        (error: unknown) => error instanceof BackupValidationError && /symlink/i.test(error.message)
      );
      await assert.rejects(restoreBackupArtifact(artifact.artifactPath, databasePath));
      assert.equal(valueOf(databasePath), 'committed-before');
    }
  });
});

test('rollback after replacement removes stale WAL/SHM and restores the previous database', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    const artifact = await createBackupArtifact({ databasePath, outputRoot });
    const current = new DatabaseSync(databasePath);
    try {
      current.prepare('UPDATE state SET value = ?').run('current-before-restore');
    } finally {
      current.close();
    }

    await assert.rejects(
      restoreBackupArtifact(artifact.artifactPath, databasePath, {
        afterReplace: async dbPath => {
          await writeFile(dbPath + '-wal', 'stale-wal');
          await writeFile(dbPath + '-shm', 'stale-shm');
          throw new Error('injected post-replace failure');
        }
      }),
      /injected post-replace failure/
    );
    // SQLite pode recriar sidecars vazios ao validar o snapshot do rollback;
    // o contrato é eliminar os bytes residuais, não proibir sidecars válidos.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = await readFile(databasePath + suffix).catch(() => null);
      assert.ok(!sidecar?.includes(Buffer.from('stale-')), suffix + ' preservou bytes obsoletos');
    }
    assert.equal(valueOf(databasePath), 'current-before-restore');
    await verifyBackupArtifact(artifact.artifactPath);
  });
});

test('failed rollback raises RestoreRollbackError and retains both original failure causes', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    const artifact = await createBackupArtifact({ databasePath, outputRoot });
    const live = new DatabaseSync(databasePath);
    try {
      live.prepare('UPDATE state SET value = ?').run('before-failed-rollback');
    } finally {
      live.close();
    }

    await assert.rejects(
      restoreBackupArtifact(artifact.artifactPath, databasePath, {
        afterReplace: async dbPath => {
          const names = await readdir(path.dirname(dbPath));
          const rollback = names.find(name => /^\.home-music-rollback-.*\.db$/.test(name));
          assert.ok(rollback, 'the rollback snapshot must exist after replacement');
          await rm(path.join(path.dirname(dbPath), rollback));
          throw new Error('injected restore failure');
        }
      }),
      (error: unknown) => {
        assert.ok(error instanceof RestoreRollbackError);
        assert.match(String(error.restoreError), /injected restore failure/);
        assert.ok(error.rollbackError);
        assert.match(error.message, /rollback automático também falhou/);
        return true;
      }
    );
    // When rollback itself fails, never claim the original database was recovered.
    assert.equal(valueOf(databasePath), 'committed-before');
    await verifyBackupArtifact(artifact.artifactPath);
  });
});

test('restore of a valid old-schema artifact can advance to current schema at next startup', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    const initial = new HomeMusicDatabase(databasePath);
    initial.close();
    const raw = new DatabaseSync(databasePath);
    try {
      raw.exec(
        "INSERT INTO metadata(key, value) VALUES ('restore-upgrade-marker', 'before-upgrade');"
      );
      raw.exec('ALTER TABLE track_hot_cues DROP COLUMN labels_json;');
      raw.exec('ALTER TABLE track_hot_cues DROP COLUMN colors_json;');
      raw.exec('PRAGMA user_version = 19;');
    } finally {
      raw.close();
    }

    const artifact = await createBackupArtifact({
      databasePath, outputRoot, createId: () => 'legacy-v19'
    });
    assert.equal(artifact.manifest.database.schemaVersion, 19);

    const intermediate = new HomeMusicDatabase(databasePath);
    intermediate.close();
    const edited = new DatabaseSync(databasePath);
    try {
      edited.exec("UPDATE metadata SET value = 'newer-live-value' WHERE key = 'restore-upgrade-marker';");
    } finally {
      edited.close();
    }

    await restoreBackupArtifact(artifact.artifactPath, databasePath);
    assert.deepEqual(
      (await readdir(path.dirname(databasePath))).filter(name => /^\.home-music-restore-/.test(name)),
      [],
      'staging database and WAL/SHM sidecars must be removed after successful restore'
    );
    const restored = new HomeMusicDatabase(databasePath);
    try {
      assert.equal(restored.getSchemaVersion(), CURRENT_SCHEMA_VERSION);
      assert.equal(restored.getMetadata('restore-upgrade-marker'), 'before-upgrade');
    } finally {
      restored.close();
    }
    const verify = new DatabaseSync(databasePath);
    try {
      assert.equal(
        (verify.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
        'ok'
      );
      assert.deepEqual(verify.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      verify.close();
    }
  });
});


test('corrupt SQLite with matching manifest hash is rejected before replacing the live database', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    const artifact = await createBackupArtifact({ databasePath, outputRoot });
    const snapshotPath = path.join(artifact.artifactPath, BACKUP_DATABASE_FILE);
    const manifestPath = path.join(artifact.artifactPath, BACKUP_MANIFEST_FILE);

    // Recalculate the digest to prove integrity_check is required even when SHA matches.
    const snapshot = await readFile(snapshotPath);
    snapshot[0] = 0; // Invalidate the SQLite header without changing the byte count.
    await writeFile(snapshotPath, snapshot);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      database: { sha256: string };
    };
    manifest.database.sha256 = createHash('sha256').update(snapshot).digest('hex');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const live = new DatabaseSync(databasePath);
    try {
      live.prepare('UPDATE state SET value = ?').run('live-stays-intact');
    } finally {
      live.close();
    }

    const expectedError = (error: unknown) => {
      assert.ok(error instanceof BackupValidationError);
      assert.match(error.message, /Não foi possível validar o SQLite do backup/);
      assert.doesNotMatch(error.message, /home-music-backup-failure-matrix-/);
      return true;
    };
    await assert.rejects(verifyBackupArtifact(artifact.artifactPath), expectedError);
    await assert.rejects(restoreBackupArtifact(artifact.artifactPath, databasePath), expectedError);
    assert.equal(valueOf(databasePath), 'live-stays-intact');
  });
});

test('future-schema artifact is rejected even when its digest and manifest are consistent', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    const artifact = await createBackupArtifact({ databasePath, outputRoot });
    const snapshotPath = path.join(artifact.artifactPath, BACKUP_DATABASE_FILE);
    const manifestPath = path.join(artifact.artifactPath, BACKUP_MANIFEST_FILE);
    const futureVersion = CURRENT_SCHEMA_VERSION + 1;

    const snapshotDb = new DatabaseSync(snapshotPath);
    try {
      snapshotDb.exec(`PRAGMA user_version = ${futureVersion};`);
    } finally {
      snapshotDb.close();
    }
    const snapshot = await readFile(snapshotPath);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      database: { bytes: number; sha256: string; schemaVersion: number };
    };
    manifest.database.bytes = snapshot.length;
    manifest.database.sha256 = createHash('sha256').update(snapshot).digest('hex');
    manifest.database.schemaVersion = futureVersion;
    await writeFile(manifestPath, JSON.stringify(manifest));

    const live = new DatabaseSync(databasePath);
    try {
      live.prepare('UPDATE state SET value = ?').run('newer-live-data');
    } finally {
      live.close();
    }

    await assert.rejects(
      verifyBackupArtifact(artifact.artifactPath),
      (error: unknown) => error instanceof BackupValidationError && /mais novo que o suportado/.test(error.message)
    );
    await assert.rejects(
      restoreBackupArtifact(artifact.artifactPath, databasePath),
      (error: unknown) => error instanceof BackupValidationError && /mais novo que o suportado/.test(error.message)
    );
    assert.equal(valueOf(databasePath), 'newer-live-data');
  });
});

test('creating backup from a future-schema database cleans up partial output', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    const db = new DatabaseSync(databasePath);
    try {
      db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION + 1};`);
    } finally {
      db.close();
    }

    await assert.rejects(
      createBackupArtifact({ databasePath, outputRoot, createId: () => 'future-schema' }),
      (error: unknown) => error instanceof BackupValidationError && /mais novo/.test(error.message)
    );
    assert.deepEqual(await readdir(outputRoot), []);
  });
});


test('failed restore into an empty target removes the newly installed DB and sidecars', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    const artifact = await createBackupArtifact({ databasePath, outputRoot });
    const emptyTarget = path.join(path.dirname(databasePath), 'empty-target.db');

    await assert.rejects(
      restoreBackupArtifact(artifact.artifactPath, emptyTarget, {
        afterReplace: async installedPath => {
          await writeFile(`${installedPath}-wal`, 'stale-wal');
          await writeFile(`${installedPath}-shm`, 'stale-shm');
          throw new Error('injected failure after initial installation');
        }
      }),
      /injected failure after initial installation/
    );

    for (const filePath of [emptyTarget, `${emptyTarget}-wal`, `${emptyTarget}-shm`]) {
      await assert.rejects(
        lstat(filePath),
        (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
      );
    }
    const leftovers = (await readdir(path.dirname(databasePath)))
      .filter(name => /^\.home-music-(restore|rollback)-/.test(name));
    assert.deepEqual(leftovers, []);
    assert.equal(valueOf(databasePath), 'committed-before');
    await verifyBackupArtifact(artifact.artifactPath);

    // A later retry can still install the verified artifact successfully.
    await restoreBackupArtifact(artifact.artifactPath, emptyTarget);
    assert.equal(valueOf(emptyTarget), 'committed-before');
    assert.deepEqual(
      (await readdir(path.dirname(databasePath))).filter(name => /^\.home-music-restore-/.test(name)),
      []
    );
  });
});

test('failed cleanup of a newly installed DB raises RestoreRollbackError', async () => {
  await inTemporaryDatabase(async (databasePath, outputRoot) => {
    seedDatabase(databasePath);
    const artifact = await createBackupArtifact({ databasePath, outputRoot });
    const emptyTarget = path.join(path.dirname(databasePath), 'empty-target.db');

    await assert.rejects(
      restoreBackupArtifact(artifact.artifactPath, emptyTarget, {
        afterReplace: async installedPath => {
          // A non-empty directory cannot be removed by the file-only sidecar cleanup.
          await rm(`${installedPath}-wal`, { force: true });
          await mkdir(`${installedPath}-wal`);
          await writeFile(path.join(`${installedPath}-wal`, 'sentinel'), 'do not discard');
          throw new Error('injected restore failure');
        }
      }),
      (error: unknown) => {
        assert.ok(error instanceof RestoreRollbackError);
        assert.match(String(error.restoreError), /injected restore failure/);
        assert.ok(error.rollbackError);
        return true;
      }
    );

    // Cleanup failed: the target may remain installed; do not claim recovery.
    assert.ok((await lstat(emptyTarget)).isFile());
    assert.equal(valueOf(databasePath), 'committed-before');
  });
});
