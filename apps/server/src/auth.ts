import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import {
  readLegacyAuthBindingFromEnvironment,
  type LegacyAuthBinding
} from './legacy-auth-binding.js';

export const SESSION_COOKIE_NAME = 'home_music_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_GLOBAL_SESSIONS = 128;
export const MAX_SESSIONS_PER_USER = 16;
export const SESSION_CAPACITY_RETRY_AFTER_SECONDS = 60;

export type AuthSession = Readonly<{
  userId: string | null;
  createdAt: number;
  authenticatedAt: number;
  expiresAt: number;
}>;

export type PublicAuthSession = Readonly<{
  id: string;
  current: boolean;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}>;

export class SessionCapacityError extends Error {
  constructor() {
    super('Capacidade global de sessões atingida.');
    this.name = 'SessionCapacityError';
  }
}

function safeEqual(left: string, right: string) {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

function publicSessionId(token: string) {
  return createHash('sha256').update(token).digest('hex').slice(0, 24);
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
  private readonly sessionActivity = new Map<string, number>();

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly ttlMs = SESSION_TTL_SECONDS * 1000,
    private readonly maxSessions = MAX_GLOBAL_SESSIONS,
    private readonly legacyBinding: LegacyAuthBinding = readLegacyAuthBindingFromEnvironment(),
    private readonly maxSessionsPerUser = Math.min(MAX_SESSIONS_PER_USER, maxSessions)
  ) {
    if (!Number.isInteger(this.maxSessions) || this.maxSessions < 1) {
      throw new RangeError('Limite global de sessões inválido.');
    }
    if (!Number.isInteger(this.maxSessionsPerUser) || this.maxSessionsPerUser < 1) {
      throw new RangeError('Limite de sessões por usuário inválido.');
    }
  }

  get configured() {
    return Boolean(
      this.username
      && this.password.length >= 12
      && this.legacyBinding.status !== 'blocked'
    );
  }

  validateUsername(username: string) {
    return this.configured && safeEqual(username, this.username);
  }

  validateCredentials(username: string, password: string) {
    if (!this.validateUsername(username)) return false;
    return safeEqual(password, this.password);
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
      this.deleteSession(token);
      return null;
    }
    this.sessionActivity.set(token, now);
    return session;
  }

  validateSession(token: string | undefined, now = Date.now()) {
    return this.getSession(token, now) !== null;
  }

  revokeSession(token: string | undefined) {
    if (token) this.deleteSession(token);
  }

  revokeUserSessions(userId: string) {
    if (!userId) return 0;
    let revoked = 0;
    for (const [token, session] of this.sessions) {
      if (session.userId !== userId) continue;
      this.deleteSession(token);
      revoked += 1;
    }
    return revoked;
  }

  revokeUserSessionsExcept(userId: string, currentToken: string | undefined, now = Date.now()) {
    if (!userId || !currentToken) return null;
    this.clearExpired(now);
    const currentSession = this.sessions.get(currentToken);
    if (!currentSession || currentSession.userId !== userId) return null;

    let revoked = 0;
    for (const [token, session] of this.sessions) {
      if (token === currentToken || session.userId !== userId) continue;
      this.deleteSession(token);
      revoked += 1;
    }
    return revoked;
  }

  listUserSessions(userId: string, currentToken: string | undefined, now = Date.now()): PublicAuthSession[] | null {
    if (!userId || !currentToken) return null;
    this.clearExpired(now);
    const currentSession = this.sessions.get(currentToken);
    if (!currentSession || currentSession.userId !== userId) return null;
    this.sessionActivity.set(currentToken, now);

    return [...this.sessions.entries()]
      .filter(([, session]) => session.userId === userId)
      .map(([token, session]) => ({
        id: publicSessionId(token),
        current: token === currentToken,
        createdAt: session.createdAt,
        lastSeenAt: this.sessionActivity.get(token) ?? session.authenticatedAt,
        expiresAt: session.expiresAt
      }))
      .sort((left, right) => Number(right.current) - Number(left.current) || right.lastSeenAt - left.lastSeenAt);
  }

  revokeUserSession(userId: string, publicId: string, currentToken: string | undefined, now = Date.now()) {
    if (!userId || !publicId || !currentToken) return null;
    this.clearExpired(now);
    const currentSession = this.sessions.get(currentToken);
    if (!currentSession || currentSession.userId !== userId) return null;

    for (const [token, session] of this.sessions) {
      if (session.userId !== userId || publicSessionId(token) !== publicId) continue;
      if (token === currentToken) return false;
      this.deleteSession(token);
      return true;
    }
    return false;
  }

  private createSessionRecord(userId: string | null, now: number) {
    this.clearExpired(now);
    this.evictOldestSessionsForUser(userId);
    if (this.sessions.size >= this.maxSessions) throw new SessionCapacityError();

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
    this.sessionActivity.set(token, now);
    return token;
  }

  private evictOldestSessionsForUser(userId: string | null) {
    const ownTokens = [...this.sessions.entries()]
      .filter(([, session]) => session.userId === userId)
      .map(([token]) => token);

    while (ownTokens.length >= this.maxSessionsPerUser) {
      const oldest = ownTokens.shift();
      if (!oldest) break;
      this.deleteSession(oldest);
    }
  }

  private deleteSession(token: string) {
    this.sessions.delete(token);
    this.sessionActivity.delete(token);
  }

  private clearExpired(now: number) {
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.deleteSession(token);
    }
  }
}

type LoginFailureEntry = { failures: number; resetAt: number };

export class LoginRateLimiter {
  private readonly attempts = new Map<string, LoginFailureEntry>();
  private overflow: LoginFailureEntry | null = null;

  constructor(
    private readonly maxFailures = 8,
    private readonly windowMs = 5 * 60 * 1000,
    private readonly maxEntries = 512
  ) {
    if (!Number.isInteger(this.maxFailures) || this.maxFailures < 1) {
      throw new RangeError('Limite de falhas de login inválido.');
    }
    if (!Number.isFinite(this.windowMs) || this.windowMs < 1) {
      throw new RangeError('Janela de rate limit de login inválida.');
    }
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new RangeError('Capacidade do rate limiter de login inválida.');
    }
  }

  isBlocked(key: string, now = Date.now()) {
    this.clearExpired(now);
    const entry = this.attempts.get(key);
    if (entry) return entry.failures >= this.maxFailures;
    if (this.attempts.size < this.maxEntries || !this.overflow) return false;
    return this.overflow.failures >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()) {
    this.clearExpired(now);
    const current = this.attempts.get(key);
    if (current) {
      current.failures += 1;
      return;
    }

    if (this.attempts.size < this.maxEntries) {
      this.attempts.set(key, { failures: 1, resetAt: now + this.windowMs });
      return;
    }

    if (!this.overflow) {
      this.overflow = { failures: 1, resetAt: now + this.windowMs };
      return;
    }
    this.overflow.failures += 1;
  }

  clear(key: string) {
    this.attempts.delete(key);
  }

  private clearExpired(now = Date.now()) {
    for (const [key, entry] of this.attempts) {
      if (entry.resetAt <= now) this.attempts.delete(key);
    }
    if (this.overflow && this.overflow.resetAt <= now) this.overflow = null;
  }
}
