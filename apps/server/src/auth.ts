import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const SESSION_COOKIE_NAME = 'home_music_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

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
  private readonly sessions = new Map<string, number>();

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly ttlMs = SESSION_TTL_SECONDS * 1000,
    private readonly maxSessions = 128
  ) {}

  get configured() {
    return Boolean(this.username && this.password.length >= 12);
  }

  validateCredentials(username: string, password: string) {
    if (!this.configured) return false;
    const usernameMatches = safeEqual(username, this.username);
    const passwordMatches = safeEqual(password, this.password);
    return usernameMatches && passwordMatches;
  }

  createSession(now = Date.now()) {
    this.clearExpired(now);
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }

    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, now + this.ttlMs);
    return token;
  }

  validateSession(token: string | undefined, now = Date.now()) {
    if (!token) return false;
    const expiresAt = this.sessions.get(token);
    if (!expiresAt) return false;
    if (expiresAt <= now) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  revokeSession(token: string | undefined) {
    if (token) this.sessions.delete(token);
  }

  private clearExpired(now: number) {
    for (const [token, expiresAt] of this.sessions) {
      if (expiresAt <= now) this.sessions.delete(token);
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
