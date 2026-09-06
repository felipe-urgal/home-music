import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LibraryAssistantContentIdentity } from '@home-music/shared/library-assistant';
import { LibraryAssistantStore } from './library-assistant-store.js';

const identity: LibraryAssistantContentIdentity = {
  algorithm: 'sha256',
  version: 1,
  digest: 'a'.repeat(64),
  sizeBytes: 42
};

async function withDatabase(run: (databasePath: string) => Promise<void> | void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-store-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('content hash cache survives restart and deduplicates the same content identity', async () => {
  await withDatabase(databasePath => {
    const first = new LibraryAssistantStore(databasePath);
    first.putCachedIdentity(
      { relativePath: 'Artist/one.flac', sizeBytes: 42, mtimeMs: 100 },
      identity,
      '2026-09-06T12:00:00.000Z'
    );
    first.putCachedIdentity(
      { relativePath: 'Artist/two.flac', sizeBytes: 42, mtimeMs: 200 },
      identity,
      '2026-09-06T12:00:01.000Z'
    );
    assert.equal(first.countContentIdentities(), 1);
    first.close();

    const restarted = new LibraryAssistantStore(databasePath);
    assert.deepEqual(
      restarted.getCachedIdentity({ relativePath: 'Artist/one.flac', sizeBytes: 42, mtimeMs: 100 }),
      identity
    );
    assert.deepEqual(
      restarted.getCachedIdentity({ relativePath: 'Artist/two.flac', sizeBytes: 42, mtimeMs: 200 }),
      identity
    );
    assert.equal(restarted.countContentIdentities(), 1);
    restarted.close();
  });
});

test('cache invalidates stale evidence for the same relative path', async () => {
  await withDatabase(databasePath => {
    const store = new LibraryAssistantStore(databasePath);
    store.putCachedIdentity(
      { relativePath: 'Artist/track.flac', sizeBytes: 42, mtimeMs: 100 },
      identity,
      '2026-09-06T12:00:00.000Z'
    );
    const changedIdentity = { ...identity, digest: 'b'.repeat(64), sizeBytes: 43 };
    store.putCachedIdentity(
      { relativePath: 'Artist/track.flac', sizeBytes: 43, mtimeMs: 101 },
      changedIdentity,
      '2026-09-06T12:00:01.000Z'
    );

    assert.equal(
      store.getCachedIdentity({ relativePath: 'Artist/track.flac', sizeBytes: 42, mtimeMs: 100 }),
      null
    );
    assert.deepEqual(
      store.getCachedIdentity({ relativePath: 'Artist/track.flac', sizeBytes: 43, mtimeMs: 101 }),
      changedIdentity
    );
    store.close();
  });
});

test('jobs persist progress and interrupted running jobs fail safely after restart', async () => {
  await withDatabase(databasePath => {
    const first = new LibraryAssistantStore(databasePath);
    first.createJob({
      id: 'job-1',
      kind: 'content-hash',
      libraryRevision: 7,
      total: 3,
      createdAt: '2026-09-06T12:00:00.000Z'
    });
    assert.equal(first.startJob('job-1', '2026-09-06T12:00:01.000Z'), true);
    first.setProgress('job-1', 2);
    assert.equal(first.getJob('job-1')?.progress.completed, 2);
    first.close();

    const restarted = new LibraryAssistantStore(databasePath, new Date('2026-09-06T12:05:00.000Z'));
    const job = restarted.getJob('job-1');
    assert.equal(job?.status, 'failed');
    assert.equal(job?.progress.completed, 2);
    assert.equal(job?.finishedAt, '2026-09-06T12:05:00.000Z');
    assert.equal(job?.error?.code, 'interrupted');
    assert.doesNotMatch(JSON.stringify(job), /[/\\](?:Users|home|tmp)[/\\]/i);
    restarted.close();
  });
});

test('cancellation and stale transitions cannot overwrite terminal jobs', async () => {
  await withDatabase(databasePath => {
    const store = new LibraryAssistantStore(databasePath);
    store.createJob({
      id: 'cancel-me',
      kind: 'content-hash',
      libraryRevision: 1,
      total: 1,
      createdAt: '2026-09-06T12:00:00.000Z'
    });
    assert.equal(store.cancelJob('cancel-me', '2026-09-06T12:00:01.000Z'), true);
    assert.equal(store.cancelJob('cancel-me', '2026-09-06T12:00:02.000Z'), false);
    assert.equal(store.completeJob('cancel-me', '2026-09-06T12:00:03.000Z'), false);
    assert.equal(store.getJob('cancel-me')?.status, 'cancelled');

    store.createJob({
      id: 'stale-me',
      kind: 'content-hash',
      libraryRevision: 1,
      total: 2,
      createdAt: '2026-09-06T12:01:00.000Z'
    });
    assert.equal(store.startJob('stale-me', '2026-09-06T12:01:01.000Z'), true);
    assert.deepEqual(store.markStaleForRevision(2, '2026-09-06T12:01:02.000Z'), ['stale-me']);
    assert.equal(store.getJob('stale-me')?.status, 'stale');
    assert.equal(store.completeJob('stale-me', '2026-09-06T12:01:03.000Z'), false);
    store.close();
  });
});
