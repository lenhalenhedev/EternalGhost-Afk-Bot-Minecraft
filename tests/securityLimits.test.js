const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SlidingWindowRateLimiter,
  CooldownRateLimiter,
} = require('../src/utils/rateLimiter');
const { normalizeFields, stripAnsi } = require('../src/services/logger');

test('account cooldown is shared across different bots', () => {
  const limiter = new CooldownRateLimiter(2_500);
  assert.deepEqual(limiter.consume('user-1', 1_000), {
    allowed: true,
    retryAfterMs: 0,
  });
  assert.equal(limiter.consume('user-1', 1_001).allowed, false);
  assert.deepEqual(limiter.consume('user-1', 3_500), {
    allowed: true,
    retryAfterMs: 0,
  });
});

test('Pino log normalization excludes raw error messages and strips ANSI sequences', () => {
  const fields = normalizeFields({
    userId: 'user-1',
    err: new Error('payload\\nFORGED_LOG_LINE'),
    input: 'secret-payload',
  });
  assert.deepEqual(fields, { userId: 'user-1', err: { name: 'Error' } });
  const ansi = `safe${String.fromCharCode(27)}[31mred${String.fromCharCode(27)}[0m`;
  assert.equal(stripAnsi(ansi), 'safered');
});

test('bot creation limiter allows five attempts and rejects the sixth in ten minutes', () => {
  const limiter = new SlidingWindowRateLimiter(5, 10 * 60 * 1_000);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(limiter.consume('user-1', attempt).allowed, true);
  }
  const rejected = limiter.consume('user-1', 5);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterMs, 10 * 60 * 1_000 - 5);
  assert.equal(limiter.consume('user-1', 10 * 60 * 1_000).allowed, true);
});
