'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateHost,
  validatePort,
  validateUsername,
  validateVersion,
  validatePassword,
  validateBotConfig,
  validateChatMessage,
  isAdmin,
} = require('../src/utils/validators');

test('validateHost accepts IPv4, hostnames, and IPv6', () => {
  assert.equal(validateHost('192.168.1.10').valid, true);
  assert.equal(validateHost('play.example.net').valid, true);
  assert.equal(validateHost('::1').valid, true);
});

test('validateHost rejects bad octets, spaces, and control chars', () => {
  assert.equal(validateHost('999.1.1.1').valid, false);
  assert.equal(validateHost('has space.com').valid, false);
  assert.equal(validateHost('evil\u0000.com').valid, false);
  assert.equal(validateHost('').valid, false);
});

test('validatePort enforces the 1-65535 range', () => {
  assert.deepEqual(validatePort('25565'), { valid: true, value: 25565 });
  assert.equal(validatePort('0').valid, false);
  assert.equal(validatePort('70000').valid, false);
  assert.equal(validatePort('abc').valid, false);
});

test('validateUsername enforces length and charset', () => {
  assert.equal(validateUsername('Steve_01').valid, true);
  assert.equal(validateUsername('ab').valid, false);
  assert.equal(validateUsername('way_too_long_username').valid, false);
  assert.equal(validateUsername('bad name!').valid, false);
});

test('validateVersion checks the supported set', () => {
  assert.equal(validateVersion('1.20.1').valid, true);
  assert.equal(validateVersion('1.7.10').valid, false);
  assert.equal(validateVersion('').valid, false);
});

test('validatePassword blocks injection vectors but allows empty', () => {
  assert.equal(validatePassword('').valid, true);
  assert.equal(validatePassword('Str0ngPass').valid, true);
  assert.equal(validatePassword('has space').valid, false);
  assert.equal(validatePassword('line\nbreak').valid, false);
  assert.equal(validatePassword('x'.repeat(101)).valid, false);
  assert.equal(validatePassword(123).valid, false);
});

test('validateBotConfig aggregates all errors', () => {
  const res = validateBotConfig({ host: '', port: '0', username: 'a', version: 'x', password: 'bad pw' });
  assert.equal(res.valid, false);
  assert.equal(res.errors.length, 5);
});

test('validateBotConfig passes a fully valid config', () => {
  const res = validateBotConfig({
    host: 'play.example.net', port: '25565', username: 'Steve', version: '1.20.1', password: '',
  });
  assert.equal(res.valid, true);
});

test('validateChatMessage blocks non-whitelisted slash commands', () => {
  assert.equal(validateChatMessage('hello world', ['/login']).valid, true);
  assert.equal(validateChatMessage('/op me', ['/login']).valid, false);
  assert.equal(validateChatMessage('/login pw', ['/login']).valid, true);
  assert.equal(validateChatMessage('', ['/login']).valid, false);
  assert.equal(validateChatMessage('x'.repeat(201), []).valid, false);
});

test('isAdmin checks membership', () => {
  assert.equal(isAdmin('123', ['123', '456']), true);
  assert.equal(isAdmin('999', ['123']), false);
});
