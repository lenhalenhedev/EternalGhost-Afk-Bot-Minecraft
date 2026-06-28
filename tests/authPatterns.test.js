'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAuthPrompt,
  isAuthSuccess,
  isAuthHardFail,
  isDuplicateLogin,
} = require('../src/bot/auth/authPatterns');

test('detects English auth prompts', () => {
  assert.equal(
    isAuthPrompt('Please register using /register <password>'),
    true
  );
  assert.equal(isAuthPrompt('You need to login to play'), true);
  assert.equal(isAuthPrompt('Welcome to the server, enjoy!'), false);
});

test('detects Vietnamese auth prompts', () => {
  assert.equal(isAuthPrompt('Vui l\u00f2ng \u0111\u0103ng nh\u1eadp'), true);
  assert.equal(isAuthPrompt('B\u1ea1n ch\u01b0a \u0111\u0103ng k\u00fd'), true);
});

test('detects auth success across languages', () => {
  assert.equal(isAuthSuccess('You are now logged in'), true);
  assert.equal(
    isAuthSuccess('\u0110\u0103ng nh\u1eadp th\u00e0nh c\u00f4ng'),
    true
  );
  assert.equal(isAuthSuccess('je bent succesvol ingelogd'), true);
  assert.equal(isAuthSuccess('random chat message'), false);
});

test('detects hard failures', () => {
  assert.equal(isAuthHardFail('Wrong password!'), true);
  assert.equal(isAuthHardFail('Too many attempts, try later'), true);
  assert.equal(isAuthHardFail('Please login'), false);
});

test('detects duplicate logins', () => {
  assert.equal(
    isDuplicateLogin('You are already logged in from another location'),
    true
  );
  assert.equal(isDuplicateLogin('duplicate login detected'), true);
  assert.equal(isDuplicateLogin('all good'), false);
});
