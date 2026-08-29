import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminImportRoutes } from './admin-import-routes.js';
import { registerAdminOperationHistoryRoutes } from './admin-operation-history-routes.js';
import { AdminOperationHistoryStore } from './admin-operation-history.js';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import { ImportUploadManager } from './import-upload.js';
import type { ImportUrlManager } from './import-url.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-import-retry-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  const history = new AdminOperationHistoryStore(path.join(root, 'home-music.db'));
  let sequence = 0;
  const queue = new ImportJobQueue({
    createId: () => `job-${++sequence}`,
    onChange: job => history.recordImport(job)
  });
  const staging = new ImportStagingManager({ musicDir, stagingRoot });
  const uploads = new ImportUploadManager({ queue, staging, maxBytes: 1024 * 1024 });
  let lastRetriedUrl = '';
  const urls = {
    config: {
      maxBytes: 1024 * 1024,
      timeoutMs: 30_000,
      maxRedirects: 3,
      acceptedProtocols: ['http:', 'https:']
    },
    async start(url: unknown) {
      lastRetriedUrl = typeof url === 'string' ? url : '';
      const job = queue.enqueue({ type: 'url', provider: null }, 'example.test · retry.flac');
      queue.transition(job.id, 'processing');
      return { job: queue.get(job.id)! };
    },
    async cancel() {
      throw new Error('não usado');
    }
  } as unknown as ImportUrlManager;

  const app = Fastify();
  registerAdminImportRoutes(app, queue, { uploads, urls, stagingCleanup: null });
  registerAdminOperationHistoryRoutes(app, history);
  return {
    root,
    app,
    history,
    queue,
    staging,
    lastRetriedUrl: () => lastRetriedUrl
  };
}

test('retry de upload cria novo job/staging, vincula tentativa e bloqueia repetição do pai', async () => {
  const item = await fixture();
  try {
    const original = item.queue.enqueue({ type: 'upload', provider: null }, 'faixa.flac');
    item.queue.transition(original.id, 'failed', 'Falha durante o recebimento do arquivo.');
    assert.equal(item.history.list({ kind: 'import' })[0].canRetry, true);

    const response = await item.app.inject({
      method: 'POST',
      url: `/api/admin/operations/import-${original.id}/retry`,
      headers: { 'x-home-music-request': '1' },
      payload: { fileName: 'faixa.flac', size: 5 }
    });
    assert.equal(response.statusCode, 201);
    const child = response.json().job;
    assert.notEqual(child.id, original.id);
    assert.deepEqual(child.retry, {
      parentJobId: original.id,
      rootJobId: original.id,
      attempt: 2
    });
    assert.equal(item.staging.hasJob(child.id), true);

    const history = item.history.list({ kind: 'import' });
    const parentItem = history.find(operation => operation.id === `import-${original.id}`);
    const childItem = history.find(operation => operation.id === `import-${child.id}`);
    assert.equal(parentItem?.canRetry, false);
    assert.deepEqual(childItem?.importRetry, {
      attempt: 2,
      parentOperationId: `import-${original.id}`,
      rootOperationId: `import-${original.id}`,
      failureDisposition: 'none'
    });

    const duplicate = await item.app.inject({
      method: 'POST',
      url: `/api/admin/operations/import-${original.id}/retry`,
      headers: { 'x-home-music-request': '1' },
      payload: { fileName: 'faixa.flac', size: 5 }
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(item.queue.list().filter(job => job.id !== original.id).length, 1);

    const uploaded = await item.app.inject({
      method: 'PUT',
      url: `/api/admin/imports/uploads/${child.id}`,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': '5',
        'x-home-music-request': '1'
      },
      payload: Buffer.from('audio')
    });
    assert.equal(uploaded.statusCode, 200);
    assert.equal(uploaded.json().receivedBytes, 5);
  } finally {
    await item.app.close();
    item.history.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('retry de URL exige nova URL, vincula a tentativa e não persiste a URL no histórico', async () => {
  const item = await fixture();
  try {
    const original = item.queue.enqueue({ type: 'url', provider: null }, 'example.test · audio.flac');
    item.queue.transition(original.id, 'failed', 'Tempo limite excedido ao baixar a URL.');

    const response = await item.app.inject({
      method: 'POST',
      url: `/api/admin/operations/import-${original.id}/retry`,
      headers: { 'x-home-music-request': '1' },
      payload: { url: 'https://cdn.example.test/audio.flac?token=segredo' }
    });
    assert.equal(response.statusCode, 202);
    assert.equal(item.lastRetriedUrl(), 'https://cdn.example.test/audio.flac?token=segredo');

    const childId = response.json().job.id as string;
    const childItem = item.history.list({ kind: 'import' }).find(operation => operation.id === `import-${childId}`);
    assert.deepEqual(childItem?.importRetry, {
      attempt: 2,
      parentOperationId: `import-${original.id}`,
      rootOperationId: `import-${original.id}`,
      failureDisposition: 'none'
    });
    assert.doesNotMatch(childItem?.label ?? '', /cdn\.example|token|segredo/i);
  } finally {
    await item.app.close();
    item.history.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('falha definitiva, job ativo e cancelado não podem iniciar retry', async () => {
  const item = await fixture();
  try {
    const definitive = item.queue.enqueue({ type: 'upload', provider: null }, 'invalido.flac');
    item.queue.transition(definitive.id, 'failed', 'O conteúdo recebido não foi reconhecido como áudio suportado.');
    const active = item.queue.enqueue({ type: 'upload', provider: null }, 'ativo.flac');
    const cancelled = item.queue.enqueue({ type: 'upload', provider: null }, 'cancelado.flac');
    item.queue.transition(cancelled.id, 'cancelled');

    for (const id of [definitive.id, active.id, cancelled.id]) {
      const response = await item.app.inject({
        method: 'POST',
        url: `/api/admin/operations/import-${id}/retry`,
        headers: { 'x-home-music-request': '1' },
        payload: { fileName: 'retry.flac', size: 5 }
      });
      assert.equal(response.statusCode, 409, id);
    }
    assert.equal(item.queue.list().length, 3);
  } finally {
    await item.app.close();
    item.history.close();
    await rm(item.root, { recursive: true, force: true });
  }
});
