import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import http, { type IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminImportRoutes } from './admin-import-routes.js';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import { ImportUploadManager } from './import-upload.js';
import { ImportUrlManager } from './import-url.js';
import { ImportMediaValidationManager } from './import-media-validation.js';
import { ImportMetadataPreviewManager } from './import-metadata-preview.js';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function remoteAudioResponse() {
  const response = Readable.from([Buffer.from('abcd')]) as unknown as IncomingMessage;
  response.statusCode = 200;
  response.headers = {
    'content-type': 'audio/mpeg',
    'content-length': '4'
  };
  const request = {
    destroy(error?: Error) {
      response.destroy(error);
      return this;
    }
  } as unknown as ReturnType<typeof http.request>;
  return { response, request };
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

async function waitForStatus(queue: ImportJobQueue, id: string, expected: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = queue.get(id);
    if (job?.status === expected) return job;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail(`Job ${id} não chegou ao estado ${expected}.`);
}

async function buildApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-import-route-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const uploads = new ImportUploadManager({ queue, staging, maxBytes: 16 });
  const urls = new ImportUrlManager({
    queue,
    staging,
    maxBytes: 32,
    timeoutMs: 1000,
    maxRedirects: 1,
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    requestUrl: async () => remoteAudioResponse(),
    validateAudio: async () => undefined
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
      title: 'Título capturado',
      artist: 'Artista capturado',
      album: 'Álbum capturado',
      albumArtist: 'Artista capturado',
      durationSeconds: 120,
      cover: { data: Buffer.from('cover'), contentType: 'image/png' }
    })
  });
  const sessions = new SessionManager('admin', 'password-segura-2026');
  const users = new Map<string, AuthenticatedUserState>([
    ['user-1', { id: 'user-1', username: 'maria', role: 'user', passwordMustChange: false }],
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
    automaticFlow: null
  });
  return { app, root, musicDir, stagingRoot, queue, sessions };
}

