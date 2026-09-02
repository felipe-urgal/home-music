import assert from 'node:assert/strict';
import test from 'node:test';
import { LoginRateLimiter } from './auth.js';

test('saturação do mapa preserva atacante bloqueado e agrupa churn em overflow', () => {
  const limiter = new LoginRateLimiter(2, 1000, 2);

  limiter.recordFailure('attacker', 100);
  limiter.recordFailure('attacker', 200);
  limiter.recordFailure('churn-a', 300);
  limiter.recordFailure('churn-b', 400);
  limiter.recordFailure('churn-c', 500);

  assert.equal(limiter.isBlocked('attacker', 600), true);
  assert.equal(limiter.isBlocked('untracked-during-overflow', 600), true);

  limiter.clear('untracked-during-overflow');
  assert.equal(limiter.isBlocked('attacker', 600), true);
  assert.equal(limiter.isBlocked('another-untracked-key', 600), true);

  assert.equal(limiter.isBlocked('attacker', 1501), false);
  assert.equal(limiter.isBlocked('new-ip', 1501), false);
});
