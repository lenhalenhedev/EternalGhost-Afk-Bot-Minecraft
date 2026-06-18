'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  clamp, randInt, randFloat, formatUptime, formatMB, formatPos,
  withTimeout, getReconnectDelay, reconnectLimitReached, sleep,
} = require('../src/utils/helpers');

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('randInt stays within inclusive bounds', () => {
  for (let i = 0; i < 200; i++) {
    const n = randInt(3, 6);
    assert.ok(n >= 3 && n <= 6 && Number.isInteger(n));
  }
});

test('randFloat stays within bounds', () => {
  for (let i = 0; i < 200; i++) {
    const n = randFloat(1, 2);
    assert.ok(n >= 1 && n < 2);
  }
});

test('formatUptime renders human-readable spans', () => {
  assert.equal(formatUptime(0), '0s');
  assert.equal(formatUptime(1000), '1s');
  assert.equal(formatUptime(90_061_000), '1d 1h 1m 1s');
});

test('formatMB and formatPos render values', () => {
  assert.equal(formatMB(1024 * 1024), '1.0 MB');
  assert.equal(formatPos(null), 'N/A');
  assert.equal(formatPos({ x: 1.9, y: 64.2, z: -3.7 }), '(1, 64, -4)');
});

test('withTimeout resolves fast promises and rejects slow ones', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 50, 'fast'), 'ok');
  await assert.rejects(() => withTimeout(sleep(50), 5, 'slow'), /slow timed out/);
});

test('getReconnectDelay uses exponential schedule and clamps', () => {
  assert.equal(getReconnectDelay(0), 5_000);
  assert.equal(getReconnectDelay(2), 60_000);
  assert.equal(getReconnectDelay(99), 120_000);
});

test('reconnectLimitReached counts attempts within the window', () => {
  const now = Date.now();
  const recent = [now, now, now, now, now];
  assert.equal(reconnectLimitReached(recent, 5, 600_000), true);
  const old = [now - 700_000, now - 800_000];
  assert.equal(reconnectLimitReached(old, 5, 600_000), false);
});
