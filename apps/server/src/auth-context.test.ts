import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthenticatedUserState } from './user-auth-store.js';
import { SessionManager } from './auth.js';
import { resolveSessionIdentity } from './auth-context.js';

function userReader(user: AuthenticatedUserState | null) {
  return {
    getEnabledUserById: (_userId: string) => user
  };
}

test('resolveSessionIdentity retorna usuário ativo e estado de troca de senha para sessão identificada', () => {
  const sessions = new SessionManager('admin', 'password-segura-2026');
  const token = sessions.createSessionForUser('user-1');
  const user: AuthenticatedUserState = {
    id: 'user-1',
    username: 'felipe',
    role: 'admin',
    passwordMustChange: true
  };

  const identity = resolveSessionIdentity(token, sessions, userReader(user));

  assert.equal(identity.kind, 'user');
  assert.deepEqual(identity.user, { id: 'user-1', username: 'felipe', role: 'admin' });
  assert.equal(identity.passwordMustChange, true);
  assert.equal(identity.session?.userId, 'user-1');
});

test('resolveSessionIdentity revoga sessão quando usuário não está mais ativo', () => {
  const sessions = new SessionManager('admin', 'password-segura-2026');
  const token = sessions.createSessionForUser('disabled-user');

  assert.deepEqual(
    resolveSessionIdentity(token, sessions, userReader(null)),
    { kind: 'unauthenticated', user: null, session: null, passwordMustChange: false }
  );
  assert.equal(sessions.validateSession(token), false);
});

test('resolveSessionIdentity preserva fallback legado transitório sem userId', () => {
  const sessions = new SessionManager(
    'admin',
    'password-segura-2026',
    undefined,
    undefined,
    { status: 'legacy-uninitialized' }
  );
  const token = sessions.createSession();

  const identity = resolveSessionIdentity(token, sessions, userReader(null));

  assert.equal(identity.kind, 'legacy');
  assert.equal(identity.user, null);
  assert.equal(identity.passwordMustChange, false);
  assert.equal(identity.session?.userId, null);
});

test('resolveSessionIdentity retorna não autenticado para token ausente ou inválido', () => {
  const sessions = new SessionManager('admin', 'password-segura-2026');

  assert.deepEqual(
    resolveSessionIdentity('token-inexistente', sessions, userReader(null)),
    { kind: 'unauthenticated', user: null, session: null, passwordMustChange: false }
  );
});
