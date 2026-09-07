'use strict';

process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.ADMIN_USER_IDS ||= '123456789012345678';
process.env.DISCORD_TOKEN ||= 'test-discord-token';
process.env.DISCORD_CLIENT_ID ||= 'test-discord-client';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('EG-006: config falls back to ENCRYPTION_KEY when WEB_JWT_SECRET is unset', () => {
  const config = require('../src/config');
  assert.equal(config.web.jwtSecretUsesFallback, true);
  assert.equal(config.web.jwtSecret, process.env.ENCRYPTION_KEY);
});

test('EG-006: a dedicated WEB_JWT_SECRET decouples session signing from the encryption key', () => {
  const dedicated = 'Z'.repeat(48);
  const encryptionA = 'a'.repeat(64);
  const encryptionB = 'b'.repeat(64);

  // Simulate an operator who sets a dedicated WEB_JWT_SECRET while the
  // ENCRYPTION_KEY (here a different one) is being rotated.
  const script = `
    process.env.WEB_JWT_SECRET = ${JSON.stringify(dedicated)};
    process.env.ENCRYPTION_KEY = ${JSON.stringify(encryptionB)};
    process.env.ADMIN_USER_IDS = '123456789012345678';
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client';
    const config = require('./src/config');
    process.stdout.write(JSON.stringify({
      fallback: config.web.jwtSecretUsesFallback,
      equalsDedicated: config.web.jwtSecret === ${JSON.stringify(dedicated)},
      notEncryptionKey: config.web.jwtSecret !== ${JSON.stringify(encryptionA)},
    }));
  `;

  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      // A different encryption key in this subprocess must not change signing.
      ENCRYPTION_KEY: encryptionB,
      // Suppress dotenv's informational log line on stdout.
      DOTENV_CONFIG_QUIET: 'true',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.fallback, false);
  assert.equal(parsed.equalsDedicated, true);
  assert.equal(parsed.notEncryptionKey, true);
});
