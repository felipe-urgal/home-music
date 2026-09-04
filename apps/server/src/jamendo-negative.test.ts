import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExternalProviderError, ExternalProviderImportManager } from './external-provider.js';
import { ExternalProviderScratchManager } from './external-provider-scratch.js';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import {
  JAMENDO_CLIENT_ID_CONFIG,
  JAMENDO_PROVIDER_ID,
  JamendoProvider,
  jamendoImportUrl
} from './jamendo-provider.js';

const CONFIG = { [JAMENDO_CLIENT_ID_CONFIG]: 'fake-client-id' };

function allowedTrack(overrides: Record<string, unknown> = {}) {
  return {
    id: '123',
    name: 'Música segura',
    artist_name: 'Artista',
    album_name: 'Álbum',
    duration: '185',
    license_ccurl: 'https://creativecommons.org/licenses/by/4.0/',
    audio: 'https://cdn.example/preview.mp3',
    audiodownload: 'https://cdn.example/download.mp3',
    audiodownload_allowed: true,
    ...overrides
  };
}

function apiResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

async function waitForSettledJob(queue: ImportJobQueue, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = queue.get(jobId);
    if (job && job.status !== 'processing') return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Job Jamendo não estabilizou no tempo esperado.');
}

test('Jamendo trata rate limit sem retry oculto e sem depender da internet pública', async () => {
  let calls = 0;
  const provider = new JamendoProvider({
    fetch: async (_input, init) => {
      calls += 1;
      assert.equal(init?.redirect, 'error');
      return apiResponse({ error: 'rate limit' }, 429);
    }
  });

  await assert.rejects(
    provider.search({ query: 'rock' }, CONFIG),
    (error: unknown) => error instanceof ExternalProviderError
      && error.code === 'provider_failed'
      && error.statusCode === 503
      && /limitou temporariamente/i.test(error.message)
  );
  assert.equal(calls, 1);
});

test('Jamendo falha fechado para resposta malformada e redirect inesperado da API', async () => {
  const malformed = new JamendoProvider({
    fetch: async () => new Response('{não-é-json', { status: 200 })
  });
  await assert.rejects(
    malformed.search({ query: 'ambient' }, CONFIG),
    (error: unknown) => error instanceof ExternalProviderError
      && error.code === 'invalid_output'
      && error.statusCode === 502
  );

  const redirected = new JamendoProvider({
    fetch: async (_input, init) => {
      assert.equal(init?.redirect, 'error');
      throw new TypeError('redirect blocked by fetch policy');
    }
  });
  await assert.rejects(
    redirected.search({ query: 'ambient' }, CONFIG),
    (error: unknown) => error instanceof ExternalProviderError
      && error.code === 'provider_network_failed'
      && error.statusCode === 502
  );
});

test('Jamendo isola item malformado sem perder resultados válidos da mesma página', async () => {
  const provider = new JamendoProvider({
    fetch: async () => apiResponse({
      headers: { status: 'success', results_fullcount: 3 },
      results: [
        allowedTrack(),
        { id: 'abc', name: 'ID inválido', audiodownload_allowed: true },
        null
      ]
    })
  });

  const result = await provider.search({ query: 'música', limit: 10 }, CONFIG);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceId, '123');
  assert.equal(result.pagination.total, 3);
});

test('Jamendo trata faixa removida entre busca e importação como conteúdo indisponível', async () => {
  const provider = new JamendoProvider({
    fetch: async input => {
      const url = new URL(input.toString());
      if (url.searchParams.has('search')) {
        return apiResponse({ headers: { status: 'success' }, results: [allowedTrack()] });
      }
      return apiResponse({ headers: { status: 'success' }, results: [] });
    }
  });

  const search = await provider.search({ query: 'música' }, CONFIG);
  assert.equal(search.items[0].importAllowed, true);

  await assert.rejects(
    provider.inspectImportEligibility('123', CONFIG),
    (error: unknown) => error instanceof ExternalProviderError
      && error.code === 'invalid_input'
      && error.statusCode === 404
      && /não está mais disponível/i.test(error.message)
  );
});

test('Jamendo rejeita payload que não é arquivo regular e limpa scratch/staging do job', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-jamendo-invalid-file-'));
  const musicDir = path.join(root, 'music');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot: path.join(root, 'staging'), musicDir });
  const scratch = new ExternalProviderScratchManager({ scratchRoot: path.join(root, 'scratch'), musicDir });
  const provider = new JamendoProvider({
    fetch: async () => apiResponse({ headers: { status: 'success' }, results: [allowedTrack()] }),
    download: async ({ scratchDir }) => {
      await mkdir(path.join(scratchDir, 'not-a-file'));
      return { relativePath: 'not-a-file', contentType: 'audio/mpeg' };
    }
  });

  try {
    const manager = new ExternalProviderImportManager({
      queue,
      staging,
      scratch,
      providers: [provider],
      providerConfigs: { [JAMENDO_PROVIDER_ID]: CONFIG }
    });

    const started = await manager.start(JAMENDO_PROVIDER_ID, { url: jamendoImportUrl('123') });
    const job = await waitForSettledJob(queue, started.job.id);
    assert.equal(job.status, 'failed');
    assert.equal(scratch.hasJob(job.id), false);
    assert.equal(staging.hasJob(job.id), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
