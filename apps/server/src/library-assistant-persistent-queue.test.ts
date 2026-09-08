import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Track } from '@home-music/shared';
import { HomeMusicDatabase } from './database.js';
import { HeavyWorkQueue } from './heavy-work-queue.js';
import type { IndexedTrack } from './library.js';
import { LibraryAssistantPersistentQueue } from './library-assistant-persistent-queue.js';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import {
  LibraryAssistantService,
  type LibraryAssistantAnalyzer,
  type LibraryAssistantSuggestionDraft
} from './library-assistant-service.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import { LongJobObservability } from './long-job-observability.js';

function indexedTrack(id: string): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Artista',
    folderPath: 'Artista/Álbum',
    duration: 180,
    format: 'mp3',
    hasCover: false,
    filePath: `/music/${id}.mp3`,
    mimeType: 'audio/mpeg',
    fileSize: 1234,
    mtimeMs: 1000
  };
}

function publicTrack(track: IndexedTrack): Track {
  const {
    filePath: _filePath,
    mimeType: _mimeType,
    fileSize: _fileSize,
    mtimeMs: _mtimeMs,
    ...safe
  } = track;
  return safe;
}

function suggestion(track: Track): LibraryAssistantSuggestionDraft {
  return {
    capability: 'metadata',
    confidence: 'high',
    reasonCodes: ['normalized-text-match'],
    evidence: [{
      type: 'text-match',
      version: 1,
      field: 'title',
      match: 'normalized',
      sourceValue: track.title,
      candidateValue: `${track.title} corrigida`
    }],
    provenance: { source: 'local', providerVersion: null, externalId: null },
    target: {
      capability: 'metadata',
      trackId: track.id,
      field: 'title',
      currentValue: track.title,
      suggestedValue: `${track.title} corrigida`
    }
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout aguardando fila persistente');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function withDatabase(
  tracks: IndexedTrack[],
  run: (databasePath: string) => Promise<void> | void
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-queue-'));
  const databasePath = path.join(directory, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  database.syncTracks(tracks, '/music', '2026-09-08T10:00:00.000Z');
  try {
    await run(databasePath);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('processing item and run resume after service restart', async () => {
  await withDatabase([indexedTrack('track-1')], databasePath => {
    const installedAt = new Date('2026-09-08T10:00:00.000Z');
    const store = new LibraryAssistantStore(databasePath, { now: () => installedAt });
    const workQueue = new LibraryAssistantPersistentQueue(databasePath, { now: () => installedAt });
    store.createRun({
      id: 'run-resume',
      capability: 'metadata',
      libraryRevision: 1,
      createdAt: '2026-09-08T10:00:01.000Z'
    });
    store.startRun('run-resume', '2026-09-08T10:00:02.000Z');
    workQueue.enqueue('run-resume', ['metadata-test'], ['track-1'], '2026-09-08T10:00:02.000Z');
    const claimed = workQueue.claimNext('run-resume', installedAt.getTime(), '2026-09-08T10:00:03.000Z');
    assert.equal(claimed?.status, 'processing');
    assert.equal(claimed?.attempts, 1);
    workQueue.close();
    store.close();

    const restartedAt = new Date('2026-09-08T10:05:00.000Z');
    const restartedStore = new LibraryAssistantStore(databasePath, { now: () => restartedAt });
    assert.equal(restartedStore.getRun('run-resume')?.status, 'failed');
    const restartedQueue = new LibraryAssistantPersistentQueue(databasePath, { now: () => restartedAt });

    assert.equal(restartedStore.getRun('run-resume')?.status, 'running');
    assert.equal(restartedQueue.summary('run-resume').pending, 1);
    const resumed = restartedQueue.claimNext(
      'run-resume',
      restartedAt.getTime(),
      '2026-09-08T10:05:01.000Z'
    );
    assert.equal(resumed?.trackId, 'track-1');
    assert.equal(resumed?.attempts, 2);

    restartedQueue.close();
    restartedStore.close();
  });
});

test('transient failure defers one track while the worker processes the next one', async () => {
  const indexed = [indexedTrack('track-1'), indexedTrack('track-2')];
  await withDatabase(indexed, async databasePath => {
    const store = new LibraryAssistantStore(databasePath);
    const workQueue = new LibraryAssistantPersistentQueue(databasePath);
    const providers = new LibraryAssistantProviderGateway(store, { minIntervalMs: 0 });
    const queue = new HeavyWorkQueue({
      name: 'assistant-persistent-test',
      maxConcurrent: 1,
      maxPending: 8,
      maxPendingPerOwner: 4,
      retryAfterSeconds: 1
    });
    const observability = new LongJobObservability({ info() {}, warn() {} });
    const tracks = indexed.map(publicTrack);
    const calls: string[] = [];
    let firstTrackFailures = 0;
    const analyzer: LibraryAssistantAnalyzer = {
      id: 'metadata-persistent-test',
      capability: 'metadata',
      async analyze({ tracks: candidates }) {
        const track = candidates[0];
        calls.push(track.id);
        if (track.id === 'track-1' && firstTrackFailures === 0) {
          firstTrackFailures += 1;
          throw Object.assign(new Error('provider temporarily unavailable'), {
            code: 'provider-rate-limited'
          });
        }
        return [suggestion(track)];
      }
    };
    let id = 0;
    const service = new LibraryAssistantService({
      store,
      workQueue,
      queue,
      observability,
      providers,
      analyzers: [analyzer],
      retryDelaysMs: [25],
      createId: () => String(++id),
      library: {
        listTracks: () => tracks.map(track => ({ ...track })),
        revision: () => 1
      }
    });

    try {
      const started = service.startRun('metadata', 'admin-1');
      await waitFor(() => service.getRun(started.id)?.status === 'completed');

      assert.deepEqual(calls.slice(0, 2), ['track-1', 'track-2']);
      assert.equal(calls.at(-1), 'track-1');
      assert.equal(service.listSuggestions(started.id)?.length, 2);
      assert.deepEqual(workQueue.summary(started.id), {
        total: 2,
        pending: 0,
        processing: 0,
        matched: 2,
        no_match: 0,
        retry: 0,
        failed: 0
      });
    } finally {
      await service.close();
      workQueue.close();
      store.close();
    }
  });
});
