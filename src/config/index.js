'use strict';
require('dotenv').config();

const net = require('node:net');
const { strictInt } = require('../utils/security');

function requireEnv(key) {
  const val = process.env[key];
  if (!val || val.trim() === '')
    throw new Error(`Missing required env var: ${key}`);
  return val.trim();
}

function optionalEnv(key, defaultValue = '') {
  return (process.env[key] || defaultValue).trim();
}

function intEnv(key, fallback, bounds = {}) {
  const parsed = strictInt(process.env[key], bounds);
  return parsed.valid ? parsed.value : fallback;
}

function boolEnv(key, fallback = false) {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (raw.trim().toLowerCase() === 'true') return true;
  if (raw.trim().toLowerCase() === 'false') return false;
  throw new Error(`${key} must be true or false`);
}

function ipListEnv(key) {
  const values = optionalEnv(key)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.some((value) => net.isIP(value) === 0)) {
    throw new Error(`${key} must contain only literal IPv4 or IPv6 addresses`);
  }
  return values;
}

const HARDCODED_LOG_CHANNEL_ID = '';

function validateHexKey(key, name) {
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `${name} must be a 64-char hex string (32 bytes). Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
}

let config;
try {
  const encryptionKey = requireEnv('ENCRYPTION_KEY');
  validateHexKey(encryptionKey, 'ENCRYPTION_KEY');

  const oldKey = optionalEnv('OLD_ENCRYPTION_KEY');
  if (oldKey) validateHexKey(oldKey, 'OLD_ENCRYPTION_KEY');

  const adminIds = requireEnv('ADMIN_USER_IDS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (adminIds.length === 0)
    throw new Error('ADMIN_USER_IDS must contain at least one Discord user ID');

  config = {
    discord: {
      token: requireEnv('DISCORD_TOKEN'),
      clientId: requireEnv('DISCORD_CLIENT_ID'),
      guildId: optionalEnv('DISCORD_GUILD_ID'),
      alertChannelId: optionalEnv('DISCORD_ALERT_CHANNEL_ID'),
      auditChannelId: optionalEnv('DISCORD_AUDIT_CHANNEL_ID'),
      logChannelId: optionalEnv(
        'DISCORD_LOG_CHANNEL_ID',
        HARDCODED_LOG_CHANNEL_ID
      ),
    },
    access: {
      adminIds,
    },
    encryption: {
      key: encryptionKey,
      oldKey: oldKey || null,
    },
    web: {
      port: intEnv('WEB_PORT', 8080, { min: 1, max: 65535 }),
      https: boolEnv('WEB_HTTPS', false),
    },
    storage: {
      logDir: optionalEnv('LOG_DIR', './logs'),
      logLevel: optionalEnv('LOG_LEVEL', 'info'),
    },
    database: {
      url: optionalEnv('DATABASE_URL'),
      host: optionalEnv('PGHOST', 'localhost'),
      port: intEnv('PGPORT', 5432, { min: 1, max: 65535 }),
      user: optionalEnv('PGUSER'),
      database: optionalEnv('PGDATABASE'),
      poolMax: intEnv('DB_POOL_MAX', 10, { min: 1 }),
    },
    egress: {
      // Non-public targets are denied by default. This is an intentional,
      // exact-IP exception for private Minecraft servers only; hostnames are
      // never approved through this setting to prevent DNS rebinding bypasses.
      privateDestinationAllowlist: ipListEnv(
        'MINECRAFT_PRIVATE_DESTINATION_ALLOWLIST'
      ),
    },
    limits: {
      maxBots: intEnv('MAX_BOTS', 50, { min: 1 }),
      queueSize: intEnv('BOT_QUEUE_SIZE', 100, { min: 1 }),
      queueTimeout: intEnv('BOT_QUEUE_TIMEOUT', 10_000, { min: 1 }),
      logSummaryIntervalMin: intEnv('LOG_SUMMARY_INTERVAL_MIN', 15, { min: 1 }),
    },
  };
} catch (err) {
  console.error(`[CONFIG] Fatal: ${err.message}`);
  process.exit(1);
}

module.exports = config;
