import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildAdminLibraryOverview } from './admin-library-overview.js';
import { recoverLocalAdmin } from './admin-recovery.js';
import { bootstrapInitialAdmin } from './bootstrap-admin.js';
import { HomeMusicDatabase } from './database.js';
import { ImportDuplicateDetectionManager } from './import-duplicate-detection.js';
import { resolveLegacyAuthBinding } from './legacy-auth-binding.js';
import { LibraryAssistantAutonomyStore } from './library-assistant-autonomy.js';
import { LibraryAssistantReviewPolicyStore } from './library-assistant-review-policy.js';
import { LibraryAssistantPersistentQueue } from './library-assistant-persistent-queue.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import { LibraryAssistantFingerprintCache } from './library-assistant-fingerprint-cache.js';
import { LibraryAssistantIncrementalIndex } from './library-assistant-incremental-index.js';
import { AccountPasswordService } from './account-password.js';
import { AdminUsersService } from './admin-users.js';
import { AdminOperationHistoryStore } from './admin-operation-history.js';
import { LibraryDuplicateReviewStore } from './library-duplicate-review.js';
import { MediaFileMoveStore } from './media-file-move.js';
import { MediaQuarantineStore } from './media-quarantine.js';
import { LibraryMetadataNormalizationStore } from './library-metadata-normalization.js';
import { TrackCoverOverrideStore } from './track-cover-overrides.js';
import { TrackMetadataOverrideStore } from './track-metadata-overrides.js';
import { OpenSubsonicCredentialStore } from './open-subsonic-credentials.js';
import { TrackLyricsOverrideStore } from './track-lyrics-overrides.js';
import { verifyPublicAccessAdmin } from './public-access-auth.js';
import { SQLITE_BUSY_TIMEOUT_MS } from './sqlite-settings.js';
import { DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY } from '@home-music/shared/library-assistant';

async function withDatabase(run: (databasePath: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-sqlite-contention-'));
  const databasePath = path.join(root, 'home-music.db');
  try {
    const initial = new HomeMusicDatabase(databasePath);
    initial.close();
    await run(databasePath);
    const check = new DatabaseSync(databasePath);
    try {
      assert.equal(
        (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
        'ok'
      );
    } finally {
      check.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('assistant autonomy write contention waits a bounded time and fails explicitly', async () => {
  await withDatabase(async databasePath => {
    const store = new LibraryAssistantAutonomyStore(databasePath);
    const lock = new DatabaseSync(databasePath);
    try {
      lock.exec('BEGIN IMMEDIATE;');
      lock.exec('UPDATE library_assistant_autonomy SET pending_revision = 1 WHERE singleton = 1;');
      const started = Date.now();
      assert.throws(() => store.setPending(2), (error: unknown) =>
        error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message)
      );
      assert.ok(
        Date.now() - started >= SQLITE_BUSY_TIMEOUT_MS - 1_000,
        'a conexão deve respeitar o tempo de espera configurado antes de falhar'
      );
      lock.exec('ROLLBACK;');
      store.setPending(2);
      assert.equal(store.get().pendingRevision, 2);
    } finally {
      try { lock.exec('ROLLBACK;'); } catch { /* Transaction may already be closed. */ }
      lock.close();
      store.close();
    }
  });
});

test('import duplicate read uses the shared SQLite timeout and retains its read-only mode', async t => {
  await withDatabase(async databasePath => {
    const statements: string[] = [];
    const nativeExec = DatabaseSync.prototype.exec;
    t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      statements.push(sql);
      return nativeExec.call(this, sql);
    });
    try {
      const manager = new ImportDuplicateDetectionManager({
        queue: {
          get: () => ({ status: 'pending', metadataPreview: {} })
        },
        staging: {},
        validatedLookup: () => ({
          jobId: 'example',
          size: 12,
          sha256: 'f'.repeat(64),
          validation: {}
        }),
        databasePath,
        musicDir: ''
      } as unknown as ConstructorParameters<typeof ImportDuplicateDetectionManager>[0]);
      const result = await manager.detect('example');
      assert.equal(result.confidence, 'none');
      const busyStatement = `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`;
      assert.ok(statements.includes(busyStatement));
      assert.ok(statements.includes('PRAGMA query_only = ON;'));
      assert.ok(statements.indexOf(busyStatement) < statements.indexOf('PRAGMA query_only = ON;'));
    } finally {
      t.mock.restoreAll();
    }
  });
});

test('short-lived SQLite helpers close on failure configuring busy_timeout', async t => {
  const cases = [
    { label: 'admin recovery', run: (db: string) => recoverLocalAdmin(db, 'admin') },
    { label: 'public access auth', run: (db: string) => verifyPublicAccessAdmin(db, 'admin', 'long-test-password-at-least-20-characters') },
    { label: 'legacy auth binding', run: (db: string) => resolveLegacyAuthBinding(db, 'admin') },
    { label: 'initial admin bootstrap', run: (db: string) =>
      bootstrapInitialAdmin({ databasePath: db, username: 'admin', password: 'a-sufficiently-long-password' }) }
  ];
  for (const scenario of cases) {
    await t.test(scenario.label, async subtest => {
      await withDatabase(async dbPath => {
        const nativeExec = DatabaseSync.prototype.exec;
        const nativeClose = DatabaseSync.prototype.close;
        const failure = new Error('injected SQLite pragma failure');
        const failAt = scenario.label === 'initial admin bootstrap' ? 2 : 1;
        let busyPragmas = 0;
        let closes = 0;
        subtest.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
          if (sql.includes('PRAGMA busy_timeout')) {
            busyPragmas++;
            if (busyPragmas === failAt) throw failure;
          }
          return nativeExec.call(this, sql);
        });
        subtest.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
          closes++;
          return nativeClose.call(this);
        });
        try {
          await assert.rejects(async () => scenario.run(dbPath), error => error === failure);
          assert.equal(busyPragmas, failAt);
          assert.equal(closes, failAt, 'cada conexão SQLite aberta deve ser fechada');
        } finally {
          subtest.mock.restoreAll();
        }
      });
    });
  }
});

