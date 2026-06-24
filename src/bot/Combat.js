'use strict';

const { goals } = require('mineflayer-pathfinder');
const { botLog } = require('../services/logger');
const { ATTACK_WHITELIST, COMBAT } = require('./combat/combatConfig');
const { equipBestWeapon } = require('./combat/weapons');

/**
 * Reactive melee combat for a single bot. Scans for whitelisted hostile mobs
 * while AFK and engages them with the best available weapon. Tuning constants
 * and weapon scoring live in `./combat/*` (single responsibility / testable).
 */

// ─── Local tuning for flying/ranged threat handling ─────────────────────────
// Flying mobs (phantoms especially) attack from above where melee can't reach.
// Naively chasing them or instantly re-engaging after a retreat causes a fatal
// chain-kill loop, so they get dedicated engagement + retreat rules below.
const FLYING_MOBS = new Set(['phantom', 'vex', 'ghast', 'blaze', 'bee']);
const VERTICAL_ENGAGE_LIMIT = 3; // blocks above us we can still melee
const RETREAT_DISTANCE = 12; // blocks to flee from a threat
const RETREAT_COOLDOWN_MS = 5_000; // suppress re-engage after a ground retreat
const FLYING_RETREAT_COOLDOWN_MS = 10_000; // longer cooldown for flyers (no melee)

class Combat {
  constructor(bot, botId, emit) {
    this.bot = bot;
    this.botId = botId;
    this._emit = emit; // emit('combatStart'|'combatEnd'|'retreat')
    this._active = false;
    this._target = null;
    this._scanner = null;
    this._attackLoop = null;
    this._targetTimeout = null;
    this._combatStart = 0;
    this._invisibleSince = new Map(); // entityId -> firstInvisibleTs
    this._retreatUntil = 0; // ts until which re-engagement is suppressed
  }

  /** Begin scanning for hostile mobs. Call when bot enters AFK state. */
  startScanning() {
    if (this._scanner) return;
    this._scanner = setInterval(() => this._scan(), COMBAT.SCAN_INTERVAL);
  }

  stopScanning() {
    clearInterval(this._scanner);
    this._scanner = null;
  }

  _scan() {
    if (this._active || this._inRetreatCooldown()) return;
    const target = this._findTarget();
    if (target) this._startCombat(target);
  }

  /** Canonical lower_snake mob name. Uses displayName/name (mobType is deprecated). */
  _mobName(entity) {
    const raw = entity?.displayName || entity?.name || '';
    return raw.toLowerCase().replace(/ /g, '_');
  }

  _isFlying(entity) {
    return FLYING_MOBS.has(this._mobName(entity));
  }

  _inRetreatCooldown() {
    return Date.now() < this._retreatUntil;
  }

  _findTarget() {
    const bot = this.bot;
    const pos = bot.entity.position;
    let nearest = null;
    let minDist = COMBAT.SCAN_RANGE + 1;

    for (const entity of Object.values(bot.entities)) {
      if (!entity || entity.id === bot.entity.id) continue;
      if (entity.type !== 'mob') continue;
      const mobType = this._mobName(entity);
      if (!ATTACK_WHITELIST.has(mobType)) continue;

      const dist = pos.distanceTo(entity.position);
      if (dist < minDist) {
        minDist = dist;
        nearest = entity;
      }
    }
    return nearest;
  }

  _startCombat(entity) {
    this._active = true;
    this._target = entity;
    this._combatStart = Date.now();
    botLog(
      this.botId,
      'info',
      `Combat started vs ${this._mobName(entity)} (dist: ${this.bot.entity.position.distanceTo(entity.position).toFixed(1)})`,
    );
    this._emit('combatStart', entity);
    this._attackLoop = setInterval(() => this._tick(), COMBAT.ATTACK_INTERVAL);

    equipBestWeapon(this.bot);

    // Hard timeout per target. Tracked so it can be cleared on early combat end
    // (previously this timer leaked when combat ended for another reason).
    this._targetTimeout = setTimeout(() => {
      if (this._active && this._target === entity) this._endCombat('timeout');
    }, COMBAT.MAX_COMBAT_DURATION);
  }

