import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AdminTrackMutationService } from './admin-track-mutation-service.js';
import { closeAllSync } from './close-resources.js';
import { HomeMusicDatabase } from './database.js';
import { LibraryAssistantCompositeReviewService } from './library-assistant-composite-review-service.js';
import { LibraryMetadataNormalizationStore } from './library-metadata-normalization.js';
import { LibraryViewStore } from './library-views.js';
import { MediaFileMoveStore } from './media-file-move.js';
import { MediaQuarantineStore } from './media-quarantine.js';
import { PersonalDataExportService } from './personal-data-export.js';
import { SmartPlaylistStore } from './smart-playlists.js';

async function withDatabase(run: (databasePath: string, root: string) => Promise<void> | void) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-composite-close-'));
  const databasePath = path.join(root, 'music.db');
  const db = new HomeMusicDatabase(databasePath);
  db.close();
  try {
    await run(databasePath, root);
    const reopened = new DatabaseSync(databasePath);
    try {
      assert.equal(
        (reopened.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
        'ok'
      );
    } finally {
      reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('closeAllSync preserves a single error and aggregates multiple failures in order', () => {
  const calls: number[] = [];
  const first = new Error('first');
  const second = new Error('second');
  assert.throws(() => closeAllSync([
    () => { calls.push(1); throw first; },
    () => { calls.push(2); },
    () => { calls.push(3); throw second; }
  ]), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [first, second]);
    return true;
  });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.throws(() => closeAllSync([() => { throw first; }, () => undefined]), error => error === first);
  assert.doesNotThrow(() => closeAllSync([() => undefined]));
});

test('personal exporter closes both stores even when the first fails, without retrying them', async t => {
  await withDatabase(databasePath => {
    const exporter = new PersonalDataExportService({} as ConstructorParameters<typeof PersonalDataExportService>[0], databasePath);
    const calls: string[] = [];
    const first = new Error('smart playlists close failure');
    const second = new Error('library views close failure');
    const originalSmart = SmartPlaylistStore.prototype.close;
    const originalViews = LibraryViewStore.prototype.close;
    t.mock.method(SmartPlaylistStore.prototype, 'close', function (this: SmartPlaylistStore) {
      calls.push('smart');
      originalSmart.call(this);
      throw first;
    });
    t.mock.method(LibraryViewStore.prototype, 'close', function (this: LibraryViewStore) {
      calls.push('views');
      originalViews.call(this);
      throw second;
    });
    try {
      assert.throws(() => exporter.close(), (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [first, second]);
        return true;
      });
      assert.deepEqual(calls, ['smart', 'views']);
      assert.doesNotThrow(() => exporter.close());
      assert.deepEqual(calls, ['smart', 'views']);
    } finally {
      t.mock.restoreAll();
    }
  });
});

test('admin mutation service closes quarantine even when file-move store close fails', async t => {
  await withDatabase((databasePath, root) => {
    const service = new AdminTrackMutationService({
      databasePath,
      musicDir: root,
      tracks: {
        listTracks: () => [],
        setEnabled: () => null,
        setLocation: () => null
      },
      decorateTrack: track => track,
      onVisibilityChanged: () => undefined,
      onFileMoved: () => undefined
    });
    const calls: string[] = [];
    const first = new Error('file moves close failed');
    const originalMove = MediaFileMoveStore.prototype.close;
    const originalQuarantine = MediaQuarantineStore.prototype.close;
    t.mock.method(MediaFileMoveStore.prototype, 'close', function (this: MediaFileMoveStore) {
      calls.push('moves');
      originalMove.call(this);
      throw first;
    });
    t.mock.method(MediaQuarantineStore.prototype, 'close', function (this: MediaQuarantineStore) {
      calls.push('quarantine');
      originalQuarantine.call(this);
    });
    try {
      assert.throws(() => service.close(), error => error === first);
      assert.deepEqual(calls, ['moves', 'quarantine']);
      assert.doesNotThrow(() => service.close());
      assert.deepEqual(calls, ['moves', 'quarantine']);
    } finally {
      t.mock.restoreAll();
    }
  });
});

test('composite assistant review closes its base when the decision SQLite close fails', async t => {
  await withDatabase(databasePath => {
    const calls: string[] = [];
    const first = new Error('decisions close failed');
    const second = new Error('base close failed');
    const service = new LibraryAssistantCompositeReviewService({
      databasePath,
      base: {
        close: () => { calls.push('base'); throw second; }
      }
    } as unknown as ConstructorParameters<typeof LibraryAssistantCompositeReviewService>[0]);
    const originalClose = DatabaseSync.prototype.close;
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      calls.push('decisions');
      originalClose.call(this);
      throw first;
    });
    try {
      assert.throws(() => service.close(), (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [first, second]);
        return true;
      });
      assert.deepEqual(calls, ['decisions', 'base']);
      assert.doesNotThrow(() => service.close());
      assert.deepEqual(calls, ['decisions', 'base']);
    } finally {
      t.mock.restoreAll();
    }
  });
});

test('smart playlist releases its own SQLite after normalization close fails', async t => {
  await withDatabase(databasePath => {
    const store = new SmartPlaylistStore(databasePath);
    const calls: string[] = [];
    const first = new Error('normalization close failed');
    const originalNormalization = LibraryMetadataNormalizationStore.prototype.close;
    const originalDb = DatabaseSync.prototype.close;
    t.mock.method(LibraryMetadataNormalizationStore.prototype, 'close', function (this: LibraryMetadataNormalizationStore) {
      calls.push('normalization');
      originalNormalization.call(this);
      throw first;
    });
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      calls.push('sqlite');
      originalDb.call(this);
    });
    try {
      assert.throws(() => store.close(), error => error === first);
      assert.deepEqual(calls, ['normalization', 'sqlite', 'sqlite']);
      assert.doesNotThrow(() => store.close());
      assert.deepEqual(calls, ['normalization', 'sqlite', 'sqlite']);
    } finally {
      t.mock.restoreAll();
    }
  });
});
