import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import { LibraryAssistantAutonomyStore } from './library-assistant-autonomy.js';
import { LibraryAssistantCompositeReviewService } from './library-assistant-composite-review-service.js';
import { LibraryAssistantReviewService } from './library-assistant-review-service.js';

type Closeable = { close(): void };
const stores: Array<{
  label: string;
  setupStatements: number;
  open(databasePath: string): Closeable;
}> = [
  {
    label: 'assistant autonomy',
    setupStatements: 1,
    open: databasePath => new LibraryAssistantAutonomyStore(databasePath)
  },
  {
    label: 'assistant metadata/artwork decisions',
    setupStatements: 2,
    open: databasePath => new LibraryAssistantReviewService(
      { databasePath } as ConstructorParameters<typeof LibraryAssistantReviewService>[0]
    )
  },
  {
    label: 'assistant lyrics decisions',
    setupStatements: 2,
    open: databasePath => new LibraryAssistantCompositeReviewService(
      {
        databasePath,
        base: { close() {} }
      } as unknown as ConstructorParameters<typeof LibraryAssistantCompositeReviewService>[0]
    )
  }
];

async function withDatabase(run: (databasePath: string) => Promise<void> | void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-sqlite-init-'));
  const databasePath = path.join(directory, 'home-music.db');
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
    await rm(directory, { recursive: true, force: true });
  }
}

test('assistant SQLite constructors release opened connections on each failing setup statement', async t => {
  for (const scenario of stores) {
    for (let failAt = 1; failAt <= scenario.setupStatements; failAt++) {
      await t.test(scenario.label + ' statement ' + failAt, async subtest => {
        await withDatabase(databasePath => {
          const originalExec = DatabaseSync.prototype.exec;
          const originalClose = DatabaseSync.prototype.close;
          let executions = 0;
          let closes = 0;
          const failure = new Error('injected SQLite initialization failure');

          subtest.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
            executions++;
            if (executions === failAt) throw failure;
            return originalExec.call(this, sql);
          });
          subtest.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
            closes++;
            return originalClose.call(this);
          });
          try {
            assert.throws(() => scenario.open(databasePath), error => error === failure);
            assert.equal(closes, 1, scenario.label + ' must close its failed connection exactly once');
            assert.equal(executions, failAt);
          } finally {
            subtest.mock.restoreAll();
          }

          const recovered = scenario.open(databasePath);
          recovered.close();
        });
      });
    }
  }
});

test('autonomy initialization closes connection on real DDL/schema mismatch, then recovers', async t => {
  await withDatabase(databasePath => {
    const sql = new DatabaseSync(databasePath);
    try {
      sql.exec('CREATE TABLE library_assistant_autonomy (singleton INTEGER PRIMARY KEY);');
    } finally {
      sql.close();
    }

    const originalClose = DatabaseSync.prototype.close;
    let closes = 0;
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      closes++;
      return originalClose.call(this);
    });
    try {
      assert.throws(
        () => new LibraryAssistantAutonomyStore(databasePath),
        /no column named enabled|has no column named enabled/i
      );
      assert.equal(closes, 1);
    } finally {
      t.mock.restoreAll();
    }

    const repair = new DatabaseSync(databasePath);
    try {
      repair.exec('DROP TABLE library_assistant_autonomy;');
    } finally {
      repair.close();
    }
    const healthy = new LibraryAssistantAutonomyStore(databasePath);
    assert.equal(healthy.get().config.enabled, false);
    healthy.close();
  });
});

test('assistant SQLite setup error is preserved when closing the failed connection also errors', async t => {
  await withDatabase(databasePath => {
    const originalClose = DatabaseSync.prototype.close;
    const failure = new Error('initialization error');
    let closeAttempts = 0;
    t.mock.method(DatabaseSync.prototype, 'exec', () => { throw failure; });
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      closeAttempts++;
      originalClose.call(this);
      throw new Error('secondary close error');
    });
    try {
      assert.throws(
        () => stores[2]!.open(databasePath),
        error => error === failure
      );
      assert.equal(closeAttempts, 1);
    } finally {
      t.mock.restoreAll();
    }
  });
});
