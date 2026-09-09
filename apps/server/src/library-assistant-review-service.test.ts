import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LibraryAssistantReasonCode } from '@home-music/shared/library-assistant';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import { LibraryAssistantReviewService } from './library-assistant-review-service.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import { TrackMetadataOverrideStore } from './track-metadata-overrides.js';

function track(id: string, title: string): IndexedTrack {
  return {
    id,
    title,
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

async function withReview(run: (context: {
  assistant: LibraryAssistantStore;
  metadata: TrackMetadataOverrideStore;
  review: LibraryAssistantReviewService;
  tracks: IndexedTrack[];
  revisionChanges: () => number;
}) => Promise<void> | void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-review-'));
  const databasePath = path.join(directory, 'home-music.db');
  const physicalTracks = [track('track-1', 'Faixa antiga'), track('track-2', 'Outra faixa')];
  const database = new HomeMusicDatabase(databasePath);
  database.syncTracks(physicalTracks, '/music', '2026-09-07T12:00:00.000Z');
  const assistant = new LibraryAssistantStore(databasePath);
  const metadata = new TrackMetadataOverrideStore(databasePath);
  let revision = 0;
  const review = new LibraryAssistantReviewService({
    databasePath,
    store: assistant,
    metadataOverrides: metadata,
    library: {
      listTracks: () => physicalTracks.map(item => metadata.resolveTrack(item)),
      revision: () => 7 + revision
    },
    onMetadataChanged: () => { revision += 1; },
    now: () => new Date('2026-09-07T12:10:00.000Z')
  });
  try {
    await run({ assistant, metadata, review, tracks: physicalTracks, revisionChanges: () => revision });
  } finally {
    review.close();
    metadata.close();
    assistant.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function seedSuggestion(
  assistant: LibraryAssistantStore,
  input: {
    runId?: string;
    suggestionId?: string;
    trackId?: string;
    field?: 'title' | 'artist' | 'album' | 'albumArtist';
    currentValue?: string;
    suggestedValue?: string;
    createdAt?: string;
    confidence?: 'low' | 'medium' | 'high';
    reasonCodes?: LibraryAssistantReasonCode[];
  } = {}
) {
  const runId = input.runId ?? 'run-1';
  if (!assistant.getRun(runId)) {
    assistant.createRun({
      id: runId,
      capability: 'metadata',
      libraryRevision: 7,
      createdAt: '2026-09-07T12:00:00.000Z'
    });
    assistant.startRun(runId, '2026-09-07T12:00:01.000Z');
  }
  const trackId = input.trackId ?? 'track-1';
  const field = input.field ?? 'title';
  const currentValue = input.currentValue ?? 'Faixa antiga';
  assistant.insertSuggestions([{
    id: input.suggestionId ?? 'suggestion-1',
    runId,
    capability: 'metadata',
    trackId,
    status: 'review',
    confidence: input.confidence ?? 'high',
    reasonCodes: input.reasonCodes ?? ['provider-match'],
    evidence: [{
      type: 'text-match',
      version: 1,
      field,
      match: 'different',
      sourceValue: currentValue,
      candidateValue: input.suggestedValue ?? 'Faixa correta'
    }],
    provenance: { source: 'musicbrainz', providerVersion: 'v1', externalId: 'recording-1' },
    target: {
      capability: 'metadata',
      trackId,
      field,
      currentValue,
      suggestedValue: input.suggestedValue ?? 'Faixa correta'
    },
    premiseSignature: 'a'.repeat(64),
    createdAt: input.createdAt ?? '2026-09-07T12:00:02.000Z'
  }]);
  assistant.completeRun(runId, '2026-09-07T12:00:03.000Z');
}

function decision(overrides: Partial<{
  runId: string;
  suggestionId: string;
  action: 'apply' | 'reject';
  expectedLibraryRevision: number;
  expectedCurrentValue: string;
}> = {}) {
  return {
    runId: overrides.runId ?? 'run-1',
    suggestionId: overrides.suggestionId ?? 'suggestion-1',
    action: overrides.action ?? 'apply',
    expectedLibraryRevision: overrides.expectedLibraryRevision ?? 7,
    expectedCurrentValue: overrides.expectedCurrentValue ?? 'Faixa antiga'
  } as const;
}

test('review queue applies one metadata field through overrides and is idempotent', async () => {
  await withReview(async ({ assistant, metadata, review, revisionChanges }) => {
    seedSuggestion(assistant);
    const queue = review.getReviewQueue();
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].track.title, 'Faixa antiga');
    assert.equal(queue.items[0].track.physical.title, 'Faixa antiga');

    const applied = await review.decide(decision());
    assert.equal(applied.outcome, 'applied');
    assert.equal(metadata.get('track-1')?.effective.title, 'Faixa correta');
    assert.equal(metadata.get('track-1')?.physical.title, 'Faixa antiga');
    assert.equal(revisionChanges(), 1);
    assert.equal(assistant.getRun('run-1')?.summary.applied, 1);

    const repeated = await review.decide(decision());
    assert.equal(repeated.outcome, 'already-applied');
    assert.equal(revisionChanges(), 1);
  });
});

test('review marks suggestion stale when effective field changed after analysis', async () => {
  await withReview(async ({ assistant, metadata, review }) => {
    seedSuggestion(assistant);
    metadata.patch('track-1', { title: 'Alterada por humano' });

    const result = await review.decide(decision());
    assert.equal(result.outcome, 'stale');
    assert.equal(result.currentValue, 'Alterada por humano');
    assert.equal(assistant.getRun('run-1')?.summary.stale, 1);
    assert.equal(metadata.get('track-1')?.effective.title, 'Alterada por humano');
  });
});

test('same-value human edit after analysis still makes that field stale', async () => {
  await withReview(async ({ assistant, metadata, review }) => {
    seedSuggestion(assistant);
    metadata.patch('track-1', { title: 'Faixa antiga' });

    const result = await review.decide(decision());
    assert.equal(result.outcome, 'stale');
    assert.equal(metadata.get('track-1')?.effective.title, 'Faixa antiga');
  });
});

test('human edit on a sibling field does not stale the reviewed field', async () => {
  await withReview(async ({ assistant, metadata, review }) => {
    seedSuggestion(assistant);
    metadata.patch('track-1', { artist: 'Artista humana' });

    const result = await review.decide(decision());
    assert.equal(result.outcome, 'applied');
    assert.equal(metadata.get('track-1')?.effective.title, 'Faixa correta');
    assert.equal(metadata.get('track-1')?.effective.artist, 'Artista humana');
  });
});

test('applying one field does not stale another suggestion from the same analysis', async () => {
  await withReview(async ({ assistant, metadata, review }) => {
    seedSuggestion(assistant, {
      suggestionId: 'suggestion-title',
      field: 'title',
      currentValue: 'Faixa antiga',
      suggestedValue: 'Faixa correta'
    });
    seedSuggestion(assistant, {
      suggestionId: 'suggestion-artist',
      field: 'artist',
      currentValue: 'Artista',
      suggestedValue: 'Artista correta'
    });

    const title = await review.decide(decision({ suggestionId: 'suggestion-title' }));
    const artist = await review.decide(decision({
      suggestionId: 'suggestion-artist',
      expectedCurrentValue: 'Artista'
    }));

    assert.equal(title.outcome, 'applied');
    assert.equal(artist.outcome, 'applied');
    assert.equal(metadata.get('track-1')?.effective.title, 'Faixa correta');
    assert.equal(metadata.get('track-1')?.effective.artist, 'Artista correta');
  });
});

test('apply converging to physical metadata removes the redundant override', async () => {
  await withReview(async ({ assistant, metadata, review }) => {
    metadata.patch('track-1', { title: 'Título manual' });
    seedSuggestion(assistant, {
      currentValue: 'Título manual',
      suggestedValue: 'Faixa antiga',
      createdAt: '2099-01-01T00:00:00.000Z'
    });

    const queue = review.getReviewQueue();
    assert.equal(queue.items[0].track.title, 'Título manual');
    assert.equal(queue.items[0].track.physical.title, 'Faixa antiga');

    const applied = await review.decide(decision({ expectedCurrentValue: 'Título manual' }));
    assert.equal(applied.outcome, 'applied');
    assert.equal(metadata.get('track-1')?.override.title, null);
    assert.equal(metadata.get('track-1')?.effective.title, 'Faixa antiga');
    assert.equal(metadata.get('track-1')?.physical.title, 'Faixa antiga');
  });
});

test('review marks suggestion stale when the track is no longer in the effective library', async () => {
  await withReview(async ({ assistant, metadata, review, tracks }) => {
    seedSuggestion(assistant);
    tracks.splice(0, 1);

    const result = await review.decide(decision());
    assert.equal(result.outcome, 'stale');
    assert.equal(result.currentValue, null);
    assert.equal(metadata.get('track-1')?.override.title, null);
  });
});

test('reject changes only assistant lifecycle and is idempotent', async () => {
  await withReview(async ({ assistant, metadata, review, revisionChanges }) => {
    seedSuggestion(assistant);
    const rejected = await review.decide(decision({ action: 'reject' }));
    assert.equal(rejected.outcome, 'rejected');
    assert.equal(metadata.get('track-1')?.override.title, null);
    assert.equal(revisionChanges(), 0);

    const repeated = await review.decide(decision({ action: 'reject' }));
    assert.equal(repeated.outcome, 'already-rejected');
    assert.equal(assistant.getRun('run-1')?.summary.rejected, 1);
  });
});

test('batch keeps explicit partial success when one suggestion is stale', async () => {
  await withReview(async ({ assistant, metadata, review }) => {
    seedSuggestion(assistant, { suggestionId: 'suggestion-apply' });
    seedSuggestion(assistant, {
      runId: 'run-2',
      suggestionId: 'suggestion-stale',
      trackId: 'track-2',
      currentValue: 'Outra faixa',
      suggestedValue: 'Outra faixa correta'
    });
    metadata.patch('track-2', { title: 'Mudança concorrente' });

    const response = await review.decideBatch([
      decision({ suggestionId: 'suggestion-apply' }),
      decision({
        runId: 'run-2',
        suggestionId: 'suggestion-stale',
        expectedCurrentValue: 'Outra faixa'
      })
    ]);

    assert.deepEqual(response.results.map(item => item.outcome), ['applied', 'stale']);
    assert.deepEqual(response.summary, {
      total: 2,
      applied: 1,
      rejected: 0,
      alreadyResolved: 0,
      stale: 1,
      failed: 0
    });
    assert.equal(metadata.get('track-1')?.effective.title, 'Faixa correta');
    assert.equal(metadata.get('track-2')?.effective.title, 'Mudança concorrente');
  });
});

test('review batch requires explicit confirmation and applies after confirmation', async () => {
  await withReview(async ({ assistant, metadata, review }) => {
    seedSuggestion(assistant, { confidence: 'low' });

    const blocked = await review.decideBatch([decision()]);
    assert.equal(blocked.results[0].outcome, 'failed');
    assert.match(blocked.results[0].message ?? '', /confirmação explícita/);
    assert.equal(assistant.getRun('run-1')?.summary.review, 1);
    assert.equal(metadata.get('track-1')?.effective.title, 'Faixa antiga');

    const confirmed = await review.decideBatch([decision()], { confirmReview: true });
    assert.equal(confirmed.results[0].outcome, 'applied');
    assert.equal(metadata.get('track-1')?.effective.title, 'Faixa correta');
  });
});

test('confirmed review batch keeps human override stale protection', async () => {
  await withReview(async ({ assistant, metadata, review }) => {
    seedSuggestion(assistant, { confidence: 'low' });
    metadata.patch('track-1', { title: 'Faixa antiga' });

    const confirmed = await review.decideBatch([decision()], { confirmReview: true });
    assert.equal(confirmed.results[0].outcome, 'stale');
    assert.equal(metadata.get('track-1')?.effective.title, 'Faixa antiga');
  });
});

test('batch rejects more than 100 decisions', async () => {
  await withReview(async ({ review }) => {
    await assert.rejects(
      () => review.decideBatch(Array.from({ length: 101 }, () => decision())),
      /entre 1 e 100 decisões/
    );
  });
});

test('reset invalidates only open metadata suggestions and preserves resolved history', async () => {
  await withReview(async ({ assistant, metadata, review }) => {
    seedSuggestion(assistant, {
      runId: 'run-open',
      suggestionId: 'suggestion-open',
      trackId: 'track-2',
      currentValue: 'Outra faixa',
      suggestedValue: 'Outra faixa revisada'
    });
    seedSuggestion(assistant, {
      runId: 'run-rejected',
      suggestionId: 'suggestion-rejected'
    });
    await review.decide(decision({
      runId: 'run-rejected',
      suggestionId: 'suggestion-rejected',
      action: 'reject'
    }));
    seedSuggestion(assistant, {
      runId: 'run-applied',
      suggestionId: 'suggestion-applied',
      suggestedValue: 'Faixa aplicada'
    });
    await review.decide(decision({
      runId: 'run-applied',
      suggestionId: 'suggestion-applied'
    }));

    const invalidated = review.resetOpenSuggestions();

    assert.equal(invalidated, 1);
    assert.equal(assistant.getRun('run-open')?.summary.stale, 1);
    assert.equal(assistant.getRun('run-open')?.status, 'stale');
    assert.equal(assistant.getRun('run-rejected')?.summary.rejected, 1);
    assert.equal(assistant.getRun('run-rejected')?.status, 'completed');
    assert.equal(assistant.getRun('run-applied')?.summary.applied, 1);
    assert.equal(assistant.getRun('run-applied')?.status, 'completed');
    assert.equal(metadata.get('track-1')?.effective.title, 'Faixa aplicada');
  });
});

test('reset refuses to mutate review state while metadata analysis is active', async () => {
  await withReview(async ({ assistant, review }) => {
    assistant.createRun({
      id: 'run-active',
      capability: 'metadata',
      libraryRevision: 7,
      createdAt: '2026-09-07T12:09:00.000Z'
    });

    assert.throws(
      () => review.resetOpenSuggestions(),
      /Cancele a análise em andamento/
    );
  });
});
