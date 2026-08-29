import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminImportRoutes } from './admin-import-routes.js';
import { ImportDuplicateDetectionManager } from './import-duplicate-detection.js';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportMediaValidationManager } from './import-media-validation.js';
import { ImportMetadataPreviewManager } from './import-metadata-preview.js';
import { ImportSafeDestinationManager } from './import-safe-destination.js';
import { ImportStagingManager } from './import-staging.js';
import { ImportUploadManager } from './import-upload.js';
import { ImportUrlManager } from './import-url.js';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function validMp3Probe() {
  return JSON.stringify({
    format: { format_name: 'mp3', duration: '120', bit_rate: '192000' },
    streams: [{
      index: 0,
      codec_name: 'mp3',
      codec_type: 'audio',
      sample_rate: '44100',
      channels: 2,
      duration: '120',
      bit_rate: '192000'
    }]
  });
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-import-destination-route-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);

  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const uploads = new ImportUploadManager({ queue, staging, maxBytes: 32 });
  const urls = new ImportUrlManager({
    queue,
    staging,
    maxBytes: 32,
    timeoutMs: 1000,
    maxRedirects: 1,
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }]
  });
  const mediaValidation = new ImportMediaValidationManager({
    queue,
    staging,
    ffmpegCommand: 'ffmpeg-test',
    ffprobeCommand: 'ffprobe-test',
    probeRunner: async () => validMp3Probe(),
    transformRunner: async () => { throw new Error('FFmpeg não esperado neste teste'); }
  });
  const metadataPreview = new ImportMetadataPreviewManager({
    queue,
    staging,
    validatedLookup: jobId => mediaValidation.getValidated(jobId),
    metadataReader: async () => ({
      title: 'Faixa segura',
      artist: 'Artista teste',
      album: 'Álbum teste',
      albumArtist: 'Artista teste',
      durationSeconds: 120,
      cover: null
    })
  });
  const duplicateDetection = new ImportDuplicateDetectionManager({
    queue,
    staging,
    validatedLookup: jobId => mediaValidation.getValidated(jobId),
    libraryTracks: async () => [],
    musicDir
  });
  const safeDestination = new ImportSafeDestinationManager({
    queue,
    staging,
    validatedLookup: jobId => mediaValidation.getValidated(jobId),
    duplicateReady: jobId => duplicateDetection.isReady(jobId),
    musicDir
  });

  const sessions = new SessionManager('admin', 'password-segura-2026');
  const users = new Map<string, AuthenticatedUserState>([
    ['admin-1', { id: 'admin-1', username: 'felipe', role: 'admin', passwordMustChange: false }]
  ]);
  const app = Fastify();
  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: { getEnabledUserById: userId => users.get(userId) ?? null }
  });
  registerAdminImportRoutes(app, queue, {
    uploads,
    urls,
    mediaValidation,
    metadataPreview,
    duplicateDetection,
    safeDestination
  });

  return { app, root, musicDir, stagingRoot, queue, staging, sessions };
}

async function prepareReadyImport(item: Awaited<ReturnType<typeof fixture>>) {
  const adminToken = item.sessions.createSessionForUser('admin-1');
  const headers = {
    cookie: cookie(adminToken),
    'x-home-music-request': '1'
  };
  const started = await item.app.inject({
    method: 'POST',
    url: '/api/admin/imports/uploads',
    headers,
    payload: { fileName: 'faixa.mp3', size: 4 }
  });
  assert.equal(started.statusCode, 201);
  const jobId = started.json().job.id as string;

  const uploaded = await item.app.inject({
    method: 'PUT',
    url: `/api/admin/imports/uploads/${jobId}`,
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    payload: Buffer.from('abcd')
  });
  assert.equal(uploaded.statusCode, 200);

  const validated = await item.app.inject({
    method: 'POST',
    url: `/api/admin/imports/${jobId}/validate`,
    headers,
    payload: { profile: 'original' }
  });
  assert.equal(validated.statusCode, 200);

  const preview = await item.app.inject({
    method: 'POST',
    url: `/api/admin/imports/${jobId}/metadata-preview`,
    headers
  });
  assert.equal(preview.statusCode, 200);

  const duplicates = await item.app.inject({
    method: 'POST',
    url: `/api/admin/imports/${jobId}/duplicates`,
    headers
  });
  assert.equal(duplicates.statusCode, 200);
  assert.equal(duplicates.json().check.disposition, 'clear');

  return { jobId, headers, adminToken };
}

test('preview de destino é somente leitura e promoção conclui o job sem sobrescrever', async () => {
  const item = await fixture();
  try {
    const { jobId, headers, adminToken } = await prepareReadyImport(item);

    const destination = await item.app.inject({
      method: 'GET',
      url: `/api/admin/imports/${jobId}/destination`,
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(destination.statusCode, 200);
    assert.equal(destination.json().destination.relativePath, 'Importados/Artista teste - Faixa segura.mp3');
    await assert.rejects(() => stat(path.join(item.musicDir, 'Importados')), { code: 'ENOENT' });
    assert.equal(item.staging.hasJob(jobId), true);

    const promoted = await item.app.inject({
      method: 'POST',
      url: `/api/admin/imports/${jobId}/promote`,
      headers,
      payload: { folderPath: 'Importados' }
    });
    assert.equal(promoted.statusCode, 200);
    assert.equal(promoted.json().job.status, 'completed');
    assert.equal(promoted.json().destination.relativePath, 'Importados/Artista teste - Faixa segura.mp3');
    assert.equal(
      await readFile(path.join(item.musicDir, 'Importados', 'Artista teste - Faixa segura.mp3'), 'utf8'),
      'abcd'
    );
    assert.equal(item.staging.hasJob(jobId), false);
    assert.deepEqual(await readdir(item.stagingRoot), []);
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('rotas de destino bloqueiam traversal e promoção sem header de mutação', async () => {
  const item = await fixture();
  try {
    const { jobId, headers, adminToken } = await prepareReadyImport(item);

    const traversalPreview = await item.app.inject({
      method: 'GET',
      url: `/api/admin/imports/${jobId}/destination?folderPath=..%2Ffora`,
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(traversalPreview.statusCode, 400);

    const traversalPromote = await item.app.inject({
      method: 'POST',
      url: `/api/admin/imports/${jobId}/promote`,
      headers,
      payload: { folderPath: '../fora' }
    });
    assert.equal(traversalPromote.statusCode, 400);
    assert.equal(item.queue.get(jobId)?.status, 'pending');
    assert.equal(item.staging.hasJob(jobId), true);
    assert.deepEqual(await readdir(item.musicDir), []);

    const missingMutationHeader = await item.app.inject({
      method: 'POST',
      url: `/api/admin/imports/${jobId}/promote`,
      headers: { cookie: cookie(adminToken) },
      payload: { folderPath: 'Importados' }
    });
    assert.equal(missingMutationHeader.statusCode, 403);
    assert.equal(item.queue.get(jobId)?.status, 'pending');
    assert.equal(item.staging.hasJob(jobId), true);
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});
