'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  CooldownRateLimiter,
  SlidingWindowRateLimiter,
} = require('../src/utils/rateLimiter');

test('EG-010: cooldown limiter prune removes stale entries after the window', () => {
  const limiter = new CooldownRateLimiter(2_500);
  limiter.consume('user-1', 1_000);
  limiter.consume('user-2', 2_000);
  assert.equal(limiter.lastAcceptedAt.size, 2);

  limiter.prune(10_000);
  assert.equal(limiter.lastAcceptedAt.size, 0);
});

test('EG-010: sliding-window limiter prune drops keys whose events all expired', () => {
  const limiter = new SlidingWindowRateLimiter(5, 10 * 60 * 1_000);
  limiter.consume('stale', 1_000);
  limiter.consume('recent', 2_000);

  // Prune at 10 min + 1s: threshold = 1_000, so 'stale' (=1_000) is outside the
  // window while 'recent' (=2_000) survives.
  limiter.prune(10 * 60 * 1_000 + 1_000);
  assert.ok(!limiter.events.has('stale'));
  assert.ok(limiter.events.has('recent'));
});

test('EG-010: a hard entry cap bounds the map under many distinct keys', () => {
  const limiter = new CooldownRateLimiter(2_500, { maxEntries: 2 });
  limiter.consume('user-1', 1_000);
  limiter.consume('user-2', 1_000);
  limiter.consume('user-3', 1_000);
  assert.ok(limiter.lastAcceptedAt.size <= 2);
});

test('EG-010: recent entries survive pruning while only expired ones are dropped', () => {
  const limiter = new CooldownRateLimiter(1_000);
  limiter.consume('active', 5_000);
  limiter.consume('old', 2_000);
  // prune at 3500 with a 1000ms window: 'old' (=2000) has expired, 'active'
  // (=5000) has not.
  limiter.prune(3_500);
  assert.ok(limiter.lastAcceptedAt.has('active'));
  assert.ok(!limiter.lastAcceptedAt.has('old'));
});
