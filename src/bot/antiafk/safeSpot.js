'use strict';

const { ANTI_AFK, isDanger } = require('./antiAfkConfig');
const { randFloat } = require('../../utils/helpers');

function isSafe(bot, vec3, x, y, z) {
  const below = bot.blockAt(vec3(x, y - 1, z));
  const feet = bot.blockAt(vec3(x, y, z));
  const head = bot.blockAt(vec3(x, y + 1, z));

  if (!below || !feet || !head) return false;

  if (below.boundingBox !== 'block') return false;
  if (feet.boundingBox !== 'empty') return false;
  if (head.boundingBox !== 'empty') return false;

  if (isDanger(below.name) || isDanger(feet.name) || isDanger(head.name))
    return false;

  return true;
}

function pickTarget(
  bot,
  vec3,
  anchor,
  minRadius = ANTI_AFK.MIN_RADIUS,
  maxRadius = ANTI_AFK.MAX_RADIUS
) {
  if (!anchor) return null;

  for (let i = 0; i < 20; i++) {
    const angle = randFloat(0, Math.PI * 2);
    const radius = randFloat(minRadius, maxRadius);
    const x = Math.round(anchor.x + Math.cos(angle) * radius);
    const z = Math.round(anchor.z + Math.sin(angle) * radius);

    for (let y = anchor.y + 3; y >= anchor.y - 5; y--) {
      if (isSafe(bot, vec3, x, y, z)) return { x, y, z };
    }
  }
  return null;
}

module.exports = { isSafe, pickTarget };
