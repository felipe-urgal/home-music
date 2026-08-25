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

test('SessionManager valida credenciais e cria sessão revogável', () => {
  const sessions = new SessionManager('home-music', 'senha-super-segura', 1000);

  assert.equal(sessions.configured, true);
  assert.equal(sessions.validateCredentials('home-music', 'senha-super-segura'), true);
  assert.equal(sessions.validateCredentials('outro', 'senha-super-segura'), false);

  const token = sessions.createSession(100);
  assert.equal(sessions.validateSession(token, 500), true);
  sessions.revokeSession(token);
  assert.equal(sessions.validateSession(token, 500), false);
});

test('SessionManager expira sessões antigas', () => {
  const sessions = new SessionManager('home-music', 'senha-super-segura', 1000);
  const token = sessions.createSession(100);
  assert.equal(sessions.validateSession(token, 1101), false);
});

test('SessionManager limita a quantidade de sessões em memória', () => {
  const sessions = new SessionManager('home-music', 'senha-super-segura', 10_000, 2);
  const first = sessions.createSession(100);
  const second = sessions.createSession(200);
  const third = sessions.createSession(300);

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
