'use strict';

const { afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const Persistence = require('../src/manager/Persistence');
const db = require('../src/config/database');

const originalWithTransaction = db.withTransaction;

function record(id = '11111111-1111-4111-8111-111111111111') {
  return {
    id,
    host: 'play.example.test',
    port: 25565,
    username: 'player',
    encryptedPassword: '',
    version: '1.20.4',
    autoReconnect: true,
    wasRunning: false,
    hidden: false,
    createdBy: 'owner-1',
    createdInGuild: 'guild-1',
  };
}

function resetPersistence() {
  Persistence._data = { bots: {}, userSelections: {} };
  Persistence._writeChain = Promise.resolve();
  Persistence._pending = 0;
}

function acceptingTransaction(task) {
  return task({ query: async () => ({ rows: [] }) });
}

afterEach(() => {
  db.withTransaction = originalWithTransaction;
  resetPersistence();
});

test('critical save rejects before mutating memory when the write queue is saturated', async () => {
  resetPersistence();
  Persistence._pending = 500;

  await assert.rejects(
    Persistence.saveBot(record()),
    (err) => err?.code === 'PERSISTENCE_QUEUE_FULL'
  );
  assert.equal(Persistence.getBot(record().id), null);
});

test('critical save rejects and rolls back in-memory state when its transaction fails', async () => {
  resetPersistence();
  db.withTransaction = async () => {
    throw new Error('database unavailable');
  };

  await assert.rejects(
    Persistence.saveBot(record()),
    (err) => err?.code === 'PERSISTENCE_WRITE_FAILED'
  );
  assert.equal(Persistence.getBot(record().id), null);
});

test('critical selection writes reject without persisting a foreign or stale selection on failure', async () => {
  resetPersistence();
  db.withTransaction = async () => {
    throw new Error('database unavailable');
  };

  await assert.rejects(
    Persistence.setUserSelection('owner-1', record().id),
    (err) => err?.code === 'PERSISTENCE_WRITE_FAILED'
  );
  assert.equal(Persistence.getUserSelection('owner-1'), null);
});

test('a failed critical write does not poison the ordered queue for a later write', async () => {
  resetPersistence();
  let failFirst = true;
  db.withTransaction = async (task) => {
    if (failFirst) {
      failFirst = false;
      throw new Error('transient database failure');
    }
    return acceptingTransaction(task);
  };

  await assert.rejects(
    Persistence.logActivity(record().id, 'created', 'owner-1'),
    (err) => err?.code === 'PERSISTENCE_WRITE_FAILED'
  );
  await assert.doesNotReject(
    Persistence.logActivity(record().id, 'created', 'owner-1')
  );
});

test('lifecycle transitions compensate the live bot state when durable state recording fails', async () => {
  const BotManager = require('../src/manager/BotManager');
  const previousBots = BotManager._bots;
  const originalUpdate = Persistence.updateBotStateWithActivity;
  const principal = { userId: 'owner-1', guildId: 'guild-1', roles: [] };
  const instance = {
    id: '11111111-1111-4111-8111-111111111111',
    record: { createdBy: 'owner-1', createdInGuild: 'guild-1' },
    starts: 0,
    stops: 0,
    async start() {
      this.starts += 1;
    },
    async stop() {
      this.stops += 1;
    },
  };

  BotManager._bots = new Map([[instance.id, instance]]);
  Persistence.updateBotStateWithActivity = async () => {
    throw new Error('database unavailable');
  };

  try {
    await assert.rejects(() => BotManager.startBot(principal, instance.id));
    assert.equal(instance.starts, 1);
    assert.equal(instance.stops, 1);

    instance.starts = 0;
    instance.stops = 0;
    await assert.rejects(() => BotManager.stopBot(principal, instance.id));
    assert.equal(instance.stops, 1);
    assert.equal(instance.starts, 1);
  } finally {
    BotManager._bots = previousBots;
    Persistence.updateBotStateWithActivity = originalUpdate;
  }
});
