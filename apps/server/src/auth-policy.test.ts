import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function buildTestApp(configured = true) {
  const sessions = new SessionManager('admin', 'password-segura-2026');
  const users = new Map<string, AuthenticatedUserState>();
  const app = Fastify();

  installApiAuthPolicy(app, {
    configured,
    sessions,
    users: {
      getEnabledUserById: userId => users.get(userId) ?? null
    }
  });

  app.get('/outside-api', async request => ({ user: request.user }));
  app.get('/api/public', { config: { auth: 'public' } }, async request => ({ user: request.user }));
  app.get('/api/default', async request => ({ user: request.user }));
  app.get('/api/admin', { config: { auth: 'admin' } }, async request => ({ user: request.user }));
  app.post('/api/write', async () => ({ ok: true }));
  app.get('/api/auth/status', { config: { auth: 'public' } }, async () => ({ ok: true }));
  app.post('/api/auth/login', { config: { auth: 'public' } }, async () => ({ ok: true }));
  app.post('/api/auth/password', async request => ({ user: request.user }));
  app.post('/api/auth/logout', async request => ({ user: request.user }));

  return { app, sessions, users };
}

test('política central aplica public, authenticated por padrão e admin com identidade atual', async () => {
  const { app, sessions, users } = buildTestApp();
  users.set('normal-1', {
    id: 'normal-1',
    username: 'maria',
    role: 'user',
    passwordMustChange: false
  });
  users.set('admin-1', {
    id: 'admin-1',
    username: 'felipe',
    role: 'admin',
    passwordMustChange: false
  });
  const userToken = sessions.createSessionForUser('normal-1');
  const adminToken = sessions.createSessionForUser('admin-1');

  try {
    const outside = await app.inject({ method: 'GET', url: '/outside-api' });
    assert.equal(outside.statusCode, 200);
    assert.deepEqual(outside.json(), { user: null });

    const publicResponse = await app.inject({ method: 'GET', url: '/api/public' });
    assert.equal(publicResponse.statusCode, 200);
    assert.deepEqual(publicResponse.json(), { user: null });

    const deniedDefault = await app.inject({ method: 'GET', url: '/api/default' });
    assert.equal(deniedDefault.statusCode, 401);

    const userDefault = await app.inject({
      method: 'GET',
      url: '/api/default',
      headers: { cookie: cookie(userToken) }
    });
    assert.equal(userDefault.statusCode, 200);
    assert.deepEqual(userDefault.json(), {
      user: { id: 'normal-1', username: 'maria', role: 'user' }
    });

    const deniedAdmin = await app.inject({
      method: 'GET',
      url: '/api/admin',
      headers: { cookie: cookie(userToken) }
    });
    assert.equal(deniedAdmin.statusCode, 403);
    assert.deepEqual(deniedAdmin.json(), { error: 'Acesso administrativo necessário.' });

    const allowedAdmin = await app.inject({
      method: 'GET',
      url: '/api/admin',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(allowedAdmin.statusCode, 200);
    assert.deepEqual(allowedAdmin.json(), {
      user: { id: 'admin-1', username: 'felipe', role: 'admin' }
    });

    users.set('admin-1', {
      id: 'admin-1',
      username: 'felipe',
      role: 'user',
      passwordMustChange: false
    });
    const demotedAdmin = await app.inject({
      method: 'GET',
      url: '/api/admin',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(demotedAdmin.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('password_must_change bloqueia uso normal no backend e libera somente troca/logout', async () => {
  const { app, sessions, users } = buildTestApp();
  users.set('pending-1', {
    id: 'pending-1',
    username: 'maria',
    role: 'admin',
    passwordMustChange: true
  });
  const token = sessions.createSessionForUser('pending-1');
  const headers = {
    cookie: cookie(token),
    'x-home-music-request': '1'
  };

  try {
    const normal = await app.inject({
      method: 'GET',
      url: '/api/default',
      headers: { cookie: cookie(token) }
    });
    assert.equal(normal.statusCode, 403);
    assert.deepEqual(normal.json(), {
      error: 'Troca de senha obrigatória antes de continuar.',
      code: 'PASSWORD_CHANGE_REQUIRED'
    });

    const admin = await app.inject({
      method: 'GET',
      url: '/api/admin',
      headers: { cookie: cookie(token) }
    });
    assert.equal(admin.statusCode, 403);
    assert.equal(admin.json().code, 'PASSWORD_CHANGE_REQUIRED');

    const password = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers
    });
    assert.equal(password.statusCode, 200);
    assert.deepEqual(password.json(), {
      user: { id: 'pending-1', username: 'maria', role: 'admin' }
    });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers
    });
    assert.equal(logout.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('usuário ausente ou desativado recebe 401 e tem a sessão revogada', async () => {
  const { app, sessions } = buildTestApp();
  const token = sessions.createSessionForUser('disabled-1');

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/default',
      headers: { cookie: cookie(token) }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(sessions.validateSession(token), false);
  } finally {
    await app.close();
  }
});

test('sessão legada transitória acessa authenticated mas nunca admin', async () => {
  const sessions = new SessionManager(
    'admin',
    'password-segura-2026',
    undefined,
    undefined,
    { status: 'legacy-uninitialized' }
  );
  const app = Fastify();
  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: { getEnabledUserById: () => null }
  });
  app.get('/api/default', async request => ({ user: request.user }));
  app.get('/api/admin', { config: { auth: 'admin' } }, async () => ({ ok: true }));
  const token = sessions.createSession();

  try {
    const authenticated = await app.inject({
      method: 'GET',
      url: '/api/default',
      headers: { cookie: cookie(token) }
    });
    assert.equal(authenticated.statusCode, 200);
    assert.deepEqual(authenticated.json(), { user: null });

    const admin = await app.inject({
      method: 'GET',
      url: '/api/admin',
      headers: { cookie: cookie(token) }
    });
    assert.equal(admin.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('mutações continuam exigindo header customizado depois da autenticação', async () => {
  const { app, sessions, users } = buildTestApp();
  users.set('user-1', {
    id: 'user-1',
    username: 'maria',
    role: 'user',
    passwordMustChange: false
  });
  const token = sessions.createSessionForUser('user-1');

  try {
    const missingHeader = await app.inject({
      method: 'POST',
      url: '/api/write',
      headers: { cookie: cookie(token) }
    });
    assert.equal(missingHeader.statusCode, 403);

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/write',
      headers: {
        cookie: cookie(token),
        'x-home-music-request': '1'
      }
    });
    assert.equal(allowed.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('configuração incompleta mantém apenas auth status disponível na API', async () => {
  const { app } = buildTestApp(false);

  try {
    const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
    assert.equal(status.statusCode, 200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-home-music-request': '1' }
    });
    assert.equal(login.statusCode, 503);

    const protectedRoute = await app.inject({ method: 'GET', url: '/api/default' });
    assert.equal(protectedRoute.statusCode, 503);
  } finally {
    await app.close();
  }
});