test('admin overview closes connection if initial SQLite query fails', async t => {
  await withDatabase(async databasePath => {
    const nativePrepare = DatabaseSync.prototype.prepare;
    const nativeClose = DatabaseSync.prototype.close;
    const failure = new Error('injected overview query error');
    let closes = 0;
    t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
      if (sql.includes('FROM track_metadata_overrides')) throw failure;
      return nativePrepare.call(this, sql);
    });
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      closes++;
      return nativeClose.call(this);
    });
    try {
      await assert.rejects(
        buildAdminLibraryOverview([], {} as Parameters<typeof buildAdminLibraryOverview>[1], {
          databasePath,
          databaseBytes: 0
        }),
        error => error === failure
      );
      assert.equal(closes, 1);
    } finally {
      t.mock.restoreAll();
    }
  });
});

test('OpenSubsonic, managed lyrics and assistant review policy use the shared SQLite timeout', async t => {
  const cases: Array<{ name: string; open: (databasePath: string) => { close(): void } }> = [
    { name: 'OpenSubsonic API credentials', open: p => new OpenSubsonicCredentialStore(p) },
    { name: 'managed lyrics', open: p => new TrackLyricsOverrideStore(p) },
    { name: 'assistant review policy', open: p => new LibraryAssistantReviewPolicyStore(p) }
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async subtest => {
      await withDatabase(async databasePath => {
        const seen: string[] = [];
        const nativeExec = DatabaseSync.prototype.exec;
        subtest.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
          seen.push(sql);
          return nativeExec.call(this, sql);
        });
        try {
          const owner = scenario.open(databasePath);
          try {
            assert.ok(seen.includes(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`));
            assert.ok(seen.includes('PRAGMA foreign_keys = ON;'));
          } finally {
            owner.close();
          }
        } finally {
          subtest.mock.restoreAll();
        }
      });
    });
  }
});

test('assistant review policy write times out on a locked SQLite writer and succeeds after release', async () => {
  await withDatabase(async databasePath => {
    const store = new LibraryAssistantReviewPolicyStore(databasePath);
    const writer = new DatabaseSync(databasePath);
    try {
      writer.exec('BEGIN IMMEDIATE;');
      const start = Date.now();
      assert.throws(
        () => store.set(DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY),
        (error: unknown) => error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message)
      );
      assert.ok(
        Date.now() - start >= SQLITE_BUSY_TIMEOUT_MS - 1_000,
        'the write must respect the configured bounded timeout'
      );
      writer.exec('ROLLBACK;');
      assert.deepEqual(store.set(DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY), DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY);
    } finally {
      try { writer.exec('ROLLBACK;'); } catch { /* Transaction may be closed. */ }
      writer.close();
      store.close();
    }
  });
});


test('admin track metadata, normalization and cover stores use the canonical SQLite timeout', async t => {
  const scenarios: Array<{ name: string; open: (databasePath: string) => { close(): void } }> = [
    { name: 'metadata overrides', open: p => new TrackMetadataOverrideStore(p) },
    { name: 'metadata normalization', open: p => new LibraryMetadataNormalizationStore(p) },
    { name: 'cover overrides', open: p => new TrackCoverOverrideStore(p) }
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async subtest => {
      await withDatabase(async databasePath => {
        const seen: string[] = [];
        const nativeExec = DatabaseSync.prototype.exec;
        subtest.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
          seen.push(sql);
          return nativeExec.call(this, sql);
        });
        try {
          const store = scenario.open(databasePath);
          try {
            assert.ok(
              seen.includes(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`),
              scenario.name + ' must follow the shared SQLite contention policy'
            );
            assert.ok(seen.includes('PRAGMA foreign_keys = ON;'));
          } finally {
            store.close();
          }
        } finally {
          subtest.mock.restoreAll();
        }
      });
    });
  }
});

