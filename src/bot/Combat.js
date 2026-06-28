'use strict';
const { goals } = require('mineflayer-pathfinder');
const { botLog } = require('../services/logger');
const { ATTACK_WHITELIST, COMBAT } = require('./combat/combatConfig');
const { equipBestWeapon } = require('./combat/weapons');

/**
 * Reactive melee combat for a single bot.
 *
 * MEMORY LEAK FIXES:
 * - _startCombat now clears any pre-existing _attackLoop and _targetTimeout
 *   before creating new ones (prevents timer stacking on rapid re-engagement)
 * - _invisibleSince Map is bounded and cleared on stop()
 * - _endCombat always clears both interval and timeout (no orphaned timers)
 * - stop() is fully idempotent and clears all state
 */

const FLYING_MOBS = new Set(['phantom', 'vex', 'ghast', 'blaze', 'bee']);
const VERTICAL_ENGAGE_LIMIT = 3;
const RETREAT_DISTANCE = 12;
const RETREAT_COOLDOWN_MS = 5_000;
const FLYING_RETREAT_COOLDOWN_MS = 10_000;
const FLEE_THROTTLE_MS = 1_000;

class Combat {
  constructor(bot, botId, emit) {
    this.bot = bot;
    this.botId = botId;
    this._emit = emit;
    this._active = false;
    this._target = null;
    this._scanner = null;
    this._attackLoop = null;
    this._targetTimeout = null;
    this._combatStart = 0;
    this._invisibleSince = new Map();
    this._retreatUntil = 0;
    this._lastFleeAt = 0;
    this._goalActive = false;
  }

  startScanning() {
    // FIX: Idempotent - clear existing scanner before creating a new one
    if (this._scanner) {
      clearInterval(this._scanner);
    }
    this._scanner = setInterval(() => this._scan(), COMBAT.SCAN_INTERVAL);
  }

  stopScanning() {
    clearInterval(this._scanner);
    this._scanner = null;
  }

  _scan() {
    if (this._active || this._inRetreatCooldown()) return;
    if (!this.bot.entity) return;
    const target = this._findTarget();
    if (target) this._startCombat(target);
  }

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
    if (!bot.entity) return null;
    const pos = bot.entity.position;
    let nearest = null;
    let minDist = COMBAT.SCAN_RANGE + 1;
    for (const entity of Object.values(bot.entities)) {
      if (!entity || entity.id === bot.entity.id) continue;
      if (entity.type !== 'mob' || !entity.position) continue;
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
    if (this._active) return;

    // FIX: Defensively clear any orphaned timers from a previous combat cycle
    // that might not have been properly cleaned up (e.g., race conditions).
    clearInterval(this._attackLoop);
    clearTimeout(this._targetTimeout);
    this._attackLoop = null;
    this._targetTimeout = null;

    this._active = true;
    this._target = entity;
    this._combatStart = Date.now();
    this._invisibleSince.clear(); // FIX: Clear stale invisible tracking

    botLog(
      this.botId,
      'info',
      `Combat started vs ${this._mobName(entity)} (dist: ${this.bot.entity.position.distanceTo(entity.position).toFixed(1)})`,
    );
    this._emit('combatStart', entity);
    this._attackLoop = setInterval(() => this._tick(), COMBAT.ATTACK_INTERVAL);
    equipBestWeapon(this.bot);

    this._targetTimeout = setTimeout(() => {
      if (this._active && this._target === entity) this._endCombat('timeout');
    }, COMBAT.MAX_COMBAT_DURATION);
  }

  _tick() {
    if (!this._active || !this._target) return;
    const bot = this.bot;
    const entity = this._target;

    if (!bot.entity) return this._endCombat('bot entity gone');

    if (!bot.entities[entity.id] || !entity.position || entity.metadata?.[0]?.value === 1) {
      return this._endCombat('target dead or gone');
    }

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

    const maxHp = bot.player?.entity?.attributes?.['minecraft:generic.max_health']?.value || 20;
    if (bot.health / maxHp < COMBAT.RETREAT_HP_PCT) {
      return this._retreat(entity);
    }

    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > COMBAT.SCAN_RANGE) return this._endCombat('out of range');

    const verticalGap = entity.position.y - bot.entity.position.y;
    if (dist <= COMBAT.ENGAGE_RANGE && verticalGap <= VERTICAL_ENGAGE_LIMIT) {
      try {
        bot.attack(entity);
      } catch (_) {
        /* entity might have disappeared */
      }
    } else if (this._isFlying(entity) && verticalGap > VERTICAL_ENGAGE_LIMIT) {
      this._clearPath();
    } else {
      this._follow(entity);
    }
  }

  _retreat(entity) {
    const flying = this._isFlying(entity);
    this._retreatUntil = Date.now() + (flying ? FLYING_RETREAT_COOLDOWN_MS : RETREAT_COOLDOWN_MS);
    this._emit('retreat', { entity, flying });
    this._endCombat('low HP retreat', { fleeFrom: entity });
  }

  _follow(entity) {
    try {
      this.bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
      this._goalActive = true;
    } catch (_) {
      /* pathfinder not available */
    }
  }

  _clearPath() {
    if (!this._goalActive) return;
    this._goalActive = false;
    try {
      this.bot.pathfinder.setGoal(null);
    } catch (_) {
      /* ignore */
    }
  }

  _fleeFrom(entity) {
    const now = Date.now();
    if (now - this._lastFleeAt < FLEE_THROTTLE_MS) return;
    this._lastFleeAt = now;
    const bot = this.bot;
    if (!bot.entity || !entity?.position) return;
    try {
      const me = bot.entity.position;
      const away = me.minus(entity.position);
      away.y = 0;
      if (away.norm() < 1e-3) away.x = 1;
      const dest = me.plus(away.normalize().scaled(RETREAT_DISTANCE));
      bot.pathfinder.setGoal(new goals.GoalNear(dest.x, me.y, dest.z, 1), false);
      this._goalActive = true;
    } catch (_) {
      this._clearPath();
    }
  }

  _endCombat(reason, opts = {}) {
    // FIX: Always clear both timers to prevent orphaned timer leaks
    clearInterval(this._attackLoop);
    clearTimeout(this._targetTimeout);
    this._attackLoop = null;
    this._targetTimeout = null;

    const was = this._target;
    this._target = null;
    this._active = false;
    this._invisibleSince.clear(); // FIX: Clear the Map to free memory

    if (opts.fleeFrom) {
      this._fleeFrom(opts.fleeFrom);
    } else {
      this._clearPath();
    }
    botLog(this.botId, 'info', `Combat ended (${reason}) after ${Date.now() - this._combatStart}ms`);
    this._emit('combatEnd', { reason, entity: was });
  }

  /** Stop combat immediately. Full, idempotent teardown. */
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
    this._lastFleeAt = 0;
    this._invisibleSince.clear(); // FIX: Use .clear() instead of reassigning
    this._goalActive = false;
    try {
      this.bot.pathfinder.setGoal(null);
    } catch (_) {
      /* ignore */
    }
  }

  onAttacked() {
    if (this._active) return;
    const bot = this.bot;
    if (!bot.entity || bot.health <= 0) return;
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
