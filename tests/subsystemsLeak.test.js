'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { projectRoot, installTimerTracker, stubResolved } = require('./support/leakKit');

/**
 * The core leak fix lives in Subsystems.startAFK / startPlaying: they must stop
 * any previous instance before creating a replacement, otherwise a respawn (or a
 * death during the settle window) orphans the old subsystem's interval timers,
 * compounding on every death until a CPU core pins and RAM bloats.
 *
 * We inject lightweight fakes for the four heavy subsystems (each registers a
 * real, tracked interval on start and clears it on stop) and load the GENUINE
 * Subsystems wiring to assert the idempotency contract by counting live timers.
 */

function makeTimerSubsystem() {
  return class {
    constructor() {
      this._t = null;
    }
    _arm() {
      if (!this._t) this._t = setInterval(() => {}, 1_000_000);
    }
    start() {
      this._arm();
    }
    startScanning() {
      this._arm();
    }
    stop() {
      clearInterval(this._t);
      this._t = null;
    }
    // no-op hooks used by enterCombat/exitCombat
    pauseForCombat() {}
    resumeAfterCombat() {}
    setCombat() {}
  };
}

// Inventory has no timers; it must still be constructible and never leak.
class FakeInventory {
  constructor() {}
  async checkAndClean() {}
}

const root = projectRoot();
stubResolved(path.join(root, 'src/bot/AntiAFK.js'), makeTimerSubsystem());
stubResolved(path.join(root, 'src/bot/Combat.js'), makeTimerSubsystem());
stubResolved(path.join(root, 'src/bot/AutoEat.js'), makeTimerSubsystem());
stubResolved(path.join(root, 'src/bot/Inventory.js'), FakeInventory);
const Subsystems = require(path.join(root, 'src/bot/subsystems.js'));

const fakeBot = {};
const emit = () => {};

test('repeated startAFK across respawns does not accumulate interval timers', () => {
  const tt = installTimerTracker();
  try {
    const sub = new Subsystems('respawn-1');
    for (let i = 0; i < 100; i++) {
      sub.startAFK(fakeBot, emit); // simulate a respawn -> AFK each loop
      // One AntiAFK interval + one Combat interval == exactly 2, never growing.
      assert.strictEqual(tt.liveCount(), 2, `timers accumulated on respawn ${i} (got ${tt.liveCount()})`);
    }
    sub.stopAll();
    assert.strictEqual(tt.liveCount(), 0, 'stopAll() failed to release subsystem timers');
  } finally {
    tt.restore();
  }
});

test('two startAFK calls with no intervening stop (settle-timer race) stay bounded', () => {
  const tt = installTimerTracker();
  try {
    const sub = new Subsystems('respawn-2');
    // This is the exact double-call the death-during-settle bug produced.
    sub.startAFK(fakeBot, emit);
    sub.startAFK(fakeBot, emit);
    assert.strictEqual(tt.liveCount(), 2, 'a redundant startAFK orphaned the previous timers');
    sub.stopAll();
    assert.strictEqual(tt.liveCount(), 0);
  } finally {
    tt.restore();
  }
});

test('repeated startPlaying does not accumulate auto-eat timers', () => {
  const tt = installTimerTracker();
  try {
    const sub = new Subsystems('respawn-3');
    for (let i = 0; i < 100; i++) {
      sub.startPlaying(fakeBot, emit);
      assert.strictEqual(tt.liveCount(), 1, `auto-eat timer leaked on cycle ${i}`);
    }
    sub.stopAll();
    assert.strictEqual(tt.liveCount(), 0);
  } finally {
    tt.restore();
  }
});

test('full PLAYING -> AFK lifecycle churn returns to zero timers', () => {
  const tt = installTimerTracker();
  try {
    const sub = new Subsystems('respawn-4');
    for (let i = 0; i < 250; i++) {
      sub.startPlaying(fakeBot, emit); // connect -> PLAYING
      sub.startAFK(fakeBot, emit); // settle -> AFK
      sub.enterCombat(); // mob appears
      sub.exitCombat(); // combat ends
      // playing(autoEat)=1 + antiAFK=1 + combat=1 == 3, stable across the loop.
      assert.strictEqual(tt.liveCount(), 3, `timer drift detected on iteration ${i}: ${tt.liveCount()}`);
    }
    sub.stopAll();
    assert.strictEqual(tt.liveCount(), 0, 'subsystem timers survived stopAll()');
  } finally {
    tt.restore();
  }
});
