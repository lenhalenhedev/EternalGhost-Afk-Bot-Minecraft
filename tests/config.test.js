'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

// The config module must fail by throwing, never by calling process.exit() at
// require time. process.exit(1) during module evaluation would kill the whole
// node:test worker process instead of surfacing a catchable error, which made
// the security test suite silently env-dependent (EG-018).
test('src/config throws CONFIG_INVALID instead of process.exit when a required var is missing', () => {
  const script =
    "try { require('./src/config'); process.stdout.write('RESOLVED'); }" +
    " catch (e) { process.stdout.write('THREW:' + (e && e.code)); }";

  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ENCRYPTION_KEY: '',
      ADMIN_USER_IDS: '',
      DISCORD_TOKEN: '',
      DISCORD_CLIENT_ID: '',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(
    result.stdout.includes('THREW:CONFIG_INVALID'),
    `expected throw, got: ${result.stdout}`
  );
  assert.ok(!result.stdout.includes('RESOLVED'));
});
