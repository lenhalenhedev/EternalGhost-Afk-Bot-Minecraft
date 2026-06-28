'use strict';

/**
 * Weapon selection helpers. The scoring function is pure and unit tested; the
 * equip helper isolates the only mineflayer interaction.
 */

/** Weapon priority: higher = better. */
const WEAPON_PRIORITY = Object.freeze({
  sword: 100,
  mace: 95,
  trident: 90,
  axe: 80,
});

const HOTBAR_START = 36;
const HOTBAR_END = 44;

/**
 * Score an inventory item as a melee weapon. 0 = none, 1 = fist (no weapon).
 * @param {{name?: string}|null|undefined} item
 */
function weaponScore(item) {
  if (!item || typeof item.name !== 'string') return 0;
  for (const [type, score] of Object.entries(WEAPON_PRIORITY)) {
    if (item.name.includes(type)) return score;
  }
  return 1; // fist
}

/**
 * Find the hotbar slot (36-44) holding the best weapon.
 * @returns slot:number, score:number slot is -1 when no weapon found
 */
function bestWeaponSlot(bot) {
  let bestSlot = -1;
  let bestScore = 0;
  for (let slot = HOTBAR_START; slot <= HOTBAR_END; slot++) {
    const item = bot.inventory.slots[slot];
    const score = weaponScore(item);
    if (score > bestScore) {
      bestScore = score;
      bestSlot = slot;
    }
  }
  return { slot: bestSlot, score: bestScore };
}

/** Equip the best available weapon onto the hotbar selection. */
function equipBestWeapon(bot) {
  const { slot, score } = bestWeaponSlot(bot);
  if (slot !== -1 && score > 1) {
    bot.setQuickBarSlot(slot - HOTBAR_START);
  }
}

module.exports = {
  WEAPON_PRIORITY,
  weaponScore,
  bestWeaponSlot,
  equipBestWeapon,
};
