'use strict';

const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');

const { projectRoot, stubResolved } = require('./support/leakKit');

class FakeInventory {
  constructor() {}
}

class FakeAutoEat {
  constructor(_bot, _botId, emit) {
    this._emit = emit;
  }

  start() {}

  stop() {}

  setCombat() {}

  reportNoFood() {
    this._emit('noFood');
  }
}

class FakeFoodFinder {
  constructor() {
    this.startCalls = 0;
    this.stopCalls = 0;
    this.noFoodCalls = 0;
    FakeFoodFinder.lastInstance = this;
  }

  start() {
    this.startCalls += 1;
  }

  stop() {
    this.stopCalls += 1;
  }

  onNoFood() {
    this.noFoodCalls += 1;
  }
}

const root = projectRoot();
stubResolved(path.join(root, 'src/bot/AutoEat.js'), FakeAutoEat);
stubResolved(path.join(root, 'src/bot/Inventory.js'), FakeInventory);
stubResolved(path.join(root, 'src/services/foodFinder.js'), FakeFoodFinder);
const Subsystems = require(path.join(root, 'src/bot/subsystems.js'));

test('forwards AutoEat noFood to the emitted event and FoodFinder', () => {
  const emitted = [];
  const subsystems = new Subsystems('food-finder-integration');
  subsystems.startPlaying({}, (event) => emitted.push(event));

  subsystems.autoEat.reportNoFood();

  assert.deepStrictEqual(emitted, ['noFood']);
  assert.strictEqual(FakeFoodFinder.lastInstance.noFoodCalls, 1);
  assert.strictEqual(FakeFoodFinder.lastInstance.startCalls, 1);

  subsystems.enterCombat();
  assert.strictEqual(FakeFoodFinder.lastInstance.stopCalls, 1);

  subsystems.exitCombat();
  assert.strictEqual(FakeFoodFinder.lastInstance.startCalls, 2);
  subsystems.stopAll();
});
