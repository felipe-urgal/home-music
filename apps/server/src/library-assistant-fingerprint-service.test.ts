import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Track } from '@home-music/shared';
import { HomeMusicDatabase } from './database.js';
import { HeavyWorkQueue } from './heavy-work-queue.js';
import type { IndexedTrack } from './library.js';
import { LibraryAssistantFingerprintCache } from './library-assistant-fingerprint-cache.js';
import { LibraryAssistantFingerprintService } from './library-assistant-fingerprint-service.js';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import { LibraryAssistantStore } from './library-assistant-store.js';

function indexedTrack(filePath: string, overrides: Partial<IndexedTrack> = {}): IndexedTrack {
  return {
    id: 'track-1',
    title: 'Título errado',
    artist: 'Artista errado',
    album: 'Álbum errado',
    albumArtist: 'Artista do álbum preservado',
    folder: 'Artista',
    folderPath: 'Artista/Álbum',
    duration: 180,
    format: 'flac',
    hasCover: false,
    filePath,
    mimeType: 'audio/flac',
    fileSize: 7,
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

async function fixture(run: (context: {
  service: LibraryAssistantFingerprintService;
  store: LibraryAssistantStore;
  track: Track;
  filePath: string;
  fingerprintCalls: () => number;
}) => Promise<void>, options: {
  lookup?: ConstructorParameters<typeof LibraryAssistantFingerprintService>[0]['lookup'];
  acoustIdEnabled?: boolean;
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-fingerprint-service-'));
  const musicRoot = path.join(directory, 'music');
  const filePath = path.join(musicRoot, 'track-1.flac');
  const databasePath = path.join(directory, 'home-music.db');
  await mkdir(musicRoot, { recursive: true });
  await writeFile(filePath, 'audio-a');
  const database = new HomeMusicDatabase(databasePath);
  const indexed = indexedTrack(filePath);
  database.syncTracks([indexed], musicRoot, '2026-09-10T10:00:00.000Z');
  const track = publicTrack(indexed);
  const store = new LibraryAssistantStore(databasePath);
  const cache = new LibraryAssistantFingerprintCache(databasePath);
  const providers = new LibraryAssistantProviderGateway(store, { minIntervalMs: 0 });
  const queue = new HeavyWorkQueue({
    name: 'fingerprint-test',
    maxConcurrent: 1,
    maxPending: 2,
    maxPendingPerOwner: 1,
    retryAfterSeconds: 1
  });
  const createdAt = '2026-09-10T10:00:00.000Z';
  store.createRun({ id: 'source-run', capability: 'metadata', libraryRevision: 1, createdAt });
  store.startRun('source-run', createdAt);
  store.insertSuggestions([{
    id: 'source-suggestion',
    runId: 'source-run',
    capability: 'metadata',
    trackId: track.id,
    status: 'review',
    confidence: 'low',
    reasonCodes: ['ambiguous-candidates'],
    evidence: [{
      type: 'external-id',
      version: 1,
      source: 'musicbrainz',
      kind: 'recording',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    }],
    provenance: { source: 'musicbrainz', providerVersion: 'test', externalId: null },
    target: {
      capability: 'metadata',
      trackId: track.id,
      field: 'title',
      currentValue: track.title,
      suggestedValue: 'Outro candidato'
    },
    premiseSignature: 'a'.repeat(64),
    createdAt
  }]);
  store.completeRun('source-run', createdAt);
  let fingerprintCount = 0;
  let id = 0;
  const service = new LibraryAssistantFingerprintService({
    store,
    cache,
    providers,
    queue,
    library: {
      listTracks: () => [{ ...track }],
      revision: () => 1,
      root: () => musicRoot,
      resolveTrackFile: trackId => trackId === track.id ? filePath : null
    },
    acoustIdEnabled: options.acoustIdEnabled,
    acoustIdApiKey: options.acoustIdEnabled ? 'fake-app-key' : undefined,
    fingerprint: async () => {
      fingerprintCount += 1;
      return { durationSeconds: 180, fingerprint: `AQAB_fake_${fingerprintCount}` };
    },
    lookup: options.lookup,
    createId: () => String(++id),
    now: () => new Date('2026-09-10T10:00:01.000Z')
  });

  try {
    await run({ service, store, track, filePath, fingerprintCalls: () => fingerprintCount });
  } finally {
    cache.close();
    store.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const strongCandidate = [{
  acoustId: '11111111-1111-4111-8111-111111111111',
  score: 0.99,
  recordings: [{
    recordingId: '22222222-2222-4222-8222-222222222222',
    title: 'Título correto',
    artist: 'Artista correto',
    artistId: '33333333-3333-4333-8333-333333333333',
    durationSeconds: 180,
    releaseGroupId: '44444444-4444-4444-8444-444444444444',
    releaseGroupTitle: 'Álbum correto'
  }]
}];

test('fingerprint forte reutiliza o matcher atual e mantém metadata contraditória em revisão', async () => {
  await fixture(async ({ service, store, track }) => {
    const result = await service.identify('source-run', 'source-suggestion');
    assert.equal(result?.identified, true);
    assert.equal(result?.conflict, true);
    assert.ok(result?.runId);

    const suggestions = store.listSuggestionRecords(result!.runId!, { limit: 20 }).map(item => item.suggestion);
    assert.ok(suggestions.length > 0);
    assert.ok(suggestions.every(item => item.confidence === 'low'));
    assert.ok(suggestions.every(item => item.reasonCodes.includes('fingerprint.match-strong')));
    assert.ok(suggestions.every(item => item.reasonCodes.includes('fingerprint.external-conflict')));
    assert.ok(suggestions.every(item => item.reasonCodes.includes('metadata-conflict')));
    assert.equal(suggestions.some(item => item.target.capability === 'metadata' && item.target.field === 'albumArtist'), false);
    assert.equal(track.albumArtist, 'Artista do álbum preservado');
  }, {
    acoustIdEnabled: true,
    lookup: async () => strongCandidate
  });
});

test('resultados de fingerprint próximos permanecem ambíguos no review', async () => {
  await fixture(async ({ service, store }) => {
    const result = await service.identify('source-run', 'source-suggestion');
    assert.equal(result?.ambiguous, true);
    assert.ok(result?.runId);
    const suggestions = store.listSuggestionRecords(result!.runId!, { limit: 20 }).map(item => item.suggestion);
    assert.ok(suggestions.every(item => item.confidence === 'low'));
    assert.ok(suggestions.every(item => item.reasonCodes.includes('fingerprint.multiple-recordings')));
    assert.ok(suggestions.every(item => item.reasonCodes.includes('ambiguous-candidates')));
  }, {
    acoustIdEnabled: true,
    lookup: async () => [
      ...strongCandidate,
      {
        acoustId: '55555555-5555-4555-8555-555555555555',
        score: 0.98,
        recordings: [{
          ...strongCandidate[0].recordings[0],
          recordingId: '66666666-6666-4666-8666-666666666666'
        }]
      }
    ]
  });
});

test('fingerprint local usa cache físico e invalida quando o arquivo muda', async () => {
  await fixture(async ({ service, filePath, fingerprintCalls }) => {
    const first = await service.identify('source-run', 'source-suggestion');
    const second = await service.identify('source-run', 'source-suggestion');
    assert.equal(first?.externalLookup, false);
    assert.equal(first?.cacheHit, false);
    assert.equal(second?.cacheHit, true);
    assert.equal(fingerprintCalls(), 1);

    await writeFile(filePath, 'audio-b-with-new-size');
    const third = await service.identify('source-run', 'source-suggestion');
    assert.equal(third?.cacheHit, false);
    assert.equal(fingerprintCalls(), 2);
  });
});
