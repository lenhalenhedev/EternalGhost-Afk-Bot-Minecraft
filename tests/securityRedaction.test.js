'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { redactDiagnostic } = require('../src/utils/security');

test('redactDiagnostic removes common secrets from error and log text', () => {
  const raw = [
    'password=correct-horse-battery-staple',
    'token: abcdefghijklmnopqrstuvwxyz.123456.ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'Authorization: Bearer top-secret-access-token',
    'Cookie: sessionid=super-secret-cookie',
    'postgres://alice:db-password@db.example.test:5432/app',
    '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
  ].join('\n');

  const redacted = redactDiagnostic(raw);

  for (const secret of [
    'correct-horse-battery-staple',
    'top-secret-access-token',
    'super-secret-cookie',
    'db-password',
    'private-material',
  ]) {
    assert.equal(redacted.includes(secret), false, `must remove ${secret}`);
  }
  assert.match(redacted, /\[REDACTED\]/);
});

test('redactDiagnostic safely redacts sensitive keys in structured diagnostic data', () => {
  const raw = {
    username: 'player-one',
    password: 'p@ssw0rd',
    nested: {
      apiKey: 'api-key-value',
      headers: { authorization: 'Bearer retained-never' },
    },
  };

  const redacted = redactDiagnostic(raw);

  assert.equal(redacted.includes('p@ssw0rd'), false);
  assert.equal(redacted.includes('api-key-value'), false);
  assert.equal(redacted.includes('retained-never'), false);
  assert.match(redacted, /player-one/);
});

test('redactDiagnostic handles undefined, errors, and control characters safely', () => {
  assert.equal(redactDiagnostic(undefined), '');
  assert.equal(
    redactDiagnostic(new Error('token=do-not-send\nnext line')).includes(
      'do-not-send'
    ),
    false
  );
  assert.equal(
    redactDiagnostic('safe\u0000 diagnostic').includes('\u0000'),
    false
  );
});
