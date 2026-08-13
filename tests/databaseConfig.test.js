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
  ]) {
    delete env[key];
  }
  Object.assign(env, { DOTENV_CONFIG_QUIET: 'true' }, overrides);

  const script = `
    const database = require(${JSON.stringify(DATABASE_MODULE)});
    const ssl = database.pool.options.ssl;
    process.stdout.write(JSON.stringify({
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

test('strict TLS aborts startup when the CA path is missing', () => {
  const result = runDatabaseLoad({
    DB_SSL: 'true',
    DB_SSL_REJECT_UNAUTHORIZED: 'true',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FATAL: DB_SSL_REJECT_UNAUTHORIZED=true/);
  assert.match(result.stderr, /missing or invalid/);
});

test('strict validation aborts startup even when DB_SSL is off', () => {
  const result = runDatabaseLoad({
    DB_SSL: 'false',
    DB_SSL_REJECT_UNAUTHORIZED: 'true',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FATAL: DB_SSL_REJECT_UNAUTHORIZED=true/);
});

test('strict TLS aborts startup when the CA path is invalid', () => {
  const result = runDatabaseLoad({
    DB_SSL: 'true',
    DB_SSL_CERT_PATH: path.join(os.tmpdir(), 'missing-ca-for-audit.pem'),
    DB_SSL_REJECT_UNAUTHORIZED: 'true',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FATAL: DB_SSL_REJECT_UNAUTHORIZED=true/);
  assert.match(result.stderr, /missing or invalid/);
});

test('strict TLS aborts startup when a readable CA file is malformed', () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'invalid-database-ca-')
  );
  const certPath = path.join(tempDir, 'ca.pem');
  fs.writeFileSync(certPath, 'not a PEM certificate', { mode: 0o600 });

  try {
    const result = runDatabaseLoad({
      DB_SSL: 'true',
      DB_SSL_CERT_PATH: certPath,
      DB_SSL_REJECT_UNAUTHORIZED: 'true',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FATAL: DB_SSL_REJECT_UNAUTHORIZED=true/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('non-strict TLS ignores a missing or invalid CA path', () => {
  const result = runDatabaseLoad({
    DB_SSL: 'true',
    DB_SSL_CERT_PATH: path.join(os.tmpdir(), 'ignored-ca-for-audit.pem'),
    DB_SSL_REJECT_UNAUTHORIZED: 'false',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ssl: { rejectUnauthorized: false, hasCa: false },
  });
});

test('strict TLS accepts a readable, parseable CA certificate', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'database-ca-'));
  const certPath = path.join(tempDir, 'ca.pem');
  fs.writeFileSync(certPath, tls.rootCertificates[0], { mode: 0o600 });

  try {
    const result = runDatabaseLoad({
      DB_SSL: 'true',
      DB_SSL_CERT_PATH: certPath,
      DB_SSL_REJECT_UNAUTHORIZED: 'true',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ssl: { rejectUnauthorized: true, hasCa: true },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('invalid strict boolean configuration aborts startup', () => {
  const result = runDatabaseLoad({
    DB_SSL: 'true',
    DB_SSL_REJECT_UNAUTHORIZED: 'sometimes',
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /FATAL: DB_SSL_REJECT_UNAUTHORIZED must be explicitly true or false/
  );
});