test('admin metadata write contention fails with SQLITE_BUSY and resumes after lock release', async () => {
  await withDatabase(async databasePath => {
    const store = new TrackMetadataOverrideStore(databasePath);
    const writer = new DatabaseSync(databasePath);
    try {
      writer.exec('BEGIN IMMEDIATE;');
      const start = Date.now();
      assert.throws(
        () => store.patch('track-not-found', { title: 'Não escrever' }),
        (error: unknown) => error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message)
      );
      assert.ok(
        Date.now() - start >= SQLITE_BUSY_TIMEOUT_MS - 1_000,
        'metadata writes must wait the configured bounded timeout before failing'
      );
      writer.exec('ROLLBACK;');
      assert.equal(store.patch('track-not-found', { title: 'Não escrever' }), null);
      const verify = new DatabaseSync(databasePath, { readOnly: true });
      try {
        assert.equal(
          (verify.prepare('SELECT count(*) AS total FROM track_metadata_overrides').get() as { total: number }).total,
          0
        );
      } finally {
        verify.close();
      }
    } finally {
      try { writer.exec('ROLLBACK;'); } catch { /* Transaction may be closed. */ }
      writer.close();
      store.close();
    }
  });
});


test('file-admin SQLite stores use the shared timeout while keeping foreign keys enabled', async t => {
  const cases: Array<{ name: string; open: (databasePath: string) => { close(): void } }> = [
    { name: 'duplicate review', open: p => new LibraryDuplicateReviewStore({ databasePath: p, musicDir: path.dirname(p) }) },
    { name: 'file move', open: p => new MediaFileMoveStore(p, path.dirname(p)) },
    { name: 'quarantine', open: p => new MediaQuarantineStore(p, path.dirname(p)) }
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async subtest => {
      await withDatabase(async databasePath => {
        const statements: string[] = [];
        const originalExec = DatabaseSync.prototype.exec;
        subtest.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
          statements.push(sql);
          return originalExec.call(this, sql);
        });
        try {
          const owner = scenario.open(databasePath);
          try {
            assert.ok(
              statements.includes(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`),
              scenario.name + ': expected canonical busy timeout'
            );
            assert.ok(statements.includes('PRAGMA foreign_keys = ON;'));
          } finally {
            owner.close();
          }
        } finally {
          subtest.mock.restoreAll();
        }
      });
    });
  }
});

test('duplicate-review write fails after bounded SQLite contention and recovers when lock releases', async () => {
  await withDatabase(async databasePath => {
    const store = new LibraryDuplicateReviewStore({
      databasePath,
      musicDir: path.dirname(databasePath)
    });
    const lock = new DatabaseSync(databasePath);
    try {
      lock.exec('BEGIN IMMEDIATE;');
      const started = Date.now();
      assert.throws(
        () => store.setIgnored(['track-a', 'track-b'], false),
        (error: unknown) => error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message)
      );
      assert.ok(
        Date.now() - started >= SQLITE_BUSY_TIMEOUT_MS - 1_000,
        'duplicate-review writer must fail after the bounded timeout, without retry loops'
      );
      lock.exec('ROLLBACK;');
      assert.equal(store.setIgnored(['track-a', 'track-b'], false).ignored, false);
      const verify = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const row = verify.prepare('SELECT COUNT(*) AS total FROM library_duplicate_ignores').get() as { total: number };
        assert.equal(row.total, 0);
      } finally {
        verify.close();
      }
    } finally {
      try { lock.exec('ROLLBACK;'); } catch { /* The transaction may already have ended. */ }
      lock.close();
      store.close();
    }
  });
});


test('password, admin user and operation history connections use the canonical SQLite timeout', async t => {
  const sessions = { revokeUserSessions: (_userId: string) => 0 };
  const scenarios: Array<{ name: string; open: (databasePath: string) => { close(): void }; foreignKeys: boolean }> = [
    { name: 'account passwords', open: db => new AccountPasswordService(db, sessions), foreignKeys: false },
    { name: 'admin users', open: db => new AdminUsersService(db, sessions), foreignKeys: true },
    { name: 'admin operation history', open: db => new AdminOperationHistoryStore(db), foreignKeys: false }
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async subtest => {
      await withDatabase(async databasePath => {
        const statements: string[] = [];
        const nativeExec = DatabaseSync.prototype.exec;
        subtest.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
          statements.push(sql);
          return nativeExec.call(this, sql);
        });
        try {
          const store = scenario.open(databasePath);
          try {
            assert.ok(
              statements.includes(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`),
              scenario.name + ' must use the shared bounded SQLite timeout'
            );
            if (scenario.foreignKeys) assert.ok(statements.includes('PRAGMA foreign_keys = ON;'));
            if (scenario.name === 'admin operation history') {
              assert.ok(statements.includes('PRAGMA journal_mode = WAL;'));
            }
          } finally {
            store.close();
          }
        } finally {
          subtest.mock.restoreAll();
        }
      });
    });
  }
});

