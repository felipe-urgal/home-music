import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExternalProviderImportManager, ExternalProviderError } from './external-provider.js';
import { ExternalProviderScratchManager } from './external-provider-scratch.js';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import {
  JAMENDO_CLIENT_ID_CONFIG,
  JAMENDO_PROVIDER_ID,
  JamendoProvider,
  jamendoImportBlockReason,
  jamendoImportUrl
} from './jamendo-provider.js';

const SECRET_CLIENT_ID = 'jamendo-secret-client-id';

function apiResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function allowedTrack(overrides: Record<string, unknown> = {}) {
  return {
    id: '123',
    name: 'Música segura',
    artist_name: 'Artista',
    album_name: 'Álbum',
    duration: '185',
    image: 'https://usercontent.jamendo.com/image.jpg#fragment',
    license_ccurl: 'https://creativecommons.org/licenses/by/4.0/',
    audio: 'https://prod.example/preview?token=preview-secret',
    audiodownload: 'https://prod.example/download?token=download-secret',
    audiodownload_allowed: true,
    ...overrides
  };
}

async function waitForJob(queue: ImportJobQueue, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = queue.get(jobId);
    if (job && job.status !== 'processing') return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Job Jamendo não estabilizou no tempo esperado pelo teste.');
}

test('Jamendo publica status configurado sem expor client_id', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-jamendo-manager-'));
  const musicDir = path.join(root, 'music');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot: path.join(root, 'staging'), musicDir });
  const scratch = new ExternalProviderScratchManager({ scratchRoot: path.join(root, 'scratch'), musicDir });
  const provider = new JamendoProvider({
    fetch: async () => apiResponse({ headers: { status: 'success' }, results: [] })
  });

  try {
    const manager = new ExternalProviderImportManager({
      queue,
      staging,
      scratch,
      providers: [provider],
      providerConfigs: {
        [JAMENDO_PROVIDER_ID]: { [JAMENDO_CLIENT_ID_CONFIG]: SECRET_CLIENT_ID }
      }
    });

    const descriptor = manager.listProviders()[0];
    assert.deepEqual(descriptor, {
      id: JAMENDO_PROVIDER_ID,
      label: 'Jamendo · música livre/licenciada',
      capabilities: {
        audio: true,
        metadata: true,
        thumbnail: true,
        playlists: false
      },
      configured: true
    });
    assert.equal(JSON.stringify(descriptor).includes(SECRET_CLIENT_ID), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Jamendo fica não configurado quando client_id está ausente', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-jamendo-unconfigured-'));
  const musicDir = path.join(root, 'music');
  await mkdir(musicDir);
  const manager = new ExternalProviderImportManager({
    queue: new ImportJobQueue(),
    staging: new ImportStagingManager({ stagingRoot: path.join(root, 'staging'), musicDir }),
    scratch: new ExternalProviderScratchManager({ scratchRoot: path.join(root, 'scratch'), musicDir }),
    providers: [new JamendoProvider()]
  });

  try {
    assert.equal(manager.listProviders()[0].configured, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Jamendo busca com paginação defensiva e publica licença, atribuição e elegibilidade', async () => {
  let requestedUrlText = '';
  const provider = new JamendoProvider({
    fetch: async input => {
      requestedUrlText = input.toString();
      return apiResponse({
        headers: { status: 'success', results_count: 1, results_fullcount: 21 },
        results: [allowedTrack({ name: '  Música\u0000   segura  ', artist_name: ' Artista ', album_name: ' Álbum ' })]
      });
    }
  });

  const result = await provider.search(
    { query: '  lo-fi  ', page: '2', limit: '10' },
    { [JAMENDO_CLIENT_ID_CONFIG]: SECRET_CLIENT_ID }
  );

  assert.notEqual(requestedUrlText, '');
  const requestedUrl = new URL(requestedUrlText);
  assert.equal(requestedUrl.hostname, 'api.jamendo.com');
  assert.equal(requestedUrl.pathname, '/v3.0/tracks/');
  assert.equal(requestedUrl.searchParams.get('client_id'), SECRET_CLIENT_ID);
  assert.equal(requestedUrl.searchParams.get('search'), 'lo-fi');
  assert.equal(requestedUrl.searchParams.get('offset'), '10');
  assert.equal(requestedUrl.searchParams.get('limit'), '10');
  assert.equal(requestedUrl.searchParams.get('fullcount'), 'true');

  assert.deepEqual(result, {
    items: [{
      sourceId: '123',
      title: 'Música segura',
      artist: 'Artista',
      album: 'Álbum',
      durationSeconds: 185,
      thumbnailUrl: 'https://usercontent.jamendo.com/image.jpg',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      downloadAllowed: true,
      previewAvailable: true,
      importAllowed: true,
      importBlockReason: null,
      attribution: '“Música segura” — Artista · Jamendo'
    }],
    pagination: { page: 2, limit: 10, total: 21, nextPage: 3 }
  });

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(SECRET_CLIENT_ID), false);
  assert.equal(serialized.includes('preview-secret'), false);
  assert.equal(serialized.includes('download-secret'), false);
});

test('política de licença Jamendo é fail-closed', () => {
  assert.equal(jamendoImportBlockReason(false, 'https://creativecommons.org/licenses/by/4.0/'), 'download-not-allowed');
  assert.equal(jamendoImportBlockReason(true, null), 'license-missing');
  assert.equal(jamendoImportBlockReason(true, 'https://example.com/license'), 'license-unsupported');
  assert.equal(jamendoImportBlockReason(true, 'https://creativecommons.org/licenses/by-nc-sa/4.0/'), null);
  assert.equal(jamendoImportBlockReason(true, 'https://creativecommons.org/publicdomain/zero/1.0/'), null);
});

