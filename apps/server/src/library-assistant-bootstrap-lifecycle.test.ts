import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import { HomeMusicDatabase } from './database.js';
import { LibraryAssistantAutonomyStore } from './library-assistant-autonomy.js';
import { registerLibraryAssistant } from './library-assistant-bootstrap.js';
import { LibraryAssistantFingerprintCache } from './library-assistant-fingerprint-cache.js';
import { LibraryAssistantIncrementalIndex } from './library-assistant-incremental-index.js';
import { LibraryAssistantPersistentQueue } from './library-assistant-persistent-queue.js';
import { LibraryAssistantReviewPolicyStore } from './library-assistant-review-policy.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import type { LibraryService } from './library-service.js';
import type { LibraryRouteProjection } from './library-routes.js';
import type { LongJobObservability } from './long-job-observability.js';
import { LocalLyricsCandidateStore } from './local-lyrics-candidates.js';
import { TrackCoverOverrideStore } from './track-cover-overrides.js';
import { getActiveTrackLyricsOverride, TrackLyricsOverrideStore } from './track-lyrics-overrides.js';
import { TrackMetadataOverrideStore } from './track-metadata-overrides.js';

const sqliteOwners: Array<{ name: string; prototype: { close(): void } }> = [
  { name: 'assistant store', prototype: LibraryAssistantStore.prototype },
  { name: 'fingerprint cache', prototype: LibraryAssistantFingerprintCache.prototype },
  { name: 'review policy', prototype: LibraryAssistantReviewPolicyStore.prototype },
  { name: 'autonomy store', prototype: LibraryAssistantAutonomyStore.prototype },
  { name: 'persistent queue', prototype: LibraryAssistantPersistentQueue.prototype },
  { name: 'incremental index', prototype: LibraryAssistantIncrementalIndex.prototype },
  { name: 'metadata overrides', prototype: TrackMetadataOverrideStore.prototype },
  { name: 'cover overrides', prototype: TrackCoverOverrideStore.prototype },
  { name: 'lyrics overrides', prototype: TrackLyricsOverrideStore.prototype },
  { name: 'lyrics candidates', prototype: LocalLyricsCandidateStore.prototype }
];

function spyOwners(t: TestContext) {
  const closes: string[] = [];
  for (const { name, prototype } of sqliteOwners) {
    const original = prototype.close as (this: object) => void;
    t.mock.method(prototype, 'close', function (this: object) {
      closes.push(name);
      original.call(this);
    });
  }
  return closes;
}

async function withBootstrap(
  run: (fixture: {
    app: ReturnType<typeof Fastify>;
    databasePath: string;
    options: Parameters<typeof registerLibraryAssistant>[1];
    projection: LibraryRouteProjection;
    library: LibraryService;
  }) => Promise<void>
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-startup-'));
  const app = Fastify({ logger: false });
  const databasePath = path.join(root, 'home-music.db');
  try {
    const database = new HomeMusicDatabase(databasePath);
    database.close();

    const library = {
      root: root,
      rescan: async () => ({ added: 0, updated: 0 }),
      updateForPromotedImport: async () => false,
      status: () => ({ revision: 1 }),
      listPublicTracks: () => [],
      listAdminTracks: () => [],
      getTrack: () => null
    } as unknown as LibraryService;
    const projection = {
      projectRevision: (revision: number) => revision,
      projectTracks: (tracks: unknown) => tracks
    } as LibraryRouteProjection;
    const options = {
      databasePath,
      library,
      projection,
      queue: {} as HeavyWorkQueue,
      observability: {} as LongJobObservability
    };
    await run({ app, databasePath, options, projection, library });

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
    await app.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

test('provider callback failure releases each already-opened SQLite owner once', async t => {
  await withBootstrap(async ({ app, options, projection }) => {
    const originalRevision = projection.projectRevision;
    const closed = spyOwners(t);
    const startupError = new Error('injected provider handoff failure');
    assert.throws(
      () => registerLibraryAssistant(app, {
        ...options,
        onProviderGatewayReady: () => { throw startupError; }
      }),
      error => error === startupError
    );
    await app.close();
    assert.deepEqual([...closed].sort(), sqliteOwners.map(item => item.name).sort());
    assert.equal(projection.projectRevision, originalRevision);
    assert.equal(getActiveTrackLyricsOverride('nonexistent'), null);
    t.mock.restoreAll();
  });
});

test('invalid analyzer after projection assignment restores state and closes partial SQLite owners', async t => {
  await withBootstrap(async ({ app, options, projection }) => {
    const originalRevision = projection.projectRevision;
    const closed = spyOwners(t);
    const analyzer = { id: 'duplicated', capability: 'metadata', analyze: async () => [] };
    assert.throws(
      () => registerLibraryAssistant(app, {
        ...options,
        analyzers: [analyzer, analyzer] as Parameters<typeof registerLibraryAssistant>[1]['analyzers']
      }),
      /Analyzer duplicado: duplicated/
    );
    await app.close();
    assert.deepEqual([...closed].sort(), sqliteOwners.map(item => item.name).sort());
    assert.equal(projection.projectRevision, originalRevision);
    assert.equal(getActiveTrackLyricsOverride('nonexistent'), null);
    t.mock.restoreAll();
  });
});

test('failure after attaching library lifecycle detaches wrappers and closes all resources', async t => {
  await withBootstrap(async ({ app, options, library, projection }) => {
    const beforeRescan = library.rescan;
    const beforeImport = library.updateForPromotedImport;
    const beforeRevision = projection.projectRevision;
    const closes = spyOwners(t);
    t.mock.method(LibraryAssistantAutonomyStore.prototype, 'get', function (this: LibraryAssistantAutonomyStore) {
      throw new Error('injected autonomy resume failure');
    });
    assert.throws(
      () => registerLibraryAssistant(app, options),
      /injected autonomy resume failure/
    );
    await app.close();
    assert.deepEqual([...closes].sort(), sqliteOwners.map(item => item.name).sort());
    assert.equal(library.rescan, beforeRescan);
    assert.equal(library.updateForPromotedImport, beforeImport);
    assert.equal(projection.projectRevision, beforeRevision);
    t.mock.restoreAll();
  });
});
