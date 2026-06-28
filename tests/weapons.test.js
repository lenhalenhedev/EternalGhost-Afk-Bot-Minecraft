'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  weaponScore,
  bestWeaponSlot,
  equipBestWeapon,
  WEAPON_PRIORITY,
} = require('../src/bot/combat/weapons');

test('weaponScore ranks weapons by priority', () => {
  assert.equal(weaponScore({ name: 'diamond_sword' }), WEAPON_PRIORITY.sword);
  assert.equal(weaponScore({ name: 'netherite_axe' }), WEAPON_PRIORITY.axe);
  assert.equal(weaponScore({ name: 'trident' }), WEAPON_PRIORITY.trident);
  assert.equal(weaponScore({ name: 'mace' }), WEAPON_PRIORITY.mace);
});

test('weaponScore returns 1 (fist) for non-weapons and 0 for empty slots', () => {
  assert.equal(weaponScore({ name: 'dirt' }), 1);
  assert.equal(weaponScore(null), 0);
  assert.equal(weaponScore(undefined), 0);
  assert.equal(weaponScore({}), 0);
});

test('bestWeaponSlot scans only the hotbar (36-44) and picks the best', () => {
  const slots = [];
  slots[36] = { name: 'wooden_axe' };
  slots[40] = { name: 'diamond_sword' };
  slots[10] = { name: 'netherite_sword' }; // outside hotbar, must be ignored
  const bot = { inventory: { slots } };
  assert.deepEqual(bestWeaponSlot(bot), {
    slot: 40,
    score: WEAPON_PRIORITY.sword,
  });
});

test('bestWeaponSlot returns -1 when no weapon present', () => {
  const bot = { inventory: { slots: [] } };
  assert.deepEqual(bestWeaponSlot(bot), { slot: -1, score: 0 });
});

test('equipBestWeapon selects the hotbar index for a real weapon', () => {
  const slots = [];
  slots[38] = { name: 'iron_sword' };
  let selected = null;
  const bot = {
    inventory: { slots },
    setQuickBarSlot: (i) => {
      selected = i;
    },
  };
  equipBestWeapon(bot);
  assert.equal(selected, 2); // slot 38 -> hotbar index 2
});

test('equipBestWeapon does not switch when only fists are available', () => {
  const slots = [];
  slots[36] = { name: 'cobblestone' };
  let called = false;
  const bot = {
    inventory: { slots },
    setQuickBarSlot: () => {
      called = true;
    },
  };
  equipBestWeapon(bot);
  assert.equal(called, false);
});
