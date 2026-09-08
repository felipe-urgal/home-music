import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { LibraryAssistantRun } from '@home-music/shared/library-assistant';
import { registerLibraryAssistantRoutes } from './library-assistant-routes.js';
import type { LibraryAssistantService } from './library-assistant-service.js';

function queuedRun(): LibraryAssistantRun {
  return {
    id: 'assistant-run-full-test',
    capability: 'metadata',
    status: 'queued',
    libraryRevision: 1,
    algorithmVersion: 1,
    summary: {
      total: 0,
      pending: 0,
      review: 0,
      applied: 0,
      rejected: 0,
      stale: 0,
      failed: 0
    },
    createdAt: '2026-09-08T13:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    error: null
  };
}

test('start run accepts explicit full reanalysis and rejects invalid mode', async () => {
  const calls: Array<{ capability: string; full: boolean | undefined }> = [];
  const assistant = {
    startRun(capability: string, _ownerId?: string | null, options?: { full?: boolean }) {
      calls.push({ capability, full: options?.full });
      return queuedRun();
    }
  } as unknown as LibraryAssistantService;
  const app = Fastify();
  registerLibraryAssistantRoutes(app, assistant);

  try {
    const full = await app.inject({
      method: 'POST',
      url: '/api/admin/library-assistant/runs',
      headers: { 'content-type': 'application/json' },
      payload: { capability: 'metadata', full: true }
    });
    assert.equal(full.statusCode, 202);
    assert.deepEqual(calls, [{ capability: 'metadata', full: true }]);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/admin/library-assistant/runs',
      headers: { 'content-type': 'application/json' },
      payload: { capability: 'metadata', full: 'yes' }
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }
});
