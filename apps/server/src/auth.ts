import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import {
  readLegacyAuthBindingFromEnvironment,
  type LegacyAuthBinding
} from './legacy-auth-binding.js';

export const SESSION_COOKIE_NAME = 'home_music_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type AuthSession = Readonly<{
  userId: string | null;
  createdAt: number;
  authenticatedAt: number;
  expiresAt: number;
}>;

function safeEqual(left: string, right: string) {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

export function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    return part.slice(separator + 1).trim();
  }

  return undefined;
}

export function buildSessionCookie(token: string, maxAgeSeconds: number, secure = false) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function loginRateLimitKey(
  socketIp: string,
  forwardedFor: string | string[] | undefined,
  trustLoopbackProxy: boolean
) {
  if (!trustLoopbackProxy) return socketIp;

  const normalizedSocketIp = socketIp.startsWith('::ffff:') ? socketIp.slice(7) : socketIp;
  if (normalizedSocketIp !== '127.0.0.1' && normalizedSocketIp !== '::1') return socketIp;
  if (typeof forwardedFor !== 'string' || forwardedFor.includes(',')) return socketIp;

  const candidate = forwardedFor.trim();
  return isIP(candidate) ? candidate : socketIp;
}

export class SessionManager {
  private readonly sessions = new Map<string, AuthSession>();

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly ttlMs = SESSION_TTL_SECONDS * 1000,
    private readonly maxSessions = 128,
    private readonly legacyBinding: LegacyAuthBinding = readLegacyAuthBindingFromEnvironment()
  ) {}

  get configured() {
    return Boolean(
      this.username
      && this.password.length >= 12
      && this.legacyBinding.status !== 'blocked'
    );
  }

  validateCredentials(username: string, password: string) {
    if (!this.configured) return false;
    const usernameMatches = safeEqual(username, this.username);
    const passwordMatches = safeEqual(password, this.password);
    return usernameMatches && passwordMatches;
  }

  createSession(now = Date.now()) {
    if (this.legacyBinding.status === 'blocked') {
      throw new Error('Credencial legada não está vinculada a um usuário ativo.');
    }
    const userId = this.legacyBinding.status === 'bound' ? this.legacyBinding.userId : null;
    return this.createSessionRecord(userId, now);
  }

  createSessionForUser(userId: string, now = Date.now()) {
    if (!userId || userId.length > 128) throw new RangeError('userId de sessão inválido.');
    return this.createSessionRecord(userId, now);
  }

  getSession(token: string | undefined, now = Date.now()): AuthSession | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  validateSession(token: string | undefined, now = Date.now()) {
    return this.getSession(token, now) !== null;
  }

  revokeSession(token: string | undefined) {
    if (token) this.sessions.delete(token);
  }

  revokeUserSessions(userId: string) {
    if (!userId) return 0;
    let revoked = 0;
    for (const [token, session] of this.sessions) {
      if (session.userId !== userId) continue;
      this.sessions.delete(token);
      revoked += 1;
    }
    return revoked;
  }

  private createSessionRecord(userId: string | null, now: number) {
    this.clearExpired(now);
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }

    let token = '';
    do {
      token = randomBytes(32).toString('base64url');
    } while (this.sessions.has(token));

    const session = Object.freeze({
      userId,
      createdAt: now,
      authenticatedAt: now,
      expiresAt: now + this.ttlMs
    });
    this.sessions.set(token, session);
    return token;
  }

  private clearExpired(now: number) {
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }
  }
}

export class LoginRateLimiter {
  private readonly attempts = new Map<string, { failures: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 8,
    private readonly windowMs = 5 * 60 * 1000,
    private readonly maxEntries = 512
  ) {}

  isBlocked(key: string, now = Date.now()) {
    const entry = this.attempts.get(key);
    if (!entry) return false;
    if (entry.resetAt <= now) {
      this.attempts.delete(key);
      return false;
    }
    return entry.failures >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()) {
    this.clearExpired(now);
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      if (this.attempts.size >= this.maxEntries) {
        const oldest = this.attempts.keys().next().value as string | undefined;
        if (oldest) this.attempts.delete(oldest);
      }
      this.attempts.set(key, { failures: 1, resetAt: now + this.windowMs });
      return;
    }
    current.failures += 1;
  }

  clear(key: string) {
    this.attempts.delete(key);
  }

  private clearExpired(now: number) {
    for (const [key, entry] of this.attempts) {
      if (entry.resetAt <= now) this.attempts.delete(key);
    }
  }
}
