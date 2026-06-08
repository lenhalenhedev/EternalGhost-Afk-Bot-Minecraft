'use strict';
const { sleep } = require('../utils/helpers');
const { botLog } = require('../services/logger');

const EAT_THRESHOLD  = 14;  // eat when food < 14 / 20
const EAT_COOLDOWN   = 1500; // ms between eat attempts
const CHECK_INTERVAL = 3000; // ms between hunger checks

/**
 * Food priority list (higher index = lower priority).
 * We prefer cooked over raw.
 */
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
  const idx  = FOOD_PRIORITY.findIndex(f => name.includes(f));
  return idx === -1 ? -1 : FOOD_PRIORITY.length - idx; // higher = better
}

class AutoEat {
  constructor(bot, botId, emit) {
    this.bot      = bot;
    this.botId    = botId;
    this._emit    = emit;
    this._enabled = true;
    this._eating  = false;
    this._lastEat = 0;
    this._inCombat = false;
    this._checker  = null;
  }

  start() {
    if (this._checker) return;
    this._checker = setInterval(() => this._check(), CHECK_INTERVAL);
    botLog(this.botId, 'debug', 'AutoEat started.');
  }

  stop() {
    clearInterval(this._checker);
    this._checker = null;
    this._eating  = false;
  }

  setCombat(inCombat) {
    this._inCombat = inCombat;
  }

  async _check() {
    if (!this._enabled) return;
    if (this._eating) return;
    if (this._inCombat) return; // don't eat during combat
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
    let bestItem  = null;
    let bestScore = -1;

    for (const item of this.bot.inventory.items()) {
      const score = foodScore(item);
      if (score > bestScore) { bestScore = score; bestItem = item; }
    }
    return bestItem;
  }

  async _eat(foodItem) {
    this._eating = true;
    try {
      // Equip food to off-hand or hotbar
      const slot = this.bot.inventory.findInventoryItem(foodItem.type, null, false);
      if (!slot) { this._eating = false; return; }

      await this.bot.equip(foodItem, 'hand');
      this.bot.deactivateItem(); // ensure not using something else
      this.bot.activateItem();
      await sleep(1500); // eat animation
      this.bot.deactivateItem();

      this._lastEat = Date.now();
      botLog(this.botId, 'debug', `AutoEat: ate ${foodItem.name} (food was ${this.bot.food})`);
    } catch (err) {
      botLog(this.botId, 'warn', `AutoEat failed: ${err.message}`);
    }
    this._eating = false;
  }

  /** Re-enable auto-eat after food was restocked. */
  enable() {
    this._enabled = true;
    botLog(this.botId, 'info', 'AutoEat re-enabled.');
  }

  get enabled() { return this._enabled; }
}

module.exports = AutoEat;
