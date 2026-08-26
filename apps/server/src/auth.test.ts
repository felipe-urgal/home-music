import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSessionCookie,
  loginRateLimitKey,
  LoginRateLimiter,
  readCookie,
  SESSION_COOKIE_NAME,
  SessionManager
} from './auth.js';

test('SessionManager valida credenciais e cria sessão revogável no fallback legado', () => {
  const sessions = new SessionManager('home-music', 'senha-super-segura', 1000);

  assert.equal(sessions.configured, true);
  assert.equal(sessions.validateUsername('home-music'), true);
  assert.equal(sessions.validateCredentials('home-music', 'senha-super-segura'), true);
  assert.equal(sessions.validateCredentials('home-music', 'senha-incorreta'), false);
  assert.equal(sessions.validateCredentials('outro', 'senha-super-segura'), false);

  const token = sessions.createSession(100);
  assert.deepEqual(sessions.getSession(token, 500), {
    userId: null,
    createdAt: 100,
    authenticatedAt: 100,
    expiresAt: 1100
  });
  sessions.revokeSession(token);
  assert.equal(sessions.getSession(token, 500), null);
});

test('SessionManager associado ao SQLite mantém validateCredentials fiel ao env e expõe validação explícita do username', () => {
  const sessions = new SessionManager(
    'home-music',
    'senha-original-do-env',
    1000,
    128,
    { status: 'bound', userId: '11111111-1111-4111-8111-111111111111' }
  );

  assert.equal(sessions.validateUsername('home-music'), true);
  assert.equal(sessions.validateUsername('outro'), false);
  assert.equal(sessions.validateCredentials('home-music', 'senha-original-do-env'), true);
  assert.equal(sessions.validateCredentials('home-music', 'senha-nova-no-sqlite'), false);
  assert.equal(sessions.validateCredentials('outro', 'senha-original-do-env'), false);

  const token = sessions.createSession(100);
  assert.deepEqual(sessions.getSession(token, 500), {
    userId: '11111111-1111-4111-8111-111111111111',
    createdAt: 100,
    authenticatedAt: 100,
    expiresAt: 1100
  });
});

test('SessionManager permite criar sessão explícita para usuário nas próximas etapas', () => {
  const sessions = new SessionManager('home-music', 'senha-super-segura', 1000);
  const token = sessions.createSessionForUser('user-2', 200);

  assert.equal(sessions.getSession(token, 500)?.userId, 'user-2');
  assert.throws(() => sessions.createSessionForUser(''), RangeError);
});

test('SessionManager bloqueia credencial legada sem vínculo válido quando users já existe', () => {
  const sessions = new SessionManager(
    'home-music',
    'senha-super-segura',
    1000,
    128,
    { status: 'blocked' }
  );

  assert.equal(sessions.configured, false);
  assert.equal(sessions.validateUsername('home-music'), false);
  assert.equal(sessions.validateCredentials('home-music', 'senha-super-segura'), false);
  assert.throws(() => sessions.createSession(100), /não está vinculada/);
});

test('SessionManager revoga todas e somente as sessões do usuário solicitado', () => {
  const sessions = new SessionManager('home-music', 'senha-super-segura', 10_000);
  const first = sessions.createSessionForUser('user-a', 100);
  const second = sessions.createSessionForUser('user-a', 200);
  const other = sessions.createSessionForUser('user-b', 300);
  const legacy = sessions.createSession(400);

  assert.equal(sessions.revokeUserSessions('user-a'), 2);
  assert.equal(sessions.getSession(first, 500), null);
  assert.equal(sessions.getSession(second, 500), null);
  assert.equal(sessions.getSession(other, 500)?.userId, 'user-b');
  assert.equal(sessions.getSession(legacy, 500)?.userId, null);
});

test('SessionManager revoga somente outras sessões e preserva a sessão atual', () => {
  const sessions = new SessionManager('home-music', 'senha-super-segura', 10_000);
  const current = sessions.createSessionForUser('user-a', 100);
  const second = sessions.createSessionForUser('user-a', 200);
  const third = sessions.createSessionForUser('user-a', 300);
  const other = sessions.createSessionForUser('user-b', 400);

  assert.equal(sessions.revokeUserSessionsExcept('user-a', current, 500), 2);
  assert.equal(sessions.getSession(current, 500)?.userId, 'user-a');
  assert.equal(sessions.getSession(second, 500), null);
  assert.equal(sessions.getSession(third, 500), null);
  assert.equal(sessions.getSession(other, 500)?.userId, 'user-b');

  assert.equal(sessions.revokeUserSessionsExcept('user-a', other, 500), null);
  assert.equal(sessions.getSession(current, 500)?.userId, 'user-a');
});

test('SessionManager expira sessões antigas', () => {
  const sessions = new SessionManager('home-music', 'senha-super-segura', 1000);
  const token = sessions.createSession(100);
  assert.equal(sessions.validateSession(token, 1101), false);
});

test('SessionManager limita a quantidade de sessões em memória', () => {
  const sessions = new SessionManager('home-music', 'senha-super-segura', 10_000, 2);
  const first = sessions.createSessionForUser('user-a', 100);
  const second = sessions.createSessionForUser('user-b', 200);
  const third = sessions.createSessionForUser('user-c', 300);

  assert.equal(sessions.validateSession(first, 400), false);
  assert.equal(sessions.validateSession(second, 400), true);
  assert.equal(sessions.validateSession(third, 400), true);
});

test('cookies de sessão leem apenas o cookie solicitado', () => {
  assert.equal(readCookie(`x=1; ${SESSION_COOKIE_NAME}=abc; y=2`, SESSION_COOKIE_NAME), 'abc');
});

test('cookie de sessão usa HttpOnly e SameSite Strict', () => {
  const cookie = buildSessionCookie('abc', 3600, true);
  assert.match(cookie, new RegExp(`${SESSION_COOKIE_NAME}=abc`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
});

test('LoginRateLimiter bloqueia após o limite e libera após a janela', () => {
  const limiter = new LoginRateLimiter(2, 1000);
  limiter.recordFailure('ip', 100);
  assert.equal(limiter.isBlocked('ip', 500), false);
  limiter.recordFailure('ip', 500);
  assert.equal(limiter.isBlocked('ip', 600), true);
  assert.equal(limiter.isBlocked('ip', 1200), false);
});

test('loginRateLimitKey usa IP encaminhado somente por proxy loopback confiável', () => {
  assert.equal(loginRateLimitKey('127.0.0.1', '203.0.113.10', true), '203.0.113.10');
  assert.equal(loginRateLimitKey('::ffff:127.0.0.1', '2001:db8::10', true), '2001:db8::10');
  assert.equal(loginRateLimitKey('127.0.0.1', '203.0.113.10', false), '127.0.0.1');
  assert.equal(loginRateLimitKey('192.0.2.10', '203.0.113.10', true), '192.0.2.10');
});

test('loginRateLimitKey rejeita X-Forwarded-For ambíguo ou inválido', () => {
  assert.equal(loginRateLimitKey('127.0.0.1', '203.0.113.10, 198.51.100.5', true), '127.0.0.1');
  assert.equal(loginRateLimitKey('127.0.0.1', 'não-é-ip', true), '127.0.0.1');
  assert.equal(loginRateLimitKey('127.0.0.1', ['203.0.113.10'], true), '127.0.0.1');
});
