import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import type { Track } from '@home-music/shared';
import type { LibraryAssistantDecision } from '@home-music/shared/library-assistant';
import { LibraryAssistantCompositeReviewService } from './library-assistant-composite-review-service.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import { TrackLyricsOverrideStore } from './track-lyrics-overrides.js';

function track(): Track {
  return {
    id: 'track-1',
    title: 'Faixa Sintética',
    artist: 'Artista de Teste',
    album: 'Álbum de Teste',
    albumArtist: 'Artista de Teste',
    folder: 'Album',
    folderPath: 'Album',
    duration: 180,
    format: '.flac',
    hasCover: false
  };
}

async function fixture(options: { sidecar?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-lyrics-review-'));
  const databasePath = path.join(root, 'library.db');
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE tracks(id TEXT PRIMARY KEY);');
  db.prepare('INSERT INTO tracks(id) VALUES (?);').run('track-1');
  db.close();

  const store = new LibraryAssistantStore(databasePath);
  const run = store.createRun({
    id: 'assistant-run-1',
    capability: 'metadata',
    libraryRevision: 7,
    createdAt: '2026-09-09T12:00:00.000Z'
  });
  assert.ok(store.startRun(run.id, '2026-09-09T12:00:01.000Z'));
  store.insertSuggestions([{
    id: 'lyrics-suggestion-1',
    runId: run.id,
    capability: 'lyrics',
    trackId: 'track-1',
    status: 'pending',
    confidence: 'high',
    reasonCodes: ['provider-match', 'exact-text-match', 'duration-close'],
    evidence: [{
      type: 'external-id',
      version: 1,
      source: 'lrclib',
      id: '123'
    }],
    provenance: { source: 'lrclib', providerVersion: 'test-v1', externalId: '123' },
    target: {
      capability: 'lyrics',
      trackId: 'track-1',
      candidateId: 'lrclib:123',
      synchronized: true,
      language: null,
      currentValue: '',
      preview: 'linha sintética'
    },
    premiseSignature: 'a'.repeat(64),
    createdAt: '2026-09-09T12:00:02.000Z'
  }]);
  assert.ok(store.completeRun(run.id, '2026-09-09T12:00:03.000Z'));

  const lyricsOverrides = new TrackLyricsOverrideStore(databasePath);
  let lyricsChanges = 0;
  const base = {
    getReviewQueue: () => ({ libraryRevision: 7, items: [] }),
    resetOpenSuggestions: () => 0,
    async decide(decision: LibraryAssistantDecision) {
      return {
        runId: decision.runId,
        suggestionId: decision.suggestionId,
        action: decision.action,
        outcome: 'unsupported' as const,
        currentValue: null,
        message: null
      };
    },
    async decideBatch() {
      return {
        results: [],
        summary: { total: 0, applied: 0, rejected: 0, alreadyResolved: 0, stale: 0, failed: 0 }
      };
    },
    close() {}
  };
  const service = new LibraryAssistantCompositeReviewService({
    databasePath,
    base,
    store,
    metadataOverrides: { get: () => null },
    lyricsOverrides,
    library: { listTracks: () => [track()], revision: () => 7 },
    hasSidecarLyrics: async () => options.sidecar === true,
    effectiveLyricsFingerprint: async () => '0'.repeat(64),
    resolveLyricsCandidate: async candidateId => ({
      candidateId,
      synchronized: true,
      language: null,
      text: '[00:01.00]linha sintética criada para teste',
      source: 'lrclib',
      origin: 'external',
      provider: 'lrclib',
      externalId: candidateId,
      preservePrevious: false,
      baseLyricsFingerprint: null
    }),
    onLyricsChanged: () => { lyricsChanges += 1; },
    now: () => new Date('2026-09-09T12:05:00.000Z')
  });

  const decision: LibraryAssistantDecision = {
    runId: run.id,
    suggestionId: 'lyrics-suggestion-1',
    action: 'apply',
    expectedLibraryRevision: 7,
    expectedCurrentValue: ''
  };
  return { service, store, lyricsOverrides, decision, getLyricsChanges: () => lyricsChanges };
}

describe('LibraryAssistantCompositeReviewService lyrics', () => {
  it('surfaces, applies and persists an approved lyrics suggestion', async () => {
    const context = await fixture();
    const queue = context.service.getReviewQueue();
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0]?.suggestion.target.capability, 'lyrics');

    const applied = await context.service.decide(context.decision);
    assert.equal(applied.outcome, 'applied');
    assert.equal(context.lyricsOverrides.get('track-1')?.provider, 'lrclib');
    assert.equal(context.lyricsOverrides.get('track-1')?.mode, 'synced');
    assert.equal(context.getLyricsChanges(), 1);
    assert.equal(context.service.getReviewQueue().items.length, 0);

    context.service.close();
    context.lyricsOverrides.close();
    context.store.close();
  });

  it('marks the suggestion stale if a sidecar appears before apply', async () => {
    const context = await fixture({ sidecar: true });
    const applied = await context.service.decide(context.decision);
    assert.equal(applied.outcome, 'stale');
    assert.equal(context.lyricsOverrides.get('track-1'), null);
    assert.equal(context.getLyricsChanges(), 0);
    assert.equal(context.store.getRun('assistant-run-1')?.status, 'stale');

    context.service.close();
    context.lyricsOverrides.close();
    context.store.close();
  });

  it('removing managed lyrics re-enables fallback without deleting history', async () => {
    const context = await fixture();
    assert.equal((await context.service.decide(context.decision)).outcome, 'applied');
    assert.equal(context.service.clearManagedLyrics('track-1'), true);
    assert.equal(context.lyricsOverrides.get('track-1'), null);
    assert.equal(context.store.listSuggestionRecords('assistant-run-1')[0]?.suggestion.status, 'applied');
    assert.equal(context.getLyricsChanges(), 2);

    context.service.close();
    context.lyricsOverrides.close();
    context.store.close();
  });
});
