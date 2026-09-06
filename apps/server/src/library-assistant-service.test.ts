import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Track } from '@home-music/shared';
import { HomeMusicDatabase } from './database.js';
import { HeavyWorkQueue } from './heavy-work-queue.js';
import type { IndexedTrack } from './library.js';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import {
  LibraryAssistantService,
  type LibraryAssistantAnalyzer
} from './library-assistant-service.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import { LongJobObservability } from './long-job-observability.js';

function indexedTrack(overrides: Partial<IndexedTrack> = {}): IndexedTrack {
  return {
    id: 'track-1',
    title: 'Faixa',
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Artista',
    folderPath: 'Artista/Álbum',
    duration: 180,
    format: 'mp3',
    hasCover: false,
    filePath: '/music/track-1.mp3',
    mimeType: 'audio/mpeg',
    fileSize: 1234,
    mtimeMs: 1000,
    ...overrides
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
    if (Date.now() - started > timeoutMs) throw new Error('timeout aguardando estado do assistente');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function withService(
  analyzers: readonly LibraryAssistantAnalyzer[],
  run: (context: {
    service: LibraryAssistantService;
    store: LibraryAssistantStore;
    database: HomeMusicDatabase;
    tracks: Track[];
    setRevision: (value: number) => void;
  }) => Promise<void>
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-service-'));
  const databasePath = path.join(directory, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  database.syncTracks([indexedTrack()], '/music', '2026-09-06T18:00:00.000Z');
  const store = new LibraryAssistantStore(databasePath);
  const providers = new LibraryAssistantProviderGateway(store, { minIntervalMs: 0 });
  const queue = new HeavyWorkQueue({
    name: 'assistant-test',
    maxConcurrent: 2,
    maxPending: 8,
    maxPendingPerOwner: 4,
    retryAfterSeconds: 1
  });
  const observability = new LongJobObservability({
    info() {},
    warn() {}
  });
  const tracks = [publicTrack(indexedTrack())];
  let revision = 1;
  let id = 0;
  const service = new LibraryAssistantService({
    store,
    queue,
    observability,
    providers,
    analyzers,
    createId: () => String(++id),
    library: {
      listTracks: () => tracks.map(track => ({ ...track })),
      revision: () => revision
    }
  });

  try {
    await run({ service, store, database, tracks, setRevision: value => { revision = value; } });
  } finally {
    await service.close();
    store.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const metadataAnalyzer: LibraryAssistantAnalyzer = {
  id: 'metadata-test',
  capability: 'metadata',
  async analyze({ tracks }) {
    const track = tracks[0];
    return [{
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
    }];
  }
};

test('analysis persists typed suggestions but does not mutate effective library or track table', async () => {
  await withService([metadataAnalyzer], async ({ service, store, database, tracks }) => {
    const beforePublic = JSON.stringify(tracks);
    const beforePersisted = database.loadTracks().map(track => ({ title: track.title, artist: track.artist }));
    const started = service.startRun('metadata', 'admin-1');
    await waitFor(() => service.getRun(started.id)?.status === 'completed');

    const suggestions = service.listSuggestions(started.id) ?? [];
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].status, 'review');
    assert.equal(suggestions[0].target.capability, 'metadata');
    assert.equal(JSON.stringify(tracks), beforePublic);
    assert.deepEqual(
      database.loadTracks().map(track => ({ title: track.title, artist: track.artist })),
      beforePersisted
    );
    assert.equal(store.getRun(started.id)?.summary.review, 1);
    assert.doesNotMatch(JSON.stringify(suggestions), /\/music\/track-1\.mp3/);
  });
});

test('completed suggestion becomes stale when the effective premise changes', async () => {
  await withService([metadataAnalyzer], async ({ service, tracks, setRevision }) => {
    const started = service.startRun('metadata', 'admin-1');
    await waitFor(() => service.getRun(started.id)?.status === 'completed');

    tracks[0] = { ...tracks[0], title: 'Faixa editada' };
    setRevision(2);
    const refreshed = service.getRun(started.id);
    assert.equal(refreshed?.status, 'stale');
    assert.equal(service.listSuggestions(started.id)?.[0].status, 'stale');
  });
});

test('cancelling a run aborts new work and invalidates already persisted partial suggestions', async () => {
  let blockingStarted = false;
  const blockingAnalyzer: LibraryAssistantAnalyzer = {
    id: 'blocking-test',
    capability: 'metadata',
    analyze: ({ signal }) => new Promise((_resolve, reject) => {
      blockingStarted = true;
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
    })
  };

  await withService([metadataAnalyzer, blockingAnalyzer], async ({ service }) => {
    const started = service.startRun('metadata', 'admin-1');
    await waitFor(() => blockingStarted && (service.listSuggestions(started.id)?.length ?? 0) === 1);
    const cancelled = service.cancelRun(started.id);
    assert.equal(cancelled?.status, 'cancelled');
    await waitFor(() => service.getRun(started.id)?.status === 'cancelled');
    assert.equal(service.listSuggestions(started.id)?.[0].status, 'stale');
  });
});

test('two analyses of the same snapshot can coexist without sharing mutable run state', async () => {
  await withService([], async ({ service }) => {
    const first = service.startRun('metadata', 'admin-1');
    const second = service.startRun('artwork', 'admin-1');
    assert.notEqual(first.id, second.id);
    await waitFor(() => service.getRun(first.id)?.status === 'completed');
    await waitFor(() => service.getRun(second.id)?.status === 'completed');
    assert.equal(service.getRun(first.id)?.libraryRevision, 1);
    assert.equal(service.getRun(second.id)?.libraryRevision, 1);
  });
});
