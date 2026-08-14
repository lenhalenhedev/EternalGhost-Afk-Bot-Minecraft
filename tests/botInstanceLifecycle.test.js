'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const EventEmitter = require('node:events');
const mineflayer = require('mineflayer');
const BotInstance = require('../src/bot/BotInstance');
const { BOT_STATES } = require('../src/bot/states');

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
    this.username = 'test-bot';
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
    id: '11111111-1111-4111-8111-111111111111',
    host: '93.184.216.34',
    port: 25565,
    username: 'TestBot',
    version: '1.20.1',
    encryptedPassword: '',
  };
}

test('stop during connection setup cannot resurrect a stale bot', async () => {
  const originalCreateBot = mineflayer.createBot;
  const connection = deferred();
  mineflayer.createBot = () => connection.promise;

  const instance = new BotInstance(record());
  try {
    const startPromise = instance.start();
    await new Promise((resolve) => setImmediate(resolve));

    await instance.stop();
    assert.equal(instance.state, BOT_STATES.OFFLINE);

    const staleBot = new FakeBot();
    connection.resolve(staleBot);
    await startPromise;

    assert.equal(instance.state, BOT_STATES.OFFLINE);
    assert.equal(instance.bot, null);
    assert.equal(staleBot.endCalls, 1);
  } finally {
    mineflayer.createBot = originalCreateBot;
    instance.removeAllListeners();
  }
});

module.exports = { FakeBot };