test('importação administrativa exige admin e header de mutação', async () => {
  const item = await buildApp();
  const userToken = item.sessions.createSessionForUser('user-1');
  const adminToken = item.sessions.createSessionForUser('admin-1');
  try {
    const denied = await item.app.inject({
      method: 'GET',
      url: '/api/admin/imports',
      headers: { cookie: cookie(userToken) }
    });
    assert.equal(denied.statusCode, 403);

    const missingUploadHeader = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/uploads',
      headers: { cookie: cookie(adminToken) },
      payload: { fileName: 'faixa.mp3', size: 4 }
    });
    assert.equal(missingUploadHeader.statusCode, 403);

    const missingUrlHeader = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/urls',
      headers: { cookie: cookie(adminToken) },
      payload: { url: 'https://example.com/faixa.mp3' }
    });
    assert.equal(missingUrlHeader.statusCode, 403);

    const missingValidationHeader = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/job-inexistente/validate',
      headers: { cookie: cookie(adminToken) },
      payload: { profile: 'original' }
    });
    assert.equal(missingValidationHeader.statusCode, 403);

    const missingPreviewHeader = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/job-inexistente/metadata-preview',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(missingPreviewHeader.statusCode, 403);

    const list = await item.app.inject({
      method: 'GET',
      url: '/api/admin/imports',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().upload.maxBytes, 16);
    assert.ok(list.json().upload.acceptedExtensions.includes('.mp3'));
    assert.equal(list.json().url.maxBytes, 32);
    assert.equal(list.json().url.maxRedirects, 1);
    assert.deepEqual(list.json().url.acceptedProtocols, ['http:', 'https:']);
    assert.deepEqual(
      list.json().mediaValidation.profiles.map((profile: { id: string }) => profile.id),
      ['original', 'economy', 'compatibility']
    );
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('rota recebe bytes no staging e nunca grava diretamente em MUSIC_DIR', async () => {
  const item = await buildApp();
  const adminToken = item.sessions.createSessionForUser('admin-1');
  const mutationHeaders = {
    cookie: cookie(adminToken),
    'x-home-music-request': '1'
  };

  try {
    const started = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/uploads',
      headers: mutationHeaders,
      payload: { fileName: 'faixa.flac', size: 4 }
    });
    assert.equal(started.statusCode, 201);
    const jobId = started.json().job.id as string;

    const uploaded = await item.app.inject({
      method: 'PUT',
      url: `/api/admin/imports/uploads/${jobId}`,
      headers: {
        ...mutationHeaders,
        'content-type': 'application/octet-stream'
      },
      payload: Buffer.from('abcd')
    });
    assert.equal(uploaded.statusCode, 200);
    assert.equal(uploaded.json().receivedBytes, 4);
    assert.equal(uploaded.json().job.status, 'pending');
    assert.equal(uploaded.json().job.mediaDecision, null);
    assert.equal(uploaded.json().job.metadataPreview, null);
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.equal((await readdir(item.stagingRoot)).length, 1);
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('rota valida mídia pendente, registra decisão no job e mantém MUSIC_DIR intacto', async () => {
  const item = await buildApp();
  const adminToken = item.sessions.createSessionForUser('admin-1');
  const headers = {
    cookie: cookie(adminToken),
    'x-home-music-request': '1'
  };
  try {
    const started = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/uploads',
      headers,
      payload: { fileName: 'faixa.mp3', size: 4 }
    });
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
    assert.equal(validated.json().job.status, 'pending');
    assert.equal(validated.json().job.mediaDecision.profile, 'original');
    assert.equal(validated.json().job.mediaDecision.action, 'preserve');
    assert.equal(validated.json().job.mediaDecision.output.extension, '.mp3');
    assert.equal(validated.json().validation.reason, 'original-compatible');
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.equal((await readdir(item.stagingRoot)).length, 1);

    const list = await item.app.inject({
      method: 'GET',
      url: '/api/admin/imports',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(list.json().jobs[0].mediaDecision.profile, 'original');
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('rota gera preview, permite ajuste reversível e serve somente capa embutida segura', async () => {
  const item = await buildApp();
  const adminToken = item.sessions.createSessionForUser('admin-1');
  const headers = {
    cookie: cookie(adminToken),
    'x-home-music-request': '1'
  };
  try {
    const started = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/uploads',
      headers,
      payload: { fileName: 'faixa.mp3', size: 4 }
    });
    const jobId = started.json().job.id as string;
    await item.app.inject({
      method: 'PUT',
      url: `/api/admin/imports/uploads/${jobId}`,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abcd')
    });
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
    assert.equal(preview.json().preview.effective.title, 'Título capturado');
    assert.equal(preview.json().preview.fieldStates.title, 'trusted');
    assert.equal(preview.json().preview.cover.available, true);
    assert.equal((await readdir(item.musicDir)).length, 0);

    const patched = await item.app.inject({
      method: 'PATCH',
      url: `/api/admin/imports/${jobId}/metadata-preview`,
      headers,
      payload: { artist: 'Artista revisado' }
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().preview.embedded.artist, 'Artista capturado');
    assert.equal(patched.json().preview.effective.artist, 'Artista revisado');
    assert.equal(patched.json().preview.fieldStates.artist, 'edited');

    const cover = await item.app.inject({
      method: 'GET',
      url: `/api/admin/imports/${jobId}/cover`,
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(cover.statusCode, 200);
    assert.match(cover.headers['content-type'] ?? '', /^image\/png/);
    assert.deepEqual(cover.rawPayload, Buffer.from('cover'));

    const list = await item.app.inject({
      method: 'GET',
      url: '/api/admin/imports',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(list.json().jobs[0].metadataPreview.effective.artist, 'Artista revisado');
    assert.equal((await readdir(item.musicDir)).length, 0);
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('rota de preview exige validação técnica concluída', async () => {
  const item = await buildApp();
  const adminToken = item.sessions.createSessionForUser('admin-1');
  const headers = {
    cookie: cookie(adminToken),
    'x-home-music-request': '1'
  };
  try {
    const started = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/uploads',
      headers,
      payload: { fileName: 'faixa.mp3', size: 4 }
    });
    const jobId = started.json().job.id as string;
    await item.app.inject({
      method: 'PUT',
      url: `/api/admin/imports/uploads/${jobId}`,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abcd')
    });

    const preview = await item.app.inject({
      method: 'POST',
      url: `/api/admin/imports/${jobId}/metadata-preview`,
      headers
    });
    assert.equal(preview.statusCode, 409);
    assert.match(preview.json().error, /valide tecnicamente/i);
    assert.equal(item.queue.get(jobId)?.metadataPreview, null);
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('rota de validação rejeita perfil inválido sem alterar o job', async () => {
  const item = await buildApp();
  const adminToken = item.sessions.createSessionForUser('admin-1');
  const headers = {
    cookie: cookie(adminToken),
    'x-home-music-request': '1'
  };
  try {
    const started = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/uploads',
      headers,
      payload: { fileName: 'faixa.mp3', size: 4 }
    });
    const jobId = started.json().job.id as string;
    await item.app.inject({
      method: 'PUT',
      url: `/api/admin/imports/uploads/${jobId}`,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abcd')
    });

    const invalid = await item.app.inject({
      method: 'POST',
      url: `/api/admin/imports/${jobId}/validate`,
      headers,
      payload: { profile: 'ultra' }
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(item.queue.get(jobId)?.status, 'pending');
    assert.equal(item.queue.get(jobId)?.mediaDecision, null);
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('rota por URL retorna job imediatamente e mantém mídia apenas no staging', async () => {
  const item = await buildApp();
  const adminToken = item.sessions.createSessionForUser('admin-1');
  const headers = {
    cookie: cookie(adminToken),
    'x-home-music-request': '1'
  };

  try {
    const started = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/urls',
      headers,
      payload: { url: 'https://example.com/faixa.mp3?signature=segredo' }
    });
    assert.equal(started.statusCode, 202);
    assert.equal(started.json().job.source.type, 'url');
    assert.equal(started.json().job.label.includes('signature='), false);

    const job = await waitForStatus(item.queue, started.json().job.id, 'pending');
    assert.equal(job.status, 'pending');
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.equal((await readdir(item.stagingRoot)).length, 1);
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('rota rejeita arquivo grande e formato inválido antes de receber bytes', async () => {
  const item = await buildApp();
  const adminToken = item.sessions.createSessionForUser('admin-1');
  const headers = {
    cookie: cookie(adminToken),
    'x-home-music-request': '1'
  };
  try {
    const tooLarge = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/uploads',
      headers,
      payload: { fileName: 'grande.mp3', size: 17 }
    });
    assert.equal(tooLarge.statusCode, 413);

    const invalid = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/uploads',
      headers,
      payload: { fileName: 'arquivo.exe', size: 4 }
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(item.queue.list().length, 0);
    assert.equal((await readdir(item.musicDir)).length, 0);
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('rota por URL rejeita protocolo e localhost antes de criar job', async () => {
  const item = await buildApp();
  const adminToken = item.sessions.createSessionForUser('admin-1');
  const headers = {
    cookie: cookie(adminToken),
    'x-home-music-request': '1'
  };
  try {
    for (const url of ['file:///etc/passwd', 'http://localhost/faixa.mp3']) {
      const response = await item.app.inject({
        method: 'POST',
        url: '/api/admin/imports/urls',
        headers,
        payload: { url }
      });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(item.queue.list().length, 0);
  } finally {
    await item.app.close();
    await rm(item.root, { recursive: true, force: true });
  }
});
