const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_DAYS,
  validateTokenTtlMs,
  validateTokenTtlDays,
  daysToMilliseconds,
  toJwtExpiresInSeconds,
} = require('../src/web/auth/tokenValidation');
const { calculateRenewedExpiry } = require('../src/web/auth/tokenService');
const { parseChatInput } = require('../src/web/commandParser');

test('accepts the inclusive token TTL bounds when divisible by one second', () => {
  assert.equal(validateTokenTtlMs(MIN_TOKEN_TTL_MS).valid, true);
  assert.equal(validateTokenTtlMs(MAX_TOKEN_TTL_MS).valid, true);
  assert.equal(validateTokenTtlMs(MAX_TOKEN_TTL_MS + 1_000).valid, false);
  assert.equal(toJwtExpiresInSeconds(1_000), 1);
});

test('accepts Day-based token TTL up to the 12-month hard cap', () => {
  assert.equal(MAX_TOKEN_TTL_DAYS, 365);
  assert.deepEqual(validateTokenTtlDays(1), { valid: true, value: 1 });
  assert.deepEqual(validateTokenTtlDays(365), { valid: true, value: 365 });
  assert.equal(daysToMilliseconds(30), 30 * 24 * 60 * 60 * 1_000);
  assert.equal(validateTokenTtlDays(366).valid, false);
});

test('calculates renewals from current expiry and caps them at now plus 12 months', () => {
  const now = new Date('2026-08-28T00:00:00.000Z');
  const currentExpiry = new Date('2026-09-02T00:00:00.000Z');
  assert.equal(
    calculateRenewedExpiry(currentExpiry, 30, now).toISOString(),
    '2026-10-02T00:00:00.000Z'
  );

  const alreadyLongExpiry = new Date('2027-12-31T00:00:00.000Z');
  assert.equal(
    calculateRenewedExpiry(alreadyLongExpiry, 30, now).toISOString(),
    '2027-08-28T00:00:00.000Z'
  );
});

test('rejects invalid token TTL values', () => {
  for (const value of [0, -1, 999, 1_500, Number.NaN, Infinity, '1000']) {
    assert.equal(validateTokenTtlMs(value).valid, false, String(value));
  }
});

test('converts only whole milliseconds to whole JWT seconds', () => {
  assert.throws(() => toJwtExpiresInSeconds(1_500));
  assert.equal(toJwtExpiresInSeconds(MAX_TOKEN_TTL_MS), 31_536_000);
});

test('classifies only a slash at character zero as a command', () => {
  assert.deepEqual(parseChatInput('/login'), {
    kind: 'command',
    text: '/login',
  });
  assert.deepEqual(parseChatInput('example/'), {
    kind: 'chat',
    text: 'example/',
  });
  assert.deepEqual(parseChatInput('  /login'), {
    kind: 'chat',
    text: '  /login',
  });
});
