'use strict';

/**
 * EG-006 regression tests: a queue timeout must guarantee the attempted
 * connection cannot become current later.
 *
 * Before the fix, `BotInstance.start()` enqueued a zero-argument closure, so
 * the AbortSignal the Queue created on timeout was never observed: the caller
 * received a timeout while the original DNS/connect promise kept running and
 * attached a bot to an instance everyone believed had failed to start.
 *
 * Mineflayer's createBot is stubbed; no socket, DNS query, or external service
 * is contacted.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const mineflayer = require('mineflayer');

const BotInstance = require('../src/bot/BotInstance');
const { BOT_STATES } = require('../src/bot/states');
const config = require('../src/config');
const { createMineflayerBot } = require('../src/bot/connection/connector');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeBot extends EventEmitter {
  constructor() {
    super();
    this.username = 'cancel-test';
    this.pathfinder = { setGoal() {} };
    this.endCalls = 0;
    this.quitCalls = 0;
  }

  loadPlugin() {}
  end() {
    this.endCalls += 1;
  }
  quit() {
    this.quitCalls += 1;
  }
}

function record() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    host: '93.184.216.34',
    port: 25565,
    username: 'CancelBot',
    version: '1.20.1',
    encryptedPassword: '',
  };
}

function withQueueTimeout(ms, fn) {
  const saved = config.limits.queueTimeout;
  config.limits.queueTimeout = ms;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      config.limits.queueTimeout = saved;
    });
}

test('EG-006: a queue timeout prevents a late connection from attaching', async () => {
  await withQueueTimeout(60, async () => {
    const originalCreateBot = mineflayer.createBot;
    const connection = deferred();
    mineflayer.createBot = () => connection.promise;

    const instance = new BotInstance(record());
    try {
      const startPromise = instance.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(instance.state, BOT_STATES.CONNECTING);

      await assert.rejects(startPromise, /timed out/);
      assert.equal(
        instance.state,
        BOT_STATES.OFFLINE,
        'a timed-out start must leave the bot startable, not stuck CONNECTING'
      );
      assert.equal(instance.bot, null);

      // The delayed connect now resolves; it must be discarded, not attached.
      const staleBot = new FakeBot();
      connection.resolve(staleBot);
      await new Promise((resolve) => setTimeout(resolve, 30));

      assert.equal(
        instance.bot,
        null,
        'the late bot must never become current'
      );
      assert.equal(staleBot.endCalls, 1, 'the late socket must be closed');
      assert.equal(instance.state, BOT_STATES.OFFLINE);
    } finally {
      mineflayer.createBot = originalCreateBot;
      await instance.destroy();
    }
  });
});

test('EG-006: a bot can be started again after a queue timeout', async () => {
  await withQueueTimeout(60, async () => {
    const originalCreateBot = mineflayer.createBot;
    const first = deferred();
    mineflayer.createBot = () => first.promise;

    const instance = new BotInstance(record());
    try {
      await assert.rejects(instance.start(), /timed out/);
      const staleBot = new FakeBot();
      first.resolve(staleBot);
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Second start resolves immediately and must attach cleanly.
      const goodBot = new FakeBot();
      mineflayer.createBot = () => goodBot;
      await instance.start();
      assert.equal(instance.bot, goodBot);
      assert.equal(staleBot.endCalls, 1);
    } finally {
      mineflayer.createBot = originalCreateBot;
      await instance.destroy();
    }
  });
});

test('EG-006: a start that is already cancelled never opens a socket', async () => {
  const originalCreateBot = mineflayer.createBot;
  let called = false;
  mineflayer.createBot = () => {
    called = true;
    return new FakeBot();
  };

  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      createMineflayerBot(record(), { signal: controller.signal }),
      /cancelled before it started/
    );
    assert.equal(called, false);
  } finally {
    mineflayer.createBot = originalCreateBot;
  }
});

test('EG-006: cancellation during destination resolution stops before createBot', async () => {
  const originalCreateBot = mineflayer.createBot;
  let called = false;
  mineflayer.createBot = () => {
    called = true;
    return new FakeBot();
  };
  const controller = new AbortController();
  try {
    await assert.rejects(
      createMineflayerBot(record(), {
        signal: controller.signal,
        resolveDestination: async (host) => {
          controller.abort();
          return { host, address: host, family: 4 };
        },
      }),
      /cancelled during destination resolution/
    );
    assert.equal(called, false);
  } finally {
    mineflayer.createBot = originalCreateBot;
  }
});

test('EG-006: an explicit stop still wins the race against a slow connect', async () => {
  await withQueueTimeout(5_000, async () => {
    const originalCreateBot = mineflayer.createBot;
    const connection = deferred();
    mineflayer.createBot = () => connection.promise;

    const instance = new BotInstance(record());
    try {
      const startPromise = instance.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await instance.stop();
      assert.equal(instance.state, BOT_STATES.OFFLINE);

      const staleBot = new FakeBot();
      connection.resolve(staleBot);
      await startPromise;
      assert.equal(instance.bot, null);
      assert.equal(staleBot.endCalls, 1);
    } finally {
      mineflayer.createBot = originalCreateBot;
      await instance.destroy();
    }
  });
});
