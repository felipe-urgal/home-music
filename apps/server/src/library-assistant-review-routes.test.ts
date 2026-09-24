import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { LibraryAssistantDecision } from '@home-music/shared/library-assistant';
import { registerLibraryAssistantReviewRoutes } from './library-assistant-review-routes.js';

test('artwork preview is served from the Home Music origin with image headers', async () => {
  const app = Fastify();
  const review = {
    getReviewQueue: () => ({ libraryRevision: 1, items: [] }),
    async getArtworkPreview(runId: string, suggestionId: string) {
      assert.equal(runId, 'run-1');
      assert.equal(suggestionId, 'suggestion-1');
      return {
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        contentType: 'image/png',
        finalUrl: 'https://archive.org/example.png'
      };
    },
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
    }
  };

  registerLibraryAssistantReviewRoutes(app, review);
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/library-assistant/runs/run-1/suggestions/suggestion-1/artwork-preview'
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /^image\/png/);
    assert.equal(response.headers['cache-control'], 'private, max-age=3600');
    assert.deepEqual(response.rawPayload, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  } finally {
    await app.close();
  }
});

test('artwork preview validates route identifiers before fetching', async () => {
  const app = Fastify();
  let fetched = false;
  registerLibraryAssistantReviewRoutes(app, {
    getReviewQueue: () => ({ libraryRevision: 1, items: [] }),
    async getArtworkPreview() {
      fetched = true;
      return null;
    },
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
    }
  });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/library-assistant/runs/bad!/suggestions/suggestion-1/artwork-preview'
    });
    assert.equal(response.statusCode, 400);
    assert.equal(fetched, false);
  } finally {
    await app.close();
  }
});
