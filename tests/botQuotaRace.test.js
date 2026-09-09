'use strict';

/**
 * EG-005 regression tests: configured global and per-owner bot quotas must
 * hold under concurrent creation requests, not merely under sequential calls.
 *
 * The original code read the in-memory bot count, awaited persistence, and only
 * then registered the instance, so every concurrent caller observed the same
 * pre-await count and all of them succeeded. These tests drive the real
 * `BotManager.createBot` path with a stubbed persistence layer; no PostgreSQL,
 * Discord, or Minecraft endpoint is contacted.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { AsyncLock } = require('../src/utils/asyncLock');
const Persistence = require('../src/manager/Persistence');
const config = require('../src/config');
const { BotManager } = require('../src/manager/BotManager');

function principal(userId) {
  return Object.freeze({ userId, guildId: null, roles: [] });
}

function botOptions(port) {
  return {
    host: '93.184.216.34',
    port,
    username: `QuotaBot${port}`,
    version: '1.20.1',
    password: '',
  };
}

/**
 * Replace persistence with an in-memory stub whose write is deliberately slow,
 * so an unserialised check-then-await sequence would interleave.
 */
function stubPersistence(delayMs = 15) {
  const saved = [];
  const original = {
    createBotWithQuota: Persistence.createBotWithQuota,
    findBot: Persistence.findBot,
  };
  Persistence.createBotWithQuota = async (record) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    saved.push(record);
    return record;
  };
  Persistence.findBot = () => null;
  return {
    saved,
    restore() {
      Persistence.createBotWithQuota = original.createBotWithQuota;
      Persistence.findBot = original.findBot;
    },
  };
}

function withLimits(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) saved[key] = config.limits[key];
  Object.assign(config.limits, overrides);
  return Promise.resolve()
    .then(fn)
    .finally(() => Object.assign(config.limits, saved));
}

// ── AsyncLock primitives ────────────────────────────────────────────────────

test('EG-005: AsyncLock serialises tasks for one key', async () => {
  const lock = new AsyncLock();
  const order = [];
  const task = (id) => async () => {
    order.push(`start:${id}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(`end:${id}`);
  };

  await Promise.all([
    lock.runExclusive('k', task(1)),
    lock.runExclusive('k', task(2)),
    lock.runExclusive('k', task(3)),
  ]);

  assert.deepEqual(order, [
    'start:1',
    'end:1',
    'start:2',
    'end:2',
    'start:3',
    'end:3',
  ]);
  assert.equal(lock.size, 0, 'idle keys must be pruned');
});

test('EG-005: AsyncLock keeps the queue alive after a rejection', async () => {
  const lock = new AsyncLock();
  const ran = [];
  const first = lock.runExclusive('k', async () => {
    throw new Error('boom');
  });
  const second = lock.runExclusive('k', async () => {
    ran.push('second');
    return 'ok';
  });

  await assert.rejects(first, /boom/);
  assert.equal(await second, 'ok');
  assert.deepEqual(ran, ['second']);
});

test('EG-005: different AsyncLock keys may run concurrently', async () => {
  const lock = new AsyncLock();
  let concurrent = 0;
  let peak = 0;
  const task = async () => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 15));
    concurrent -= 1;
  };
  await Promise.all([
    lock.runExclusive('a', task),
    lock.runExclusive('b', task),
  ]);
  assert.equal(peak, 2);
});

// ── BotManager quota under concurrency ──────────────────────────────────────

test('EG-005: concurrent creates cannot exceed the per-user quota', async () => {
  await withLimits({ maxBotsPerUser: 2, maxBots: 50 }, async () => {
    const stub = stubPersistence();
    const manager = new BotManager();
    try {
      const results = await Promise.allSettled(
        [1, 2, 3, 4].map((n) =>
          manager.createBot(
            botOptions(25560 + n),
            principal('111111111111111111')
          )
        )
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(fulfilled.length, 2, 'exactly the quota may succeed');
      assert.equal(rejected.length, 2);
      for (const failure of rejected) {
        assert.equal(failure.reason.code, 'BOT_USER_QUOTA_REACHED');
      }
      assert.equal(manager._bots.size, 2);
      assert.equal(stub.saved.length, 2, 'only admitted records are persisted');
    } finally {
      stub.restore();
      await manager.shutdown();
    }
  });
});

test('EG-005: concurrent creates across users cannot exceed the global quota', async () => {
  await withLimits({ maxBotsPerUser: 5, maxBots: 3 }, async () => {
    const stub = stubPersistence();
    const manager = new BotManager();
    try {
      const users = [
        '222222222222222222',
        '333333333333333333',
        '444444444444444444',
      ];
      const results = await Promise.allSettled(
        users.flatMap((userId, index) => [
          manager.createBot(botOptions(25600 + index * 2), principal(userId)),
          manager.createBot(botOptions(25601 + index * 2), principal(userId)),
        ])
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      assert.equal(fulfilled.length, 3, 'the global quota must hold');
      assert.equal(manager._bots.size, 3);
      const quotaErrors = results
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason.code);
      assert.ok(
        quotaErrors.every((code) => code === 'BOT_QUOTA_REACHED'),
        `unexpected rejection codes: ${quotaErrors.join(',')}`
      );
    } finally {
      stub.restore();
      await manager.shutdown();
    }
  });
});

test('EG-005: a failed creation releases the lock for the next caller', async () => {
  await withLimits({ maxBotsPerUser: 5, maxBots: 50 }, async () => {
    const stub = stubPersistence();
    const manager = new BotManager();
    try {
      Persistence.createBotWithQuota = async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error('database unavailable');
      };
      await assert.rejects(
        manager.createBot(botOptions(25700), principal('555555555555555555')),
        /database unavailable/
      );
      assert.equal(manager._bots.size, 0, 'a failed create registers nothing');

      // The lock must not be wedged by the failure.
      Persistence.createBotWithQuota = async (record) => record;
      const created = await manager.createBot(
        botOptions(25701),
        principal('555555555555555555')
      );
      assert.ok(created.id, 'a later create must still succeed');
      assert.equal(
        manager._createLock.size,
        0,
        'the lock key must be released'
      );
    } finally {
      stub.restore();
      await manager.shutdown();
    }
  });
});

test('EG-005: the persistence layer re-checks both quotas inside the transaction', async () => {
  // Static proof that the guarded creation path exists and asks PostgreSQL to
  // serialise and re-count before inserting; the live behaviour needs a real
  // database and is tracked as a verification limitation in the report.
  const source = require('node:fs').readFileSync(
    require.resolve('../src/manager/Persistence'),
    'utf8'
  );
  assert.match(source, /createBotWithQuota/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /SELECT COUNT\(\*\) FROM bots WHERE created_by = \$1/);
  assert.match(source, /BOT_USER_QUOTA_REACHED/);
  assert.match(source, /BOT_QUOTA_REACHED/);
});
