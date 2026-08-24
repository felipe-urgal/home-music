import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSessionCookie,
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
