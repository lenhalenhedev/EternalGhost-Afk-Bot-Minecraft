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

test('EG-011: an alternate origin on the same host is rejected', () => {
  // The previous fallback compared only the hostname and stripped the port, so
  // a different HTTPS origin on the same host could pass the CSRF guard while
  // still being cross-origin.
  const result = probe({ ACT: 'csrforiginstrict', ...baseEnv });
  assert.equal(result.sameHostDifferentPort, 403);
  assert.equal(result.sameHostDifferentScheme, 403);
  assert.equal(result.malformedOrigin, 403);
  assert.equal(
    result.requestOrigin,
    204,
    'the real request origin stays allowed'
  );
  assert.equal(
    result.noOrigin,
    204,
    'non-browser clients without Origin still pass'
  );
});

test('EG-011: WEB_PUBLIC_ORIGIN pins the exact accepted origin', () => {
  const result = probe({
    ACT: 'csrforiginstrict',
    WEB_PUBLIC_ORIGIN: 'https://dashboard.example.test',
    ...baseEnv,
  });
  assert.equal(result.configuredPublicOrigin, 204);
  assert.equal(
    result.requestOrigin,
    403,
    'once a canonical origin is configured the inferred request origin must not be trusted'
  );
  assert.equal(result.sameHostDifferentPort, 403);
});

test('EG-011: WEB_HTTPS=true deploys still accept their own https origin', () => {
  // Behind a TLS-terminating proxy the request arrives over http but the public
  // origin is https; the guard must derive the expected origin from WEB_HTTPS.
  const result = probe({
    ACT: 'csrforiginstrict',
    WEB_HTTPS: 'true',
    ...baseEnv,
  });
  assert.equal(
    result.requestOrigin,
    403,
    'a plain http origin is no longer accepted'
  );
  assert.equal(
    result.sameHostDifferentScheme,
    204,
    'the https origin is accepted'
  );
  assert.equal(result.noOrigin, 204);
});

test('EG-011: a malformed WEB_PUBLIC_ORIGIN is refused at startup', () => {
  const result = spawnSync(
    process.execPath,
    ['-e', "require('./src/config'); console.log('loaded');"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DOTENV_CONFIG_QUIET: 'true',
        WEB_PUBLIC_ORIGIN: 'dashboard.example.test/path',
        ...baseEnv,
      },
      encoding: 'utf8',
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WEB_PUBLIC_ORIGIN/);
});
