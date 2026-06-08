'use strict';
const { sleep } = require('../utils/helpers');
const { botLog } = require('../services/logger');

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'spider', 'cave_spider', 'creeper', 'enderman',
  'witch', 'blaze', 'ghast', 'slime', 'magma_cube', 'phantom',
  'drowned', 'husk', 'stray', 'pillager', 'vindicator', 'vex',
  'warden', 'ravager', 'hoglin', 'piglin_brute', 'zoglin',
]);

/** Mobs we do NOT engage – too dangerous or griefing risk. */
const COMBAT_BLACKLIST = new Set(['creeper', 'enderman', 'warden', 'ghast']);

/** Attack only these mobs (rest of HOSTILE_MOBS). */
const ATTACK_WHITELIST = new Set([...HOSTILE_MOBS].filter(m => !COMBAT_BLACKLIST.has(m)));

const SCAN_RANGE         = 15;   // blocks
const ENGAGE_RANGE       = 4;    // must be this close before swinging
const MAX_COMBAT_DURATION = 12_000; // ms per target
const RETREAT_HP_PCT     = 0.30;  // retreat when HP < 30%
const SCAN_INTERVAL      = 1_000;
const ATTACK_INTERVAL    = 600;   // ms between attacks

/** Weapon priority: higher = better. */
const WEAPON_PRIORITY = {
  'sword':   100,
  'axe':     80,
  'trident': 90,
  'mace':    95,
};

function weaponScore(item) {
  if (!item) return 0;
  for (const [type, score] of Object.entries(WEAPON_PRIORITY)) {
    if (item.name.includes(type)) return score;
  }
  return 1; // fist
}

class Combat {
  constructor(bot, botId, emit) {
    this.bot     = bot;
    this.botId   = botId;
    this._emit   = emit;           // emit('combatStart'|'combatEnd'|'retreat')
    this._active = false;
    this._target = null;
    this._scanner   = null;
    this._attackLoop = null;
    this._combatStart = 0;
    this._invisible  = new Map(); // entityId -> lastSeenTs
  }

  /** Begin scanning for hostile mobs. Call when bot enters AFK state. */
  startScanning() {
    if (this._scanner) return;
    this._scanner = setInterval(() => this._scan(), SCAN_INTERVAL);
  }

  stopScanning() {
    clearInterval(this._scanner);
    this._scanner = null;
  }

  /** Called on every scan tick. Finds nearest hostile and starts combat. */
  _scan() {
    if (this._active) return;
    const target = this._findTarget();
    if (target) this._startCombat(target);
  }

  _findTarget() {
    const bot   = this.bot;
    const pos   = bot.entity.position;
    let nearest = null;
    let minDist = SCAN_RANGE + 1;

    for (const entity of Object.values(bot.entities)) {
      if (!entity || entity.id === bot.entity.id) continue;
      if (entity.type !== 'mob') continue;
      const mobType = entity.mobType ? entity.mobType.toLowerCase().replace(/ /g, '_') : '';
      if (!ATTACK_WHITELIST.has(mobType)) continue;

      const dist = pos.distanceTo(entity.position);
      if (dist < minDist) { minDist = dist; nearest = entity; }
    }
    return nearest;
  }

  _startCombat(entity) {
    this._active     = true;
    this._target     = entity;
    this._combatStart = Date.now();
    botLog(this.botId, 'info', `Combat started vs ${entity.mobType} (dist: ${this.bot.entity.position.distanceTo(entity.position).toFixed(1)})`);
    this._emit('combatStart', entity);
    this._attackLoop = setInterval(() => this._tick(), ATTACK_INTERVAL);

    // Equip best weapon
    this._equipBestWeapon();

    // Hard timeout per target
    setTimeout(() => {
      if (this._active && this._target === entity) this._endCombat('timeout');
    }, MAX_COMBAT_DURATION);
  }

  _tick() {
    if (!this._active || !this._target) return;

    const bot    = this.bot;
    const entity = this._target;

    // Check if entity is gone / dead
    if (!bot.entities[entity.id] || entity.metadata?.[0]?.value === 1) {
      return this._endCombat('target dead or gone');
    }

    // Check if target has been invisible too long
    const lastSeen = this._invisible.get(entity.id);
    if (entity.invisible) {
      if (!lastSeen) {
        this._invisible.set(entity.id, Date.now());
      } else if (Date.now() - lastSeen > 3_000) {
        return this._endCombat('target invisible > 3s');
      }
    } else {
      this._invisible.delete(entity.id);
    }

    // Retreat if low HP
    const maxHp = bot.player?.entity?.attributes?.['minecraft:generic.max_health']?.value || 20;
    if (bot.health / maxHp < RETREAT_HP_PCT) {
      return this._endCombat('low HP retreat');
    }

    // Check distance
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > SCAN_RANGE) return this._endCombat('out of range');

    // Move towards target if far away and attack when close
    if (dist <= ENGAGE_RANGE) {
      try { bot.attack(entity); } catch (_) { /* entity might have disappeared */ }
    } else {
      // Move closer via pathfinder if available
      try {
        const { goals } = require('mineflayer-pathfinder');
        bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
      } catch (_) { /* pathfinder not available */ }
    }
  }

  _endCombat(reason) {
    clearInterval(this._attackLoop);
    this._attackLoop = null;
    const was = this._target;
    this._target  = null;
    this._active  = false;
    this._invisible.clear();
    try { this.bot.pathfinder.setGoal(null); } catch (_) { /* ignore */ }
    botLog(this.botId, 'info', `Combat ended (${reason}) after ${Date.now() - this._combatStart}ms`);
    this._emit('combatEnd', { reason, entity: was });
  }

  /** Stop combat immediately (e.g. bot stopping). */
  stop() {
    clearInterval(this._scanner);
    clearInterval(this._attackLoop);
    this._scanner    = null;
    this._attackLoop = null;
    this._active     = false;
    this._target     = null;
  }

  _equipBestWeapon() {
    const bot  = this.bot;
    let bestSlot = -1;
    let bestScore = 0;

    for (let slot = 36; slot <= 44; slot++) {
      const item = bot.inventory.slots[slot];
      const score = weaponScore(item);
      if (score > bestScore) { bestScore = score; bestSlot = slot; }
    }

    if (bestSlot !== -1 && bestScore > 1) {
      bot.setQuickBarSlot(bestSlot - 36);
    }
  }

  /** Called when bot is attacked (health dropped). Forces switch to combat state. */
  onAttacked() {
    if (this._active) return; // already in combat
    const target = this._findTarget();
    if (target) this._startCombat(target);
  }

  get isActive() { return this._active; }
}

module.exports = Combat;
