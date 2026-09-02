import { createHash } from 'node:crypto';
import { LoginRateLimiter } from './auth.js';
import { normalizeUsername } from './user-identity.js';

export type LoginAbuseProtectionConfig = Readonly<{
  ipMaxFailures: number;
  identityMaxFailures: number;
  failureWindowMs: number;
  maxLimiterEntries: number;
  maxConcurrentVerifications: number;
  maxVerificationsPerWindow: number;
  verificationWindowMs: number;
  backoffMs: number;
}>;

export const DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG: LoginAbuseProtectionConfig = Object.freeze({
  ipMaxFailures: 8,
  identityMaxFailures: 12,
  failureWindowMs: 5 * 60 * 1000,
  maxLimiterEntries: 512,
  maxConcurrentVerifications: 4,
  maxVerificationsPerWindow: 64,
  verificationWindowMs: 60 * 1000,
  backoffMs: 30 * 1000
});

type LoginAbuseProtectionMetrics = Readonly<{
  attemptsChecked: number;
  authenticationFailures: number;
  authenticationSuccesses: number;
  blockedByIp: number;
  blockedByIdentity: number;
  verificationStarted: number;
  verificationRejectedConcurrency: number;
  verificationRejectedWindow: number;
  verificationInFlight: number;
  verificationsInWindow: number;
}>;

type VerificationLease = Readonly<{
  release: () => void;
}>;

type VerificationDecision =
  | { ok: true; lease: VerificationLease }
  | { ok: false; reason: 'global-concurrency' | 'global-window'; retryAfterSeconds: number };

type AttemptDecision =
  | { ok: true }
  | { ok: false; reason: 'ip' | 'identity'; retryAfterSeconds: number };

function retryAfterSeconds(milliseconds: number) {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) {
  if (value == null || value.trim() === '') return fallback;
  if (!/^\d+$/u.test(value.trim())) throw new RangeError(`${name} deve ser um inteiro positivo.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} deve estar entre ${minimum} e ${maximum}.`);
  }
  return parsed;
}

export function parseLoginAbuseProtectionConfig(
  env: Record<string, string | undefined>
): LoginAbuseProtectionConfig {
  const failureWindowSeconds = parseInteger(
    'HOME_MUSIC_LOGIN_WINDOW_SECONDS',
    env.HOME_MUSIC_LOGIN_WINDOW_SECONDS,
    DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG.failureWindowMs / 1000,
    10,
    3600
  );
  const verificationWindowSeconds = parseInteger(
    'HOME_MUSIC_LOGIN_GLOBAL_WINDOW_SECONDS',
    env.HOME_MUSIC_LOGIN_GLOBAL_WINDOW_SECONDS,
    DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG.verificationWindowMs / 1000,
    1,
    3600
  );
  const backoffSeconds = parseInteger(
    'HOME_MUSIC_LOGIN_BACKOFF_SECONDS',
    env.HOME_MUSIC_LOGIN_BACKOFF_SECONDS,
    DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG.backoffMs / 1000,
    1,
    3600
  );
  const maxConcurrentVerifications = parseInteger(
    'HOME_MUSIC_LOGIN_MAX_CONCURRENT_VERIFICATIONS',
    env.HOME_MUSIC_LOGIN_MAX_CONCURRENT_VERIFICATIONS,
    DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG.maxConcurrentVerifications,
    1,
    64
  );
  const maxVerificationsPerWindow = parseInteger(
    'HOME_MUSIC_LOGIN_MAX_VERIFICATIONS_PER_WINDOW',
    env.HOME_MUSIC_LOGIN_MAX_VERIFICATIONS_PER_WINDOW,
    DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG.maxVerificationsPerWindow,
    1,
    10_000
  );

  if (maxVerificationsPerWindow < maxConcurrentVerifications) {
    throw new RangeError(
      'HOME_MUSIC_LOGIN_MAX_VERIFICATIONS_PER_WINDOW não pode ser menor que HOME_MUSIC_LOGIN_MAX_CONCURRENT_VERIFICATIONS.'
    );
  }

  return Object.freeze({
    ipMaxFailures: parseInteger(
      'HOME_MUSIC_LOGIN_IP_MAX_FAILURES',
      env.HOME_MUSIC_LOGIN_IP_MAX_FAILURES,
      DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG.ipMaxFailures,
      1,
      100
    ),
    identityMaxFailures: parseInteger(
      'HOME_MUSIC_LOGIN_IDENTITY_MAX_FAILURES',
      env.HOME_MUSIC_LOGIN_IDENTITY_MAX_FAILURES,
      DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG.identityMaxFailures,
      1,
      100
    ),
    failureWindowMs: failureWindowSeconds * 1000,
    maxLimiterEntries: parseInteger(
      'HOME_MUSIC_LOGIN_LIMITER_MAX_ENTRIES',
      env.HOME_MUSIC_LOGIN_LIMITER_MAX_ENTRIES,
      DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG.maxLimiterEntries,
      16,
      100_000
    ),
    maxConcurrentVerifications,
    maxVerificationsPerWindow,
    verificationWindowMs: verificationWindowSeconds * 1000,
    backoffMs: backoffSeconds * 1000
  });
}