test('Jamendo revalida faixa por sourceId antes de permitir importação', async () => {
  let requestedUrlText = '';
  const provider = new JamendoProvider({
    fetch: async input => {
      requestedUrlText = input.toString();
      return apiResponse({ headers: { status: 'success' }, results: [allowedTrack()] });
    }
  });

  const track = await provider.inspectImportEligibility('123', {
    [JAMENDO_CLIENT_ID_CONFIG]: SECRET_CLIENT_ID
  });

  assert.equal(new URL(requestedUrlText).searchParams.get('id'), '123');
  assert.equal(track.importAllowed, true);
  assert.equal(track.importBlockReason, null);
});

test('Jamendo bloqueia no backend quando download ou licença não permitem', async () => {
  for (const [track, expected] of [
    [allowedTrack({ audiodownload_allowed: false }), 'não permite download'],
    [allowedTrack({ license_ccurl: '' }), 'não possui licença'],
    [allowedTrack({ license_ccurl: 'https://example.com/license' }), 'não é reconhecida']
  ] as const) {
    const provider = new JamendoProvider({
      fetch: async () => apiResponse({ headers: { status: 'success' }, results: [track] })
    });
    await assert.rejects(
      provider.inspectImportEligibility('123', { [JAMENDO_CLIENT_ID_CONFIG]: SECRET_CLIENT_ID }),
      (error: unknown) => error instanceof ExternalProviderError
        && error.statusCode === 409
        && error.message.includes(expected)
    );
  }
});

test('Jamendo rejeita busca sem configuração e limites fora da allowlist', async () => {
  const provider = new JamendoProvider({
    fetch: async () => apiResponse({ headers: { status: 'success' }, results: [] })
  });

  await assert.rejects(
    provider.search({ query: 'rock' }, {}),
    (error: unknown) => error instanceof ExternalProviderError
      && error.code === 'provider_not_configured'
      && error.statusCode === 503
  );

  await assert.rejects(
    provider.search({ query: 'rock', limit: 51 }, { [JAMENDO_CLIENT_ID_CONFIG]: SECRET_CLIENT_ID }),
    (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_input'
  );
});

test('Jamendo interrompe resposta streaming acima de 1 MiB mesmo sem Content-Length', async () => {
  const chunk = new Uint8Array(600 * 1024);
  const provider = new JamendoProvider({
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      }
    }), { status: 200 })
  });

  await assert.rejects(
    provider.search({ query: 'ambient' }, { [JAMENDO_CLIENT_ID_CONFIG]: SECRET_CLIENT_ID }),
    (error: unknown) => error instanceof ExternalProviderError
      && error.code === 'invalid_output'
      && error.statusCode === 502
      && error.message.includes('excedeu o limite')
  );
});

test('Jamendo aceita somente URL pública canônica de faixa para aquisição física', () => {
  const provider = new JamendoProvider();
  assert.doesNotThrow(() => provider.validate({ url: jamendoImportUrl('123') }));
  for (const url of [
    'http://www.jamendo.com/track/123',
    'https://evil.example/track/123',
    'https://www.jamendo.com/track/123?token=secret',
    'https://www.jamendo.com/album/123'
  ]) {
    assert.throws(
      () => provider.validate({ url }),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_input'
    );
  }
});

test('Jamendo baixa no scratch fake, transfere ao staging comum e preserva metadata segura', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-jamendo-physical-'));
  const musicDir = path.join(root, 'music');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot: path.join(root, 'staging'), musicDir });
  const scratch = new ExternalProviderScratchManager({ scratchRoot: path.join(root, 'scratch'), musicDir });
  let observedDownloadUrl = '';
  const provider = new JamendoProvider({
    fetch: async () => apiResponse({ headers: { status: 'success' }, results: [allowedTrack()] }),
    download: async ({ url, scratchDir, signal }) => {
      assert.equal(signal.aborted, false);
      observedDownloadUrl = url;
      const relativePath = 'jamendo-track.mp3';
      await writeFile(path.join(scratchDir, relativePath), Buffer.from('fake-jamendo-audio'));
      return { relativePath, contentType: 'audio/mpeg' };
    }
  });

  try {
    const manager = new ExternalProviderImportManager({
      queue,
      staging,
      scratch,
      providers: [provider],
      providerConfigs: {
        [JAMENDO_PROVIDER_ID]: { [JAMENDO_CLIENT_ID_CONFIG]: SECRET_CLIENT_ID }
      }
    });
    const started = await manager.start(JAMENDO_PROVIDER_ID, { url: jamendoImportUrl('123') });
    const job = await waitForJob(queue, started.job.id);
    assert.equal(job.status, 'pending');
    assert.equal(observedDownloadUrl, 'https://prod.example/download?token=download-secret');
    assert.equal(scratch.hasJob(job.id), false);
    assert.equal(staging.hasJob(job.id), true);
    assert.equal(await staging.inspectPayload(job.id, target => target.size), Buffer.byteLength('fake-jamendo-audio'));

    const prepared = manager.getPrepared(job.id);
    assert.ok(prepared);
    assert.equal(prepared.provider, JAMENDO_PROVIDER_ID);
    assert.equal(prepared.payload.contentType, 'audio/mpeg');
    assert.equal(prepared.metadata.sourceId, '123');
    assert.equal(prepared.metadata.title, 'Música segura');
    assert.equal(prepared.metadata.artist, 'Artista');
    assert.equal(prepared.metadata.album, 'Álbum');
    assert.equal(JSON.stringify(prepared).includes('download-secret'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
