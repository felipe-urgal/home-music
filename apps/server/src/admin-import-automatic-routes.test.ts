import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
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

async function waitForPrepared(queue: ImportJobQueue, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = queue.get(jobId);
    if (job?.status === 'pending' && job.mediaDecision && job.metadataPreview) return job;
    if (job?.status === 'failed' || job?.status === 'cancelled') {
      assert.fail(`Job automático terminou como ${job.status}: ${job.error ?? 'sem diagnóstico'}`);
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`Job automático não ficou pronto para destino. Estado atual: ${queue.get(jobId)?.status}`);
}

test('upload prepara validação e metadata automaticamente e aguarda confirmação do destino', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-import-auto-route-'));
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
      title: 'Faixa automática',
      artist: 'Artista automático',
      album: 'Álbum automático',
      albumArtist: 'Artista automático',
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
    safeDestination,
    stagingCleanup: null
  });

  const token = sessions.createSessionForUser('admin-1');
  const headers = {
    cookie: cookie(token),
    'x-home-music-request': '1'
  };

  try {
    const started = await app.inject({
      method: 'POST',
      url: '/api/admin/imports/uploads',
      headers,
      payload: { fileName: 'origem.mp3', size: 4 }
    });
    assert.equal(started.statusCode, 201);
    const jobId = started.json().job.id as string;

    const uploaded = await app.inject({
      method: 'PUT',
      url: `/api/admin/imports/uploads/${jobId}`,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abcd')
    });
    assert.equal(uploaded.statusCode, 200);

    const prepared = await waitForPrepared(queue, jobId);
    assert.equal(prepared.mediaDecision?.profile, 'original');
    assert.equal(prepared.metadataPreview?.effective.title, 'Faixa automática');
    assert.equal(prepared.metadataPreview?.effective.artist, 'Artista automático');
    assert.equal(staging.hasJob(jobId), true);

    const promoted = await app.inject({
      method: 'POST',
      url: `/api/admin/imports/${jobId}/promote`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { folderPath: 'Favoritas' }
    });
    assert.equal(promoted.statusCode, 200);
    assert.equal(promoted.json().job.status, 'completed');
    assert.equal(promoted.json().destination.folderPath, 'Favoritas');
    assert.equal(
      await readFile(path.join(musicDir, 'Favoritas', 'Artista automático - Faixa automática.mp3'), 'utf8'),
      'abcd'
    );
    assert.equal(staging.hasJob(jobId), false);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
