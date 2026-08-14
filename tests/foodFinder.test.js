'use strict';

const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const FoodFinder = require('../src/services/foodFinder');

function position(x, y, z) {
  return {
    x,
    y,
    z,
    distanceTo(other) {
      return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
    },
    offset(dx, dy, dz) {
      return position(this.x + dx, this.y + dy, this.z + dz);
    },
  };
}

function solidBlock() {
  return { boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] };
}

function foodDrop(id, name, x, y, z) {
  return {
    id,
    name: 'item',
    position: position(x, y, z),
    getDroppedItem: () => ({ name, count: 1 }),
  };
}

function passiveMob(id, name, x, y, z) {
  return {
    id,
    type: 'mob',
    name,
    height: 1,
    position: position(x, y, z),
  };
}

function raycastWithSolidObstruction(shouldBlock) {
  return (origin, direction, _range, matcher) => {
    if (!shouldBlock(origin, direction)) return null;
    const iterator = { intersect: () => ({}) };
    const block = solidBlock();
    return matcher(block, iterator) ? block : null;
  };
}

function createBot(entities = {}, options = {}) {
  const bot = new EventEmitter();
  bot.entity = { id: 1, height: 1.62, position: position(0, 64, 0) };
  bot.entities = entities;
  bot.inventory = new EventEmitter();
  bot.inventory.items = () => [];
  bot.world = {
    raycast: options.raycast || (() => null),
  };
  bot.pathfinder = {
    gotoCalls: [],
    setGoalCalls: [],
    async goto(goal) {
      this.gotoCalls.push(goal);
      bot.entity.position = position(goal.x, goal.y, goal.z);
    },
    setGoal(goal) {
      this.setGoalCalls.push(goal);
    },
  };
  bot.attackCalls = [];
  bot.attack = (entity) => {
    bot.attackCalls.push(entity);
    options.onAttack?.(entity, bot);
  };
  bot.waitForTicks = options.waitForTicks || (async () => {});
  return bot;
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function nextTurns(count) {
  for (let index = 0; index < count; index += 1) await nextTurn();
}

test('navigates to the nearest visible dropped food when noFood is emitted', async (t) => {
  const bot = createBot({
    2: foodDrop(2, 'bread', 8, 64, 0),
    3: foodDrop(3, 'apple', 3, 64, 0),
    4: foodDrop(4, 'cobblestone', 1, 64, 0),
  });
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurn();

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 1);
  const [goal] = bot.pathfinder.gotoCalls;
  assert.strictEqual(goal.x, 3);
  assert.strictEqual(goal.y, 64);
  assert.strictEqual(goal.z, 0);
  assert.strictEqual(finder.isSearching, false);
});

test('ignores an occluded dropped food item in favor of a visible food item', async (t) => {
  const bot = createBot(
    {
      2: foodDrop(2, 'bread', 3, 64, 0),
      3: foodDrop(3, 'apple', 0, 64, 6),
    },
    {
      raycast: raycastWithSolidObstruction(
        (_eye, direction) => direction.x > 0.5
      ),
    }
  );
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurn();

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 1);
  const [goal] = bot.pathfinder.gotoCalls;
  assert.strictEqual(goal.x, 0);
  assert.strictEqual(goal.z, 6);
});

test('raycasts from the bot eye and rejects solid obstructions', async (t) => {
  let observedOrigin;
  const bot = createBot(
    { 2: foodDrop(2, 'bread', 3, 64, 0) },
    {
      raycast: raycastWithSolidObstruction((origin) => {
        observedOrigin = origin;
        return true;
      }),
    }
  );
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurn();

  assert.strictEqual(observedOrigin.x, 0);
  assert.strictEqual(observedOrigin.y, 65.62);
  assert.strictEqual(observedOrigin.z, 0);
  assert.strictEqual(bot.pathfinder.gotoCalls.length, 0);
});

test('does not navigate to non-food drops', async (t) => {
  const bot = createBot({
    2: foodDrop(2, 'cobblestone', 1, 64, 0),
  });
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurn();

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 0);
  assert.strictEqual(finder.isSearching, false);
});

test('hunts a visible passive food mob when no visible food drop is available', async (t) => {
  const cow = passiveMob(2, 'cow', 4, 64, 0);
  const bot = createBot(
    { 2: cow },
    {
      onAttack(entity, currentBot) {
        delete currentBot.entities[entity.id];
      },
    }
  );
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurns(4);

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 1);
  const [goal] = bot.pathfinder.gotoCalls;
  assert.strictEqual(goal.x, 4);
  assert.strictEqual(goal.y, 64);
  assert.strictEqual(goal.z, 0);
  assert.deepStrictEqual(bot.attackCalls, [cow]);
  assert.strictEqual(finder.isSearching, false);
});

test('re-approaches a visible food mob that moves during navigation', async (t) => {
  const cow = passiveMob(2, 'cow', 4, 64, 0);
  const bot = createBot(
    { 2: cow },
    {
      onAttack(entity, currentBot) {
        delete currentBot.entities[entity.id];
      },
    }
  );
  let navigationCount = 0;
  bot.pathfinder.goto = async (goal) => {
    bot.pathfinder.gotoCalls.push(goal);
    bot.entity.position = position(goal.x, goal.y, goal.z);
    navigationCount += 1;
    if (navigationCount === 1) cow.position = position(10, 64, 0);
  };
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurns(5);

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 2);
  assert.deepStrictEqual(bot.attackCalls, [cow]);
});

