import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import { LibraryAssistantStore } from './library-assistant-store.js';

function track(id = 'track-1'): IndexedTrack {
  return {
    id,
    title: 'Faixa',
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

async function withDatabase(run: (databasePath: string) => Promise<void> | void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-store-'));
  const databasePath = path.join(directory, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  database.syncTracks([track()], '/music', '2026-09-06T12:00:00.000Z');
  try {
    await run(databasePath);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const suggestion = {
  id: 'suggestion-1',
  runId: 'run-1',
  capability: 'metadata' as const,
  trackId: 'track-1',
  status: 'review' as const,
  confidence: 'high' as const,
  reasonCodes: ['provider-match', 'exact-text-match'] as const,
  evidence: [{
    type: 'text-match' as const,
    version: 1 as const,
    field: 'title' as const,
    match: 'exact' as const,
    sourceValue: 'Faixa',
    candidateValue: 'Faixa'
  }],
  provenance: {
    source: 'musicbrainz' as const,
    providerVersion: 'v1',
    externalId: 'recording-1'
  },
  target: {
    capability: 'metadata' as const,
    trackId: 'track-1',
    field: 'title' as const,
    currentValue: 'Faixa',
    suggestedValue: 'Faixa'
  },
  premiseSignature: 'a'.repeat(64),
  createdAt: '2026-09-06T12:00:01.000Z'
};

test('runs and typed suggestions survive reopen without duplicating the track catalog', async () => {
  await withDatabase(databasePath => {
    const first = new LibraryAssistantStore(databasePath);
    first.createRun({
      id: 'run-1',
      capability: 'metadata',
      libraryRevision: 4,
      createdAt: '2026-09-06T12:00:00.000Z'
    });
    assert.equal(first.startRun('run-1', '2026-09-06T12:00:00.500Z'), true);
    first.insertSuggestions([suggestion]);
    assert.equal(first.completeRun('run-1', '2026-09-06T12:00:02.000Z'), true);
    assert.deepEqual(first.getRun('run-1')?.summary, {
      total: 1,
      pending: 0,
      review: 1,
      applied: 0,
      rejected: 0,
      stale: 0,
      failed: 0
    });
    first.close();

    const reopened = new LibraryAssistantStore(databasePath);
    const run = reopened.getRun('run-1');
    const records = reopened.listSuggestionRecords('run-1');
    assert.equal(run?.status, 'completed');
    assert.equal(run?.libraryRevision, 4);
    assert.equal(records.length, 1);
    assert.equal(records[0].suggestion.target.trackId, 'track-1');
    assert.equal(records[0].premiseSignature, 'a'.repeat(64));
    assert.doesNotMatch(JSON.stringify(records[0]), /\/music\/track-1\.mp3/);
    reopened.close();
  });
});

test('running analysis is marked failed safely after restart', async () => {
  await withDatabase(databasePath => {
    const first = new LibraryAssistantStore(databasePath);
    first.createRun({
      id: 'run-interrupted',
      capability: 'artwork',
      libraryRevision: 7,
      createdAt: '2026-09-06T12:00:00.000Z'
    });
    first.startRun('run-interrupted', '2026-09-06T12:00:01.000Z');
    first.close();

    const restarted = new LibraryAssistantStore(databasePath, {
      now: () => new Date('2026-09-06T12:05:00.000Z')
    });
    const run = restarted.getRun('run-interrupted');
    assert.equal(run?.status, 'failed');
    assert.equal(run?.finishedAt, '2026-09-06T12:05:00.000Z');
    assert.equal(run?.error?.code, 'interrupted');
    assert.doesNotMatch(JSON.stringify(run), /[/\\](?:Users|home|tmp|music)[/\\]/i);
    restarted.close();
  });
});

test('stale suggestion and cancellation transitions do not overwrite terminal state', async () => {
  await withDatabase(databasePath => {
    const store = new LibraryAssistantStore(databasePath);
    store.createRun({
      id: 'run-1',
      capability: 'metadata',
      libraryRevision: 1,
      createdAt: '2026-09-06T12:00:00.000Z'
    });
    store.startRun('run-1', '2026-09-06T12:00:00.500Z');
    store.insertSuggestions([suggestion]);
    assert.equal(store.markSuggestionStale('suggestion-1', '2026-09-06T12:00:01.000Z'), true);
    assert.equal(store.markSuggestionStale('suggestion-1', '2026-09-06T12:00:02.000Z'), false);
    assert.equal(store.getRun('run-1')?.summary.stale, 1);

    assert.equal(store.cancelRun('run-1', '2026-09-06T12:00:03.000Z'), true);
    assert.equal(store.completeRun('run-1', '2026-09-06T12:00:04.000Z'), false);
    assert.equal(store.getRun('run-1')?.status, 'cancelled');
    store.close();
  });
});

test('provider cache is versioned, TTL-bound and keyed only by a deterministic hash', async () => {
  await withDatabase(databasePath => {
    let nowMs = Date.parse('2026-09-06T12:00:00.000Z');
    const store = new LibraryAssistantStore(databasePath, { now: () => new Date(nowMs) });
    const rawKey = 'title=Faixa&artist=Artista';
    const key = {
      provider: 'musicbrainz',
      providerVersion: 'v1',
      cacheKeyHash: createHash('sha256').update(rawKey).digest('hex')
    };
    store.putProviderCache(key, { recordingId: 'recording-1' }, nowMs + 5_000, new Date(nowMs).toISOString());
    assert.deepEqual(store.getProviderCache(key, nowMs)?.payload, { recordingId: 'recording-1' });
    assert.equal(store.getProviderCache({ ...key, providerVersion: 'v2' }, nowMs), null);

    nowMs += 5_001;
    assert.equal(store.getProviderCache(key, nowMs), null);
    store.close();
  });
});

test('suggestion persistence rejects path-shaped evidence and oversized provider payloads', async () => {
  await withDatabase(databasePath => {
    const store = new LibraryAssistantStore(databasePath);
    store.createRun({
      id: 'run-1',
      capability: 'metadata',
      libraryRevision: 1,
      createdAt: '2026-09-06T12:00:00.000Z'
    });
    store.startRun('run-1', '2026-09-06T12:00:00.500Z');

    assert.throws(() => store.insertSuggestions([{
      ...suggestion,
      evidence: [{
        type: 'file-context',
        version: 1,
        fileName: '/music/secret.mp3',
        folderName: null
      }]
    }]), /caminho físico/);

    const key = {
      provider: 'musicbrainz',
      providerVersion: 'v1',
      cacheKeyHash: 'b'.repeat(64)
    };
    assert.throws(
      () => store.putProviderCache(key, { huge: 'x'.repeat(70 * 1024) }, Date.now() + 1_000, new Date().toISOString()),
      /excede o limite/
    );
    store.close();
  });
});
