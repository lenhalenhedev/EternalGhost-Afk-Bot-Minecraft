'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const manager = require('../src/manager/BotManager');
const Persistence = require('../src/manager/Persistence');

const OWNER = Object.freeze({
  userId: 'owner-1',
  guildId: 'guild-1',
  roles: [],
});
const OTHER_MANAGER = Object.freeze({
  userId: 'manager-2',
  guildId: 'guild-1',
  roles: [],
});
const BOT_ID = '11111111-1111-4111-8111-111111111111';

function prepareManager() {
  manager._bots.clear();
  manager._bots.set(BOT_ID, {
    id: BOT_ID,
    record: {
      id: BOT_ID,
      createdBy: OWNER.userId,
      username: 'OwnerBot',
      host: 'play.example.net',
      port: 25565,
    },
  });
  return manager;
}

test('BotManager returns a bot only to its owner when given its canonical UUID', () => {
  const manager = prepareManager();

  const instance = manager.resolveAuthorizedBot(OWNER, BOT_ID, {
    allowSelection: false,
    purpose: 'status',
  });

  assert.equal(instance.id, BOT_ID);
});

test('BotManager fails closed without revealing a bot to an unrelated allowlisted manager', () => {
  const manager = prepareManager();

  assert.throws(
    () =>
      manager.resolveAuthorizedBot(OTHER_MANAGER, BOT_ID, {
        allowSelection: false,
        purpose: 'edit',
      }),
    (error) =>
      error?.code === 'RESOURCE_ACCESS_DENIED' &&
      error.message === 'Bot not found or access denied.'
  );
});

test('BotManager rejects a UUID prefix rather than selecting the first matching bot', () => {
  const manager = prepareManager();

  assert.throws(
    () =>
      manager.resolveAuthorizedBot(OWNER, BOT_ID.slice(0, 8), {
        allowSelection: false,
        purpose: 'delete',
      }),
    (error) => error?.code === 'INVALID_BOT_ID'
  );
});

test('BotManager rejects a malformed principal before resolving a resource', () => {
  const manager = prepareManager();

  assert.throws(
    () =>
      manager.resolveAuthorizedBot(
        { userId: '', guildId: 'guild-1', roles: [] },
        BOT_ID,
        {
          allowSelection: false,
          purpose: 'logs',
        }
      ),
    (error) => error?.code === 'INVALID_PRINCIPAL'
  );
});

test('BotManager lists only records owned by the authenticated principal', () => {
  const manager = prepareManager();
  manager._bots.set('22222222-2222-4222-8222-222222222222', {
    id: '22222222-2222-4222-8222-222222222222',
    record: {
      id: '22222222-2222-4222-8222-222222222222',
      createdBy: OTHER_MANAGER.userId,
      username: 'OtherBot',
    },
  });

  const bots = manager.listAuthorizedBots(OWNER);

  assert.deepEqual(
    bots.map((bot) => bot.id),
    [BOT_ID]
  );
});

test('BotManager applies guild provenance when a bot record has a creation guild', () => {
  const manager = prepareManager();
  manager._bots.get(BOT_ID).record.createdInGuild = 'guild-1';

  assert.throws(
    () =>
      manager.resolveAuthorizedBot(
        { userId: OWNER.userId, guildId: 'guild-2', roles: [] },
        BOT_ID,
        { allowSelection: false }
      ),
    (error) => error?.code === 'RESOURCE_ACCESS_DENIED'
  );
});

test('BotManager rejects a foreign legacy selection with the same generic denial', () => {
  const manager = prepareManager();
  const originalGetUserSelection = Persistence.getUserSelection;
  Persistence.getUserSelection = () => BOT_ID;

  try {
    assert.throws(
      () =>
        manager.resolveAuthorizedBot(OTHER_MANAGER, null, {
          allowSelection: true,
        }),
      (error) =>
        error?.code === 'RESOURCE_ACCESS_DENIED' &&
        error.message === 'Bot not found or access denied.'
    );
  } finally {
    Persistence.getUserSelection = originalGetUserSelection;
  }
});

test('BotManager does not expose legacy global resource getters that bypass principal authorization', () => {
  assert.equal(typeof manager.getBot, 'undefined');
  assert.equal(typeof manager.getAllBots, 'undefined');
  assert.equal(typeof manager._getBotOrThrow, 'undefined');
});