test('stops hunting a mob that moves beyond the search radius', async (t) => {
  const cow = passiveMob(2, 'cow', 4, 64, 0);
  const bot = createBot(
    { 2: cow },
    {
      onAttack(entity, currentBot) {
        delete currentBot.entities[entity.id];
      },
    }
  );
  const originalGoto = bot.pathfinder.goto;
  bot.pathfinder.goto = async (goal) => {
    await originalGoto.call(bot.pathfinder, goal);
    cow.position = position(29, 64, 0);
  };
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurns(4);

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 1);
  assert.strictEqual(bot.attackCalls.length, 0);
  assert.strictEqual(finder.isSearching, false);
});

test('does not hunt an occluded passive food mob', async (t) => {
  const bot = createBot(
    { 2: passiveMob(2, 'cow', 4, 64, 0) },
    { raycast: () => solidBlock() }
  );
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurns(3);

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 0);
  assert.strictEqual(bot.attackCalls.length, 0);
});

test('does not hunt mobs outside the passive food allow-list', async (t) => {
  const bot = createBot({ 2: passiveMob(2, 'zombie', 4, 64, 0) });
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurns(3);

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 0);
  assert.strictEqual(bot.attackCalls.length, 0);
});

test('returns to visible dropped-food pickup after a hunted mob is defeated', async (t) => {
  const cow = passiveMob(2, 'cow', 4, 64, 0);
  const bot = createBot(
    { 2: cow },
    {
      onAttack(entity, currentBot) {
        delete currentBot.entities[entity.id];
        currentBot.entities[3] = foodDrop(3, 'cooked_beef', 4, 64, 0);
        currentBot.emit('itemDrop', currentBot.entities[3]);
      },
    }
  );
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurns(5);

  assert.strictEqual(bot.attackCalls.length, 1);
  assert.strictEqual(bot.pathfinder.gotoCalls.length, 2);
  const [, pickupGoal] = bot.pathfinder.gotoCalls;
  assert.strictEqual(pickupGoal.x, 4);
  assert.strictEqual(pickupGoal.y, 64);
  assert.strictEqual(pickupGoal.z, 0);
});

test('does not attack a mob if LOS is blocked after navigation completes', async (t) => {
  const cow = passiveMob(2, 'cow', 4, 64, 0);
  let raycastCalls = 0;
  const bot = createBot(
    { 2: cow },
    {
      raycast: () => {
        raycastCalls += 1;
        return raycastCalls > 2 ? solidBlock() : null;
      },
    }
  );
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurns(4);

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 1);
  assert.strictEqual(bot.attackCalls.length, 0);
});

test('does not overlap food searches while an earlier navigation is in progress', async (t) => {
  const bot = createBot({
    2: foodDrop(2, 'bread', 3, 64, 0),
  });
  let resolveNavigation;
  bot.pathfinder.goto = (goal) => {
    bot.pathfinder.gotoCalls.push(goal);
    return new Promise((resolve) => {
      resolveNavigation = resolve;
    });
  };
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurn();
  finder.onNoFood();

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 1);
  assert.strictEqual(finder.isSearching, true);

  resolveNavigation();
  await nextTurn();
  assert.strictEqual(finder.isSearching, false);
});

test('cancels an active food search when food enters the inventory', async (t) => {
  const bot = createBot({
    2: foodDrop(2, 'bread', 3, 64, 0),
  });
  let resolveNavigation;
  bot.pathfinder.goto = (goal) => {
    bot.pathfinder.gotoCalls.push(goal);
    return new Promise((resolve) => {
      resolveNavigation = resolve;
    });
  };
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurn();
  bot.inventory.emit('updateSlot', 9, null, { name: 'bread', count: 1 });

  assert.strictEqual(bot.pathfinder.setGoalCalls.length, 1);
  assert.strictEqual(bot.pathfinder.setGoalCalls[0], null);
  assert.strictEqual(finder.isSearching, false);

  resolveNavigation();
  await nextTurn();
});

test('does not react to no-food requests after it is stopped', async () => {
  const bot = createBot({
    2: foodDrop(2, 'bread', 3, 64, 0),
  });
  const finder = new FoodFinder(bot, 'food-finder-test');
  finder.start();
  finder.stop();

  finder.onNoFood();
  await nextTurn();

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 0);
});

test('resumes a pending food search after a temporary stop', async (t) => {
  const bot = createBot();
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurn();
  finder.stop();
  bot.entities[2] = foodDrop(2, 'bread', 3, 64, 0);
  finder.start();
  await nextTurn();

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 1);
});

test('searches when edible food drops after a no-food request', async (t) => {
  const bot = createBot();
  const finder = new FoodFinder(bot, 'food-finder-test');
  t.after(() => finder.stop());
  finder.start();

  finder.onNoFood();
  await nextTurn();
  bot.entities[2] = foodDrop(2, 'bread', 3, 64, 0);
  bot.emit('itemDrop', bot.entities[2]);
  await nextTurn();

  assert.strictEqual(bot.pathfinder.gotoCalls.length, 1);
});
