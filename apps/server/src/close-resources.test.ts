import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { AdminTrackMutationService } from './admin-track-mutation-service.js';
import { registerAdminTrackRoutes } from './admin-track-routes.js';
import { closeAll } from './close-resources.js';
import { HomeMusicDatabase } from './database.js';
import { LibraryDuplicateReviewStore } from './library-duplicate-review.js';
import { LibraryMetadataNormalizationStore } from './library-metadata-normalization.js';
import { PersonalDataExportService } from './personal-data-export.js';
import { PersonalDataImportApplyStore } from './personal-data-import-apply-store.js';
import type { PersonalLibraryService } from './personal-library-service.js';
import { registerPersonalRoutes } from './personal-routes.js';
import { TrackCoverOverrideStore } from './track-cover-overrides.js';
import { TrackMetadataOverrideStore } from './track-metadata-overrides.js';

function spyClose(
  t: TestContext,
  prototype: { close(): void },
  name: string,
  calls: string[],
  fail = false
) {
  const original = prototype.close as (this: object) => void;
  t.mock.method(prototype, 'close', function (this: object) {
    calls.push(name);
    original.call(this);
    if (fail) throw new Error('injected close error: ' + name);
  });
}

async function withSqlite(run: (databasePath: string, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-close-hooks-'));
  const databasePath = path.join(root, 'home-music.db');
  try {
    const initial = new HomeMusicDatabase(databasePath);
    initial.close();
    await run(databasePath, root);
    const db = new DatabaseSync(databasePath);
    try {
      const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      assert.equal(integrity.integrity_check, 'ok');
    } finally {
      db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('closeAll continues sequentially after sync and async failures and keeps every cause', async () => {
  const calls: string[] = [];
  const first = new Error('sync error');
  const second = new Error('async error');
  await assert.rejects(
    closeAll([
      () => { calls.push('first'); throw first; },
      async () => { calls.push('second'); await Promise.resolve(); throw second; },
      () => { calls.push('third'); }
    ]),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [first, second]);
      return true;
    }
  );
  assert.deepEqual(calls, ['first', 'second', 'third']);

  const single = new Error('single close failure');
  await assert.rejects(closeAll([() => { throw single; }, () => undefined]), error => error === single);
  await assert.doesNotReject(closeAll([() => undefined, async () => undefined]));
});

test('admin route shutdown closes every SQLite owner when the first close throws', async t => {
  await withSqlite(async (databasePath, root) => {
    await mkdir(path.join(root, 'music'));
    const app = Fastify();
    const calls: string[] = [];
    registerAdminTrackRoutes(app, {
      listTracks: () => [],
      setEnabled: () => null,
      setLocation: () => null
    }, { databasePath, musicDir: path.join(root, 'music') });

    spyClose(t, TrackCoverOverrideStore.prototype, 'cover', calls, true);
    spyClose(t, LibraryMetadataNormalizationStore.prototype, 'normalization', calls);
    spyClose(t, TrackMetadataOverrideStore.prototype, 'metadata', calls);
    spyClose(t, LibraryDuplicateReviewStore.prototype, 'duplicates', calls);
    spyClose(t, AdminTrackMutationService.prototype, 'mutations', calls);
    try {
      await assert.rejects(app.close(), /injected close error: cover/);
      assert.deepEqual(calls, ['cover', 'normalization', 'metadata', 'duplicates', 'mutations']);
    } finally {
      t.mock.restoreAll();
    }
  });
});

test('personal route shutdown closes import SQLite even when data exporter close throws', async t => {
  await withSqlite(async databasePath => {
    const app = Fastify();
    registerPersonalRoutes(app, {} as PersonalLibraryService, {
      databasePath,
      library: { listPublicTracks: () => [] }
    });
    const calls: string[] = [];
    spyClose(t, PersonalDataExportService.prototype, 'export', calls, true);
    spyClose(t, PersonalDataImportApplyStore.prototype, 'import', calls);
    try {
      await assert.rejects(app.close(), /injected close error: export/);
      assert.deepEqual(calls, ['export', 'import']);
    } finally {
      t.mock.restoreAll();
    }
  });
});
