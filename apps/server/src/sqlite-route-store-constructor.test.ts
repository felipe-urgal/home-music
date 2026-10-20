import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import { TrackAvailabilityStore } from './track-availability-store.js';
import { TrackLyricsOverrideStore } from './track-lyrics-overrides.js';
import { TrackMetadataOverrideStore } from './track-metadata-overrides.js';
import { TrackCoverOverrideStore } from './track-cover-overrides.js';
import { LocalLyricsCandidateStore } from './local-lyrics-candidates.js';
import { PersonalDataImportApplyStore } from './personal-data-import-apply-store.js';
import { LibraryAssistantFingerprintCache } from './library-assistant-fingerprint-cache.js';
import { LibraryAssistantIncrementalIndex } from './library-assistant-incremental-index.js';
import { LibraryAssistantReviewPolicyStore } from './library-assistant-review-policy.js';
import { LibraryAssistantPersistentQueue } from './library-assistant-persistent-queue.js';
import { LibraryAssistantStore } from './library-assistant-store.js';

// These stores are owned by route registrations or the central infrastructure.
// If SQLite DDL/refresh fails inside the constructor, no caller has an instance to close.
const cases: Array<{
  label: string;
  table: string;
  open: (databasePath: string) => { close(): void };
}> = [
  { label: 'availability', table: 'track_availability', open: p => new TrackAvailabilityStore(p) },
  { label: 'track lyrics', table: 'track_lyrics_overrides', open: p => new TrackLyricsOverrideStore(p) },
  { label: 'metadata overrides', table: 'track_metadata_overrides', open: p => new TrackMetadataOverrideStore(p) },
  { label: 'cover overrides', table: 'track_cover_overrides', open: p => new TrackCoverOverrideStore(p) },
  { label: 'local lyrics candidates', table: 'local_lyrics_candidates', open: p => new LocalLyricsCandidateStore(p) },
  { label: 'personal import', table: 'library_views', open: p => new PersonalDataImportApplyStore(p) },
  { label: 'fingerprint cache', table: 'library_assistant_fingerprint_cache', open: p => new LibraryAssistantFingerprintCache(p) },
  { label: 'incremental index', table: 'library_assistant_analysis_state', open: p => new LibraryAssistantIncrementalIndex(p) },
  { label: 'review policy', table: 'library_assistant_review_policy', open: p => new LibraryAssistantReviewPolicyStore(p) },
  { label: 'persistent queue', table: 'library_assistant_work_items', open: p => new LibraryAssistantPersistentQueue(p) }
];

test('route SQLite stores close the connection if initialization fails before returning', async t => {
  for (const scenario of cases) {
    await t.test(scenario.label, async subtest => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-sqlite-constructor-'));
      const databasePath = path.join(root, 'home-music.db');
      try {
        const initialized = new HomeMusicDatabase(databasePath);
        initialized.close();
        if (scenario.label === 'persistent queue') {
          const assistantStore = new LibraryAssistantStore(databasePath);
          assistantStore.close();
        }

        // A VIEW of the expected table name breaks DDL/index/refresh in real SQLite.
        // The review-policy store only has CREATE TABLE IF NOT EXISTS, which
        // permits a VIEW; inject the DDL error for that one case.
        const prepare = new DatabaseSync(databasePath);
        try {
          prepare.exec('CREATE VIEW ' + scenario.table + ' AS SELECT 1 AS id;');
        } finally {
          prepare.close();
        }

        const nativeClose = DatabaseSync.prototype.close;
        let closeCount = 0;
        const closeMock = subtest.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
          closeCount += 1;
          return nativeClose.call(this);
        });
        const nativeExec = DatabaseSync.prototype.exec;
        const execMock = scenario.label === 'review policy'
          ? subtest.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
            if (sql.includes('CREATE TABLE IF NOT EXISTS library_assistant_review_policy')) {
              throw new Error('injected SQLite schema initialization failure');
            }
            return nativeExec.call(this, sql);
          })
          : null;
        try {
          assert.throws(() => scenario.open(databasePath), /sqlite|table|view|exist|column|injected/i);
          assert.equal(closeCount, 1, scenario.label + ' must close its failed SQLite connection');
        } finally {
          execMock?.mock.restore();
          closeMock.mock.restore();
        }

        const repair = new DatabaseSync(databasePath);
        try {
          repair.exec('DROP VIEW ' + scenario.table + ';');
          assert.equal(
            (repair.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
            'ok'
          );
        } finally {
          repair.close();
        }

        // Recovery may use the same database file without restarting the server.
        const recovered = scenario.open(databasePath);
        recovered.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('initialization failure remains the cause even if closing the connection also throws', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-sqlite-close-error-'));
  const databasePath = path.join(root, 'home-music.db');
  try {
    const initial = new HomeMusicDatabase(databasePath);
    initial.close();
    const prepare = new DatabaseSync(databasePath);
    try {
      prepare.exec('CREATE VIEW track_lyrics_overrides AS SELECT 1 AS id;');
    } finally {
      prepare.close();
    }

    const nativeClose = DatabaseSync.prototype.close;
    let closes = 0;
    const closeMock = t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      closes++;
      nativeClose.call(this);
      throw new Error('injected close failure');
    });
    try {
      assert.throws(
        () => new TrackLyricsOverrideStore(databasePath),
        error => error instanceof Error
          && /view|table|exist/i.test(error.message)
          && !/injected close failure/.test(error.message)
      );
      assert.equal(closes, 1);
    } finally {
      closeMock.mock.restore();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
