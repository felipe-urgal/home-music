import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {
  registerAdminExternalProviderBatchRoutes
} from './admin-external-provider-batch-routes.js';
import {
  ExternalProviderBatchError,
  type ExternalProviderBatch
} from './external-provider-batch.js';

function batch(status: ExternalProviderBatch['status'] = 'ready'): ExternalProviderBatch {
  return {
    id: 'batch-1',
    providerId: 'yt-dlp',
    label: 'Minha playlist',
    status,
    folderPath: status === 'ready' ? null : 'Playlists/Teste',
    createdAt: '2026-08-29T12:00:00.000Z',
    updatedAt: '2026-08-29T12:00:00.000Z',
    startedAt: status === 'ready' ? null : '2026-08-29T12:00:01.000Z',
    finishedAt: null,
    expiresAt: '2026-08-29T12:30:00.000Z',
    error: null,
    limits: { maxItems: 50, maxBytes: 2_147_483_648, maxDurationSeconds: 43_200 },
    summary: {
      total: 2,
      processed: 0,
      completed: 0,
      duplicates: 0,
      ignored: 0,
      failed: 0,
      cancelled: 0,
      importedBytes: 0,
      importedDurationSeconds: 0
    },
    items: [
      { index: 0, sourceId: 'video001', label: 'Faixa 1', durationSeconds: 120, status: 'queued', jobId: null, destination: null, error: null },
      { index: 1, sourceId: 'video002', label: 'Faixa 2', durationSeconds: 180, status: 'queued', jobId: null, destination: null, error: null }
    ]
  };
}

test('rotas de lote expõem preview, início, progresso e cancelamento', async () => {
  const app = Fastify();
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const ready = batch('ready');
  const running = batch('running');
  const cancelled = { ...running, status: 'cancelled' as const };

  const batches = {
    inspect: async (providerId: string, request: { url: string }) => {
      calls.push({ operation: 'inspect', value: { providerId, request } });
      return ready;
    },
    getLimits: () => ready.limits,
    get: (id: string) => {
      calls.push({ operation: 'get', value: id });
      return running;
    },
    start: (id: string, folderPath?: unknown) => {
      calls.push({ operation: 'start', value: { id, folderPath } });
      return running;
    },
    cancel: async (id: string) => {
      calls.push({ operation: 'cancel', value: id });
      return cancelled;
    },
    stop: () => undefined
  };

  registerAdminExternalProviderBatchRoutes(app, { batches: batches as never });
  await app.ready();
  try {
    const inspected = await app.inject({
      method: 'POST',
      url: '/api/admin/imports/providers/yt-dlp/batches/inspect',
      payload: { url: 'https://music.youtube.com/playlist?list=PL123' }
    });
    assert.equal(inspected.statusCode, 200);
    assert.equal(inspected.headers['cache-control'], 'no-store');
    assert.equal(inspected.json().batch.summary.total, 2);

    const started = await app.inject({
      method: 'POST',
      url: '/api/admin/imports/provider-batches/batch-1/start',
      payload: { folderPath: 'Playlists/Teste' }
    });
    assert.equal(started.statusCode, 202);
    assert.equal(started.json().batch.status, 'running');

    const progress = await app.inject({ method: 'GET', url: '/api/admin/imports/provider-batches/batch-1' });
    assert.equal(progress.statusCode, 200);
    assert.equal(progress.headers['cache-control'], 'private, no-store');

    const stopped = await app.inject({ method: 'DELETE', url: '/api/admin/imports/provider-batches/batch-1' });
    assert.equal(stopped.statusCode, 200);
    assert.equal(stopped.json().batch.status, 'cancelled');

    assert.deepEqual(calls.map(call => call.operation), ['inspect', 'start', 'get', 'cancel']);
  } finally {
    await app.close();
  }
});

test('rota de lote preserva status HTTP de erro de domínio', async () => {
  const app = Fastify();
  const batches = {
    inspect: async () => {
      throw new ExternalProviderBatchError('batch_limit_exceeded', 'Playlist excede o limite.', 413);
    },
    getLimits: () => ({ maxItems: 50, maxBytes: 100, maxDurationSeconds: 100 }),
    get: () => batch(),
    start: () => batch(),
    cancel: async () => batch('cancelled'),
    stop: () => undefined
  };
  registerAdminExternalProviderBatchRoutes(app, { batches: batches as never });
  await app.ready();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/imports/providers/yt-dlp/batches/inspect',
      payload: { url: 'https://music.youtube.com/playlist?list=PL123' }
    });
    assert.equal(response.statusCode, 413);
    assert.deepEqual(response.json(), { error: 'Playlist excede o limite.' });
  } finally {
    await app.close();
  }
});
