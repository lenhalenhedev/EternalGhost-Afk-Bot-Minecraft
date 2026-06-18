'use strict';

const { ANTI_AFK, isDanger } = require('./antiAfkConfig');
const { randFloat } = require('../../utils/helpers');

/**
 * Pure spatial reasoning for anti-AFK wandering.
 *
 * The `vec3` factory is injected (rather than `require('vec3')` at module load)
 * so this module stays decoupled from mineflayer and can be unit tested with a
 * lightweight fake. In production AntiAFK passes the real `vec3` constructor,
 * which is required because `bot.blockAt` only accepts a Vec3 instance — the
 * previous code passed plain `{x,y,z}` objects, which silently failed.
 *
 * @typedef {(x:number,y:number,z:number)=>any} Vec3Factory
 */

/**
 * Check whether the column at (x, y, z) is safe to stand in.
 * @param {object} bot mineflayer bot (needs `blockAt`)
 * @param {Vec3Factory} vec3
 */
function isSafe(bot, vec3, x, y, z) {
  const below = bot.blockAt(vec3(x, y - 1, z));
  const feet = bot.blockAt(vec3(x, y, z));
  const head = bot.blockAt(vec3(x, y + 1, z));

  if (!below || !feet || !head) return false;

  // Must have solid ground to stand on.
  if (below.boundingBox !== 'block') return false;
  // Feet and head must be clear.
  if (feet.boundingBox !== 'empty') return false;
  if (head.boundingBox !== 'empty') return false;

  // No damaging blocks anywhere in the column.
  if (isDanger(below.name) || isDanger(feet.name) || isDanger(head.name)) return false;

  return true;
}

/**
 * Pick a random safe target within radius of `anchor`.
 * @param {object} bot mineflayer bot
 * @param {Vec3Factory} vec3
 * @param x:number,y:number,z:number anchor
 * @returns {{x:number,y:number,z:number}|null}
 */
function pickTarget(bot, vec3, anchor) {
  if (!anchor) return null;

  for (let i = 0; i < 20; i++) {
    const angle = randFloat(0, Math.PI * 2);
    const radius = randFloat(ANTI_AFK.MIN_RADIUS, ANTI_AFK.MAX_RADIUS);
    const x = Math.round(anchor.x + Math.cos(angle) * radius);
    const z = Math.round(anchor.z + Math.sin(angle) * radius);

    // Find correct Y by scanning downward from anchor.y+3 to anchor.y-5.
    for (let y = anchor.y + 3; y >= anchor.y - 5; y--) {
      if (isSafe(bot, vec3, x, y, z)) return { x, y, z };
    }
  }
  return null;
}

module.exports = { isSafe, pickTarget };
