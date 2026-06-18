'use strict';
require('dotenv').config();

function requireEnv(key) {
  const val = process.env[key];
  if (!val || val.trim() === '') throw new Error(`Missing required env var: ${key}`);
  return val.trim();
}

function optionalEnv(key, defaultValue = '') {
  return (process.env[key] || defaultValue).trim();
}

// ─── Hard-coded Discord log channel ─────────────────────────────────────
// Bot errors / bug logs are posted to this channel. Paste your Discord channel
// ID between the quotes to hard-code it. The DISCORD_LOG_CHANNEL_ID env var, if
// set, takes precedence over this value.
const HARDCODED_LOG_CHANNEL_ID = '';

function validateHexKey(key, name) {
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`${name} must be a 64-char hex string (32 bytes). Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
  }
}

let config;
try {
  const encryptionKey = requireEnv('ENCRYPTION_KEY');
  validateHexKey(encryptionKey, 'ENCRYPTION_KEY');

  const oldKey = optionalEnv('OLD_ENCRYPTION_KEY');
  if (oldKey) validateHexKey(oldKey, 'OLD_ENCRYPTION_KEY');

  const adminIds = requireEnv('ADMIN_USER_IDS').split(',').map(s => s.trim()).filter(Boolean);
  if (adminIds.length === 0) throw new Error('ADMIN_USER_IDS must contain at least one Discord user ID');

  config = {
    discord: {
      token:          requireEnv('DISCORD_TOKEN'),
      clientId:       requireEnv('DISCORD_CLIENT_ID'),
      guildId:        optionalEnv('DISCORD_GUILD_ID'),
      alertChannelId: optionalEnv('DISCORD_ALERT_CHANNEL_ID'),
      auditChannelId: optionalEnv('DISCORD_AUDIT_CHANNEL_ID'),
      logChannelId:   optionalEnv('DISCORD_LOG_CHANNEL_ID', HARDCODED_LOG_CHANNEL_ID),
    },
    access: {
      adminIds,
    },
    encryption: {
      key:    encryptionKey,
      oldKey: oldKey || null,
    },
    storage: {
      dataFile: optionalEnv('DATA_FILE', './data/bots.json'),
      logDir:   optionalEnv('LOG_DIR', './logs'),
      logLevel: optionalEnv('LOG_LEVEL', 'info'),
    },
    limits: {
      maxBots:              parseInt(optionalEnv('MAX_BOTS', '50'), 10),
      queueSize:            parseInt(optionalEnv('BOT_QUEUE_SIZE', '100'), 10),
      queueTimeout:         parseInt(optionalEnv('BOT_QUEUE_TIMEOUT', '10000'), 10),
      logSummaryIntervalMin:parseInt(optionalEnv('LOG_SUMMARY_INTERVAL_MIN', '15'), 10),
    },
  };
} catch (err) {
  console.error(`[CONFIG] Fatal: ${err.message}`);
  process.exit(1);
}

module.exports = config;
