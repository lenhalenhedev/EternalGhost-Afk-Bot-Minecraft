'use strict';

process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.ADMIN_USER_IDS ||= '123456789012345678';
process.env.DISCORD_TOKEN ||= 'test-discord-token';
process.env.DISCORD_CLIENT_ID ||= 'test-discord-client';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const db = require('../src/config/database');
const {
  signToken,
  verifyActiveToken,
} = require('../src/web/auth/tokenService');

const USER = '123456789012345678';
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const signSecret = process.env.ENCRYPTION_KEY;

const ORIGINAL_QUERY = db.query;

function stubDbQuery() {
  db.query = async () => ({
    rows: [
      {
        user_id: USER,
        issued_at: new Date(),
        expires_at: new Date(Date.now() + ONE_DAY_MS),
      },
    ],
  });
}

test.after(() => {
  db.query = ORIGINAL_QUERY;
});

test('EG-007: an HS256 token signed with the app secret still verifies', async () => {
  stubDbQuery();
  const token = signToken(USER, ONE_DAY_MS);
  const session = await verifyActiveToken(token);
  assert.equal(session.userId, USER);
});

test('EG-007: a token signed with a non-allowlisted algorithm is rejected', async () => {
  let queryCalls = 0;
  const query = async () => {
    queryCalls += 1;
    return {
      rows: [
        {
          user_id: USER,
          issued_at: new Date(),
          expires_at: new Date(Date.now() + ONE_DAY_MS),
        },
      ],
    };
  };
  db.query = query;

  const hs512 = jwt.sign({ userId: USER }, signSecret, {
    algorithm: 'HS512',
    expiresIn: 3600,
  });

  await assert.rejects(
    () => verifyActiveToken(hs512),
    /Invalid or expired token\./
  );
  // Verification must fail before the database is consulted.
  assert.equal(queryCalls, 0);
});
