'use strict';

const { computeStats } = require('../../manager/managerStats');
const { getBotLogs } = require('../../services/logger');

const MAX_LOG_LINES = 50;
const MAX_LOG_HOURS = 24;
const MAX_ACTIVITY_ROWS = 100;

function sanitiseSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    host: snapshot.host,
    port: snapshot.port,
    username: snapshot.username,
    version: snapshot.version,
    state: snapshot.state,
    uptime: snapshot.uptime,
    health: snapshot.health,
    food: snapshot.food,
    ping: snapshot.ping,
    position: snapshot.position,
    reconnectAttempts: snapshot.reconnectAttempts,
    autoReconnect: snapshot.autoReconnect,
  };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createStatusService({ botManager, persistence }) {
  function publicSnapshots() {
    return botManager.getPublicSnapshots().map(sanitiseSnapshot);
  }

  function publicStatus() {
    const bots = publicSnapshots();
    const stats = computeStats(bots);
    const states = bots.reduce((counts, bot) => {
      counts[bot.state] = (counts[bot.state] || 0) + 1;
      return counts;
    }, {});
    return {
      service: 'EternalGhost-Afk-Bot-Minecraft',
      timestamp: new Date().toISOString(),
      process: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
      fleet: {
        ...stats,
        states,
      },
      bots,
    };
  }

  function authorisedBots(principal) {
    return botManager
      .listAuthorizedBots(principal)
      .map((bot) => sanitiseSnapshot(bot.toJSON()));
  }

  function stats(principal) {
    return botManager.getStats(principal);
  }

  function botStatus(principal, id) {
    return sanitiseSnapshot(
      botManager.resolveAuthorizedBot(principal, id).toJSON()
    );
  }

  function botLogs(principal, id, query = {}) {
    const instance = botManager.resolveAuthorizedBot(principal, id);
    const lines = clampInteger(query.lines, 30, 1, MAX_LOG_LINES);
    const hours = clampInteger(query.hours, 0, 0, MAX_LOG_HOURS);
    const level =
      typeof query.level === 'string' ? query.level.toLowerCase() : '';
    const allowedLevels = new Set([
      'error',
      'warn',
      'info',
      'debug',
      'verbose',
      'silly',
    ]);
    const logs = getBotLogs(instance.id, lines, hours * 60 * 60 * 1000).filter(
      (entry) =>
        level && allowedLevels.has(level) ? entry.level === level : true
    );
    return {
      bot: sanitiseSnapshot(instance.toJSON()),
      filters: { lines, hours, level: level || null },
      logs,
    };
  }

  async function activity(principal, id, query = {}) {
    const instance = botManager.resolveAuthorizedBot(principal, id);
    const limit = clampInteger(query.limit, 50, 1, MAX_ACTIVITY_ROWS);
    return {
      bot: sanitiseSnapshot(instance.toJSON()),
      activity: await persistence.getActivityHistory(instance.id, limit),
    };
  }

  return {
    authorisedBots,
    activity,
    botLogs,
    botStatus,
    publicStatus,
    stats,
  };
}

module.exports = { createStatusService, sanitiseSnapshot };
