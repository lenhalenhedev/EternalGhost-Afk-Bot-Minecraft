'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('EG-013: runtime log output paths are git-ignored so they cannot be committed', () => {
  for (const candidate of ['logs/run.log', 'log.txt']) {
    const result = spawnSync('git', ['check-ignore', '-q', candidate], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(
      result.status,
      0,
      `expected ${candidate} to be git-ignored (git check-ignore exit 0)`
    );
  }
});

test('EG-013: run.js writes logs under the ignored logs/ directory and does not use a shell', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'run.js'), 'utf8');
  assert.match(source, /'run\.log'/, 'run.js writes to logs/run.log');
  assert.ok(
    !source.includes("path.join(__dirname, 'log.txt')"),
    'run.js must not target a repo-root log.txt'
  );
  assert.match(source, /shell:\s*false/);
});

test('EG-011: Dockerfile restricts runtime writability to /app/logs and adds a HEALTHCHECK', () => {
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
  assert.ok(
    !dockerfile.includes('chown -R node:node /app\n'),
    'must not chown the whole application tree'
  );
  assert.ok(
    dockerfile.includes('chown -R node:node /app/logs'),
    'must chown only the log directory'
  );
  assert.match(dockerfile, /HEALTHCHECK/);
});

test('EG-012: compose binds the published port to loopback by default and hardens the container', () => {
  const compose = fs.readFileSync(
    path.join(repoRoot, 'docker-compose.yml'),
    'utf8'
  );
  assert.match(
    compose,
    /\$\{WEB_BIND_HOST:-127\.0\.0\.1\}/,
    'default bind must be loopback'
  );
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /cap_drop:/);
  assert.match(compose, /no-new-privileges:true/);
});