  _tick() {
    if (!this._active || !this._target) return;

    const bot = this.bot;
    const entity = this._target;

    // Entity gone / dead.
    if (!bot.entities[entity.id] || entity.metadata?.[0]?.value === 1) {
      return this._endCombat('target dead or gone');
    }

    // Invisible too long.
    const firstInvisible = this._invisibleSince.get(entity.id);
    if (entity.invisible) {
      if (!firstInvisible) {
        this._invisibleSince.set(entity.id, Date.now());
      } else if (Date.now() - firstInvisible > COMBAT.INVISIBLE_TIMEOUT) {
        return this._endCombat('target invisible too long');
      }
    } else {
      this._invisibleSince.delete(entity.id);
    }

    // Retreat if low HP. Flying threats get an active flee + longer suppression
    // window so the bot relocates instead of being instantly re-engaged.
    const maxHp = bot.player?.entity?.attributes?.['minecraft:generic.max_health']?.value || 20;
    if (bot.health / maxHp < COMBAT.RETREAT_HP_PCT) {
      return this._retreat(entity);
    }

    // Out of range.
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > COMBAT.SCAN_RANGE) return this._endCombat('out of range');

    const verticalGap = entity.position.y - bot.entity.position.y;

    // Attack when genuinely within reach, otherwise approach. A high-flying mob
    // (e.g. a circling phantom) can't be meleed: don't burn the engagement
    // pathing toward an unreachable target — hold position and wait for it to
    // dive into ENGAGE_RANGE. The per-target timeout still bounds this.
    if (dist <= COMBAT.ENGAGE_RANGE && verticalGap <= VERTICAL_ENGAGE_LIMIT) {
      try {
        bot.attack(entity);
      } catch (_) {
        /* entity might have disappeared */
      }
    } else if (this._isFlying(entity) && verticalGap > VERTICAL_ENGAGE_LIMIT) {
      // Unreachable flyer: stop chasing, conserve position until it descends.
      try {
        bot.pathfinder.setGoal(null);
      } catch (_) {
        /* pathfinder not available */
      }
    } else {
      try {
        bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
      } catch (_) {
        /* pathfinder not available */
      }
    }
  }

  /** Low-HP retreat: actively flee from the threat and suppress re-engagement. */
  _retreat(entity) {
    const flying = this._isFlying(entity);
    this._retreatUntil = Date.now() + (flying ? FLYING_RETREAT_COOLDOWN_MS : RETREAT_COOLDOWN_MS);
    this._emit('retreat', { entity, flying });
    this._endCombat('low HP retreat', { fleeFrom: entity });
  }

  /** Pathfind to a point away from the threat (horizontal flee). */
  _fleeFrom(entity) {
    const bot = this.bot;
    try {
      const me = bot.entity.position;
      const away = me.minus(entity.position);
      away.y = 0; // flee on the horizontal plane; we can't out-climb a flyer
      if (away.norm() < 1e-3) away.x = 1; // degenerate overlap: pick a direction
      const dest = me.plus(away.normalize().scaled(RETREAT_DISTANCE));
      bot.pathfinder.setGoal(new goals.GoalNear(dest.x, me.y, dest.z, 1), false);
    } catch (_) {
      // Pathfinder/vector math unavailable — fall back to clearing the goal.
      try {
        bot.pathfinder.setGoal(null);
      } catch (__) {
        /* ignore */
      }
    }
  }

  _endCombat(reason, opts = {}) {
    clearInterval(this._attackLoop);
    clearTimeout(this._targetTimeout);
    this._attackLoop = null;
    this._targetTimeout = null;
    const was = this._target;
    this._target = null;
    this._active = false;
    this._invisibleSince.clear();

    if (opts.fleeFrom) {
      this._fleeFrom(opts.fleeFrom);
    } else {
      try {
        this.bot.pathfinder.setGoal(null);
      } catch (_) {
        /* ignore */
      }
    }

    botLog(this.botId, 'info', `Combat ended (${reason}) after ${Date.now() - this._combatStart}ms`);
    this._emit('combatEnd', { reason, entity: was });
  }

  /** Stop combat immediately (e.g. bot stopping). */
  stop() {
    clearInterval(this._scanner);
    clearInterval(this._attackLoop);
    clearTimeout(this._targetTimeout);
    this._scanner = null;
    this._attackLoop = null;
    this._targetTimeout = null;
    this._active = false;
    this._target = null;
    this._retreatUntil = 0;
    this._invisibleSince.clear();
  }

  /** Called when bot is attacked (health dropped). Forces switch to combat. */
  onAttacked() {
    if (this._active) return;

    // During the post-retreat cooldown, do NOT restart a melee loop — that is
    // exactly what chain-kills the bot against phantoms. If a flyer is still
    // hitting us, keep relocating instead of re-engaging.
    if (this._inRetreatCooldown()) {
      const threat = this._findTarget();
      if (threat && this._isFlying(threat)) this._fleeFrom(threat);
      return;
    }

    const target = this._findTarget();
    if (target) this._startCombat(target);
  }

  get isActive() {
    return this._active;
  }
}

module.exports = Combat;
