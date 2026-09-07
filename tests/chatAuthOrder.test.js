'use strict';

process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.ADMIN_USER_IDS ||= '123456789012345678';
process.env.DISCORD_TOKEN ||= 'test-discord-token';
process.env.DISCORD_CLIENT_ID ||= 'test-discord-client';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const manager = require('../src/manager/BotManager');

const CALLER = Object.freeze({
  userId: '999000000000000001',
  guildId: null,
  roles: [],
});
const OTHER = Object.freeze({
  userId: '999000000000000002',
  guildId: null,
  roles: [],
});

const MY_BOT = '11111111-1111-4111-8111-111111111111';
const FOREIGN_BOT = '22222222-2222-4222-8222-222222222222';

function prepare() {
  manager._bots.clear();
  const sent = [];
  manager._bots.set(MY_BOT, {
    id: MY_BOT,
    record: { id: MY_BOT, createdBy: CALLER.userId },
    sendInput: async () => {
      sent.push(MY_BOT);
    },
  });
  manager._bots.set(FOREIGN_BOT, {
    id: FOREIGN_BOT,
    record: { id: FOREIGN_BOT, createdBy: OTHER.userId },
    sendInput: async () => {
      sent.push(FOREIGN_BOT);
    },
  });
  return { sent };
}

test('EG-009: a chat attempt against a foreign bot is denied without consuming the caller cooldown', async () => {
  const { sent } = prepare();

  await assert.rejects(
    () => manager.chatBot(CALLER, FOREIGN_BOT, 'hello'),
    (error) => error?.code === 'RESOURCE_ACCESS_DENIED'
  );

  // Because authorization happens first, the denied request left the caller's
  // cooldown untouched, so an immediate legitimate chat to their own bot must
  // be allowed (not RATE_LIMITED).
  await manager.chatBot(CALLER, MY_BOT, 'hello');

  assert.deepEqual(sent, [MY_BOT]);
});