test('admin operation history write times out on a held SQLite lock without recording a partial scan', async () => {
  await withDatabase(async databasePath => {
    const store = new AdminOperationHistoryStore(databasePath);
    const writer = new DatabaseSync(databasePath);
    try {
      writer.exec('BEGIN IMMEDIATE;');
      const started = Date.now();
      assert.throws(
        () => store.startScan('manual'),
        (error: unknown) => error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message)
      );
      assert.ok(
        Date.now() - started >= SQLITE_BUSY_TIMEOUT_MS - 1_000,
        'history writes must expire after the shared bounded timeout'
      );
      writer.exec('ROLLBACK;');
      const id = store.startScan('manual');
      const rows = store.list({ kind: 'scan' });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, id);
      assert.equal(rows[0].status, 'running');
    } finally {
      try { writer.exec('ROLLBACK;'); } catch { /* Transaction already finished. */ }
      writer.close();
      store.close();
    }
  });
});


test('assistant queue, incremental index and fingerprint cache use shared bounded SQLite timeout', async t => {
  const cases: Array<{ name: string; open: (databasePath: string) => { close(): void }; hasWal: boolean }> = [
    { name: 'persistent work queue', open: p => new LibraryAssistantPersistentQueue(p), hasWal: true },
    { name: 'incremental analysis index', open: p => new LibraryAssistantIncrementalIndex(p), hasWal: true },
    { name: 'fingerprint cache', open: p => new LibraryAssistantFingerprintCache(p), hasWal: false }
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async subtest => {
      await withDatabase(async databasePath => {
        if (scenario.name === 'persistent work queue') {
          const assistant = new LibraryAssistantStore(databasePath);
          assistant.close();
        }
        const statements: string[] = [];
        const nativeExec = DatabaseSync.prototype.exec;
        subtest.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
          statements.push(sql);
          return nativeExec.call(this, sql);
        });
        try {
          const owner = scenario.open(databasePath);
          try {
            assert.ok(
              statements.includes(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`),
              scenario.name + ' must use the central SQLite timeout'
            );
            assert.ok(statements.includes('PRAGMA foreign_keys = ON;'));
            if (scenario.hasWal) assert.ok(statements.includes('PRAGMA journal_mode = WAL;'));
          } finally {
            owner.close();
          }
        } finally {
          subtest.mock.restoreAll();
        }
      });
    });
  }
});

test('assistant queue claim explicitly expires on locked writer and recovers without partial claim', async () => {
  await withDatabase(async databasePath => {
    const assistant = new LibraryAssistantStore(databasePath);
    assistant.close();
    const queue = new LibraryAssistantPersistentQueue(databasePath);
    const writer = new DatabaseSync(databasePath);
    try {
      writer.exec('BEGIN IMMEDIATE;');
      const started = Date.now();
      assert.throws(
        () => queue.claimNext('missing-run', Date.now(), '2026-10-23T12:00:00.000Z'),
        (error: unknown) => error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message)
      );
      assert.ok(
        Date.now() - started >= SQLITE_BUSY_TIMEOUT_MS - 1_000,
        'the claim must fail after the canonical bounded SQLite timeout'
      );
      writer.exec('ROLLBACK;');
      assert.equal(queue.claimNext('missing-run', Date.now(), '2026-10-23T12:01:00.000Z'), null);
      const db = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const row = db.prepare('SELECT COUNT(*) AS total FROM library_assistant_work_items').get() as { total: number };
        assert.equal(row.total, 0);
      } finally {
        db.close();
      }
    } finally {
      try { writer.exec('ROLLBACK;'); } catch { /* Transaction already ended. */ }
      writer.close();
      queue.close();
    }
  });
});
