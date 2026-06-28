'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  BOT_STATES,
  ALIVE_STATES,
  STARTABLE_STATES,
  STOPPABLE_STATES,
  STATE_COLORS,
  STATE_EMOJI,
} = require('../src/bot/states');

test('every state has a colour and emoji', () => {
  for (const state of Object.values(BOT_STATES)) {
    assert.ok(STATE_COLORS[state] !== undefined, `colour for ${state}`);
    assert.ok(STATE_EMOJI[state] !== undefined, `emoji for ${state}`);
  }
});

test('ALIVE_STATES excludes offline/disconnected/error/reconnecting', () => {
  assert.equal(ALIVE_STATES.has(BOT_STATES.PLAYING), true);
  assert.equal(ALIVE_STATES.has(BOT_STATES.AFK), true);
  assert.equal(ALIVE_STATES.has(BOT_STATES.OFFLINE), false);
  assert.equal(ALIVE_STATES.has(BOT_STATES.DISCONNECTED), false);
  assert.equal(ALIVE_STATES.has(BOT_STATES.ERROR), false);
  assert.equal(ALIVE_STATES.has(BOT_STATES.RECONNECTING), false);
});

test('STARTABLE and STOPPABLE sets are disjoint where expected', () => {
  assert.equal(STARTABLE_STATES.has(BOT_STATES.OFFLINE), true);
  assert.equal(STOPPABLE_STATES.has(BOT_STATES.PLAYING), true);
  assert.equal(STOPPABLE_STATES.has(BOT_STATES.OFFLINE), false);
});

test('BOT_STATES is frozen', () => {
  assert.equal(Object.isFrozen(BOT_STATES), true);
});
