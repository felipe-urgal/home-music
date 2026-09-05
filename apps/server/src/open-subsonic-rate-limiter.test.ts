import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_OPEN_SUBSONIC_RATE_LIMIT_SUBJECTS,
  OpenSubsonicRateLimiter
} from './open-subsonic-routes.js';

test('OpenSubsonic limita cardinalidade do rate limiter e falha fechado sob churn', () => {
  const limiter = new OpenSubsonicRateLimiter();

  for (let index = 0; index < MAX_OPEN_SUBSONIC_RATE_LIMIT_SUBJECTS; index += 1) {
    assert.equal(limiter.hit(`subject-${index}`, 1, 0), true);
  }

  assert.equal(limiter.hit('overflow', 1, 0), false);
  assert.equal(limiter.hit('subject-0', 1, 0), false);

  assert.equal(limiter.hit('overflow', 1, 120_001), true);
});
