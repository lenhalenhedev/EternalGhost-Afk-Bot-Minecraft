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

// ─── Per-bot ring buffers (for /logs-bot command) ─────────────────────────────
/** @type {Map<string, Array<{ts:number,level:string,msg:string}>>} */
const botLogBuffers = new Map();
const BOT_BUFFER_SIZE = 200;

function getBotBuffer(botId) {
  if (!botLogBuffers.has(botId)) botLogBuffers.set(botId, []);
  return botLogBuffers.get(botId);
}

function pushBotLog(botId, level, message) {
  const buf = getBotBuffer(botId);
  buf.push({ ts: Date.now(), level, msg: message });
  if (buf.length > BOT_BUFFER_SIZE) buf.shift();
}

/**
 * Retrieve recent logs for a bot.
 * @param {string} botId
 * @param {number} maxLines
 * @param {number} maxAgeMs   – 0 means no limit
 */
function getBotLogs(botId, maxLines = 50, maxAgeMs = 0) {
  const buf = getBotBuffer(botId);
  const cutoff = maxAgeMs ? Date.now() - maxAgeMs : 0;
  const filtered = maxAgeMs ? buf.filter(e => e.ts >= cutoff) : buf;
  return filtered.slice(-maxLines);
}

// ─── Discord summary buffer ────────────────────────────────────────────────────
const summaryBuffer = [];

function addToSummary(level, botId, message) {
  const prefix = botId ? `[Bot:${botId.slice(0, 8)}]` : '[SYS]';
  summaryBuffer.push({ ts: Date.now(), level, prefix, message });
  // keep at most last 100 entries between flushes
  if (summaryBuffer.length > 100) summaryBuffer.shift();
}

/**
 * Flush summary buffer; returns formatted entries and clears the buffer.
 * Called by BotManager on a cron interval.
 */
function flushSummary() {
  if (summaryBuffer.length === 0) return null;
  const entries = summaryBuffer.splice(0, summaryBuffer.length);
  const lines = entries.map(e => {
    const t = new Date(e.ts).toISOString().slice(11, 19);
    return `\`${t}\` **[${e.level.toUpperCase()}]** ${e.prefix} ${e.message}`;
  });
  return lines.join('\n');
}

// ─── Alert cooldown tracker ────────────────────────────────────────────────────
/** @type {Map<string, number>} key => lastSentTs */
const alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 45_000; // 45 seconds

/**
 * Check and set alert cooldown.
 * @param {string} key  e.g. `${botId}:death`
 * @returns {boolean} true if alert should be sent
 */
function checkAlertCooldown(key) {
  const now  = Date.now();
  const last = alertCooldowns.get(key) || 0;
  if (now - last < ALERT_COOLDOWN_MS) return false;
  alertCooldowns.set(key, now);
  return true;
}

// ─── Convenience wrapper that also writes to per-bot buffer + summary ─────────
function botLog(botId, level, message) {
  logger.log({ level, message, botId });
  pushBotLog(botId, level, message);
  if (level === 'warn' || level === 'error') {
    addToSummary(level, botId, message);
  }
}

module.exports = { logger, botLog, getBotLogs, flushSummary, addToSummary, checkAlertCooldown };
