import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  JamendoProvider
} from './jamendo-provider.js';

const SECRET_CLIENT_ID = 'jamendo-secret-client-id';

function apiResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
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
        audio: false,
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

test('Jamendo busca com paginação defensiva e devolve somente modelo normalizado', async () => {
  let requestedUrl: URL | null = null;
  const provider = new JamendoProvider({
    fetch: async input => {
      requestedUrl = new URL(input.toString());
      return apiResponse({
        headers: {
          status: 'success',
          results_count: 1,
          results_fullcount: 21
        },
        results: [
          {
            id: '123',
            name: '  Música\u0000   segura  ',
            artist_name: ' Artista ',
            album_name: ' Álbum ',
            duration: '185',
            image: 'https://usercontent.jamendo.com/image.jpg#fragment',
            license_ccurl: 'https://creativecommons.org/licenses/by/4.0/',
            audio: 'https://prod.example/preview?token=preview-secret',
            audiodownload: 'https://prod.example/download?token=download-secret',
            audiodownload_allowed: true
          }
        ]
      });
    }
  });

  const result = await provider.search(
    { query: '  lo-fi  ', page: '2', limit: '10' },
    { [JAMENDO_CLIENT_ID_CONFIG]: SECRET_CLIENT_ID }
  );

  assert.ok(requestedUrl);
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
      previewAvailable: true
    }],
    pagination: {
      page: 2,
      limit: 10,
      total: 21,
      nextPage: 3
    }
  });

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(SECRET_CLIENT_ID), false);
  assert.equal(serialized.includes('preview-secret'), false);
  assert.equal(serialized.includes('download-secret'), false);
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
    provider.search(
      { query: 'rock', limit: 51 },
      { [JAMENDO_CLIENT_ID_CONFIG]: SECRET_CLIENT_ID }
    ),
    (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_input'
  );
});

test('Jamendo não aceita importação física antes do gate de download seguro', () => {
  const provider = new JamendoProvider();
  assert.throws(
    () => provider.validate({ url: 'https://www.jamendo.com/track/123' }),
    (error: unknown) => error instanceof ExternalProviderError
      && error.code === 'invalid_input'
      && error.message.includes('descoberta')
  );
});
