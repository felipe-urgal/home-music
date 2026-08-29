import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminImportRoutes } from './admin-import-routes.js';
import {
  ExternalProviderImportManager,
  type ExternalProvider
} from './external-provider.js';
import { ExternalProviderScratchManager } from './external-provider-scratch.js';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';

async function waitForPending(queue: ImportJobQueue, jobId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const job = queue.get(jobId);
    if (job?.status !== 'processing') return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return queue.get(jobId);
}

async function fixture(configured = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-provider-route-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  const scratchRoot = path.join(root, 'scratch');
  await mkdir(musicDir);
  const queue = new ImportJobQueue({ createId: () => 'provider-job-1' });
  const staging = new ImportStagingManager({ musicDir, stagingRoot });
  const scratch = new ExternalProviderScratchManager({ musicDir, scratchRoot });
  const provider: ExternalProvider = {
    id: 'fixture',
    label: 'Fixture provider',
    capabilities: { audio: true, metadata: true, thumbnail: false, playlists: false },
    requiredConfigKeys: ['token'],
    validate(request) {
      if (!request.url.startsWith('https://')) throw new Error('unsupported');
    },
    async prepare(_request, context) {
      await writeFile(path.join(context.scratchDir, 'audio.flac'), Buffer.from('fixture-audio'));
      return {
        relativePath: 'audio.flac',
        contentType: 'audio/flac',
        metadata: { title: 'Faixa externa', artist: 'Artista externo', album: 'Álbum externo' }
      };
    }
  };
  const externalProviders = new ExternalProviderImportManager({
    queue,
    staging,
    scratch,
    providers: [provider],
    providerConfigs: { fixture: { token: configured ? 'configured' : '' } },
    timeoutMs: 1000,
    maxOutputBytes: 1024 * 1024
  });
  const app = Fastify();
  registerAdminImportRoutes(app, queue, { externalProviders, stagingCleanup: null });
  return { root, app, queue, staging, externalProviders };
}

test('rota externa anuncia capability e entrega aquisição ao staging comum', async () => {
  const item = await fixture(true);
  try {
    const list = await item.app.inject({ method: 'GET', url: '/api/admin/imports' });
    assert.equal(list.statusCode, 200);
    const descriptor = list.json().providers.find((provider: { id: string }) => provider.id === 'fixture');
    assert.deepEqual(descriptor, {
      id: 'fixture',
      label: 'Fixture provider',
      capabilities: { audio: true, metadata: true, thumbnail: false, playlists: false },
      configured: true
    });

    const started = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/providers/fixture',
      headers: { 'x-home-music-request': '1' },
      payload: { url: 'https://example.test/audio' }
    });
    assert.equal(started.statusCode, 202);
    const jobId = started.json().job.id as string;
    const settled = await waitForPending(item.queue, jobId);
    assert.equal(settled?.status, 'pending');
    assert.equal(settled?.source.type, 'provider');
    assert.equal(settled?.source.provider, 'fixture');

    const inspected = await item.staging.inspectPayload(jobId, async target => target.size);
    assert.equal(inspected, Buffer.byteLength('fixture-audio'));
    assert.deepEqual(item.externalProviders.getPrepared(jobId)?.metadata, {
      sourceId: null,
      title: 'Faixa externa',
      artist: 'Artista externo',
      album: 'Álbum externo',
      thumbnailUrl: null
    });
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('provider sem configuração falha fechado antes de criar job ou staging', async () => {
  const item = await fixture(false);
  try {
    const list = await item.app.inject({ method: 'GET', url: '/api/admin/imports' });
    assert.equal(list.json().providers[0].configured, false);

    const response = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/providers/fixture',
      headers: { 'x-home-music-request': '1' },
      payload: { url: 'https://example.test/audio' }
    });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /não está configurado/i);
    assert.equal(item.queue.list().length, 0);
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});
