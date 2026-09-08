import assert from 'node:assert/strict';
import test from 'node:test';
import { LibraryAssistantRunMetrics } from './library-assistant-run-metrics.js';

test('run metrics attributes provider work and retries to the bound analysis signal', () => {
  const metrics = new LibraryAssistantRunMetrics();
  const first = new AbortController();
  const second = new AbortController();

  metrics.bindSignal('assistant-run-1', first.signal);
  metrics.bindSignal('assistant-run-2', second.signal);
  metrics.observeProvider({
    signal: first.signal,
    cache: 'miss',
    externalRequest: true,
    rateLimitWaitMs: 1_000
  });
  metrics.observeProvider({
    signal: first.signal,
    cache: 'hit',
    externalRequest: false,
    rateLimitWaitMs: 0
  });
  metrics.observeProvider({
    signal: second.signal,
    cache: 'miss',
    externalRequest: true,
    rateLimitWaitMs: 500
  });
  metrics.recordRetry('assistant-run-1', 'Provider-Timeout');
  metrics.recordRetry('assistant-run-1', 'provider-timeout');

  assert.deepEqual(metrics.snapshot('assistant-run-1'), {
    searchAttempts: 2,
    externalRequests: 1,
    cacheHits: 1,
    cacheMisses: 1,
    rateLimitWaitMs: 1_000,
    retriesTotal: 2,
    retriesByReason: { 'provider-timeout': 2 }
  });
  assert.deepEqual(metrics.snapshot('assistant-run-2'), {
    searchAttempts: 1,
    externalRequests: 1,
    cacheHits: 0,
    cacheMisses: 1,
    rateLimitWaitMs: 500,
    retriesTotal: 0,
    retriesByReason: {}
  });
});

test('run metrics ignore unbound provider observations and sanitize retry reasons', () => {
  const metrics = new LibraryAssistantRunMetrics();
  const controller = new AbortController();

  metrics.observeProvider({
    signal: controller.signal,
    cache: 'miss',
    externalRequest: true,
    rateLimitWaitMs: 1_000
  });
  metrics.recordRetry('assistant-run-1', 'not safe / reason');

  assert.deepEqual(metrics.snapshot('assistant-run-1').retriesByReason, { unknown: 1 });
  assert.equal(metrics.snapshot('assistant-run-1').searchAttempts, 0);
});
