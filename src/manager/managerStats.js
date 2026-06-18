'use strict';

const { ALIVE_STATES } = require('../bot/states');

/**
 * Compute process + fleet health stats for the /stats command.
 * Uses the canonical ALIVE_STATES set so ERROR/RECONNECTING bots (which have no
 * live mineflayer client) are not counted as alive.
 */
function computeStats(bots) {
  const mem = process.memoryUsage();
  const alive = bots.filter((b) => ALIVE_STATES.has(b.state));
  return {
    uptime: process.uptime(),
    totalBots: bots.length,
    aliveBots: alive.length,
    memHeapUsed: mem.heapUsed,
    memRSS: mem.rss,
    memExternal: mem.external,
    estimatedPerBotMB: alive.length ? Math.round(mem.heapUsed / alive.length / 1024 / 1024) : 0,
  };
}

module.exports = { computeStats };
