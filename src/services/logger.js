'use strict';
const path   = require('path');
const fs     = require('fs');
const winston = require('winston');
require('winston-daily-rotate-file');
const config = require('../config');

// Ensure log directory exists
const LOG_DIR = path.resolve(config.storage.logDir);
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ─── Formats ──────────────────────────────────────────────────────────────────
const { combine, timestamp, colorize, printf, errors } = winston.format;

const fileFormat = combine(
  errors({ stack: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp: ts, botId, stack }) => {
    const prefix = botId ? `[${botId.slice(0, 8)}]` : '[SYSTEM]';
    return `${ts} [${level.toUpperCase()}] ${prefix} ${stack || message}`;
  })
);

const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ level, message, timestamp: ts, botId, stack }) => {
    const prefix = botId ? `[Bot:${botId.slice(0, 8)}]` : '[SYS]';
    return `${ts} ${level} ${prefix} ${stack || message}`;
  })
);

// ─── Transports ───────────────────────────────────────────────────────────────
const transports = [
  new winston.transports.Console({ format: consoleFormat }),
  new winston.transports.DailyRotateFile({
    filename:       path.join(LOG_DIR, 'combined-%DATE%.log'),
    datePattern:    'YYYY-MM-DD',
    maxFiles:       '14d',
    maxSize:        '50m',
    format:         fileFormat,
    zippedArchive:  true,
  }),
  new winston.transports.DailyRotateFile({
    level:          'error',
    filename:       path.join(LOG_DIR, 'error-%DATE%.log'),
    datePattern:    'YYYY-MM-DD',
    maxFiles:       '30d',
    format:         fileFormat,
    zippedArchive:  true,
  }),
];

const logger = winston.createLogger({
  level:       config.storage.logLevel || 'info',
  transports,
  exitOnError: false,
});

// ─── In-memory buffers (per-bot ring buffer, Discord summary, alert cooldowns) ─
// Pure buffering logic lives in ./logBuffer so it can be unit tested without
// pulling in winston/config. This module owns winston transports + wiring only.
const { LogBuffers } = require('./logBuffer');
const buffers = new LogBuffers();

/** Retrieve recent logs for a bot (newest last). 0 maxAgeMs = no age limit. */
function getBotLogs(botId, maxLines = 50, maxAgeMs = 0) {
  return buffers.getBotLogs(botId, maxLines, maxAgeMs);
}

/** Queue a warn/error line for the next Discord summary flush. */
function addToSummary(level, botId, message) {
  buffers.addToSummary(level, botId, message);
}

/**
 * Flush the summary buffer to a formatted Markdown string (or null if empty).
 * Called by BotManager on a cron interval.
 */
function flushSummary() {
  const entries = buffers.drainSummary();
  if (entries.length === 0) return null;
  return entries
    .map((e) => {
      const t = new Date(e.ts).toISOString().slice(11, 19);
      return `\`${t}\` **[${e.level.toUpperCase()}]** ${e.prefix} ${e.message}`;
    })
    .join('\n');
}

/**
 * Check and set alert cooldown.
 * @param {string} key  e.g. `${botId}:death`
 * @returns {boolean} true if alert should be sent
 */
function checkAlertCooldown(key) {
  return buffers.checkAlertCooldown(key);
}

/** Drop all retained in-memory state for a deleted bot (prevents leaks). */
function clearBotState(botId) {
  buffers.clearBot(botId);
}

// ─── Convenience wrapper that also writes to per-bot buffer + summary ─────────
function botLog(botId, level, message) {
  logger.log({ level, message, botId });
  buffers.pushBotLog(botId, level, message);
  if (level === 'warn' || level === 'error') {
    buffers.addToSummary(level, botId, message);
  }
}

module.exports = {
  logger,
  botLog,
  getBotLogs,
  flushSummary,
  addToSummary,
  checkAlertCooldown,
  clearBotState,
};
