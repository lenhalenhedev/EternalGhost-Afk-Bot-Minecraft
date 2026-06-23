'use strict';

/**
 * Centralised PostgreSQL connection pool.
 *
 * Why node-postgres (`pg`) and not Prisma?
 *  - The existing Persistence interface (saveBot / getBot / findBot ...) is
 *    SYNCHRONOUS and called all over BotManager / instanceEvents without
 *    `await`. A `pg.Pool` lets us keep an in-memory cache as the runtime
 *    source of truth and write-behind to Postgres, so we can preserve that
 *    interface exactly. Prisma's client is async-only and would force an
 *    invasive rewrite of every caller.
 *  - `pg.Pool` gives us first-class connection pooling out of the box.
 *
 * Configuration precedence (highest first):
 *   1. DATABASE_URL  (e.g. postgres://user:pass@host:5432/dbname)
 *   2. Discrete PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
 *
 * All values are optional except that *one* of the two forms must be present.
 */

require('dotenv').config();
const { Pool } = require('pg');

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

/** Build the pg Pool config from environment variables. */
function buildPoolConfig() {
  const connectionString = optionalEnv('DATABASE_URL');

  // SSL: enable when PGSSLMODE=require or DB_SSL=true (common on managed PG).
  const sslEnabled =
    boolEnv('DB_SSL') || /^(require|verify-ca|verify-full)$/i.test(optionalEnv('PGSSLMODE', ''));
  const ssl = sslEnabled ? { rejectUnauthorized: boolEnv('DB_SSL_REJECT_UNAUTHORIZED', false) } : undefined;

  // Pool tuning (sensible production defaults; override via env).
  const poolTuning = {
    max: intEnv('DB_POOL_MAX', 10),
    min: intEnv('DB_POOL_MIN', 0),
    idleTimeoutMillis: intEnv('DB_POOL_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: intEnv('DB_POOL_CONNECTION_TIMEOUT_MS', 10_000),
  };

  if (connectionString) {
    return { connectionString, ssl, ...poolTuning };
  }

  // Fall back to discrete PG* vars. `pg` already reads PGHOST/PGUSER/... from
  // the environment automatically, but we pass them explicitly so the values
  // are visible/overridable in one place.
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

// A pool-level error handler is essential: idle clients can be dropped by the
// server/network and would otherwise crash the process with an unhandled error.
pool.on('error', (err) => {
  // Lazy-require to avoid a circular dependency at module load time.
  try {
    const { logger } = require('../services/logger');
    logger.error(`[database] Idle client error: ${err.message}`);
  } catch (_) {
    console.error('[database] Idle client error:', err.message);
  }
});

/**
 * Run a parameterised query against the pool.
 * @param {string} text  SQL with $1, $2 ... placeholders
 * @param {Array}  params
 * @returns {Promise<import('pg').QueryResult>}
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `fn` inside a single transaction. The callback receives a dedicated
 * client; BEGIN/COMMIT/ROLLBACK are handled automatically.
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Verify connectivity (used at startup). Throws if the DB is unreachable. */
async function assertConnection() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0] && rows[0].ok === 1;
}

/** Close the pool (call on graceful shutdown). */
function close() {
  return pool.end();
}

module.exports = { pool, query, withTransaction, assertConnection, close };
