import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { LEGACY_ADMIN_OPERATIONS } from './api-access.js';
import { installApiAuthPolicy } from './auth-policy.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function requestHeaders(token?: string) {
  const headers: Record<string, string> = {
    'x-home-music-request': '1'
  };
  if (token) headers.cookie = cookie(token);
  return headers;
}

function buildApp() {
  const sessions = new SessionManager('admin', 'password-segura-2026');
  const users = new Map<string, AuthenticatedUserState>();
  const app = Fastify();

  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: {
      getEnabledUserById: userId => users.get(userId) ?? null
    }
  });

  for (const operation of LEGACY_ADMIN_OPERATIONS) {
    app.route({
      method: operation.method,
      url: operation.path,
      handler: async request => ({ user: request.user, ok: true })
    });
  }

  app.get('/api/library', async request => ({ user: request.user, ok: true }));
  app.get('/api/admin/users', async request => ({ user: request.user, ok: true }));

  return { app, sessions, users };
}

test('user autenticado recebe 403 em todas as operações administrativas existentes', async () => {
  const { app, sessions, users } = buildApp();
  users.set('user-1', {
    id: 'user-1',
    username: 'maria',
    role: 'user',
    passwordMustChange: false
  });
  const token = sessions.createSessionForUser('user-1');

  try {
    for (const operation of LEGACY_ADMIN_OPERATIONS) {
      const response = await app.inject({
        method: operation.method,
        url: operation.path,
        headers: requestHeaders(token)
      });
      assert.equal(response.statusCode, 403, `${operation.method} ${operation.path}`);
      assert.deepEqual(response.json(), { error: 'Acesso administrativo necessário.' });
    }

    const futureAdminNamespace = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: requestHeaders(token)
    });
    assert.equal(futureAdminNamespace.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('admin autenticado acessa as operações administrativas existentes', async () => {
  const { app, sessions, users } = buildApp();
  users.set('admin-1', {
    id: 'admin-1',
    username: 'felipe',
    role: 'admin',
    passwordMustChange: false
  });
  const token = sessions.createSessionForUser('admin-1');

  try {
    for (const operation of LEGACY_ADMIN_OPERATIONS) {
      const response = await app.inject({
        method: operation.method,
        url: operation.path,
        headers: requestHeaders(token)
      });
      assert.equal(response.statusCode, 200, `${operation.method} ${operation.path}`);
      assert.equal(response.json().ok, true);
      assert.equal(response.json().user.role, 'admin');
    }

    const futureAdminNamespace = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: requestHeaders(token)
    });
    assert.equal(futureAdminNamespace.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('sem sessão as operações administrativas retornam 401', async () => {
  const { app } = buildApp();

  try {
    for (const operation of LEGACY_ADMIN_OPERATIONS) {
      const response = await app.inject({
        method: operation.method,
        url: operation.path,
        headers: requestHeaders()
      });
      assert.equal(response.statusCode, 401, `${operation.method} ${operation.path}`);
    }
  } finally {
    await app.close();
  }
});

test('rota comum continua acessível para user autenticado', async () => {
  const { app, sessions, users } = buildApp();
  users.set('user-1', {
    id: 'user-1',
    username: 'maria',
    role: 'user',
    passwordMustChange: false
  });
  const token = sessions.createSessionForUser('user-1');

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/library',
      headers: requestHeaders(token)
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.role, 'user');
  } finally {
    await app.close();
  }
});
