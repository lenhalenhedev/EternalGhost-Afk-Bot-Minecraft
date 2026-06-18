'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { LogBuffers } = require('../src/services/logBuffer');

test('pushBotLog keeps only the most recent N lines (ring buffer cap)', () => {
  const b = new LogBuffers({ botBufferSize: 3 });
  for (let i = 0; i < 5; i++) b.pushBotLog('bot', 'info', `m${i}`, 1000 + i);
  const logs = b.getBotLogs('bot', 50);
  assert.deepEqual(logs.map((e) => e.msg), ['m2', 'm3', 'm4']);
});

test('getBotLogs respects maxLines and returns newest last', () => {
  const b = new LogBuffers();
  for (let i = 0; i < 10; i++) b.pushBotLog('bot', 'info', `m${i}`, 1000 + i);
  const logs = b.getBotLogs('bot', 3);
  assert.deepEqual(logs.map((e) => e.msg), ['m7', 'm8', 'm9']);
});

test('getBotLogs filters by maxAgeMs', () => {
  const b = new LogBuffers();
  b.pushBotLog('bot', 'info', 'old', 1_000);
  b.pushBotLog('bot', 'info', 'recent', 9_000);
  const now = 10_000;
  const logs = b.getBotLogs('bot', 50, 2_000, now); // only last 2s
  assert.deepEqual(logs.map((e) => e.msg), ['recent']);
});

test('getBotLogs returns empty array for unknown bot', () => {
  const b = new LogBuffers();
  assert.deepEqual(b.getBotLogs('nope'), []);
});

test('drainSummary returns queued entries then empties the buffer', () => {
  const b = new LogBuffers();
  b.addToSummary('warn', 'abcdef1234', 'something', 1_000);
  b.addToSummary('error', null, 'system issue', 2_000);
  const first = b.drainSummary();
  assert.equal(first.length, 2);
  assert.equal(first[0].prefix, '[Bot:abcdef12]');
  assert.equal(first[1].prefix, '[SYS]');
  assert.deepEqual(b.drainSummary(), []); // drained
});

test('addToSummary caps retained entries at summaryMax', () => {
  const b = new LogBuffers({ summaryMax: 2 });
  b.addToSummary('warn', 'bot', 'a', 1);
  b.addToSummary('warn', 'bot', 'b', 2);
  b.addToSummary('warn', 'bot', 'c', 3);
  const entries = b.drainSummary();
  assert.deepEqual(entries.map((e) => e.message), ['b', 'c']);
});

test('checkAlertCooldown allows once then suppresses within the window', () => {
  const b = new LogBuffers({ alertCooldownMs: 1_000 });
  const t = 1_000_000;
  assert.equal(b.checkAlertCooldown('bot:death', t), true);
  assert.equal(b.checkAlertCooldown('bot:death', t + 500), false); // within window
  assert.equal(b.checkAlertCooldown('bot:death', t + 1_500), true); // window elapsed
});

test('checkAlertCooldown tracks distinct keys independently', () => {
  const b = new LogBuffers({ alertCooldownMs: 1_000 });
  const t = 1_000_000;
  assert.equal(b.checkAlertCooldown('bot:death', t), true);
  assert.equal(b.checkAlertCooldown('bot:kicked', t), true);
});

test('clearBot drops the bot log buffer and its alert cooldowns', () => {
  const b = new LogBuffers({ alertCooldownMs: 10_000 });
  const base = 1_000_000; // realistic clock so window math is meaningful
  b.pushBotLog('bot', 'info', 'm', base);
  b.checkAlertCooldown('bot:death', base);
  b.checkAlertCooldown('other:death', base);

  b.clearBot('bot');

  assert.deepEqual(b.getBotLogs('bot'), []);
  // cooldown for cleared bot is forgotten -> fires again on the next event
  assert.equal(b.checkAlertCooldown('bot:death', base + 500), true);
  // unrelated bot's cooldown is untouched -> still suppressed within window
  assert.equal(b.checkAlertCooldown('other:death', base + 500), false);
});
