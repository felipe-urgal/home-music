import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TvDeviceLoginCapacityError,
  TvDeviceLoginManager,
  TvDeviceLoginRateLimitError
} from './tv-device-login-manager.js';

function deterministicManager(overrides: ConstructorParameters<typeof TvDeviceLoginManager>[0] = {}) {
  let token = 0;
  return new TvDeviceLoginManager({
    now: () => 1_000,
    randomToken: bytes => `token_${bytes}_${String(++token).padStart(12, '0')}`,
    randomCode: () => '123456',
    startRateLimitMax: 100,
    ...overrides
  });
}

test('start cria solicitação pending com segredos distintos e TTL', () => {
  const manager = deterministicManager({ ttlMs: 300_000 });

  const first = manager.start('127.0.0.1');
  const second = manager.start('127.0.0.2');

  assert.equal(first.displayCode, '123456');
  assert.equal(first.expiresAt, 301_000);
  assert.notEqual(first.requestId, second.requestId);
  assert.notEqual(first.deviceToken, second.deviceToken);
  assert.notEqual(first.approvalToken, second.approvalToken);
  assert.notEqual(first.deviceToken, first.approvalToken);
  assert.equal(manager.status(first.requestId, first.deviceToken), 'pending');
});

test('segredo incorreto da TV não observa a solicitação', () => {
  const manager = deterministicManager();
  const started = manager.start('origin-a');

  assert.equal(manager.status(started.requestId, 'token_32_999999999999'), null);
  assert.equal(manager.status('token_18_999999999999', started.deviceToken), null);
  assert.equal(manager.status(started.requestId, started.deviceToken), 'pending');
});

test('approve associa o usuário e consumo é de uso único', () => {
  const manager = deterministicManager();
  const started = manager.start('origin-a');

  assert.deepEqual(manager.approve(started.approvalToken, 'user-7'), { displayCode: '123456' });
  assert.equal(manager.status(started.requestId, started.deviceToken), 'approved');
  assert.equal(manager.approve(started.approvalToken, 'user-8'), null);
  assert.equal(manager.deny(started.approvalToken), false);

  const reserved = manager.reserveConsume(started.requestId, started.deviceToken);
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  assert.equal(reserved.lease.userId, 'user-7');
  assert.deepEqual(manager.reserveConsume(started.requestId, started.deviceToken), {
    ok: false,
    reason: 'busy'
  });

  reserved.lease.commit();
  assert.equal(manager.status(started.requestId, started.deviceToken), 'consumed');
  assert.deepEqual(manager.reserveConsume(started.requestId, started.deviceToken), {
    ok: false,
    reason: 'consumed'
  });
});

test('rollback do consumo preserva autorização para nova tentativa', () => {
  const manager = deterministicManager();
  const started = manager.start('origin-a');
  manager.approve(started.approvalToken, 'user-7');

  const first = manager.reserveConsume(started.requestId, started.deviceToken);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  first.lease.rollback();

  assert.equal(manager.status(started.requestId, started.deviceToken), 'approved');
  const second = manager.reserveConsume(started.requestId, started.deviceToken);
  assert.equal(second.ok, true);
});

test('deny encerra pending e impede replay', () => {
  const manager = deterministicManager();
  const started = manager.start('origin-a');

  assert.equal(manager.deny(started.approvalToken), true);
  assert.equal(manager.status(started.requestId, started.deviceToken), 'denied');
  assert.equal(manager.deny(started.approvalToken), false);
  assert.equal(manager.approve(started.approvalToken, 'user-7'), null);
  assert.deepEqual(manager.reserveConsume(started.requestId, started.deviceToken), {
    ok: false,
    reason: 'denied'
  });
});

test('expiração é aplicada antes de approve e consume', () => {
  let now = 0;
  const manager = deterministicManager({ now: () => now, ttlMs: 100 });
  const started = manager.start('origin-a');

  now = 100;
  assert.equal(manager.status(started.requestId, started.deviceToken), 'expired');
  assert.equal(manager.approve(started.approvalToken, 'user-7'), null);
  assert.deepEqual(manager.reserveConsume(started.requestId, started.deviceToken), {
    ok: false,
    reason: 'expired'
  });
});

test('cancelamento exige segredo da TV e remove apenas solicitação ativa', () => {
  const manager = deterministicManager();
  const started = manager.start('origin-a');

  assert.equal(manager.cancel(started.requestId, 'token_32_999999999999'), false);
  assert.equal(manager.cancel(started.requestId, started.deviceToken), true);
  assert.equal(manager.status(started.requestId, started.deviceToken), null);
});

test('cap global e cap por origem rejeitam sem expulsar solicitações existentes', () => {
  const byOrigin = deterministicManager({ maxActiveRequests: 4, maxActivePerOrigin: 1 });
  const first = byOrigin.start('origin-a');
  assert.throws(() => byOrigin.start('origin-a'), error => (
    error instanceof TvDeviceLoginCapacityError && error.scope === 'origin'
  ));
  assert.equal(byOrigin.status(first.requestId, first.deviceToken), 'pending');

  const global = deterministicManager({ maxActiveRequests: 1, maxActivePerOrigin: 1 });
  global.start('origin-a');
  assert.throws(() => global.start('origin-b'), error => (
    error instanceof TvDeviceLoginCapacityError && error.scope === 'global'
  ));
});

test('rate limit de start é limitado por janela e informa Retry-After', () => {
  let now = 0;
  const manager = deterministicManager({
    now: () => now,
    maxActiveRequests: 20,
    maxActivePerOrigin: 20,
    startRateLimitMax: 2,
    startRateLimitWindowMs: 1_000
  });

  manager.start('origin-a');
  manager.start('origin-a');
  assert.throws(() => manager.start('origin-a'), error => (
    error instanceof TvDeviceLoginRateLimitError && error.retryAfterSeconds === 1
  ));

  now = 1_000;
  assert.doesNotThrow(() => manager.start('origin-a'));
});

test('cleanup remove terminais expirados depois da retenção', () => {
  let now = 0;
  const manager = deterministicManager({
    now: () => now,
    ttlMs: 100,
    terminalRetentionMs: 50
  });
  const started = manager.start('origin-a');

  now = 100;
  assert.equal(manager.status(started.requestId, started.deviceToken), 'expired');
  now = 149;
  assert.equal(manager.cleanupExpired(), 0);
  now = 150;
  assert.equal(manager.cleanupExpired(), 1);
  assert.equal(manager.status(started.requestId, started.deviceToken), null);
});

test('manager guarda hashes dos segredos, não os tokens brutos', () => {
  const manager = deterministicManager();
  const started = manager.start('origin-a');
  const storedRequests = (manager as unknown as {
    requests: Map<string, Record<string, unknown>>;
  }).requests;
  const stored = storedRequests.get(started.requestId);

  assert.ok(stored);
  assert.equal('deviceToken' in stored, false);
  assert.equal('approvalToken' in stored, false);
  assert.ok(Buffer.isBuffer(stored.deviceTokenHash));
  assert.ok(Buffer.isBuffer(stored.approvalTokenHash));
  assert.notEqual((stored.deviceTokenHash as Buffer).toString('utf8'), started.deviceToken);
  assert.notEqual((stored.approvalTokenHash as Buffer).toString('utf8'), started.approvalToken);
});
