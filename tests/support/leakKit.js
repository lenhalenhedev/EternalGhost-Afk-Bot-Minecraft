'use strict';

/**
 * Shared test instrumentation for the memory-leak / CPU-spike defensive suite.
 *
 * This file deliberately has NO `.test.js` suffix and lives under tests/support/
 * so the `node --test` runner does not execute it as a test.
 *
 * It provides:
 *   - a live-timer tracker (patches the global timer functions and counts
 *     un-cleared setInterval/setTimeout handles) to catch interval leaks,
 *   - a `Module._load` shim to stub uninstalled native deps (mineflayer-
 *     pathfinder, vec3, …) by request string,
 *   - a require.cache stub for resolvable project modules (e.g. the winston-
 *     backed logger) so heavy/external requires never execute,
 *   - a tiny vector class + fake mineflayer bot used by the Combat tests.
 */

const path = require('path');
const Module = require('module');

function projectRoot() {
  return path.resolve(__dirname, '..', '..');
}

// ─────────────────────────────── Timer tracking ────────────────────────────────
/**
 * Install counters over the global timer functions. Returns a handle exposing
 * `liveCount()` (currently un-cleared interval+timeout handles) and `restore()`.
 *
 * Created handles are `unref()`-ed so a *leaked* timer (the thing we are testing
 * for) can never keep the test process alive and hang CI.
 */
function installTimerTracker() {
  const live = new Set();
  const orig = {
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
  };

  global.setInterval = (fn, ms, ...args) => {
    const handle = orig.setInterval(fn, ms, ...args);
    if (handle && typeof handle.unref === 'function') handle.unref();
    live.add(handle);
    return handle;
  };
  global.clearInterval = (handle) => {
    if (handle != null) live.delete(handle);
    return orig.clearInterval(handle);
  };
  global.setTimeout = (fn, ms, ...args) => {
    let handle;
    handle = orig.setTimeout(
      (...inner) => {
        live.delete(handle); // a fired timeout is no longer "live"
        if (typeof fn === 'function') fn(...inner);
      },
      ms,
      ...args,
    );
    if (handle && typeof handle.unref === 'function') handle.unref();
    live.add(handle);
    return handle;
  };
  global.clearTimeout = (handle) => {
    if (handle != null) live.delete(handle);
    return orig.clearTimeout(handle);
  };

  return {
    liveCount: () => live.size,
    restore: () => {
      // Clear anything still outstanding so a failing assertion doesn't leave
      // real timers behind, then restore the originals.
      for (const handle of live) {
        orig.clearInterval(handle);
        orig.clearTimeout(handle);
      }
      live.clear();
      Object.assign(global, orig);
    },
  };
}

// ────────────────────────────── Module stubbing ───────────────────────────────
/**
 * Intercept `require(request)` for uninstalled / external packages by exact
 * request string. Returns a restore function.
 */
function stubExternal(map) {
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(map, request)) return map[request];
    return origLoad.call(this, request, parent, isMain);
  };
  return () => {
    Module._load = origLoad;
  };
}

/** Pre-populate the require cache for a resolvable project file with a stub. */
function stubResolved(absPath, exportsObj) {
  const resolved = require.resolve(absPath);
  const m = new Module(resolved, null);
  m.filename = resolved;
  m.loaded = true;
  m.exports = exportsObj;
  require.cache[resolved] = m;
  return () => {
    delete require.cache[resolved];
  };
}

/** Stub the winston-backed logger so requiring combat code doesn't pull winston. */
function stubLogger() {
  const noop = () => {};
  return stubResolved(path.join(projectRoot(), 'src/services/logger.js'), {
    botLog: noop,
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    checkAlertCooldown: () => true,
  });
}

/** Minimal fake of the `mineflayer-pathfinder` package surface used by Combat/AntiAFK. */
function fakePathfinder() {
  class GoalFollow {
    constructor(entity, range) {
      this.entity = entity;
      this.range = range;
    }
  }
  class GoalNear {
    constructor(x, y, z, range) {
      Object.assign(this, { x, y, z, range });
    }
  }
  class GoalBlock {}
  class GoalInvert {}
  class Movements {
    constructor() {}
  }
  return {
    pathfinder: { name: 'pathfinder' },
    Movements,
    goals: { GoalFollow, GoalNear, GoalBlock, GoalInvert },
  };
}

// ────────────────────────── Fake bot + vectors ─────────────────────────────
/** Vector supporting exactly the ops Combat performs in `_fleeFrom`/`_tick`. */
class Vec {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  distanceTo(o) {
    const dx = this.x - o.x;
    const dy = this.y - o.y;
    const dz = this.z - o.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  minus(o) {
    return new Vec(this.x - o.x, this.y - o.y, this.z - o.z);
  }
  plus(o) {
    return new Vec(this.x + o.x, this.y + o.y, this.z + o.z);
  }
  scaled(s) {
    return new Vec(this.x * s, this.y * s, this.z * s);
  }
  norm() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  normalize() {
    const n = this.norm() || 1;
    return new Vec(this.x / n, this.y / n, this.z / n);
  }
  clone() {
    return new Vec(this.x, this.y, this.z);
  }
}

/**
 * Build a fake mineflayer bot for Combat tests. `setGoal` calls are recorded so
 * a test can assert pathfinding is throttled (and that stop() cancels the goal).
 */
function makeCombatBot() {
  const setGoalCalls = [];
  const bot = {
    health: 20,
    food: 20,
    entities: {},
    inventory: { slots: [] },
    player: { entity: { attributes: {} } },
    entity: { id: 1, position: new Vec(0, 64, 0) },
    attackCount: 0,
    attack() {
      bot.attackCount += 1;
    },
    setQuickBarSlot() {},
    pathfinder: {
      setGoal(goal) {
        setGoalCalls.push(goal);
      },
      setMovements() {},
      goto: async () => {},
    },
  };
  bot._setGoalCalls = setGoalCalls;
  return bot;
}

/** A whitelisted flying mob (phantom) at a vertical offset above the bot. */
function makePhantom(id = 2, y = 70) {
  return {
    id,
    type: 'mob',
    displayName: 'Phantom',
    name: 'phantom',
    invisible: false,
    metadata: [],
    position: new Vec(0, y, 0),
  };
}

/** A whitelisted ground mob (zombie) within melee reach. */
function makeZombie(id = 3, dist = 2) {
  return {
    id,
    type: 'mob',
    displayName: 'Zombie',
    name: 'zombie',
    invisible: false,
    metadata: [],
    position: new Vec(dist, 64, 0),
  };
}

module.exports = {
  projectRoot,
  installTimerTracker,
  stubExternal,
  stubResolved,
  stubLogger,
  fakePathfinder,
  Vec,
  makeCombatBot,
  makePhantom,
  makeZombie,
};
