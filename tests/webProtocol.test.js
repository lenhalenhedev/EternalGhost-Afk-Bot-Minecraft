const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readHeaders(webHttps) {
  const result = spawnSync(process.execPath, ['tasks/check-web-headers.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ENCRYPTION_KEY: 'a'.repeat(64),
      ADMIN_USER_IDS: '123456789012345678',
      DISCORD_TOKEN: 'test-token',
      DISCORD_CLIENT_ID: 'test-client',
      WEB_HTTPS: webHttps,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const jsonStart = result.stdout.lastIndexOf('\n{');
  return JSON.parse(result.stdout.slice(jsonStart >= 0 ? jsonStart + 1 : 0));
}

test('HTTP mode does not force HTTPS-only browser policies', () => {
  const headers = readHeaders('false');
  assert.equal(headers.status, 200);
  assert.doesNotMatch(headers.csp, /upgrade-insecure-requests/);
  assert.equal(headers.hsts, null);
  assert.equal(headers.coop, null);
  assert.equal(headers.oac, null);
});

test('HTTPS mode enables protocol-aware browser policies', () => {
  const headers = readHeaders('true');
  assert.match(headers.csp, /upgrade-insecure-requests/);
  assert.match(headers.hsts, /max-age=/);
  assert.equal(headers.coop, 'same-origin');
  assert.equal(headers.oac, '?1');
});
