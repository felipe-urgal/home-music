import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'home_music_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
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

export class SessionManager {
  private readonly sessions = new Map<string, number>();

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly ttlMs = SESSION_TTL_SECONDS * 1000
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
    private readonly windowMs = 5 * 60 * 1000
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
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      this.attempts.set(key, { failures: 1, resetAt: now + this.windowMs });
      return;
    }
    current.failures += 1;
  }

  clear(key: string) {
    this.attempts.delete(key);
  }
}
