import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { LibraryAssistantRun } from '@home-music/shared/library-assistant';
import type { LibraryAssistantPersistentQueue } from './library-assistant-persistent-queue.js';
import { registerLibraryAssistantRoutes } from './library-assistant-routes.js';
import { LibraryAssistantRunMetrics } from './library-assistant-run-metrics.js';
import type { LibraryAssistantService } from './library-assistant-service.js';

function completedRun(): LibraryAssistantRun {
  return {
    id: 'assistant-run-1',
    capability: 'metadata',
    status: 'completed',
    libraryRevision: 7,
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
    createdAt: '2026-09-08T10:00:00.000Z',
    startedAt: '2026-09-08T10:00:00.000Z',
    finishedAt: '2026-09-08T10:00:10.000Z',
    error: null
  };
}

test('progress endpoint exposes throughput, ETA and provider/retry observations', async () => {
  const assistant = {
    getRun(id: string) { return id === 'assistant-run-1' ? completedRun() : null; }
  } as unknown as LibraryAssistantService;
  const workQueue = {
    summary() {
      return {
        total: 10,
        pending: 2,
        processing: 0,
        matched: 6,
        no_match: 2,
        retry: 0,
        failed: 0
      };
    }
  } as unknown as LibraryAssistantPersistentQueue;
  const metrics = new LibraryAssistantRunMetrics();
  const controller = new AbortController();
  metrics.bindSignal('assistant-run-1', controller.signal);
  metrics.observeProvider({ signal: controller.signal, cache: 'miss', externalRequest: true, rateLimitWaitMs: 1_000 });
  metrics.observeProvider({ signal: controller.signal, cache: 'miss', externalRequest: true, rateLimitWaitMs: 1_000 });
  metrics.observeProvider({ signal: controller.signal, cache: 'hit', externalRequest: false, rateLimitWaitMs: 0 });
  metrics.recordRetry('assistant-run-1', 'provider-timeout');

  const app = Fastify();
  registerLibraryAssistantRoutes(app, assistant, workQueue, metrics);
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/library-assistant/runs/assistant-run-1/progress'
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().progress, {
      total: 10,
      processed: 8,
      pending: 2,
      processing: 0,
      matched: 6,
      noMatch: 2,
      retry: 0,
      failed: 0,
      metrics: {
        elapsedMs: 10_000,
        tracksPerSecond: 0.8,
        etaMs: 2_500,
        searchAttempts: 3,
        externalRequests: 2,
        cacheHits: 1,
        cacheMisses: 2,
        rateLimitWaitMs: 2_000,
        retriesTotal: 1,
        retriesByReason: { 'provider-timeout': 1 }
      }
    });
  } finally {
    await app.close();
  }
});

test('progress endpoint omits derived metrics when the run was not observed in this process', async () => {
  const assistant = {
    getRun() { return completedRun(); }
  } as unknown as LibraryAssistantService;
  const workQueue = {
    summary() {
      return {
        total: 0,
        pending: 0,
        processing: 0,
        matched: 0,
        no_match: 0,
        retry: 0,
        failed: 0
      };
    }
  } as unknown as LibraryAssistantPersistentQueue;

  const app = Fastify();
  registerLibraryAssistantRoutes(app, assistant, workQueue, new LibraryAssistantRunMetrics());
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/library-assistant/runs/assistant-run-1/progress'
    });
    assert.equal(response.statusCode, 200);
    assert.equal('metrics' in response.json().progress, false);
  } finally {
    await app.close();
  }
});
