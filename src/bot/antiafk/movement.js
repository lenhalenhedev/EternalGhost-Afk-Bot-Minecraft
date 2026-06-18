'use strict';

/**
 * Pathfinding helpers for the anti-AFK subsystem. Kept separate from the
 * scheduling logic in AntiAFK so the (mineflayer-coupled) movement concerns are
 * isolated in one place.
 */

/**
 * Walk to `goal`, aborting if the bot stops making progress ("stuck").
 *
 * A watchdog samples the bot position every `checkIntervalMs`; if it hasn't
 * moved at least 0.1 blocks for `stuckLimitMs`, the pathfinder goal is cleared
 * so `goto` rejects/returns instead of hanging forever.
 *
 * @param {object} bot mineflayer bot
 * @param {object} goal pathfinder goal
 * @param {number} stuckLimitMs
 * @param {number} [checkIntervalMs]
 */
async function gotoWithStuckDetection(bot, goal, stuckLimitMs, checkIntervalMs = 1_000) {
  let lastPos = bot.entity.position.clone();
  let stuckMs = 0;

  const checker = setInterval(() => {
    const cur = bot.entity.position;
    if (cur.distanceTo(lastPos) < 0.1) {
      stuckMs += checkIntervalMs;
      if (stuckMs >= stuckLimitMs) {
        clearInterval(checker);
        try {
          bot.pathfinder.setGoal(null);
        } catch (_) {
          /* ignore */
        }
      }
    } else {
      stuckMs = 0;
      lastPos = cur.clone();
    }
  }, checkIntervalMs);

  try {
    await bot.pathfinder.goto(goal);
  } finally {
    clearInterval(checker);
  }
}

module.exports = { gotoWithStuckDetection };
