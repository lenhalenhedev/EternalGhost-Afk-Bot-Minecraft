'use strict';
const { goals } = require('mineflayer-pathfinder');
const { botLog } = require('../services/logger');
const { ATTACK_WHITELIST, resolveCombatConfig } = require('./combat/combatConfig');
const { equipBestWeapon } = require('./combat/weapons');

const FLYING_MOBS = new Set(['phantom', 'vex', 'ghast', 'blaze', 'bee']);
const VERTICAL_ENGAGE_LIMIT = 3;
const RETREAT_DISTANCE = 12;
const RETREAT_COOLDOWN_MS = 5_000;
const FLYING_RETREAT_COOLDOWN_MS = 10_000;
const FLEE_THROTTLE_MS = 1_000;

class Combat {
  constructor(bot, botId, emit, cfg) {
    this.bot = bot;
    this.botId = botId;
    this._emit = emit;
    this.cfg = resolveCombatConfig(cfg);
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
    if (this._scanner) {
      clearInterval(this._scanner);
    }
    this._scanner = setInterval(() => this._scan(), this.cfg.scanInterval);
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
    let minDist = this.cfg.scanRange + 1;
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

    clearInterval(this._attackLoop);
    clearTimeout(this._targetTimeout);
    this._attackLoop = null;
    this._targetTimeout = null;

    this._active = true;
    this._target = entity;
    this._combatStart = Date.now();
    this._invisibleSince.clear();

    botLog(
      this.botId,
      'info',
      `Combat started vs ${this._mobName(entity)} (dist: ${this.bot.entity.position.distanceTo(entity.position).toFixed(1)})`
    );
    this._emit('combatStart', entity);
    this._attackLoop = setInterval(() => this._tick(), this.cfg.attackInterval);
    equipBestWeapon(this.bot);

    this._targetTimeout = setTimeout(() => {
      if (this._active && this._target === entity) this._endCombat('timeout');
    }, this.cfg.maxCombatDuration);
  }

  _tick() {
    if (!this._active || !this._target) return;
    const bot = this.bot;
    const entity = this._target;

    if (!bot.entity) return this._endCombat('bot entity gone');

    if (
      !bot.entities[entity.id] ||
      !entity.position ||
      entity.metadata?.[0]?.value === 1
    ) {
      return this._endCombat('target dead or gone');
    }

    const firstInvisible = this._invisibleSince.get(entity.id);
    if (entity.invisible) {
      if (!firstInvisible) {
        this._invisibleSince.set(entity.id, Date.now());
      } else if (Date.now() - firstInvisible > this.cfg.invisibleTimeout) {
        return this._endCombat('target invisible too long');
      }
    } else {
      this._invisibleSince.delete(entity.id);
    }

    const maxHp =
      bot.player?.entity?.attributes?.['minecraft:generic.max_health']?.value ||
      20;
    if (bot.health / maxHp < this.cfg.retreatHpPct) {
      return this._retreat(entity);
    }

    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > this.cfg.scanRange) return this._endCombat('out of range');

    const verticalGap = entity.position.y - bot.entity.position.y;
    if (dist <= this.cfg.engageRange && verticalGap <= VERTICAL_ENGAGE_LIMIT) {
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
    this._retreatUntil =
      Date.now() + (flying ? FLYING_RETREAT_COOLDOWN_MS : RETREAT_COOLDOWN_MS);
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
      bot.pathfinder.setGoal(
        new goals.GoalNear(dest.x, me.y, dest.z, 1),
        false
      );
      this._goalActive = true;
    } catch (_) {
      this._clearPath();
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
      this._clearPath();
    }
    botLog(
      this.botId,
      'info',
      `Combat ended (${reason}) after ${Date.now() - this._combatStart}ms`
    );
    this._emit('combatEnd', { reason, entity: was });
  }

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
    this._invisibleSince.clear();
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
