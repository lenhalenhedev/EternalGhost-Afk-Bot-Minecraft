'use strict';

process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.ADMIN_USER_IDS ||= '123456789012345678';
process.env.DISCORD_TOKEN ||= 'test-discord-token';
process.env.DISCORD_CLIENT_ID ||= 'test-discord-client';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  eventDecision,
  sanitizeEventData,
} = require('../src/web/routes/events');

const USER_A = 'user-a';
const USER_B = 'user-b';
const BOT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function decide(event, visible = []) {
  const visibleBotIds = new Set(visible);
  const decision = eventDecision(event, {
    userId: USER_A,
    visibleBotIds,
  });
  return { decision, visibleBotIds };
}

test('EG-001: another user auth:revoked is never written to this stream', () => {
  const { decision } = decide({
    event: 'auth:revoked',
    data: { userId: USER_B },
  });
  assert.equal(decision, 'ignore');
});

test('EG-001: a foreign userId is never serialized out of an outbound event', () => {
  assert.deepEqual(
    sanitizeEventData({ userId: USER_B, ownerId: USER_A, message: 'x' }),
    { message: 'x' }
  );
});

test('EG-001: own auth:revoked still terminates the stream', () => {
  const { decision } = decide({
    event: 'auth:revoked',
    data: { userId: USER_A },
  });
  assert.equal(decision, 'revoke');
});

test('EG-001: other auth:* events are never broadcast cross-user', () => {
  for (const name of ['auth:other', 'auth:revoked']) {
    const data = name === 'auth:revoked' ? { userId: USER_B } : {};
    const { decision } = decide({ event: name, data });
    assert.equal(decision, 'ignore', name);
  }
});

test('EG-002: ownerless bot:created snapshot is dropped for every subscriber', () => {
  const { decision, visibleBotIds } = decide({
    event: 'bot:created',
    data: { botId: BOT_A, snapshot: { id: BOT_A, host: 'a' } },
  });
  assert.equal(decision, 'ignore');
  assert.ok(!visibleBotIds.has(BOT_A));
});

test('EG-002: own bot:created is delivered and added to the visible set', () => {
  const { decision, visibleBotIds } = decide({
    event: 'bot:created',
    data: { botId: BOT_A, ownerId: USER_A, snapshot: { id: BOT_A } },
  });
  assert.equal(decision, 'deliver');
  assert.ok(visibleBotIds.has(BOT_A));
});

test('EG-002: foreign-owned bot event is dropped', () => {
  const { decision } = decide({
    event: 'bot:created',
    data: { botId: BOT_B, ownerId: USER_B, snapshot: { id: BOT_B } },
  });
  assert.equal(decision, 'ignore');
});

test('EG-002: bot:log for a visible bot is delivered without an ownerId', () => {
  const { decision } = decide(
    { event: 'bot:log', data: { botId: BOT_A, message: 'line' } },
    [BOT_A]
  );
  assert.equal(decision, 'deliver');
});

test('EG-002: bot:log for a bot that is not visible is dropped', () => {
  const { decision } = decide({
    event: 'bot:log',
    data: { botId: BOT_B, message: 'line' },
  });
  assert.equal(decision, 'ignore');
});

test('own bot:deleted is delivered and removed from the visible set', () => {
  const { decision, visibleBotIds } = decide(
    { event: 'bot:deleted', data: { botId: BOT_A, ownerId: USER_A } },
    [BOT_A]
  );
  assert.equal(decision, 'deliver');
  assert.ok(!visibleBotIds.has(BOT_A));
});
