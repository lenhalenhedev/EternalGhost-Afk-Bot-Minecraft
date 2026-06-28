'use strict';

/**
 * Tunable constants and danger-detection for the anti-AFK subsystem.
 * Pure module (no mineflayer/runtime dependencies) so it is trivially testable.
 */

const ANTI_AFK = Object.freeze({
  MIN_RADIUS: 5,
  MAX_RADIUS: 10,
  MIN_INTERVAL: 5_000,
  MAX_INTERVAL: 15_000,
  MAX_RETRIES: 3,
  MOVE_TIMEOUT: 20_000, // abort pathfinding after 20s
  STUCK_TIMEOUT: 12_000, // declare "stuck" if position doesn't change for 12s
  ROTATION_INTERVAL: 3_000, // random look-around every 3s
});

/** Danger block names (fragment match). */
const DANGER_NAMES = [
  'lava',
  'fire',
  'magma_block',
  'cactus',
  'sweet_berry_bush',
  'wither_rose',
];

/** True if a block name refers to a damaging block. */
function isDanger(name) {
  if (!name) return false;
  return DANGER_NAMES.some((d) => name.includes(d));
}

module.exports = { ANTI_AFK, DANGER_NAMES, isDanger };
