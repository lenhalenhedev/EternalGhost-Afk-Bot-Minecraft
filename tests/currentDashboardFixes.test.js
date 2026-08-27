'use strict';

process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.ADMIN_USER_IDS ||= 'test-admin';
process.env.DISCORD_TOKEN ||= 'test-discord-token';
process.env.DISCORD_CLIENT_ID ||= 'test-discord-client';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const BotInstance = require('../src/bot/BotInstance');
const BotManager = require('../src/manager/BotManager');
const { parseChatInput } = require('../src/utils/chatInput');
const { botLog } = require('../src/services/logger');
const { subscribe } = require('../src/web/sse/eventHub');

const OWNER = Object.freeze({
  userId: 'dashboard-owner',
  guildId: null,
  roles: [],
});
const OTHER_OWNER = Object.freeze({
  userId: 'dashboard-other-owner',
  guildId: null,
  roles: [],
});
const BOT_ID = '139e91c5-3c69-4ce5-b05f-7093e49a47e5';
const SECOND_BOT_ID = '139e91c5-aaaa-4ce5-b05f-7093e49a47e5';

function preparePrefixManager() {
  BotManager._bots.clear();
  BotManager._bots.set(BOT_ID, {
    id: BOT_ID,
    record: { id: BOT_ID, createdBy: OWNER.userId },
  });
  BotManager._bots.set(SECOND_BOT_ID, {
    id: SECOND_BOT_ID,
    record: { id: SECOND_BOT_ID, createdBy: OWNER.userId },
  });
  BotManager._bots.set('139e91c5-bbbb-4ce5-b05f-7093e49a47e5', {
    id: '139e91c5-bbbb-4ce5-b05f-7093e49a47e5',
    record: {
      id: '139e91c5-bbbb-4ce5-b05f-7093e49a47e5',
      createdBy: OTHER_OWNER.userId,
    },
  });
}

test('logger events are forwarded into the shared SSE event hub', () => {
  const events = [];
  const unsubscribe = subscribe((event) => events.push(event));

  try {
    botLog('live-bot', 'info', 'new live line');
  } finally {
    unsubscribe();
  }

  assert.ok(
    events.some(
      (event) =>
        event.event === 'bot:log' &&
        event.data.botId === 'live-bot' &&
        event.data.message === 'new live line'
    )
  );
});

test('chat input classification uses only the first character and preserves transport text', () => {
  assert.deepEqual(parseChatInput('/login'), {
    kind: 'command',
    text: '/login',
    command: 'login',
  });
  assert.deepEqual(parseChatInput('  /login'), {
    kind: 'chat',
    text: '  /login',
    command: null,
  });
  assert.deepEqual(parseChatInput('example/'), {
    kind: 'chat',
    text: 'example/',
    command: null,
  });
});

test('BotInstance exposes the shared input dispatcher and sends the original command text', async () => {
  const sent = [];
  const instance = Object.create(BotInstance.prototype);
  instance._bot = { chat: (message) => sent.push(message) };
  instance._state = 'PLAYING';
  instance._queue = { enqueue: (task) => task() };
  instance._abort = null;

  await instance.sendInput('/spawn');

  assert.deepEqual(sent, ['/spawn']);
});

test('select-bot resolves a unique owned UUID prefix of at least eight characters', () => {
  preparePrefixManager();

  const instance = BotManager.resolveAuthorizedBotPrefix(
    OWNER,
    '139e91c5-3c69'
  );

  assert.equal(instance.id, BOT_ID);
});

test('select-bot rejects a prefix shorter than eight characters', () => {
  preparePrefixManager();

  assert.throws(
    () => BotManager.resolveAuthorizedBotPrefix(OWNER, '139e91c5'.slice(0, 7)),
    (error) => error?.code === 'INVALID_BOT_ID'
  );
});

test('select-bot rejects an ambiguous owned UUID prefix without choosing the first match', () => {
  preparePrefixManager();

  assert.throws(
    () => BotManager.resolveAuthorizedBotPrefix(OWNER, '139e91c5'),
    (error) => error?.code === 'AMBIGUOUS_BOT_ID'
  );
});

test('select-bot ignores foreign bots when resolving an otherwise matching prefix', () => {
  preparePrefixManager();

  const instance = BotManager.resolveAuthorizedBotPrefix(
    OTHER_OWNER,
    '139e91c5'
  );

  assert.equal(instance.id, '139e91c5-bbbb-4ce5-b05f-7093e49a47e5');
});

test('select-bot rejects malformed UUID prefix characters', () => {
  preparePrefixManager();

  assert.throws(
    () => BotManager.resolveAuthorizedBotPrefix(OWNER, '--------'),
    (error) => error?.code === 'INVALID_BOT_ID'
  );
});