export function loginIdentityRateLimitKey(username: string) {
  const normalized = normalizeUsername(username);
  const canonicalIdentity = normalized?.usernameNormalized ?? '<invalid-identity>';
  return createHash('sha256').update(canonicalIdentity).digest('hex');
}

class PasswordVerificationGate {
  private inFlight = 0;
  private windowStartedAt = 0;
  private verificationsInWindow = 0;
  private blockedUntil = 0;

  constructor(private readonly config: LoginAbuseProtectionConfig) {}

  tryAcquire(now = Date.now()): VerificationDecision {
    this.refreshWindow(now);

    if (this.blockedUntil > now) {
      return {
        ok: false,
        reason: 'global-window',
        retryAfterSeconds: retryAfterSeconds(this.blockedUntil - now)
      };
    }

    if (this.inFlight >= this.config.maxConcurrentVerifications) {
      return { ok: false, reason: 'global-concurrency', retryAfterSeconds: 1 };
    }

    if (this.verificationsInWindow >= this.config.maxVerificationsPerWindow) {
      this.blockedUntil = Math.max(
        now + this.config.backoffMs,
        this.windowStartedAt + this.config.verificationWindowMs
      );
      return {
        ok: false,
        reason: 'global-window',
        retryAfterSeconds: retryAfterSeconds(this.blockedUntil - now)
      };
    }

    this.inFlight += 1;
    this.verificationsInWindow += 1;
    let released = false;

    return {
      ok: true,
      lease: Object.freeze({
        release: () => {
          if (released) return;
          released = true;
          this.inFlight = Math.max(0, this.inFlight - 1);
        }
      })
    };
  }

  snapshot() {
    return {
      verificationInFlight: this.inFlight,
      verificationsInWindow: this.verificationsInWindow
    };
  }

  private refreshWindow(now: number) {
    if (
      this.windowStartedAt === 0
      || now >= this.windowStartedAt + this.config.verificationWindowMs
    ) {
      this.windowStartedAt = now;
      this.verificationsInWindow = 0;
    }
    if (this.blockedUntil <= now) this.blockedUntil = 0;
  }
}

export class LoginAbuseProtection {
  private readonly ipLimiter: LoginRateLimiter;
  private readonly identityLimiter: LoginRateLimiter;
  private readonly verificationGate: PasswordVerificationGate;
  private attemptsChecked = 0;
  private authenticationFailures = 0;
  private authenticationSuccesses = 0;
  private blockedByIp = 0;
  private blockedByIdentity = 0;
  private verificationStarted = 0;
  private verificationRejectedConcurrency = 0;
  private verificationRejectedWindow = 0;

  constructor(
    private readonly config: LoginAbuseProtectionConfig = DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG
  ) {
    this.ipLimiter = new LoginRateLimiter(
      config.ipMaxFailures,
      config.failureWindowMs,
      config.maxLimiterEntries
    );
    this.identityLimiter = new LoginRateLimiter(
      config.identityMaxFailures,
      config.failureWindowMs,
      config.maxLimiterEntries
    );
    this.verificationGate = new PasswordVerificationGate(config);
  }

  checkAttempt(ipKey: string, identityKey: string, now = Date.now()): AttemptDecision {
    this.attemptsChecked += 1;
    const ipBlocked = this.ipLimiter.isBlocked(ipKey, now);
    const identityBlocked = this.identityLimiter.isBlocked(identityKey, now);
    const retrySeconds = retryAfterSeconds(this.config.failureWindowMs);

    if (ipBlocked) {
      this.blockedByIp += 1;
      return { ok: false, reason: 'ip', retryAfterSeconds: retrySeconds };
    }
    if (identityBlocked) {
      this.blockedByIdentity += 1;
      return { ok: false, reason: 'identity', retryAfterSeconds: retrySeconds };
    }
    return { ok: true };
  }

  tryStartPasswordVerification(now = Date.now()): VerificationDecision {
    const decision = this.verificationGate.tryAcquire(now);
    if (decision.ok) {
      this.verificationStarted += 1;
      return decision;
    }
    if (decision.reason === 'global-concurrency') {
      this.verificationRejectedConcurrency += 1;
    } else {
      this.verificationRejectedWindow += 1;
    }
    return decision;
  }

  recordFailure(ipKey: string, identityKey: string, now = Date.now()) {
    this.authenticationFailures += 1;
    this.ipLimiter.recordFailure(ipKey, now);
    this.identityLimiter.recordFailure(identityKey, now);
  }

  recordSuccess(ipKey: string, identityKey: string) {
    this.authenticationSuccesses += 1;
    this.ipLimiter.clear(ipKey);
    this.identityLimiter.clear(identityKey);
  }

  metrics(): LoginAbuseProtectionMetrics {
    const verification = this.verificationGate.snapshot();
    return Object.freeze({
      attemptsChecked: this.attemptsChecked,
      authenticationFailures: this.authenticationFailures,
      authenticationSuccesses: this.authenticationSuccesses,
      blockedByIp: this.blockedByIp,
      blockedByIdentity: this.blockedByIdentity,
      verificationStarted: this.verificationStarted,
      verificationRejectedConcurrency: this.verificationRejectedConcurrency,
      verificationRejectedWindow: this.verificationRejectedWindow,
      verificationInFlight: verification.verificationInFlight,
      verificationsInWindow: verification.verificationsInWindow
    });
  }
}
