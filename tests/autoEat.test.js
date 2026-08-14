'use strict';

const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const AutoEat = require('../src/bot/AutoEat');

function createBot(items = []) {
  const bot = new EventEmitter();
  bot.username = 'test-bot';
  bot.entity = { id: 1, username: bot.username };
  bot.food = 10;
  bot.inventory = new EventEmitter();
  bot.inventory.items = () => items;
  bot.equip = async () => {};
  bot.activateItem = () => {};
  bot.deactivateItem = () => {};
  return bot;
}

function createDisabledAutoEat(bot) {
  return new AutoEat(bot, 'auto-eat-test', () => {}, { enabled: false });
}

test('re-enables AutoEat when an inventory slot gains edible food', (t) => {
  const bot = createBot([{ name: 'bread', count: 1 }]);
  const autoEat = createDisabledAutoEat(bot);
  t.after(() => autoEat.stop());
  autoEat.start();

  bot.inventory.emit('updateSlot', 9, null, { name: 'bread', count: 1 });

  assert.strictEqual(autoEat.enabled, true);
});

test('does not re-enable AutoEat for a non-food update or food removal', (t) => {
  const bot = createBot();
  const autoEat = createDisabledAutoEat(bot);
  t.after(() => autoEat.stop());
  autoEat.start();

  bot.inventory.emit('updateSlot', 9, null, { name: 'cobblestone', count: 1 });
  assert.strictEqual(autoEat.enabled, false);

  bot.inventory.emit(
    'updateSlot',
    9,
    { name: 'bread', count: 2 },
    { name: 'bread', count: 1 }
  );
  assert.strictEqual(autoEat.enabled, false);
});

test('rechecks the inventory after the bot collects an item', async (t) => {
  const items = [];
  const bot = createBot(items);
  const autoEat = createDisabledAutoEat(bot);
  t.after(() => autoEat.stop());
  autoEat.start();

  items.push({ name: 'apple', count: 1 });
  bot.emit('playerCollect', bot.entity, { id: 2 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(autoEat.enabled, true);
});

test('removes collection and inventory listeners when stopped', () => {
  const bot = createBot();
  const autoEat = createDisabledAutoEat(bot);
  autoEat.start();
  autoEat.stop();

  bot.inventory.emit('updateSlot', 9, null, { name: 'bread', count: 1 });
  bot.emit('playerCollect', bot.entity, { id: 2 });

  assert.strictEqual(autoEat.enabled, false);
});
