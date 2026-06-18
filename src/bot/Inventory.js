'use strict';

const { botLog } = require('../services/logger');

const FULL_THRESHOLD = 0.9; // 90% of slots
const TOTAL_INVENTORY_SLOTS = 36;
const TOSS_DELAY_MS = 100;

/** Junk items to drop when inventory is full (name substring match). */
const DROP_LIST = new Set([
  'dirt', 'cobblestone', 'sand', 'gravel', 'flint', 'rotten_flesh',
  'bone', 'string', 'spider_eye', 'gunpowder', 'feather', 'arrow',
  'granite', 'diorite', 'andesite', 'netherrack', 'soul_sand',
  'clay_ball', 'pebble', 'tuff', 'calcite',
]);

/** Valuables to NEVER drop. */
const PROTECT_LIST = new Set([
  'diamond', 'emerald', 'netherite', 'ancient_debris', 'gold_ingot', 'iron_ingot',
  'diamond_sword', 'netherite_sword', 'diamond_pickaxe', 'netherite_pickaxe',
  'diamond_chestplate', 'netherite_chestplate', 'elytra', 'totem_of_undying',
  'enchanted_book', 'nether_star',
]);

function isDroppable(item) {
  if (!item) return false;
  const name = item.name.toLowerCase();
  for (const p of PROTECT_LIST) {
    if (name.includes(p)) return false;
  }
  for (const d of DROP_LIST) {
    if (name.includes(d)) return true;
  }
  return false;
}

/** Drops junk items when the inventory approaches capacity. */
class Inventory {
  constructor(bot, botId, emit) {
    this.bot = bot;
    this.botId = botId;
    this._emit = emit;
    this._cleaning = false;
  }

  /** Check fill level and trigger cleanup if needed. */
  async checkAndClean(force = false) {
    const bot = this.bot;
    const used = bot.inventory.items().length;
    const fill = used / TOTAL_INVENTORY_SLOTS;

    if (!force && fill < FULL_THRESHOLD) return;
    if (this._cleaning) return; // already running
    this._cleaning = true;

    try {
      botLog(this.botId, 'info', `Inventory cleanup triggered (${used}/${TOTAL_INVENTORY_SLOTS} slots, ${(fill * 100).toFixed(0)}% full)`);
      const dropped = await this._dropJunk();
      botLog(this.botId, 'info', `Inventory cleanup done. Dropped ${dropped} item stacks.`);

      const remaining = bot.inventory.items().length / TOTAL_INVENTORY_SLOTS;
      if (remaining >= FULL_THRESHOLD) {
        botLog(this.botId, 'warn', 'Inventory still full after cleanup – no droppable items remain.');
        this._emit('inventoryFull');
      }
    } finally {
      this._cleaning = false;
    }
  }

  async _dropJunk() {
    let dropped = 0;
    for (const item of this.bot.inventory.items()) {
      if (!isDroppable(item)) continue;
      try {
        await this.bot.toss(item.type, null, item.count);
        dropped++;
        botLog(this.botId, 'debug', `Dropped ${item.count}x ${item.name}`);
        await new Promise((r) => setTimeout(r, TOSS_DELAY_MS));
      } catch (err) {
        botLog(this.botId, 'warn', `Failed to drop ${item.name}: ${err.message}`);
      }
    }
    return dropped;
  }

  /** Called when a pickup fails – inventory is presumably full. */
  onPickupFail() {
    this.checkAndClean(true).catch((err) =>
      botLog(this.botId, 'error', `Inventory cleanup error: ${err.message}`),
    );
  }

  get isFull() {
    return this.bot.inventory.items().length / TOTAL_INVENTORY_SLOTS >= FULL_THRESHOLD;
  }
}

module.exports = Inventory;
