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

/**
 * Validate an origin-shaped environment value (EG-011).
 *
 * Only absolute http(s) origins without credentials, path, query or fragment
 * are accepted; the value is normalised through the WHATWG URL parser so the
 * caller can compare it byte-for-byte with `URL#origin`.
 */
function originEnv(key) {
  const value = optionalEnv(key);
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${key} must be an absolute http(s) URL such as https://dashboard.example.com.`
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`${key} must use http or https.`);
  if (url.username || url.password)
    throw new Error(`${key} must not contain credentials.`);
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error(`${key} must not contain a path, query or fragment.`);
  return url.origin;
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

/**
 * Parse WEB_TRUST_PROXY into a value accepted by Express's `trust proxy`.
 * Accepts either a hop count (a small non-negative integer) or a
 * comma/space-separated list of trusted proxy IPs / CIDRs. We deliberately do
 * NOT accept the boolean true, which would trust arbitrary X-Forwarded-For
 * values from any source and let an attacker spoof the client IP to defeat the
 * login rate limiter. Returns undefined when unset (Express defaults to false).
 */
function trustProxyEnv(key) {
  const value = optionalEnv(key).trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops < 1 || hops > 10) {
      throw new Error(`${key} hop count must be between 1 and 10`);
    }
    return hops;
  }
  const entries = value.split(/[\s,]+/).filter(Boolean);
  const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  const valid = entries.every(
    (entry) => net.isIP(entry) !== 0 || CIDR_RE.test(entry)
  );
  if (!valid) {
    throw new Error(
      `${key} must be a hop count or a comma/space list of trusted proxy IPs/CIDRs`
    );
  }
  return entries;
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

  // Optional dedicated secret for signing dashboard JWTs. Keeping it separate
  // from ENCRYPTION_KEY lets operators rotate encryption keys without silently
  // invalidating every active session, and stops a single leaked secret from
  // granting both session forgery and Minecraft-password decryption (EG-006).
  const webJwtSecret = optionalEnv('WEB_JWT_SECRET');
  if (webJwtSecret && webJwtSecret.length < 32) {
    throw new Error('WEB_JWT_SECRET must be at least 32 characters long.');
  }

  // Only trust a reverse proxy when the operator explicitly configures it.
  // Unset (undefined) keeps Express's default of no trust, which is correct for
  // direct-to-Internet HTTP deployments and prevents X-Forwarded-For spoofing.
  const webTrustProxy = trustProxyEnv('WEB_TRUST_PROXY');

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
      // EG-011: explicit public origin used for the exact same-origin CSRF
      // comparison. Empty means "derive it from the request Host + WEB_HTTPS".
      publicOrigin: originEnv('WEB_PUBLIC_ORIGIN'),
      jwtSecret: webJwtSecret || encryptionKey,
      jwtSecretUsesFallback: !webJwtSecret,
      trustProxy: webTrustProxy,
      globalLimitPerMin: intEnv('WEB_GLOBAL_LIMIT_PER_MIN', 600, { min: 1 }),
      botsLimitPerMin: intEnv('WEB_BOTS_LIMIT_PER_MIN', 300, { min: 1 }),
      eventsLimitPerMin: intEnv('WEB_EVENTS_LIMIT_PER_MIN', 30, { min: 1 }),
      allowedCommandPrefixes: optionalEnv('ALLOWED_COMMAND_PREFIXES')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    },
    storage: {
      logDir: optionalEnv('LOG_DIR', './logs'),
      logLevel: optionalEnv('LOG_LEVEL', 'info'),
      // EG-004: bound durable log volume. Total on-disk usage per file is
      // logMaxFileBytes * (logMaxFiles + 1).
      logMaxFileBytes: intEnv('LOG_MAX_FILE_BYTES', 10 * 1024 * 1024, {
        min: 4_096,
        max: 1_073_741_824,
      }),
      logMaxFiles: intEnv('LOG_MAX_FILES', 5, { min: 1, max: 100 }),
      // Longest untrusted message retained per log record.
      logMessageMaxChars: intEnv('LOG_MESSAGE_MAX_CHARS', 2_000, {
        min: 128,
        max: 65_536,
      }),
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
      maxBotsPerUser: intEnv('MAX_BOTS_PER_USER', 5, { min: 1, max: 5 }),
      botCreateLimit: intEnv('BOT_CREATE_LIMIT', 5, { min: 1, max: 5 }),
      botCreateWindowMs: intEnv('BOT_CREATE_WINDOW_MS', 600_000, { min: 1 }),
      chatCooldownMs: intEnv('CHAT_COOLDOWN_MS', 2_500, { min: 1 }),
      queueSize: intEnv('BOT_QUEUE_SIZE', 100, { min: 1 }),
      queueTimeout: intEnv('BOT_QUEUE_TIMEOUT', 10_000, { min: 1 }),
      logSummaryIntervalMin: intEnv('LOG_SUMMARY_INTERVAL_MIN', 15, { min: 1 }),
      // EG-004: hard cap on frames buffered per slow/stalled SSE client.
      sseMaxBufferedEvents: intEnv('SSE_MAX_BUFFERED_EVENTS', 200, {
        min: 1,
        max: 10_000,
      }),
    },
  };
} catch (err) {
  // Never call process.exit() at module scope. Doing so would silently kill any
  // consumer that requires this module in a worker/subprocess (notably the
  // node:test runner) instead of surfacing a catchable error. Startup entry
  // points (index.js) translate a throw into the original fail-closed exit(1).
  const fatal = new Error(`Configuration error: ${err?.message || err}`);
  fatal.code = 'CONFIG_INVALID';
  fatal.cause = err;
  throw fatal;
}

module.exports = config;
