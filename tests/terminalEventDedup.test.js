'use strict';

/**
 * EG-007 regression tests: one physical disconnect must consume the reconnect
 * budget exactly once.
 *
 * Mineflayer registers `kicked` when it receives a disconnect packet and also
 * emits `end` when the underlying client ends, so a single normal disconnect
 * used to charge two of the five reconnect slots. These tests use in-process
 * fake bots and instances; no Minecraft server is contacted.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

const {
  bindBotEvents,
  claimTerminalDisconnect,
} = require('../src/bot/connection/botEventBinder');
const ReconnectPolicy = require('../src/bot/connection/reconnectPolicy');
const { BOT_STATES } = require('../src/bot/states');

class FakeBot extends EventEmitter {
  constructor() {
    super();
    this.username = 'terminal-test';
    this.pathfinder = { setGoal() {} };
    this.endCalls = 0;
  }

  loadPlugin() {}
  end() {
    this.endCalls += 1;
  }
  quit() {}
}

function fakeInstance({ autoReconnect = true, generation = 1 } = {}) {
  const instance = new EventEmitter();
  instance.id = '33333333-3333-4333-8333-333333333333';
  instance.state = BOT_STATES.PLAYING;
  instance.record = { autoReconnect };
  instance._sub = { stopAll() {} };
  instance._connectGeneration = generation;
  instance._terminalGeneration = -1;
  instance._respawnHandler = null;
  instance._setState = (next) => {
    instance.state = next;
  };
  instance._connect = async () => {};
  instance._reconnect = new ReconnectPolicy(instance);
  return instance;
}

test('EG-007: claimTerminalDisconnect admits one event per connection', () => {
  const instance = fakeInstance();
  assert.equal(claimTerminalDisconnect(instance, 'kicked'), true);
  assert.equal(claimTerminalDisconnect(instance, 'end'), false);
  assert.equal(claimTerminalDisconnect(instance, 'end'), false);

  // A new connection generation re-arms the guard.
  instance._connectGeneration = 2;
  assert.equal(claimTerminalDisconnect(instance, 'end'), true);
  assert.equal(claimTerminalDisconnect(instance, 'kicked'), false);
});

test('EG-007: kicked followed by end charges the reconnect budget once', () => {
  const instance = fakeInstance();
  const bot = new FakeBot();
  bindBotEvents(instance, bot);

  bot.emit('kicked', { reason: 'server closed' });
  bot.emit('end', 'socket closed');

  assert.equal(
    instance._reconnect.currentAttempts,
    1,
    'one physical disconnect must cost exactly one attempt'
  );
  instance._reconnect.clearTimer();
});

test('EG-007: end followed by kicked also charges only once', () => {
  const instance = fakeInstance();
  const bot = new FakeBot();
  bindBotEvents(instance, bot);

  bot.emit('end', 'socket closed');
  bot.emit('kicked', { reason: 'server closed' });

  assert.equal(instance._reconnect.currentAttempts, 1);
  instance._reconnect.clearTimer();
});

test('EG-007: a lone terminal event still drives recovery', () => {
  for (const kind of ['kicked', 'end']) {
    const instance = fakeInstance();
    const bot = new FakeBot();
    bindBotEvents(instance, bot);

    if (kind === 'kicked') bot.emit('kicked', 'bye');
    else bot.emit('end', 'bye');

    assert.equal(instance._reconnect.currentAttempts, 1, kind);
    assert.equal(instance.state, BOT_STATES.RECONNECTING, kind);
    instance._reconnect.clearTimer();
  }
});

test('EG-007: a fresh connection after a disconnect can disconnect again', () => {
  const instance = fakeInstance();
  const firstBot = new FakeBot();
  bindBotEvents(instance, firstBot);
  firstBot.emit('kicked', 'bye');
  firstBot.emit('end', 'bye');
  assert.equal(instance._reconnect.currentAttempts, 1);

  // Simulate the next successful _connect generation.
  instance._connectGeneration = 2;
  instance.state = BOT_STATES.PLAYING;
  const secondBot = new FakeBot();
  bindBotEvents(instance, secondBot);
  secondBot.emit('end', 'bye again');
  secondBot.emit('kicked', 'bye again');

  assert.equal(
    instance._reconnect.currentAttempts,
    2,
    'the second connection must be allowed its own single charge'
  );
  instance._reconnect.clearTimer();
});

test('EG-007: repeated normal disconnects respect the configured budget', () => {
  const instance = fakeInstance();
  for (let connection = 1; connection <= 3; connection += 1) {
    instance._connectGeneration = connection;
    instance.state = BOT_STATES.PLAYING;
    const bot = new FakeBot();
    bindBotEvents(instance, bot);
    bot.emit('kicked', 'unstable server');
    bot.emit('end', 'unstable server');
    instance._reconnect.clearTimer();
  }

  assert.equal(
    instance._reconnect.currentAttempts,
    3,
    'three disconnects must cost three attempts, not six'
  );
  assert.notEqual(instance.state, BOT_STATES.ERROR);
});
