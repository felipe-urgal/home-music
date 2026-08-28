import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminImportRoutes } from './admin-import-routes.js';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import { ImportUploadManager } from './import-upload.js';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function buildApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-import-route-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const uploads = new ImportUploadManager({ queue, staging, maxBytes: 16 });
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
  registerAdminImportRoutes(app, queue, { uploads });
  return { app, root, musicDir, stagingRoot, queue, sessions };
}

test('upload administrativo exige admin e header de mutação', async () => {
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

    const missingHeader = await item.app.inject({
      method: 'POST',
      url: '/api/admin/imports/uploads',
      headers: { cookie: cookie(adminToken) },
      payload: { fileName: 'faixa.mp3', size: 4 }
    });
    assert.equal(missingHeader.statusCode, 403);

    const list = await item.app.inject({
      method: 'GET',
      url: '/api/admin/imports',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().upload.maxBytes, 16);
    assert.ok(list.json().upload.acceptedExtensions.includes('.mp3'));
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
