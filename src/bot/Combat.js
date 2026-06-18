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
    if (this._active) return;
    const target = this._findTarget();
    if (target) this._startCombat(target);
  }

  _findTarget() {
    const bot = this.bot;
    const pos = bot.entity.position;
    let nearest = null;
    let minDist = COMBAT.SCAN_RANGE + 1;

    for (const entity of Object.values(bot.entities)) {
      if (!entity || entity.id === bot.entity.id) continue;
      if (entity.type !== 'mob') continue;
      const mobType = entity.mobType ? entity.mobType.toLowerCase().replace(/ /g, '_') : '';
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
      `Combat started vs ${entity.mobType} (dist: ${this.bot.entity.position.distanceTo(entity.position).toFixed(1)})`,
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

    // Retreat if low HP.
    const maxHp = bot.player?.entity?.attributes?.['minecraft:generic.max_health']?.value || 20;
    if (bot.health / maxHp < COMBAT.RETREAT_HP_PCT) {
      return this._endCombat('low HP retreat');
    }

    // Out of range.
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > COMBAT.SCAN_RANGE) return this._endCombat('out of range');

    // Attack when close, otherwise path towards the target.
    if (dist <= COMBAT.ENGAGE_RANGE) {
      try {
        bot.attack(entity);
      } catch (_) {
        /* entity might have disappeared */
      }
    } else {
      try {
        bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
      } catch (_) {
        /* pathfinder not available */
      }
    }
  }

  _endCombat(reason) {
    clearInterval(this._attackLoop);
    clearTimeout(this._targetTimeout);
    this._attackLoop = null;
    this._targetTimeout = null;
    const was = this._target;
    this._target = null;
    this._active = false;
    this._invisibleSince.clear();
    try {
      this.bot.pathfinder.setGoal(null);
    } catch (_) {
      /* ignore */
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
    this._invisibleSince.clear();
  }

  /** Called when bot is attacked (health dropped). Forces switch to combat. */
  onAttacked() {
    if (this._active) return;
    const target = this._findTarget();
    if (target) this._startCombat(target);
  }

  get isActive() {
    return this._active;
  }
}

module.exports = Combat;
