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
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tls = require('tls');

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

function strictBoolEnv(key, defaultValue = false) {
  const v = optionalEnv(key);
  if (v === undefined) return defaultValue;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  throw new Error(
    `[database] FATAL: ${key} must be explicitly true or false when provided.`
  );
}

/**
 * Read and validate a CA certificate for strict SSL connections.
 *
 * Returns the PEM contents when the path is a readable regular file containing
 * a certificate accepted by Node's TLS parser, or `null` otherwise. The caller
 * is responsible for logging a fatal startup error when strict verification is
 * enabled.
 */
function readSslCertificate(certPath) {
  if (!certPath) return null;

  const resolvedPath = path.resolve(certPath);

  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) return null;

    const ca = fs.readFileSync(resolvedPath, 'utf8');
    const certificatePattern =
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
    const certificates = ca.match(certificatePattern);
    if (!certificates || ca.replace(certificatePattern, '').trim()) return null;

    // Node's TLS context ignores unrecognised CA text, so parse every PEM
    // certificate explicitly before allowing Pool construction.
    for (const certificate of certificates) {
      new crypto.X509Certificate(certificate);
    }
    tls.createSecureContext({ ca });
    return ca;
  } catch {
    return null;
  }
}

function isLoopbackDatabaseHost(host) {
  const normalized = String(host || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    /^127\./.test(normalized)
  );
}

function fatalTls(message) {
  console.error(`[database] FATAL: ${message}`);
  throw new Error(message);
}

function parseDatabaseTarget(connectionString) {
  if (!connectionString) {
    const host = optionalEnv('PGHOST', 'localhost');
    return { host, connectionString: null };
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    fatalTls('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  const unsafeSslParameters = [
    'ssl',
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'rejectunauthorized',
  ];
  if (
    [...url.searchParams.keys()].some((key) =>
      unsafeSslParameters.includes(key.toLowerCase())
    )
  ) {
    fatalTls(
      'DATABASE_URL must not include SSL parameters; use DB_SSL_CERT_PATH instead.'
    );
  }
  return { host: url.hostname, connectionString };
}

/**
 * Build the pg SSL option. Any non-loopback database must provide a trusted CA
 * and certificate verification. Local development may deliberately use a
 * loopback plaintext socket, but never an unverified TLS connection.
 */
function buildSslConfig({ remote }) {
  const sslEnabled = boolEnv('DB_SSL');
  const rejectUnauthorized = strictBoolEnv('DB_SSL_REJECT_UNAUTHORIZED', false);

  if (remote && (!sslEnabled || !rejectUnauthorized)) {
    fatalTls(
      'remote PostgreSQL requires verified TLS (DB_SSL=true, DB_SSL_REJECT_UNAUTHORIZED=true, and DB_SSL_CERT_PATH).'
    );
  }
  if (!sslEnabled) return undefined;
  if (!rejectUnauthorized) {
    fatalTls('unverified PostgreSQL TLS is not supported.');
  }

  const ca = readSslCertificate(optionalEnv('DB_SSL_CERT_PATH'));
  if (!ca) {
    fatalTls(
      'verified PostgreSQL TLS requires DB_SSL_CERT_PATH to reference a readable, valid CA certificate.'
    );
  }
  return { ca, rejectUnauthorized: true };
}

/** Build the pg Pool config from environment variables. */
function buildPoolConfig() {
  const target = parseDatabaseTarget(optionalEnv('DATABASE_URL'));
  const ssl = buildSslConfig({ remote: !isLoopbackDatabaseHost(target.host) });
  const connectionString = target.connectionString;

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
    host: target.host,
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
