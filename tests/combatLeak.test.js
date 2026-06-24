'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  projectRoot,
  installTimerTracker,
  stubExternal,
  stubLogger,
  fakePathfinder,
  makeCombatBot,
  makePhantom,
  makeZombie,
} = require('./support/leakKit');

// Stub the uninstalled native dep + the winston-backed logger BEFORE requiring
// the real Combat module, then load the genuine implementation under test.
stubExternal({ 'mineflayer-pathfinder': fakePathfinder() });
stubLogger();
const Combat = require(path.join(projectRoot(), 'src/bot/Combat.js'));

const noop = () => {};

/**
 * Regression suite for the combat-driven memory leak / CPU spike. These tests
 * assert the things that previously blew up: leaked intervals across combat
 * cycles, un-throttled flee re-pathing, and ticking against a dead entity.
 */

test('stop() leaves zero live timers across many start/combat/stop cycles', () => {
  const tt = installTimerTracker();
  try {
    const baseline = tt.liveCount();
    for (let i = 0; i < 200; i++) {
      const bot = makeCombatBot();
      const combat = new Combat(bot, 'leak-1', noop);
      combat.startScanning(); // arms scanner interval
      const zombie = makeZombie();
      bot.entities[zombie.id] = zombie;
      combat._startCombat(zombie); // arms attack loop + target timeout
      combat._tick(); // exercise the hot path
      combat.stop(); // must clear EVERYTHING
      assert.strictEqual(
        tt.liveCount(),
        baseline,
        `live timers leaked after stop() on cycle ${i} (got ${tt.liveCount()})`,
      );
    }
  } finally {
    tt.restore();
  }
});

test('startScanning() is idempotent (no duplicate scanner interval)', () => {
  const tt = installTimerTracker();
  try {
    const bot = makeCombatBot();
    const combat = new Combat(bot, 'leak-2', noop);
    const before = tt.liveCount();
    combat.startScanning();
    combat.startScanning();
    combat.startScanning();
    assert.strictEqual(tt.liveCount(), before + 1, 'scanner interval was duplicated');
    combat.stop();
    assert.strictEqual(tt.liveCount(), before);
  } finally {
    tt.restore();
  }
});

test('_startCombat() cannot stack a second attack loop (re-entrancy guard)', () => {
  const tt = installTimerTracker();
  try {
    const bot = makeCombatBot();
    const combat = new Combat(bot, 'leak-3', noop);
    const zombie = makeZombie();
    bot.entities[zombie.id] = zombie;
    const before = tt.liveCount();
    combat._startCombat(zombie);
    const afterFirst = tt.liveCount();
    combat._startCombat(zombie); // ignored – already active
    combat._startCombat(zombie);
    assert.strictEqual(tt.liveCount(), afterFirst, 'attack loop / timeout were duplicated');
    combat.stop();
    assert.strictEqual(tt.liveCount(), before);
  } finally {
    tt.restore();
  }
});

test('_fleeFrom is throttled under a burst of onAttacked calls (CPU spike fix)', () => {
  const tt = installTimerTracker();
  try {
    const bot = makeCombatBot();
    const combat = new Combat(bot, 'leak-4', noop);
    combat.startScanning();

    const phantom = makePhantom(2, 70);
    bot.entities[phantom.id] = phantom;

    // Enter combat then drop to low HP so the next tick triggers a retreat,
    // which sets the retreat cooldown and issues exactly one flee goal.
    combat._startCombat(phantom);
    bot.health = 4; // 20% of 20 < RETREAT_HP_PCT (0.3)
    combat._tick();
    const afterRetreat = bot._setGoalCalls.length;

    // Simulate phantom hammering the bot many times per second. Without the
    // throttle each call would issue a fresh setGoal and pin a CPU core.
    for (let i = 0; i < 500; i++) combat.onAttacked();

    const issuedDuringBurst = bot._setGoalCalls.length - afterRetreat;
    assert.ok(
      issuedDuringBurst <= 1,
      `flee re-path not throttled: ${issuedDuringBurst} setGoal calls during a 500-hit burst`,
    );

    combat.stop();
    assert.strictEqual(tt.liveCount(), 0, 'timers leaked after retreat + burst');
  } finally {
    tt.restore();
  }
});

test('_tick() is safe and self-terminating when the bot entity disappears (death)', () => {
  const tt = installTimerTracker();
  try {
    const bot = makeCombatBot();
    const combat = new Combat(bot, 'leak-5', noop);
    const zombie = makeZombie();
    bot.entities[zombie.id] = zombie;
    combat._startCombat(zombie);

    // Bot dies mid-combat: entity becomes null. A tick must not throw and must
    // end combat (clearing its interval) instead of spinning forever.
    bot.entity = null;
    assert.doesNotThrow(() => combat._tick());
    assert.strictEqual(combat.isActive, false, 'combat did not end after entity loss');
    assert.strictEqual(tt.liveCount(), 0, 'attack loop kept running after entity loss');
  } finally {
    tt.restore();
  }
});

test('_tick() ends combat when the target entity is removed', () => {
  const tt = installTimerTracker();
  try {
    const bot = makeCombatBot();
    const combat = new Combat(bot, 'leak-6', noop);
    const zombie = makeZombie();
    bot.entities[zombie.id] = zombie;
    combat._startCombat(zombie);
    delete bot.entities[zombie.id]; // target despawned
    assert.doesNotThrow(() => combat._tick());
    assert.strictEqual(combat.isActive, false);
    assert.strictEqual(tt.liveCount(), 0);
  } finally {
    tt.restore();
  }
});

test('stop() cancels the active pathfinder goal', () => {
  const tt = installTimerTracker();
  try {
    const bot = makeCombatBot();
    const combat = new Combat(bot, 'leak-7', noop);
    const zombie = makeZombie(3, 8); // far enough to trigger a follow goal
    bot.entities[zombie.id] = zombie;
    combat._startCombat(zombie);
    combat._tick(); // issues a GoalFollow
    combat.stop();
    const last = bot._setGoalCalls[bot._setGoalCalls.length - 1];
    assert.strictEqual(last, null, 'stop() did not call pathfinder.setGoal(null)');
  } finally {
    tt.restore();
  }
});

test('high-frequency death/retreat cycling does not accumulate timers', () => {
  const tt = installTimerTracker();
  try {
    const bot = makeCombatBot();
    const combat = new Combat(bot, 'leak-8', noop);
    combat.startScanning();
    const phantom = makePhantom(2, 70);
    bot.entities[phantom.id] = phantom;

    for (let i = 0; i < 300; i++) {
      bot.health = 20;
      combat._startCombat(phantom);
      bot.health = 3; // force retreat next tick
      combat._tick();
      for (let j = 0; j < 20; j++) combat.onAttacked(); // damage flood
    }
    // Only the scanner interval should remain after all the churn.
    assert.strictEqual(tt.liveCount(), 1, `expected only scanner interval, got ${tt.liveCount()}`);
    combat.stop();
    assert.strictEqual(tt.liveCount(), 0);
  } finally {
    tt.restore();
  }
});
