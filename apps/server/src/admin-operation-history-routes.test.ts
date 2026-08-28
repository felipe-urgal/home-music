import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminOperationHistoryRoutes } from './admin-operation-history-routes.js';
import { AdminOperationHistoryStore } from './admin-operation-history.js';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function createApp(databasePath: string) {
  const sessions = new SessionManager('admin', 'password-segura-2026');
  const users = new Map<string, AuthenticatedUserState>([
    ['user-1', { id: 'user-1', username: 'maria', role: 'user', passwordMustChange: false }],
    ['admin-1', { id: 'admin-1', username: 'felipe', role: 'admin', passwordMustChange: false }]
  ]);
  const history = new AdminOperationHistoryStore(databasePath, {
    createId: () => 'scan-route',
    now: () => new Date('2026-08-28T12:00:00.000Z')
  });
  const scanId = history.startScan('manual');
  history.completeScan(scanId, {
    tracks: 3,
    scannedAt: '2026-08-28T12:00:01.000Z',
    added: 1,
    updated: 0,
    removed: 0,
    unchanged: 2
  });

  const app = Fastify();
  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: { getEnabledUserById: userId => users.get(userId) ?? null }
  });
  registerAdminOperationHistoryRoutes(app, history);
  return { app, sessions, history };
}

test('histórico exige admin e aplica filtros válidos', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'home-music-operation-history-route-'));
  const { app, sessions, history } = createApp(path.join(dir, 'home-music.db'));
  const userToken = sessions.createSessionForUser('user-1');
  const adminToken = sessions.createSessionForUser('admin-1');
  try {
    const denied = await app.inject({
      method: 'GET',
      url: '/api/admin/operations',
      headers: { cookie: cookie(userToken) }
    });
    assert.equal(denied.statusCode, 403);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/operations?kind=scan&status=completed&limit=20',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.json().items.length, 1);
    assert.equal(response.json().items[0].kind, 'scan');
    assert.equal(response.json().items[0].status, 'completed');
  } finally {
    await app.close();
    history.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('histórico rejeita filtros e limites inválidos', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'home-music-operation-history-invalid-'));
  const { app, sessions, history } = createApp(path.join(dir, 'home-music.db'));
  const adminToken = sessions.createSessionForUser('admin-1');
  try {
    for (const url of [
      '/api/admin/operations?kind=other',
      '/api/admin/operations?status=unknown',
      '/api/admin/operations?limit=0',
      '/api/admin/operations?limit=501'
    ]) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie: cookie(adminToken) } });
      assert.equal(response.statusCode, 400, url);
    }
  } finally {
    await app.close();
    history.close();
    await rm(dir, { recursive: true, force: true });
  }
});
