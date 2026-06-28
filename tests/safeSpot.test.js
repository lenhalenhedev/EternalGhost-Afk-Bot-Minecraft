'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSafe, pickTarget } = require('../src/bot/antiafk/safeSpot');

// Minimal fake vec3 factory and a block-grid bot stub.
const vec3 = (x, y, z) => ({ x, y, z });

function makeBot(grid) {
  // grid: map of "x,y,z" -> { boundingBox, name }
  return {
    blockAt: (pos) => grid[`${pos.x},${pos.y},${pos.z}`] || null,
  };
}

const SOLID = { boundingBox: 'block', name: 'stone' };
const AIR = { boundingBox: 'empty', name: 'air' };
const LAVA = { boundingBox: 'block', name: 'lava' };

test('isSafe accepts solid ground with clear feet/head', () => {
  const bot = makeBot({ '0,-1,0': SOLID, '0,0,0': AIR, '0,1,0': AIR });
  assert.equal(isSafe(bot, vec3, 0, 0, 0), true);
});

test('isSafe rejects missing blocks (unloaded chunk)', () => {
  const bot = makeBot({ '0,0,0': AIR, '0,1,0': AIR });
  assert.equal(isSafe(bot, vec3, 0, 0, 0), false);
});

test('isSafe rejects non-solid ground and obstructed space', () => {
  assert.equal(
    isSafe(
      makeBot({ '0,-1,0': AIR, '0,0,0': AIR, '0,1,0': AIR }),
      vec3,
      0,
      0,
      0
    ),
    false
  );
  assert.equal(
    isSafe(
      makeBot({ '0,-1,0': SOLID, '0,0,0': SOLID, '0,1,0': AIR }),
      vec3,
      0,
      0,
      0
    ),
    false
  );
});

test('isSafe rejects danger blocks in the column', () => {
  const bot = makeBot({ '0,-1,0': LAVA, '0,0,0': AIR, '0,1,0': AIR });
  assert.equal(isSafe(bot, vec3, 0, 0, 0), false);
});

test('pickTarget returns null without an anchor', () => {
  assert.equal(pickTarget(makeBot({}), vec3, null), null);
});

test('pickTarget returns null when nothing is safe', () => {
  const bot = { blockAt: () => AIR }; // never solid ground
  assert.equal(pickTarget(bot, vec3, { x: 0, y: 64, z: 0 }), null);
});

test('pickTarget finds a safe spot when ground exists everywhere', () => {
  // Any (x,z): solid at y=63, air above. Anchor at y=64.
  const bot = {
    blockAt: (pos) => {
      if (pos.y === 63) return SOLID;
      if (pos.y >= 64) return AIR;
      return SOLID;
    },
  };
  const target = pickTarget(bot, vec3, { x: 0, y: 64, z: 0 });
  assert.ok(target, 'expected a target');
  assert.equal(target.y, 64); // standing on the y=63 floor
});
