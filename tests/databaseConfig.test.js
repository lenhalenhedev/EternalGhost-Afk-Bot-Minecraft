'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tls = require('node:tls');

const REPO_ROOT = path.resolve(__dirname, '..');
const DATABASE_MODULE = './src/config/database';

function runDatabaseLoad(overrides) {
  const env = { ...process.env };
  for (const key of [
    'DB_SSL',
    'DB_SSL_CERT_PATH',
    'DB_SSL_REJECT_UNAUTHORIZED',
    'PGSSLMODE',
    'DATABASE_URL',
    'PGHOST',
  ]) {
    delete env[key];
  }
  Object.assign(env, { DOTENV_CONFIG_QUIET: 'true' }, overrides);

  const script = `
    const database = require(${JSON.stringify(DATABASE_MODULE)});
    const ssl = database.pool.options.ssl;
    process.stdout.write(JSON.stringify({
      host: database.pool.options.host || null,
      ssl: ssl === undefined ? null : {
        rejectUnauthorized: ssl.rejectUnauthorized,
        hasCa: typeof ssl.ca === 'string' && ssl.ca.length > 0,
      },
    }));
    database.close().catch(() => process.exitCode = 1);
  `;

  return spawnSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
  });
}

function withTrustedCa(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'database-ca-'));
  const certPath = path.join(tempDir, 'ca.pem');
  fs.writeFileSync(certPath, tls.rootCertificates[0], { mode: 0o600 });
  try {
    callback(certPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('a remote database aborts startup without an explicit verified-TLS CA', () => {
  const result = runDatabaseLoad({ PGHOST: 'db.example.test' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FATAL: remote PostgreSQL requires verified TLS/);
});

test('a remote database rejects plaintext and unverified TLS toggles', () => {
  for (const overrides of [
    { PGHOST: 'db.example.test', DB_SSL: 'false' },
    {
      PGHOST: 'db.example.test',
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'false',
    },
  ]) {
    const result = runDatabaseLoad(overrides);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /FATAL: remote PostgreSQL requires verified TLS/
    );
  }
});

test('a remote database accepts a readable CA only with certificate verification enabled', () => {
  withTrustedCa((certPath) => {
    const result = runDatabaseLoad({
      PGHOST: 'db.example.test',
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'true',
      DB_SSL_CERT_PATH: certPath,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      host: 'db.example.test',
      ssl: { rejectUnauthorized: true, hasCa: true },
    });
  });
});

test('database URLs with TLS parameters are rejected so they cannot override verified TLS', () => {
  const result = runDatabaseLoad({
    DATABASE_URL:
      'postgres://user:password@db.example.test/app?sslmode=no-verify',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not include SSL parameters/);
});

test('an explicit loopback development database may use local plaintext transport', () => {
  const result = runDatabaseLoad({ PGHOST: '127.0.0.1' });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    host: '127.0.0.1',
    ssl: null,
  });
});

test('invalid TLS booleans abort startup', () => {
  const result = runDatabaseLoad({
    PGHOST: 'db.example.test',
    DB_SSL_REJECT_UNAUTHORIZED: 'sometimes',
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /FATAL: DB_SSL_REJECT_UNAUTHORIZED must be explicitly true or false/
  );
});
