'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createAuthService,
  sha256Hex,
  isSha256Hex,
} = require('../src/web/private/auth');

const PASSWORD = 'correct-horse-battery-staple';
const PASSWORD_HASH = sha256Hex(PASSWORD);

function createService(overrides = {}) {
  return createAuthService({
    username: 'admin',
    passwordHash: PASSWORD_HASH,
    sessionTtlMs: 60_000,
    loginWindowMs: 60_000,
    loginMaxAttempts: 3,
    ...overrides,
  });
}

test('sha256Hex produces the configured 64-character hash format', () => {
  assert.equal(
    sha256Hex(PASSWORD),
    '87cbebfeebc05f7c54ac9336c4b4bbec831227a641951a4bde7edd56020f8590'
  );
  assert.equal(isSha256Hex(PASSWORD_HASH), true);
  assert.equal(isSha256Hex('not-a-hash'), false);
});

test('login returns an httpOnly session and csrf token only for valid credentials', () => {
  const service = createService();
  assert.equal(
    service.login({ username: 'admin', password: PASSWORD }, '127.0.0.1').ok,
    true
  );
  assert.equal(
    service.login({ username: 'admin', password: 'wrong' }, '127.0.0.1').ok,
    false
  );
  const login = service.login(
    { username: 'admin', password: PASSWORD },
    '127.0.0.2'
  );
  const session = service.getSession(login.token);
  assert.equal(session.username, 'admin');
  assert.equal(typeof session.csrfToken, 'string');
  assert.equal(service.isCsrfValid(session, session.csrfToken), true);
  assert.equal(service.isCsrfValid(session, 'wrong'), false);
});

test('sessions expire and logout invalidates the token', () => {
  let now = 1_000;
  const service = createService({ now: () => now, sessionTtlMs: 100 });
  const login = service.login(
    { username: 'admin', password: PASSWORD },
    '127.0.0.1'
  );
  assert.equal(service.getSession(login.token).username, 'admin');
  now += 101;
  assert.equal(service.getSession(login.token), null);

  const second = service.login(
    { username: 'admin', password: PASSWORD },
    '127.0.0.1'
  );
  assert.equal(service.logout(second.token), true);
  assert.equal(service.getSession(second.token), null);
});

test('login rate limiting blocks repeated failures without blocking a new client', () => {
  const service = createService();
  assert.equal(
    service.login({ username: 'admin', password: 'bad' }, '10.0.0.1').ok,
    false
  );
  assert.equal(
    service.login({ username: 'admin', password: 'bad' }, '10.0.0.1').ok,
    false
  );
  assert.equal(
    service.login({ username: 'admin', password: 'bad' }, '10.0.0.1').ok,
    false
  );
  assert.equal(
    service.login({ username: 'admin', password: PASSWORD }, '10.0.0.1').reason,
    'rate_limited'
  );
  assert.equal(
    service.login({ username: 'admin', password: PASSWORD }, '10.0.0.2').ok,
    true
  );
});
