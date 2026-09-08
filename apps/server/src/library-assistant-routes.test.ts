import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { LibraryAssistantDecision, LibraryAssistantRun } from '@home-music/shared/library-assistant';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { registerLibraryAssistantReviewRoutes } from './library-assistant-review-routes.js';
import type { LibraryAssistantReviewService } from './library-assistant-review-service.js';
import { registerLibraryAssistantRoutes } from './library-assistant-routes.js';
import type { LibraryAssistantService } from './library-assistant-service.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function run(status: LibraryAssistantRun['status'] = 'completed'): LibraryAssistantRun {
  return {
    id: 'assistant-run-1',
    capability: 'metadata',
    status,
    libraryRevision: 7,
    algorithmVersion: 1,
    summary: {
      total: 0,
      pending: 0,
      review: 0,
      applied: 0,
      rejected: 0,
      stale: 0,
      failed: 0
    },
    createdAt: '2026-09-06T18:00:00.000Z',
    startedAt: '2026-09-06T18:00:00.100Z',
    finishedAt: status === 'running' ? null : '2026-09-06T18:00:00.200Z',
    error: null
  };
}

function reviewResult(decision: LibraryAssistantDecision) {
  return {
    runId: decision.runId,
    suggestionId: decision.suggestionId,
    action: decision.action,
    outcome: decision.action === 'apply' ? 'applied' as const : 'rejected' as const,
    currentValue: decision.expectedCurrentValue,
    message: null
  };
}

function createApp() {
  const sessions = new SessionManager('admin', 'password-segura-2026');
  const users = new Map<string, AuthenticatedUserState>([
    ['user-1', { id: 'user-1', username: 'maria', role: 'user', passwordMustChange: false }],
    ['admin-1', { id: 'admin-1', username: 'felipe', role: 'admin', passwordMustChange: false }]
  ]);
  const startedBy: Array<string | null | undefined> = [];
  const assistant = {
    startRun(_capability: 'metadata' | 'artwork' | 'lyrics', ownerId?: string | null) {
      startedBy.push(ownerId);
      return run('queued');
    },
    listRuns() { return [run()]; },
    getRun(id: string) { return id === 'assistant-run-1' ? run() : null; },
    listSuggestions(id: string) { return id === 'assistant-run-1' ? [] : null; },
    cancelRun(id: string) { return id === 'assistant-run-1' ? run('cancelled') : null; }
  } as unknown as LibraryAssistantService;
  const review = {
    getReviewQueue() {
      return { libraryRevision: 7, items: [] };
    },
    async decide(decision: LibraryAssistantDecision) {
      return reviewResult(decision);
    },
    async decideBatch(decisions: LibraryAssistantDecision[]) {
      if (decisions.length < 1 || decisions.length > 100) {
        throw new RangeError('O lote deve conter entre 1 e 100 decisões.');
      }
      const results = decisions.map(reviewResult);
      return {
        results,
        summary: {
          total: results.length,
          applied: results.filter(item => item.outcome === 'applied').length,
          rejected: results.filter(item => item.outcome === 'rejected').length,
          alreadyResolved: 0,
          stale: 0,
          failed: 0
        }
      };
    }
  } as unknown as LibraryAssistantReviewService;

  const app = Fastify();
  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: { getEnabledUserById: userId => users.get(userId) ?? null }
  });
  registerLibraryAssistantRoutes(app, assistant);
  registerLibraryAssistantReviewRoutes(app, review);
  return { app, sessions, startedBy };
}

const validDecision = {
  runId: 'assistant-run-1',
  suggestionId: 'suggestion-1',
  action: 'apply' as const,
  expectedLibraryRevision: 7,
  expectedCurrentValue: 'Faixa atual'
};

