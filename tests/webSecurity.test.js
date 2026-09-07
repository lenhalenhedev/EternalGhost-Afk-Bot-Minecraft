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
const helper = path.join(repoRoot, 'tasks', 'check-web-security.js');

function probe(overrides) {
  const result = spawnSync(process.execPath, [helper], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DOTENV_CONFIG_QUIET: 'true',
      ...overrides,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.slice(result.stdout.lastIndexOf('{')));
}

const baseEnv = {
  ENCRYPTION_KEY: 'a'.repeat(64),
  ADMIN_USER_IDS: '123456789012345678',
  DISCORD_TOKEN: 'test-token',
  DISCORD_CLIENT_ID: 'test-client',
};

test('EG-005: trust proxy is applied only when explicitly configured', () => {
  const configured = probe({
    ACT: 'trustproxy',
    WEB_TRUST_PROXY: '1',
    ...baseEnv,
  });
  assert.equal(configured.trustProxy, 1);

  const unset = probe({ ACT: 'trustproxy', ...baseEnv });
  assert.equal(unset.trustProxy, false);
});

test('EG-008: a global request budget returns 429 once exceeded', () => {
  const counts = probe({
    ACT: 'ratelimit',
    WEB_GLOBAL_LIMIT_PER_MIN: '5',
    ...baseEnv,
  });
  assert.equal(counts.ok, 5);
  assert.equal(counts.limited, 1);
});

test('EG-004: cross-origin state-changing requests are rejected', () => {
  const result = probe({ ACT: 'csrforigin', ...baseEnv });
  assert.equal(result.crossOrigin, 403);
  assert.equal(result.crossSiteFetchSite, 403);
  assert.equal(result.sameOrigin, 204);
});
