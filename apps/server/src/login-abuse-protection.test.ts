import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG,
  LoginAbuseProtection,
  loginIdentityRateLimitKey,
  parseLoginAbuseProtectionConfig,
  type LoginAbuseProtectionConfig
} from './login-abuse-protection.js';

function config(overrides: Partial<LoginAbuseProtectionConfig> = {}): LoginAbuseProtectionConfig {
  return Object.freeze({ ...DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG, ...overrides });
}

test('identidade de rate limit usa a mesma normalização do login sem depender da existência da conta', () => {
  assert.equal(loginIdentityRateLimitKey('  Alice  '), loginIdentityRateLimitKey('alice'));
  assert.equal(loginIdentityRateLimitKey('ÁLICE'), loginIdentityRateLimitKey('álice'));
  assert.equal(loginIdentityRateLimitKey(''), loginIdentityRateLimitKey('\u0000'));
});

test('múltiplos IPs contra a mesma identidade são limitados e recuperam após a janela', () => {
  const protection = new LoginAbuseProtection(config({
    ipMaxFailures: 100,
    identityMaxFailures: 2,
    failureWindowMs: 1000,
    maxLimiterEntries: 8,
    maxConcurrentVerifications: 2,
    maxVerificationsPerWindow: 20,
    verificationWindowMs: 1000,
    backoffMs: 500
  }));
  const identity = loginIdentityRateLimitKey('target');

  protection.recordFailure('198.51.100.1', identity, 100);
  protection.recordFailure('198.51.100.2', identity, 200);

  assert.deepEqual(protection.checkAttempt('198.51.100.3', identity, 300), {
    ok: false,
    reason: 'identity',
    retryAfterSeconds: 1
  });
  assert.deepEqual(
    protection.checkAttempt('198.51.100.3', loginIdentityRateLimitKey('other'), 300),
    { ok: true }
  );
  assert.deepEqual(protection.checkAttempt('198.51.100.3', identity, 1101), { ok: true });
});

test('gate global limita concorrência e libera capacidade ao finalizar a verificação', () => {
  const protection = new LoginAbuseProtection(config({
    maxConcurrentVerifications: 2,
    maxVerificationsPerWindow: 10,
    verificationWindowMs: 1000,
    backoffMs: 500
  }));

  const first = protection.tryStartPasswordVerification(100);
  const second = protection.tryStartPasswordVerification(100);
  const third = protection.tryStartPasswordVerification(100);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(third, {
    ok: false,
    reason: 'global-concurrency',
    retryAfterSeconds: 1
  });

  if (!first.ok || !second.ok) throw new Error('leases esperadas não foram adquiridas');
  first.lease.release();
  const replacement = protection.tryStartPasswordVerification(200);
  assert.equal(replacement.ok, true);
  if (!replacement.ok) throw new Error('lease substituta esperada não foi adquirida');
  replacement.lease.release();
  second.lease.release();

  assert.equal(protection.metrics().verificationInFlight, 0);
  assert.equal(protection.metrics().verificationRejectedConcurrency, 1);
});

test('gate global aplica orçamento por janela, backoff e recuperação determinística', () => {
  const protection = new LoginAbuseProtection(config({
    maxConcurrentVerifications: 2,
    maxVerificationsPerWindow: 3,
    verificationWindowMs: 1000,
    backoffMs: 500
  }));

  for (const now of [100, 200, 300]) {
    const decision = protection.tryStartPasswordVerification(now);
    assert.equal(decision.ok, true);
    if (!decision.ok) throw new Error('lease esperada não foi adquirida');
    decision.lease.release();
  }

  assert.deepEqual(protection.tryStartPasswordVerification(400), {
    ok: false,
    reason: 'global-window',
    retryAfterSeconds: 1
  });
  assert.deepEqual(protection.tryStartPasswordVerification(900), {
    ok: false,
    reason: 'global-window',
    retryAfterSeconds: 1
  });

  const recovered = protection.tryStartPasswordVerification(1101);
  assert.equal(recovered.ok, true);
  if (recovered.ok) recovered.lease.release();
});

test('configuração do login aceita overrides seguros e rejeita limites incoerentes', () => {
  const parsed = parseLoginAbuseProtectionConfig({
    HOME_MUSIC_LOGIN_IP_MAX_FAILURES: '6',
    HOME_MUSIC_LOGIN_IDENTITY_MAX_FAILURES: '10',
    HOME_MUSIC_LOGIN_WINDOW_SECONDS: '120',
    HOME_MUSIC_LOGIN_LIMITER_MAX_ENTRIES: '1024',
    HOME_MUSIC_LOGIN_MAX_CONCURRENT_VERIFICATIONS: '3',
    HOME_MUSIC_LOGIN_MAX_VERIFICATIONS_PER_WINDOW: '40',
    HOME_MUSIC_LOGIN_GLOBAL_WINDOW_SECONDS: '30',
    HOME_MUSIC_LOGIN_BACKOFF_SECONDS: '15'
  });

  assert.deepEqual(parsed, {
    ipMaxFailures: 6,
    identityMaxFailures: 10,
    failureWindowMs: 120_000,
    maxLimiterEntries: 1024,
    maxConcurrentVerifications: 3,
    maxVerificationsPerWindow: 40,
    verificationWindowMs: 30_000,
    backoffMs: 15_000
  });
  assert.throws(
    () => parseLoginAbuseProtectionConfig({
      HOME_MUSIC_LOGIN_MAX_CONCURRENT_VERIFICATIONS: '8',
      HOME_MUSIC_LOGIN_MAX_VERIFICATIONS_PER_WINDOW: '4'
    }),
    /não pode ser menor/
  );
});
