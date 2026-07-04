'use strict';

const { strictInt } = require('../../utils/security');

const ANTI_AFK = Object.freeze({
  MIN_RADIUS: 5,
  MAX_RADIUS: 10,
  MIN_INTERVAL: 5_000,
  MAX_INTERVAL: 15_000,
  MAX_RETRIES: 3,
  MOVE_TIMEOUT: 20_000,
  STUCK_TIMEOUT: 12_000,
  ROTATION_INTERVAL: 3_000,
});

const DANGER_NAMES = [
  'lava',
  'fire',
  'magma_block',
  'cactus',
  'sweet_berry_bush',
  'wither_rose',
];

function isDanger(name) {
  if (!name) return false;
  return DANGER_NAMES.some((d) => name.includes(d));
}

function intOr(value, fallback, bounds) {
  const parsed = strictInt(value, bounds);
  return parsed.valid ? parsed.value : fallback;
}

function resolveAntiAfkConfig(cfg) {
  const source = cfg && typeof cfg === 'object' ? cfg : {};
  return Object.freeze({
    enabled: source.enabled !== false,
    minRadius: intOr(source.minRadius, ANTI_AFK.MIN_RADIUS, { min: 1 }),
    maxRadius: intOr(source.maxRadius, ANTI_AFK.MAX_RADIUS, { min: 1 }),
    minInterval: intOr(source.minInterval, ANTI_AFK.MIN_INTERVAL, { min: 1 }),
    maxInterval: intOr(source.maxInterval, ANTI_AFK.MAX_INTERVAL, { min: 1 }),
    maxRetries: intOr(source.maxRetries, ANTI_AFK.MAX_RETRIES, { min: 1 }),
    moveTimeout: intOr(source.moveTimeout, ANTI_AFK.MOVE_TIMEOUT, { min: 1 }),
    stuckTimeout: intOr(source.stuckTimeout, ANTI_AFK.STUCK_TIMEOUT, {
      min: 1,
    }),
    rotationInterval: intOr(
      source.rotationInterval,
      ANTI_AFK.ROTATION_INTERVAL,
      { min: 1 }
    ),
  });
}

module.exports = {
  ANTI_AFK,
  DANGER_NAMES,
  isDanger,
  resolveAntiAfkConfig,
};
