import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthenticatedUserState } from './user-auth-store.js';
import { SessionManager } from './auth.js';
import { resolveAuthStatus } from './auth-status.js';

function userReader(user: AuthenticatedUserState | null) {
  return {
    getEnabledUserById: (_userId: string) => user
  };
}

test('auth status não autentica quando o Home Music não está configurado', () => {
  const sessions = new SessionManager('', '');
  assert.deepEqual(
    resolveAuthStatus(false, undefined, sessions, userReader(null)),
    {
      configured: false,
      authenticated: false,
      user: null,
      passwordChangeRequired: false
    }
  );
});

test('auth status retorna não autenticado para token ausente ou inválido', () => {
  const sessions = new SessionManager('admin', 'password-segura-2026');
  assert.deepEqual(
    resolveAuthStatus(true, 'token-inexistente', sessions, userReader(null)),
    {
      configured: true,
      authenticated: false,
      user: null,
      passwordChangeRequired: false
    }
  );
});

test('auth status retorna identidade mínima do usuário ativo sem expor flag dentro de user', () => {
  const sessions = new SessionManager('admin', 'password-segura-2026');
  const token = sessions.createSessionForUser('user-1');
  const user: AuthenticatedUserState = {
    id: 'user-1',
    username: 'felipe',
    role: 'admin',
    passwordMustChange: true
  };

  assert.deepEqual(
    resolveAuthStatus(true, token, sessions, userReader(user)),
    {
      configured: true,
      authenticated: true,
      user: { id: 'user-1', username: 'felipe', role: 'admin' },
      passwordChangeRequired: true
    }
  );
});

test('auth status revoga sessão quando o userId não resolve para usuário ativo', () => {
  const sessions = new SessionManager('admin', 'password-segura-2026');
  const token = sessions.createSessionForUser('user-disabled');

  assert.deepEqual(
    resolveAuthStatus(true, token, sessions, userReader(null)),
    {
      configured: true,
      authenticated: false,
      user: null,
      passwordChangeRequired: false
    }
  );
  assert.equal(sessions.validateSession(token), false);
});

test('auth status preserva fallback legado transitório sem userId', () => {
  const sessions = new SessionManager(
    'admin',
    'password-segura-2026',
    undefined,
    undefined,
    { status: 'legacy-uninitialized' }
  );
  const token = sessions.createSession();

  assert.deepEqual(
    resolveAuthStatus(true, token, sessions, userReader(null)),
    {
      configured: true,
      authenticated: true,
      user: null,
      passwordChangeRequired: false
    }
  );
});
