import { describe, expect, it } from 'vitest';
import {
  buildSessionCookie,
  LoginRateLimiter,
  readCookie,
  SESSION_COOKIE_NAME,
  SessionManager
} from './auth.js';

describe('SessionManager', () => {
  it('valida credenciais em tempo constante e cria sessão revogável', () => {
    const sessions = new SessionManager('home-music', 'senha-super-segura', 1000);

    expect(sessions.configured).toBe(true);
    expect(sessions.validateCredentials('home-music', 'senha-super-segura')).toBe(true);
    expect(sessions.validateCredentials('outro', 'senha-super-segura')).toBe(false);

    const token = sessions.createSession(100);
    expect(sessions.validateSession(token, 500)).toBe(true);
    sessions.revokeSession(token);
    expect(sessions.validateSession(token, 500)).toBe(false);
  });

  it('expira sessões antigas', () => {
    const sessions = new SessionManager('home-music', 'senha-super-segura', 1000);
    const token = sessions.createSession(100);
    expect(sessions.validateSession(token, 1101)).toBe(false);
  });
});

describe('cookies de sessão', () => {
  it('lê apenas o cookie solicitado', () => {
    expect(readCookie(`x=1; ${SESSION_COOKIE_NAME}=abc; y=2`, SESSION_COOKIE_NAME)).toBe('abc');
  });

  it('gera cookie HttpOnly e SameSite Strict', () => {
    const cookie = buildSessionCookie('abc', 3600, true);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=abc`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
  });
});

describe('LoginRateLimiter', () => {
  it('bloqueia após o limite e libera após a janela', () => {
    const limiter = new LoginRateLimiter(2, 1000);
    limiter.recordFailure('ip', 100);
    expect(limiter.isBlocked('ip', 500)).toBe(false);
    limiter.recordFailure('ip', 500);
    expect(limiter.isBlocked('ip', 600)).toBe(true);
    expect(limiter.isBlocked('ip', 1200)).toBe(false);
  });
});
