'use strict';
const { sleep } = require('../utils/helpers');
const { botLog } = require('../services/logger');

const EAT_THRESHOLD = 14;
const EAT_COOLDOWN = 1_500;
const CHECK_INTERVAL = 3_000;
const EAT_ANIMATION_MS = 1_500;

const FOOD_PRIORITY = [
  'golden_apple', 'enchanted_golden_apple',
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'cooked_salmon', 'cooked_cod', 'cooked_rabbit',
  'bread', 'baked_potato',
  'beef', 'porkchop', 'mutton', 'chicken', 'salmon', 'cod', 'rabbit',
  'carrot', 'potato', 'melon_slice', 'apple', 'sweet_berries',
  'cookie', 'pumpkin_pie',
  'dried_kelp',
];

function foodScore(item) {
  if (!item) return -1;
  const name = item.name.toLowerCase();
  const idx = FOOD_PRIORITY.findIndex((f) => name.includes(f));
  return idx === -1 ? -1 : FOOD_PRIORITY.length - idx;
}

/**
 * Automatically eats when hungry, pausing during combat.
 *
 * MEMORY LEAK FIXES:
 * - start() is idempotent: clears existing interval before creating a new one
 * - stop() nullifies all state to aid GC
 * - _check() guards against use-after-stop via _checker null check
 */
class AutoEat {
  constructor(bot, botId, emit) {
    this.bot = bot;
    this.botId = botId;
    this._emit = emit;
    this._enabled = true;
    this._eating = false;
    this._lastEat = 0;
    this._inCombat = false;
    this._checker = null;
  }

  start() {
    // FIX: Idempotent — clear existing interval to prevent duplicates
    if (this._checker) {
      clearInterval(this._checker);
    }
    this._checker = setInterval(() => {
      this._check().catch((err) => botLog(this.botId, 'warn', `AutoEat check error: ${err.message}`));
    }, CHECK_INTERVAL);
    botLog(this.botId, 'debug', 'AutoEat started.');
  }

  stop() {
    clearInterval(this._checker);
    this._checker = null;
    this._eating = false;
  }

  setCombat(inCombat) {
    this._inCombat = inCombat;
  }

  async _check() {
    // FIX: Guard against running after stop (race condition with async)
    if (!this._checker) return;
    if (!this._enabled || this._eating || this._inCombat) return;
    if (Date.now() - this._lastEat < EAT_COOLDOWN) return;
    if (this.bot.food >= EAT_THRESHOLD) return;
    const food = this._findBestFood();
    if (!food) {
      botLog(this.botId, 'warn', 'AutoEat: no food found in inventory!');
      this._enabled = false;
      this._emit('noFood');
      return;
    }
    await this._eat(food);
  }

  _findBestFood() {
    let bestItem = null;
    let bestScore = -1;
    for (const item of this.bot.inventory.items()) {
      const score = foodScore(item);
      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }
    return bestItem;
  }

  async _eat(foodItem) {
    this._eating = true;
    try {
      await this.bot.equip(foodItem, 'hand');
      this.bot.deactivateItem();
      this.bot.activateItem();
      await sleep(EAT_ANIMATION_MS);
      this.bot.deactivateItem();
      this._lastEat = Date.now();
      botLog(this.botId, 'debug', `AutoEat: ate ${foodItem.name} (food was ${this.bot.food})`);
    } catch (err) {
      botLog(this.botId, 'warn', `AutoEat failed: ${err.message}`);
    } finally {
      this._eating = false;
    }
  }

  enable() {
    this._enabled = true;
    botLog(this.botId, 'info', 'AutoEat re-enabled.');
  }

  get enabled() {
    return this._enabled;
  }
}

module.exports = AutoEat;
