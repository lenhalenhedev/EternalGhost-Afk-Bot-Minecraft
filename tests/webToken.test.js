const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
  validateTokenTtlMs,
  toJwtExpiresInSeconds,
} = require('../src/web/auth/tokenValidation');
const { parseChatInput } = require('../src/web/commandParser');

test('accepts the inclusive token TTL bounds when divisible by one second', () => {
  assert.equal(validateTokenTtlMs(MIN_TOKEN_TTL_MS).valid, true);
  const highestWholeSecondTtl = MAX_TOKEN_TTL_MS - (MAX_TOKEN_TTL_MS % 1_000);
  assert.equal(validateTokenTtlMs(highestWholeSecondTtl).valid, true);
  assert.equal(validateTokenTtlMs(MAX_TOKEN_TTL_MS).valid, false);
  assert.equal(toJwtExpiresInSeconds(1_000), 1);
});

test('rejects invalid token TTL values', () => {
  for (const value of [0, -1, 999, 1_500, Number.NaN, Infinity, '1000']) {
    assert.equal(validateTokenTtlMs(value).valid, false, String(value));
  }
});

test('converts only whole milliseconds to whole JWT seconds', () => {
  assert.throws(() => toJwtExpiresInSeconds(1_500));
  assert.equal(
    toJwtExpiresInSeconds(MAX_TOKEN_TTL_MS - (MAX_TOKEN_TTL_MS % 1_000)),
    9_007_199_254_740
  );
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