test('Library Assistant API is admin-only and lifecycle/review mutations require anti-CSRF header', async () => {
  const { app, sessions, startedBy } = createApp();
  const userToken = sessions.createSessionForUser('user-1');
  const adminToken = sessions.createSessionForUser('admin-1');
  try {
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/admin/library-assistant/runs'
    });
    assert.equal(anonymous.statusCode, 401);

    const user = await app.inject({
      method: 'GET',
      url: '/api/admin/library-assistant/review',
      headers: { cookie: cookie(userToken) }
    });
    assert.equal(user.statusCode, 403);

    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/admin/library-assistant/runs',
      headers: { cookie: cookie(adminToken), 'content-type': 'application/json' },
      payload: { capability: 'metadata' }
    });
    assert.equal(noCsrf.statusCode, 403);

    const noCsrfDecision = await app.inject({
      method: 'POST',
      url: '/api/admin/library-assistant/suggestions/suggestion-1/decision',
      headers: { cookie: cookie(adminToken), 'content-type': 'application/json' },
      payload: validDecision
    });
    assert.equal(noCsrfDecision.statusCode, 403);

    const started = await app.inject({
      method: 'POST',
      url: '/api/admin/library-assistant/runs',
      headers: {
        cookie: cookie(adminToken),
        'content-type': 'application/json',
        'x-home-music-request': '1'
      },
      payload: { capability: 'metadata' }
    });
    assert.equal(started.statusCode, 202);
    assert.equal(started.json().run.status, 'queued');
    assert.deepEqual(startedBy, ['admin-1']);
    assert.equal(started.headers['cache-control'], 'private, no-store');

    const progress = await app.inject({
      method: 'GET',
      url: '/api/admin/library-assistant/runs/assistant-run-1/progress',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(progress.statusCode, 200);
    assert.deepEqual(progress.json().progress, {
      total: 0,
      processed: 0,
      pending: 0,
      processing: 0,
      matched: 0,
      noMatch: 0,
      retry: 0,
      failed: 0
    });
    assert.equal(progress.headers['cache-control'], 'private, no-store');

    const decided = await app.inject({
      method: 'POST',
      url: '/api/admin/library-assistant/suggestions/suggestion-1/decision',
      headers: {
        cookie: cookie(adminToken),
        'content-type': 'application/json',
        'x-home-music-request': '1'
      },
      payload: validDecision
    });
    assert.equal(decided.statusCode, 200);
    assert.equal(decided.json().result.outcome, 'applied');
    assert.equal(decided.headers['cache-control'], 'private, no-store');

    const cancelled = await app.inject({
      method: 'POST',
      url: '/api/admin/library-assistant/runs/assistant-run-1/cancel',
      headers: { cookie: cookie(adminToken), 'x-home-music-request': '1' }
    });
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.json().run.status, 'cancelled');
  } finally {
    await app.close();
  }
});

test('Library Assistant API validates capability, identifiers, filters and review payloads', async () => {
  const { app, sessions } = createApp();
  const adminToken = sessions.createSessionForUser('admin-1');
  const headers = { cookie: cookie(adminToken), 'x-home-music-request': '1' };
  try {
    const invalidCapability = await app.inject({
      method: 'POST',
      url: '/api/admin/library-assistant/runs',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { capability: 'fingerprint' }
    });
    assert.equal(invalidCapability.statusCode, 400);

    for (const url of [
      '/api/admin/library-assistant/runs?limit=0',
      '/api/admin/library-assistant/runs?limit=201',
      '/api/admin/library-assistant/runs/assistant-run-1/suggestions?status=unknown',
      '/api/admin/library-assistant/runs/assistant-run-1/suggestions?limit=501',
      '/api/admin/library-assistant/runs/%2Fsecret',
      '/api/admin/library-assistant/runs/%2Fsecret/progress',
      '/api/admin/library-assistant/review?limit=0',
      '/api/admin/library-assistant/review?limit=501'
    ]) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie: cookie(adminToken) } });
      assert.equal(response.statusCode, 400, url);
    }

    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/library-assistant/runs/missing',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(missing.statusCode, 404);

    const missingProgress = await app.inject({
      method: 'GET',
      url: '/api/admin/library-assistant/runs/missing/progress',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(missingProgress.statusCode, 404);

    const invalidDecision = await app.inject({
      method: 'POST',
      url: '/api/admin/library-assistant/suggestions/%2Fsecret/decision',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: validDecision
    });
    assert.equal(invalidDecision.statusCode, 400);

    const invalidBatch = await app.inject({
      method: 'POST',
      url: '/api/admin/library-assistant/decisions',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { decisions: [] }
    });
    assert.equal(invalidBatch.statusCode, 400);
  } finally {
    await app.close();
  }
});
