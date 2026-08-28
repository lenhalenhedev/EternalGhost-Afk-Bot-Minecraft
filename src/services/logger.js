'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const pino = require('pino');
const config = require('../config');
const { sanitizeForLog } = require('../utils/security');
const { LogBuffers } = require('./logBuffer');

const LOG_DIR = path.resolve(config.storage.logDir);
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ANSI escape filtering intentionally uses control characters.
const stripAnsi = (value) =>
  String(value ?? '').replace(
    // eslint-disable-next-line no-control-regex
    /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    ''
  );

function safeText(value) {
  return stripAnsi(sanitizeForLog(value));
}

function normalizeError(error) {
  if (!error) return undefined;
  if (error instanceof Error) {
    return { name: safeText(error.name) };
  }
  if (typeof error === 'object') {
    return { name: safeText(error.name || 'Error') };
  }
  return { name: 'Error' };
}

function normalizeFields(fields = {}) {
  const normalized = {};
  for (const key of ['requestId', 'userId', 'botId', 'route', 'statusCode']) {
    if (fields[key] !== undefined && fields[key] !== null)
      normalized[key] =
        key === 'statusCode' ? Number(fields[key]) : safeText(fields[key]);
  }
  if (fields.err) normalized.err = normalizeError(fields.err);
  return normalized;
}

const combinedStream = fs.createWriteStream(
  path.join(LOG_DIR, 'combined.jsonl'),
  { flags: 'a' }
);
const errorStream = fs.createWriteStream(path.join(LOG_DIR, 'error.jsonl'), {
  flags: 'a',
});
const destination = pino.multistream([
  { stream: process.stdout },
  { stream: combinedStream },
  { level: 'error', stream: errorStream },
]);
const pinoLogger = pino(
  {
    level: config.storage.logLevel || 'info',
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  },
  destination
);

const logger = {
  log({ level = 'info', message = '', ...fields } = {}) {
    const method = typeof pinoLogger[level] === 'function' ? level : 'info';
    pinoLogger[method](normalizeFields(fields), safeText(message));
  },
};
for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
  logger[level] = (fieldsOrMessage, maybeMessage) => {
    if (typeof fieldsOrMessage === 'object' && fieldsOrMessage !== null) {
      pinoLogger[level](
        normalizeFields(fieldsOrMessage),
        safeText(maybeMessage || fieldsOrMessage.msg || '')
      );
      return;
    }
    pinoLogger[level]({}, safeText(fieldsOrMessage));
  };
}

const buffers = new LogBuffers();
const logEvents = new EventEmitter();
logEvents.setMaxListeners(0);

function getBotLogs(botId, maxLines = 50, maxAgeMs = 0) {
  return buffers.getBotLogs(botId, maxLines, maxAgeMs);
}

function addToSummary(level, botId, message) {
  buffers.addToSummary(level, botId, safeText(message));
}

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

function checkAlertCooldown(key) {
  return buffers.checkAlertCooldown(key);
}

function clearBotState(botId) {
  buffers.clearBot(botId);
}

function subscribeBotLogs(listener) {
  if (typeof listener !== 'function')
    throw new TypeError('Listener is required.');
  logEvents.on('botLog', listener);
  return () => logEvents.off('botLog', listener);
}

function shutdown() {
  buffers.destroy();
  pinoLogger.flush();
  combinedStream.end();
  errorStream.end();
}

function botLog(botId, level, message) {
  const safe = safeText(message);
  logger.log({ level, message: safe, botId });
  buffers.pushBotLog(botId, level, safe);
  logEvents.emit('botLog', { botId, ts: Date.now(), level, message: safe });
  if (level === 'warn' || level === 'error') {
    buffers.addToSummary(level, botId, safe);
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
  subscribeBotLogs,
  shutdown,
  normalizeFields,
  stripAnsi,
};
