'use strict';

/**
 * EG-002 regression tests: dashboard token reissue must always produce a
 * distinct credential, and renewal must succeed for a stored expiry that
 * carries millisecond precision.
 *
 * The database is an in-process stub; no PostgreSQL instance is contacted and
 * no real credential is produced (the signing secret is the dummy value from
 * tests/support/envSetup.js).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const db = require('../src/config/database');
const config = require('../src/config');
const {
  buildSignedToken,
  signToken,
  hashToken,
  issueToken,
  renewToken,
  verifyActiveToken,
  toWholeSecond,
} = require('../src/web/auth/tokenService');

const DAY_MS = 24 * 60 * 60 * 1_000;
const USER = '123456789012345678';

function installFakeDatabase() {
  const rows = new Map();
  const original = { query: db.query, withTransaction: db.withTransaction };

  const runQuery = (text, params) => {
    if (/SELECT user_id, expires_at\s+FROM web_tokens/.test(text)) {
      const row = rows.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/SELECT user_id, issued_at, expires_at\s+FROM web_tokens/.test(text)) {
      const row = rows.get(params[0]);
      const matches =
        row && row.token_hash === params[1] && row.expires_at > new Date();
      return { rows: matches ? [row] : [] };
    }
    if (/INSERT INTO web_tokens/.test(text) || /UPDATE web_tokens/.test(text)) {
      const row = {
        user_id: params[0],
        token_hash: params[1],
        issued_at: params[2],
        expires_at: params[3],
      };
      rows.set(params[0], row);
      return { rows: [row] };
    }
    throw new Error(`unexpected query in EG-002 test: ${text}`);
  };

  db.query = async (text, params) => runQuery(text, params);
  db.withTransaction = async (fn) => fn({ query: runQuery });
  return {
    rows,
    restore() {
      db.query = original.query;
      db.withTransaction = original.withTransaction;
    },
  };
}

test('EG-002: identical user/TTL issuances inside one second differ', () => {
  // A fixed clock inside the current second: both issuances share one iat.
  const fixedNow = Date.now() + 60_000;
  const a = buildSignedToken(USER, DAY_MS, { issuedAtMs: fixedNow });
  const b = buildSignedToken(USER, DAY_MS, { issuedAtMs: fixedNow });

  assert.notEqual(a.token, b.token, 'same-second reissue must differ');
  assert.notEqual(a.jti, b.jti);
  assert.notEqual(hashToken(a.token), hashToken(b.token));

  const decoded = jwt.verify(a.token, config.web.jwtSecret, {
    algorithms: ['HS256'],
  });
  assert.equal(decoded.userId, USER);
  assert.equal(typeof decoded.jti, 'string');
  assert.ok(decoded.jti.length >= 32, 'jti must carry real entropy');
});

test('EG-002: token timestamps are canonical whole seconds matching the TTL', () => {
  const issued = buildSignedToken(USER, 30 * DAY_MS, {
    issuedAtMs: Date.now() + 987,
  });
  assert.equal(issued.issuedAt.getMilliseconds(), 0);
  assert.equal(issued.expiresAt.getMilliseconds(), 0);
  assert.equal(
    issued.expiresAt.getTime() - issued.issuedAt.getTime(),
    30 * DAY_MS
  );

  const decoded = jwt.verify(issued.token, config.web.jwtSecret, {
    algorithms: ['HS256'],
  });
  assert.equal(decoded.exp - decoded.iat, (30 * DAY_MS) / 1_000);
  assert.equal(Number.isInteger(decoded.exp), true);
  assert.equal(toWholeSecond(1_700_000_000_999), 1_700_000_000_000);
});

test('EG-002: a reissued token invalidates the previous bearer', async () => {
  const fake = installFakeDatabase();
  try {
    const first = await issueToken(USER, DAY_MS);
    const second = await issueToken(USER, DAY_MS);

    assert.notEqual(first.token, second.token);
    assert.notEqual(
      hashToken(first.token),
      hashToken(second.token),
      'the stored hash must change so the UPSERT really rotates'
    );

    await assert.rejects(
      verifyActiveToken(first.token),
      /revoked/,
      'the superseded bearer must stop authenticating'
    );
    const active = await verifyActiveToken(second.token);
    assert.equal(active.userId, USER);
  } finally {
    fake.restore();
  }
});

test('EG-002: renewal succeeds for a stored expiry with millisecond precision', async () => {
  const fake = installFakeDatabase();
  try {
    // PostgreSQL TIMESTAMPTZ values routinely carry a sub-second component.
    const storedExpiry = new Date(Date.now() + 5 * DAY_MS + 437);
    fake.rows.set(USER, {
      user_id: USER,
      token_hash: 'stale',
      issued_at: new Date(),
      expires_at: storedExpiry,
    });

    const renewed = await renewToken(USER, 1);
    assert.equal(typeof renewed.token, 'string');

    const decoded = jwt.verify(renewed.token, config.web.jwtSecret, {
      algorithms: ['HS256'],
    });
    assert.equal(Number.isInteger(decoded.exp), true);
    assert.equal(
      decoded.exp,
      Math.floor(Date.parse(renewed.metadata.expiresAt) / 1_000),
      'the signed expiry must equal the persisted expiry'
    );
    assert.equal(new Date(renewed.metadata.expiresAt).getMilliseconds(), 0);
    assert.notEqual(fake.rows.get(USER).token_hash, 'stale');
  } finally {
    fake.restore();
  }
});

test('EG-002: renewal of an expired session still fails closed', async () => {
  const fake = installFakeDatabase();
  try {
    fake.rows.set(USER, {
      user_id: USER,
      token_hash: 'stale',
      issued_at: new Date(Date.now() - 40 * DAY_MS),
      expires_at: new Date(Date.now() - 10 * DAY_MS),
    });
    await assert.rejects(renewToken(USER, 1), /at least one second/);
  } finally {
    fake.restore();
  }
});

test('EG-002: signToken keeps rejecting out-of-range TTLs', () => {
  assert.throws(() => signToken(USER, 999));
  assert.throws(() => signToken(USER, 366 * DAY_MS));
  assert.throws(() => signToken('not-a-user', DAY_MS));
});
