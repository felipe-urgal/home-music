import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY } from '@home-music/shared/library-assistant';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { registerLibraryAssistantPolicyRoutes } from './library-assistant-policy-routes.js';
import { LibraryAssistantReviewPolicyStore } from './library-assistant-review-policy.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function withPolicyStore(run: (databasePath: string) => Promise<void> | void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-policy-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('review policy defaults safely and persists across store instances', async () => {
  await withPolicyStore(databasePath => {
    const first = new LibraryAssistantReviewPolicyStore(databasePath);
    assert.deepEqual(first.get(), DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY);

    const configured = first.set({
      title: 'review',
      artist: 'ignore',
      album: 'bulk',
      albumArtist: 'review',
      artwork: 'review',
      lyrics: 'bulk'
    });
    assert.deepEqual(configured, {
      title: 'review',
      artist: 'ignore',
      album: 'bulk',
      albumArtist: 'review',
      artwork: 'review',
      lyrics: 'bulk'
    });
    first.close();

    const second = new LibraryAssistantReviewPolicyStore(databasePath);
    assert.deepEqual(second.get(), configured);
    assert.throws(() => second.set({ ...configured, artwork: 'bulk' }), /artwork/);
    assert.throws(() => second.set({ ...configured, extra: 'review' }), /campos inválidos/);
    second.close();
  });
});

test('review policy API is admin-only, CSRF-protected and validates artwork mode', async () => {
  await withPolicyStore(async databasePath => {
    const sessions = new SessionManager('admin', 'password-segura-2026');
    const users = new Map<string, AuthenticatedUserState>([
      ['user-1', { id: 'user-1', username: 'maria', role: 'user', passwordMustChange: false }],
      ['admin-1', { id: 'admin-1', username: 'felipe', role: 'admin', passwordMustChange: false }]
    ]);
    const store = new LibraryAssistantReviewPolicyStore(databasePath);
    const app = Fastify();
    installApiAuthPolicy(app, {
      configured: true,
      sessions,
      users: { getEnabledUserById: userId => users.get(userId) ?? null }
    });
    registerLibraryAssistantPolicyRoutes(app, store);

    const userToken = sessions.createSessionForUser('user-1');
    const adminToken = sessions.createSessionForUser('admin-1');
    const configured = {
      title: 'review',
      artist: 'ignore',
      album: 'bulk',
      albumArtist: 'review',
      artwork: 'ignore',
      lyrics: 'bulk'
    } as const;

    try {
      const anonymous = await app.inject({
        method: 'GET',
        url: '/api/admin/library-assistant/policy'
      });
      assert.equal(anonymous.statusCode, 401);

      const regularUser = await app.inject({
        method: 'GET',
        url: '/api/admin/library-assistant/policy',
        headers: { cookie: cookie(userToken) }
      });
      assert.equal(regularUser.statusCode, 403);

      const initial = await app.inject({
        method: 'GET',
        url: '/api/admin/library-assistant/policy',
        headers: { cookie: cookie(adminToken) }
      });
      assert.equal(initial.statusCode, 200);
      assert.deepEqual(initial.json().policy, DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY);
      assert.equal(initial.headers['cache-control'], 'private, no-store');

      const noCsrf = await app.inject({
        method: 'PUT',
        url: '/api/admin/library-assistant/policy',
        headers: {
          cookie: cookie(adminToken),
          'content-type': 'application/json'
        },
        payload: { policy: configured }
      });
      assert.equal(noCsrf.statusCode, 403);

      const saved = await app.inject({
        method: 'PUT',
        url: '/api/admin/library-assistant/policy',
        headers: {
          cookie: cookie(adminToken),
          'content-type': 'application/json',
          'x-home-music-request': '1'
        },
        payload: { policy: configured }
      });
      assert.equal(saved.statusCode, 200);
      assert.deepEqual(saved.json().policy, configured);
      assert.deepEqual(store.get(), configured);
      assert.equal(saved.headers['cache-control'], 'private, no-store');

      const invalidArtwork = await app.inject({
        method: 'PUT',
        url: '/api/admin/library-assistant/policy',
        headers: {
          cookie: cookie(adminToken),
          'content-type': 'application/json',
          'x-home-music-request': '1'
        },
        payload: { policy: { ...configured, artwork: 'bulk' } }
      });
      assert.equal(invalidArtwork.statusCode, 400);
      assert.match(invalidArtwork.json().error, /artwork/);
      assert.deepEqual(store.get(), configured);
    } finally {
      await app.close();
      store.close();
    }
  });
});
