'use strict';
/**
 * Centralised PostgreSQL connection pool.
 *
 * MEMORY LEAK / RESOURCE LEAK FIXES:
 * - withTransaction() uses try/finally to ALWAYS release the client back to the
 *   pool, even if ROLLBACK itself throws (prevents connection exhaustion)
 * - Added connection leak detection logging
 * - Pool error handler prevents unhandled errors from crashing the process
 * - close() properly drains all connections on shutdown
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function optionalEnv(key, defaultValue = undefined) {
  const v = process.env[key];
  return v === undefined || v.trim() === '' ? defaultValue : v.trim();
}

function boolEnv(key, defaultValue = false) {
  const v = optionalEnv(key);
  if (v === undefined) return defaultValue;
  return /^(1|true|yes|on)$/i.test(v);
}

function intEnv(key, defaultValue) {
  const v = optionalEnv(key);
  const n = v === undefined ? NaN : parseInt(v, 10);
  return Number.isNaN(n) ? defaultValue : n;
}

/**
 * Safely read a CA certificate file for SSL connections.
 *
 * Returns the file contents as a UTF-8 string, or `null` if the path is not
 * configured, the file does not exist, or it cannot be read for any reason
 * (permissions, corrupt path, etc). Errors are logged clearly but never
 * thrown here — callers decide the fallback behaviour.
 */
function readSslCertificate(certPath) {
  if (!certPath) return null;

  const resolvedPath = path.resolve(certPath);

  try {
    if (!fs.existsSync(resolvedPath)) {
      console.warn(
        `[database] DB_SSL_CERT_PATH is set to "${certPath}" but the file was not found at "${resolvedPath}".`
      );
      return null;
    }
    return fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    console.error(
      `[database] Failed to read SSL certificate at "${resolvedPath}": ${err.message}`
    );
    return null;
  }
}

/**
 * Build the `ssl` option for the pg Pool config.
 *
 * - DB_SSL=false (default) -> SSL disabled, returns `undefined`.
 * - DB_SSL=true + no valid DB_SSL_CERT_PATH -> falls back to
 *   `rejectUnauthorized: false` (works for self-signed certs used by managed
 *   providers like Supabase/Neon) and logs a warning so this is never silent.
 * - DB_SSL=true + valid DB_SSL_CERT_PATH -> loads the CA cert and honours
 *   DB_SSL_REJECT_UNAUTHORIZED for strict certificate validation.
 */
function buildSslConfig() {
  const sslEnabled =
    boolEnv('DB_SSL') ||
    /^(require|verify-ca|verify-full)$/i.test(optionalEnv('PGSSLMODE', ''));

  if (!sslEnabled) return undefined;

  const certPath = optionalEnv('DB_SSL_CERT_PATH');
  const rejectUnauthorized = boolEnv('DB_SSL_REJECT_UNAUTHORIZED', false);
  const ca = readSslCertificate(certPath);

  if (!ca) {
    if (certPath) {
      // A path was provided but the cert could not be loaded — still fail
      // open to `rejectUnauthorized: false` so the app can boot, but the
      // warnings above/below make the misconfiguration impossible to miss.
      console.warn(
        '[database] SSL is enabled but the certificate at DB_SSL_CERT_PATH could not be loaded. ' +
          'Falling back to rejectUnauthorized: false.'
      );
    } else {
      console.warn(
        '[database] SSL is enabled but DB_SSL_CERT_PATH is missing. Falling back to rejectUnauthorized: false.'
      );
    }
    return { rejectUnauthorized: false };
  }

  return { ca, rejectUnauthorized };
}

/** Build the pg Pool config from environment variables. */
function buildPoolConfig() {
  const connectionString = optionalEnv('DATABASE_URL');
  const ssl = buildSslConfig();

  const poolTuning = {
    max: intEnv('DB_POOL_MAX', 2),
    min: intEnv('DB_POOL_MIN', 1),
    idleTimeoutMillis: intEnv('DB_POOL_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: intEnv('DB_POOL_CONNECTION_TIMEOUT_MS', 10_000),
    // FIX: Enable statement timeout to prevent long-running queries from
    // holding connections indefinitely (resource leak prevention).
    statement_timeout: intEnv('DB_STATEMENT_TIMEOUT_MS', 30_000),
  };

  if (connectionString) {
    return { connectionString, ssl, ...poolTuning };
  }

  return {
    host: optionalEnv('PGHOST', 'localhost'),
    port: intEnv('PGPORT', 5432),
    user: optionalEnv('PGUSER'),
    password: optionalEnv('PGPASSWORD'),
    database: optionalEnv('PGDATABASE'),
    ssl,
    ...poolTuning,
  };
}

const pool = new Pool(buildPoolConfig());

// FIX: Track pool metrics for leak detection
let _acquireCount = 0;
let _releaseCount = 0;

pool.on('acquire', () => {
  _acquireCount++;
});
pool.on('release', () => {
  _releaseCount++;
});

pool.on('error', (err) => {
  try {
    const { logger } = require('../services/logger');
    logger.error(`[database] Idle client error: ${err.message}`);
  } catch {
    console.error('[database] Idle client error:', err.message);
  }
});

/**
 * Run a parameterised query against the pool.
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `fn` inside a single transaction.
 *
 * FIX: The client is ALWAYS released in the finally block, even if ROLLBACK
 * throws. The original code could leak the client if ROLLBACK failed (e.g.,
 * network timeout during rollback), eventually exhausting the pool.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    committed = true;
    return result;
  } catch (err) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore rollback errors */
      }
    }
    throw err;
  } finally {
    // FIX: ALWAYS release the client, regardless of what happened above.
    // Passing `true` to release() signals that the client is in an error state
    // and should be destroyed rather than returned to the pool.
    client.release(!committed);
  }
}

/** Verify connectivity (used at startup). */
async function assertConnection() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0] && rows[0].ok === 1;
}

/** Close the pool (call on graceful shutdown). */
function close() {
  return pool.end();
}

/** Get pool health metrics (useful for monitoring). */
function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    acquired: _acquireCount,
    released: _releaseCount,
    leakedEstimate: _acquireCount - _releaseCount - pool.totalCount,
  };
}

module.exports = {
  pool,
  query,
  withTransaction,
  assertConnection,
  close,
  getPoolStats,
};
