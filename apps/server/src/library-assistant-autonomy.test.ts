import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LibraryAssistantRun } from '@home-music/shared/library-assistant';
import { LibraryAssistantAutonomyController, LibraryAssistantAutonomyStore } from './library-assistant-autonomy.js';
import type { LibraryAssistantService } from './library-assistant-service.js';
import type { LibraryAssistantCompositeReviewService } from './library-assistant-composite-review-service.js';

async function withStore(run: (databasePath: string) => Promise<void> | void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-autonomy-'));
  try { await run(path.join(directory, 'home-music.db')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function completedRun(id: string, revision = 1): LibraryAssistantRun {
  return {
    id,
    capability: 'metadata',
    status: 'completed',
    libraryRevision: revision,
    algorithmVersion: 1,
    summary: { total: 0, pending: 0, review: 0, applied: 0, rejected: 0, stale: 0, failed: 0 },
    createdAt: new Date(0).toISOString(),
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(0).toISOString(),
    error: null
  };
}

test('autonomy defaults off and persists explicit opt-in', async () => {
  await withStore(databasePath => {
    const first = new LibraryAssistantAutonomyStore(databasePath);
    assert.deepEqual(first.get().config, { enabled: false, metadata: true, fillMissingOnly: true });
    first.setConfig({ enabled: true, metadata: true });
    first.close();

    const second = new LibraryAssistantAutonomyStore(databasePath);
    assert.equal(second.get().config.enabled, true);
    second.setConfig({ enabled: false });
    assert.equal(second.get().pendingRevision, null);
    second.close();
  });
});

test('disabled autonomy ignores library changes; enabled mode starts existing metadata pipeline', async () => {
  await withStore(async databasePath => {
    const store = new LibraryAssistantAutonomyStore(databasePath);
    const started: string[] = [];
    const assistant = {
      startRun(capability: 'metadata') {
        started.push(capability);
        return completedRun(`run-${started.length}`);
      },
      getRun(runId: string) { return completedRun(runId); },
      cancelRun() { return null; }
    } as unknown as Pick<LibraryAssistantService, 'startRun' | 'getRun' | 'cancelRun'>;
    const review = {
      getReviewQueue() { return { libraryRevision: 1, items: [] }; },
      async decideBatch() { throw new Error('não deveria aplicar lote vazio'); }
    } as unknown as Pick<LibraryAssistantCompositeReviewService, 'getReviewQueue' | 'decideBatch'>;
    const controller = new LibraryAssistantAutonomyController(store, assistant, review);

    controller.notifyLibraryChanged(1, 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(started, []);

    controller.configure({ enabled: true, metadata: true });
    controller.notifyLibraryChanged(2, 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(started, ['metadata']);
    assert.equal(store.get().activeRunId, null);
    assert.equal(store.get().lastSummary?.applied, 0);

    controller.notifyLibraryChanged(3, 0);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(started.length, 1);
    await controller.close();
    store.close();
  });
});
