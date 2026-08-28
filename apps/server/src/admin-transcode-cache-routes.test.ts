import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminTranscodeCacheRoutes } from './admin-transcode-cache-routes.js';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { TranscodeCacheMaintenance } from './transcode-cache-maintenance.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function adminApp(cacheDir: string, runtime: () => { active: number; pending: number }) {
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
  const maintenance = new TranscodeCacheMaintenance({
    cacheDir,
    limitBytes: 512,
    runtime
  });
  registerAdminTranscodeCacheRoutes(app, maintenance);
  return { app, sessions };
}

test('cache administrativo exige admin e header de mutação', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-admin-cache-route-'));
  const { app, sessions } = adminApp(cacheDir, () => ({ active: 0, pending: 0 }));
  await writeFile(path.join(cacheDir, `${'d'.repeat(64)}.m4a`), Buffer.alloc(32));

  const userToken = sessions.createSessionForUser('user-1');
  const adminToken = sessions.createSessionForUser('admin-1');

  try {
    const denied = await app.inject({
      method: 'GET',
      url: '/api/admin/transcoding/cache',
      headers: { cookie: cookie(userToken) }
    });
    assert.equal(denied.statusCode, 403);

    const status = await app.inject({
      method: 'GET',
      url: '/api/admin/transcoding/cache',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().bytes, 32);

    const missingMutationHeader = await app.inject({
      method: 'DELETE',
      url: '/api/admin/transcoding/cache',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(missingMutationHeader.statusCode, 403);

    const cleared = await app.inject({
      method: 'DELETE',
      url: '/api/admin/transcoding/cache',
      headers: {
        cookie: cookie(adminToken),
        'x-home-music-request': '1'
      }
    });
    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.json().freedBytes, 32);
    assert.equal(cleared.json().cache.bytes, 0);
  } finally {
    await app.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('limpeza responde 409 e preserva cache quando há transcoding ativo', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-admin-cache-busy-'));
  const { app, sessions } = adminApp(cacheDir, () => ({ active: 1, pending: 0 }));
  await writeFile(path.join(cacheDir, `${'e'.repeat(64)}.m4a`), Buffer.alloc(24));
  const adminToken = sessions.createSessionForUser('admin-1');

  try {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/transcoding/cache',
      headers: {
        cookie: cookie(adminToken),
        'x-home-music-request': '1'
      }
    });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /transcoding em andamento/i);
    assert.equal(response.json().cache.active, 1);
    assert.equal(response.json().cache.bytes, 24);

    const status = await app.inject({
      method: 'GET',
      url: '/api/admin/transcoding/cache',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().bytes, 24);
  } finally {
    await app.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
