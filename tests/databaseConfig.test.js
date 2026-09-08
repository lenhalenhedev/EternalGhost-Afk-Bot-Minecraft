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
    'DB_ALLOW_LOOPBACK_PLAINTEXT',
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

// ── EG-010: loopback classification must be by IP literal, not text prefix ──

test('EG-010: only parsed loopback literals count as local', () => {
  const { isLoopbackDatabaseHost } = require('../src/config/database');

  for (const host of [
    '127.0.0.1',
    '127.1.2.3',
    '127.255.255.254',
    '::1',
    '[::1]',
    'localhost',
  ]) {
    assert.equal(
      isLoopbackDatabaseHost(host),
      true,
      `${host} must be loopback`
    );
  }

  for (const host of [
    '127.db.example.test', // remote DNS name with a loopback-looking prefix
    '127.example.com',
    'db.example.test',
    '128.0.0.1',
    '12.7.0.1',
    '1270.0.1',
    '::2',
    '0:0:0:0:0:0:0:2',
    'localhost.example.test',
    '',
  ]) {
    assert.equal(isLoopbackDatabaseHost(host), false, `${host} must be remote`);
  }
});

test('EG-010: a remote hostname beginning with "127." requires verified TLS', () => {
  const result = runDatabaseLoad({ PGHOST: '127.db.example.test' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FATAL: remote PostgreSQL requires verified TLS/);
});

test('EG-010: DATABASE_URL and discrete PGHOST classify identically', () => {
  for (const overrides of [
    { DATABASE_URL: 'postgres://user@127.db.example.test/app' },
    { PGHOST: '127.db.example.test' },
  ]) {
    const result = runDatabaseLoad(overrides);
    assert.notEqual(result.status, 0, JSON.stringify(overrides));
    assert.match(
      result.stderr,
      /FATAL: remote PostgreSQL requires verified TLS/
    );
  }
});

test('EG-010: any loopback address in 127.0.0.0/8 may use plaintext', () => {
  for (const host of ['127.0.0.1', '127.9.8.7']) {
    const result = runDatabaseLoad({ PGHOST: host });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { host, ssl: null });
  }
});

test('EG-010: DB_ALLOW_LOOPBACK_PLAINTEXT=false forces verified TLS everywhere', () => {
  const result = runDatabaseLoad({
    PGHOST: '127.0.0.1',
    DB_ALLOW_LOOPBACK_PLAINTEXT: 'false',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FATAL: remote PostgreSQL requires verified TLS/);
});
