'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  HOSTILE_MOBS,
  COMBAT_BLACKLIST,
  ATTACK_WHITELIST,
  COMBAT,
} = require('../src/bot/combat/combatConfig');

test('blacklisted mobs are never in the attack whitelist', () => {
  for (const mob of COMBAT_BLACKLIST) {
    assert.equal(
      ATTACK_WHITELIST.has(mob),
      false,
      `${mob} must not be attacked`
    );
  }
});

test('attack whitelist is hostile mobs minus the blacklist', () => {
  assert.equal(
    ATTACK_WHITELIST.size,
    HOSTILE_MOBS.size - COMBAT_BLACKLIST.size
  );
  assert.equal(ATTACK_WHITELIST.has('zombie'), true);
  assert.equal(ATTACK_WHITELIST.has('creeper'), false);
});

test('combat tuning constants are sane and frozen', () => {
  assert.equal(Object.isFrozen(COMBAT), true);
  assert.ok(COMBAT.ENGAGE_RANGE < COMBAT.SCAN_RANGE);
  assert.ok(COMBAT.RETREAT_HP_PCT > 0 && COMBAT.RETREAT_HP_PCT < 1);
  assert.ok(COMBAT.ATTACK_INTERVAL > 0);
});
