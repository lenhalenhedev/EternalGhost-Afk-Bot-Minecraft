'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { encrypt, decrypt, needsRotation, fingerprint } = require('../src/services/encryption');

const KEY = crypto.randomBytes(32).toString('hex');
const OLD_KEY = crypto.randomBytes(32).toString('hex');

test('encrypt/decrypt round-trips a password', () => {
  const payload = encrypt('hunter2', KEY);
  assert.match(payload, /^1:/);
  const { plaintext, rotationNeeded } = decrypt(payload, KEY);
  assert.equal(plaintext, 'hunter2');
  assert.equal(rotationNeeded, false);
});

test('encrypt produces a unique IV per call (non-deterministic ciphertext)', () => {
  assert.notEqual(encrypt('same', KEY), encrypt('same', KEY));
});

test('empty input encrypts/decrypts to empty string', () => {
  assert.equal(encrypt('', KEY), '');
  assert.deepEqual(decrypt('', KEY), { plaintext: '', rotationNeeded: false });
});

test('decrypt with old key flags rotationNeeded', () => {
  const payload = encrypt('secret', OLD_KEY);
  const { plaintext, rotationNeeded } = decrypt(payload, KEY, OLD_KEY);
  assert.equal(plaintext, 'secret');
  assert.equal(rotationNeeded, true);
});

test('decrypt throws on tampered ciphertext (GCM auth)', () => {
  const payload = encrypt('secret', KEY);
  const parts = payload.split(':');
  parts[4] = parts[4].replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  assert.throws(() => decrypt(parts.join(':'), KEY));
});

test('decrypt throws when no key fingerprint matches', () => {
  const payload = encrypt('secret', OLD_KEY);
  assert.throws(() => decrypt(payload, KEY), /No matching key/);
});

test('decrypt rejects malformed payloads', () => {
  assert.throws(() => decrypt('not-a-valid-payload', KEY), /Invalid encrypted payload/);
});

test('needsRotation detects stale key', () => {
  assert.equal(needsRotation(encrypt('x', OLD_KEY), KEY), true);
  assert.equal(needsRotation(encrypt('x', KEY), KEY), false);
  assert.equal(needsRotation('', KEY), false);
});

test('fingerprint is stable and key-specific', () => {
  assert.equal(fingerprint(KEY), fingerprint(KEY));
  assert.notEqual(fingerprint(KEY), fingerprint(OLD_KEY));
});
