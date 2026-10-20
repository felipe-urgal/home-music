import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AccountPasswordService } from './account-password.js';
import { AdminOperationHistoryStore } from './admin-operation-history.js';
import { AdminUsersService } from './admin-users.js';
import { HomeMusicDatabase } from './database.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import { LibraryDuplicateReviewStore } from './library-duplicate-review.js';
import { LibraryMetadataNormalizationStore } from './library-metadata-normalization.js';
import { MediaFileMoveStore } from './media-file-move.js';
import { MediaQuarantineStore } from './media-quarantine.js';
import { OpenSubsonicCredentialStore } from './open-subsonic-credentials.js';
import { PersistentSessionManager } from './persistent-session-manager.js';
import { UserAuthStore } from './user-auth-store.js';

const cases: Array<{ label: string; open: (db: string, dir: string) => { close(): void } }> = [
  { label: 'assistant runs', open: db => new LibraryAssistantStore(db) },
  { label: 'metadata normalization', open: db => new LibraryMetadataNormalizationStore(db) },
  { label: 'duplicate review', open: (db, dir) => new LibraryDuplicateReviewStore({ databasePath: db, musicDir: dir }) },
  { label: 'media quarantine', open: (db, dir) => new MediaQuarantineStore(db, dir) },
  { label: 'media file moves', open: (db, dir) => new MediaFileMoveStore(db, dir) },
  { label: 'admin operation history', open: db => new AdminOperationHistoryStore(db) },
  { label: 'persistent sessions', open: db => new PersistentSessionManager(db) },
  { label: 'OpenSubsonic credentials', open: db => new OpenSubsonicCredentialStore(db) },
  { label: 'admin users', open: db => new AdminUsersService(db, {} as ConstructorParameters<typeof AdminUsersService>[1]) },
  { label: 'account password', open: db => new AccountPasswordService(db, {} as ConstructorParameters<typeof AccountPasswordService>[1]) },
  { label: 'user authentication', open: db => new UserAuthStore(db) }
];

test('SQLite store constructors close opened connections when PRAGMA setup throws', async t => {
  for (const scenario of cases) {
    await t.test(scenario.label, async subtest => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-sqlite-startup-cleanup-'));
      const dbPath = path.join(root, 'library.db');
      try {
        const database = new HomeMusicDatabase(dbPath);
        database.close();

        const failure = new Error('injected SQLite setup failure');
        const nativeClose = DatabaseSync.prototype.close;
        let closes = 0;
        subtest.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, _sql: string) {
          throw failure;
        });
        subtest.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
          closes++;
          return nativeClose.call(this);
        });
        try {
          assert.throws(() => scenario.open(dbPath, root), error => error === failure);
          assert.equal(closes, 1, scenario.label + ': constructor must release its opened SQLite connection');
        } finally {
          subtest.mock.restoreAll();
        }

        // The original database remains usable and the store can start again.
        const healthy = scenario.open(dbPath, root);
        healthy.close();
        const check = new DatabaseSync(dbPath);
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
    });
  }
});

test('constructor preserves setup exception even when close also fails', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-sqlite-setup-close-fail-'));
  const dbPath = path.join(root, 'library.db');
  try {
    const database = new HomeMusicDatabase(dbPath);
    database.close();

    const setupError = new Error('original SQLite setup error');
    const nativeClose = DatabaseSync.prototype.close;
    let closes = 0;
    t.mock.method(DatabaseSync.prototype, 'exec', function (_sql: string) {
      throw setupError;
    });
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      closes++;
      nativeClose.call(this);
      throw new Error('secondary SQLite close error');
    });
    assert.throws(() => new LibraryAssistantStore(dbPath), error => error === setupError);
    assert.equal(closes, 1);
  } finally {
    t.mock.restoreAll();
    await rm(root, { recursive: true, force: true });
  }
});
