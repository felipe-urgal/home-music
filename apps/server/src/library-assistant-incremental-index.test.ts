import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Track } from '@home-music/shared';
import { HomeMusicDatabase } from './database.js';
import { HeavyWorkQueue } from './heavy-work-queue.js';
import type { IndexedTrack } from './library.js';
import { LibraryAssistantIncrementalIndex } from './library-assistant-incremental-index.js';
import { LibraryAssistantPersistentQueue } from './library-assistant-persistent-queue.js';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import { LibraryAssistantService, type LibraryAssistantAnalyzer } from './library-assistant-service.js';
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

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout aguardando análise incremental');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function withIncrementalService(
  indexed: IndexedTrack[],
  analyzer: LibraryAssistantAnalyzer,
  run: (context: {
    service: LibraryAssistantService;
    workQueue: LibraryAssistantPersistentQueue;
    tracks: Track[];
    setRevision: (value: number) => void;
  }) => Promise<void>
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-incremental-'));
  const databasePath = path.join(directory, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  database.syncTracks(indexed, '/music', '2026-09-08T12:00:00.000Z');
  const store = new LibraryAssistantStore(databasePath);
  const workQueue = new LibraryAssistantPersistentQueue(databasePath);
  const incrementalIndex = new LibraryAssistantIncrementalIndex(databasePath);
  const providers = new LibraryAssistantProviderGateway(store, { minIntervalMs: 0 });
  const queue = new HeavyWorkQueue({
    name: 'assistant-incremental-test',
    maxConcurrent: 1,
    maxPending: 8,
    maxPendingPerOwner: 4,
    retryAfterSeconds: 1
  });
  const observability = new LongJobObservability({ info() {}, warn() {} });
  const tracks = indexed.map(publicTrack);
  let revision = 1;
  let id = 0;
  const service = new LibraryAssistantService({
    store,
    workQueue,
    incrementalIndex,
    queue,
    observability,
    providers,
    analyzers: [analyzer],
    createId: () => String(++id),
    library: {
      listTracks: () => tracks.map(track => ({ ...track })),
      revision: () => revision
    }
  });

  try {
    await run({ service, workQueue, tracks, setRevision: value => { revision = value; } });
  } finally {
    await service.close();
    incrementalIndex.close();
    workQueue.close();
    store.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('índice incremental reutiliza uma premissa concluída sem depender da fila', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-index-'));
  const databasePath = path.join(directory, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  database.syncTracks([indexedTrack('track-1')], '/music', '2026-09-08T12:00:00.000Z');
  const index = new LibraryAssistantIncrementalIndex(databasePath);
  const premiseSignature = 'a'.repeat(64);

  try {
    assert.deepEqual(index.planRun({
      runId: 'assistant-1',
      capability: 'metadata',
      analyzerIds: ['metadata-test'],
      tracks: [{ id: 'track-1', premiseSignature }],
      updatedAt: '2026-09-08T13:00:00.000Z'
    }), ['track-1']);

    assert.equal(index.markResult(
      'assistant-1',
      'metadata',
      'metadata-test',
      'track-1',
      'no_match',
      '2026-09-08T13:00:01.000Z'
    ), 1);

    assert.deepEqual(index.planRun({
      runId: 'assistant-2',
      capability: 'metadata',
      analyzerIds: ['metadata-test'],
      tracks: [{ id: 'track-1', premiseSignature }],
      updatedAt: '2026-09-08T14:00:00.000Z'
    }), []);
  } finally {
    index.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('reanálise incremental ignora faixas inalteradas e permite forçar análise completa', async () => {
  const calls: string[] = [];
  const analyzer: LibraryAssistantAnalyzer = {
    id: 'metadata-incremental-test',
    capability: 'metadata',
    async analyze({ tracks }) {
      calls.push(tracks[0].id);
      return [];
    }
  };

  await withIncrementalService(
    [indexedTrack('track-1'), indexedTrack('track-2')],
    analyzer,
    async ({ service, workQueue, tracks, setRevision }) => {
      const first = service.startRun('metadata', 'admin-1');
      await waitFor(() => service.getRun(first.id)?.status === 'completed');
      assert.deepEqual(calls, ['track-1', 'track-2']);
      assert.equal(workQueue.summary(first.id).total, 2);

      const unchanged = service.startRun('metadata', 'admin-1');
      await waitFor(() => service.getRun(unchanged.id)?.status === 'completed');
      assert.deepEqual(calls, ['track-1', 'track-2']);
      assert.equal(workQueue.summary(unchanged.id).total, 0);

      tracks[1] = { ...tracks[1], title: 'Faixa track-2 editada' };
      setRevision(2);
      const changed = service.startRun('metadata', 'admin-1');
      await waitFor(() => service.getRun(changed.id)?.status === 'completed');
      assert.equal(workQueue.summary(changed.id).total, 1);
      assert.equal(calls.at(-1), 'track-2');
      assert.equal(calls.length, 3);

      const full = service.startRun('metadata', 'admin-1', { full: true });
      await waitFor(() => service.getRun(full.id)?.status === 'completed');
      assert.equal(workQueue.summary(full.id).total, 2);
      assert.deepEqual(calls.slice(-2), ['track-1', 'track-2']);
    }
  );
});

test('faixa que falhou volta para a próxima análise incremental', async () => {
  let calls = 0;
  const analyzer: LibraryAssistantAnalyzer = {
    id: 'metadata-incremental-failure-test',
    capability: 'metadata',
    async analyze() {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('falha definitiva'), { code: 'invalid-result' });
      return [];
    }
  };

  await withIncrementalService(
    [indexedTrack('track-1')],
    analyzer,
    async ({ service, workQueue }) => {
      const failed = service.startRun('metadata', 'admin-1');
      await waitFor(() => service.getRun(failed.id)?.status === 'completed');
      assert.equal(workQueue.summary(failed.id).failed, 1);
      assert.equal(calls, 1);

      const retry = service.startRun('metadata', 'admin-1');
      await waitFor(() => service.getRun(retry.id)?.status === 'completed');
      assert.equal(workQueue.summary(retry.id).total, 1);
      assert.equal(workQueue.summary(retry.id).no_match, 1);
      assert.equal(calls, 2);
    }
  );
});
