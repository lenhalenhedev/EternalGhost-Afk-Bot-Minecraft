'use strict';
const { sleep } = require('../utils/helpers');
const { botLog } = require('../services/logger');
const { strictInt } = require('../utils/security');

const EAT_THRESHOLD = 14;
const EAT_COOLDOWN = 1_500;
const CHECK_INTERVAL = 3_000;
const EAT_ANIMATION_MS = 1_500;

const FOOD_PRIORITY = Object.freeze([
  'golden_apple',
  'enchanted_golden_apple',
  'cooked_beef',
  'cooked_porkchop',
  'cooked_mutton',
  'cooked_chicken',
  'cooked_salmon',
  'cooked_cod',
  'cooked_rabbit',
  'bread',
  'baked_potato',
  'beef',
  'porkchop',
  'mutton',
  'chicken',
  'salmon',
  'cod',
  'rabbit',
  'carrot',
  'potato',
  'melon_slice',
  'apple',
  'sweet_berries',
  'cookie',
  'pumpkin_pie',
  'dried_kelp',
]);

function foodScore(item) {
  if (!item) return -1;
  const name = item.name.toLowerCase();
  const idx = FOOD_PRIORITY.findIndex((f) => name.includes(f));
  return idx === -1 ? -1 : FOOD_PRIORITY.length - idx;
}

function intOr(value, fallback, bounds) {
  const parsed = strictInt(value, bounds);
  return parsed.valid ? parsed.value : fallback;
}

function resolveAutoEatConfig(cfg) {
  const source = cfg && typeof cfg === 'object' ? cfg : {};
  return Object.freeze({
    enabled: source.enabled !== false,
    eatThreshold: intOr(source.eatThreshold, EAT_THRESHOLD, {
      min: 0,
      max: 20,
    }),
    eatCooldown: intOr(source.eatCooldown, EAT_COOLDOWN, { min: 0 }),
    checkInterval: intOr(source.checkInterval, CHECK_INTERVAL, { min: 1 }),
  });
}

class AutoEat {
  constructor(bot, botId, emit, cfg) {
    this.bot = bot;
    this.botId = botId;
    this._emit = emit;
    this.cfg = resolveAutoEatConfig(cfg);
    this._enabled = this.cfg.enabled;
    this._eating = false;
    this._lastEat = 0;
    this._inCombat = false;
    this._checker = null;
  }

  start() {
    if (this._checker) {
      clearInterval(this._checker);
    }
    this._checker = setInterval(() => {
      this._check().catch((err) =>
        botLog(this.botId, 'warn', `AutoEat check error: ${err.message}`)
      );
    }, this.cfg.checkInterval);
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
    if (!this._checker) return;
    if (!this._enabled || this._eating || this._inCombat) return;
    if (Date.now() - this._lastEat < this.cfg.eatCooldown) return;
    if (this.bot.food >= this.cfg.eatThreshold) return;
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
      botLog(
        this.botId,
        'debug',
        `AutoEat: ate ${foodItem.name} (food was ${this.bot.food})`
      );
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
