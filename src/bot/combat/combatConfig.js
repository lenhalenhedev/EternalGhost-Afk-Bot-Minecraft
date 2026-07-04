'use strict';

const { strictInt } = require('../../utils/security');

const HOSTILE_MOBS = new Set([
  'zombie',
  'skeleton',
  'spider',
  'cave_spider',
  'creeper',
  'enderman',
  'witch',
  'blaze',
  'ghast',
  'slime',
  'magma_cube',
  'phantom',
  'drowned',
  'husk',
  'stray',
  'pillager',
  'vindicator',
  'vex',
  'warden',
  'ravager',
  'hoglin',
  'piglin_brute',
  'zoglin',
]);

const COMBAT_BLACKLIST = new Set(['creeper', 'enderman', 'warden', 'ghast']);

const ATTACK_WHITELIST = new Set(
  [...HOSTILE_MOBS].filter((m) => !COMBAT_BLACKLIST.has(m))
);

const COMBAT = Object.freeze({
  SCAN_RANGE: 15,
  ENGAGE_RANGE: 4,
  MAX_COMBAT_DURATION: 12_000,
  RETREAT_HP_PCT: 0.3,
  SCAN_INTERVAL: 1_000,
  ATTACK_INTERVAL: 600,
  INVISIBLE_TIMEOUT: 3_000,
});

function intOr(value, fallback, bounds) {
  const parsed = strictInt(value, bounds);
  return parsed.valid ? parsed.value : fallback;
}

function floatOr(value, fallback, { min, max } = {}) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    n = Number(value.trim());
  } else {
    return fallback;
  }
  if (!Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return fallback;
  if (max !== undefined && n > max) return fallback;
  return n;
}

function resolveCombatConfig(cfg) {
  const source = cfg && typeof cfg === 'object' ? cfg : {};
  return Object.freeze({
    enabled: source.enabled !== false,
    scanRange: intOr(source.scanRange, COMBAT.SCAN_RANGE, { min: 1 }),
    engageRange: intOr(source.engageRange, COMBAT.ENGAGE_RANGE, { min: 1 }),
    maxCombatDuration: intOr(
      source.maxCombatDuration,
      COMBAT.MAX_COMBAT_DURATION,
      { min: 1 }
    ),
    retreatHpPct: floatOr(source.retreatHpPct, COMBAT.RETREAT_HP_PCT, {
      min: 0,
      max: 1,
    }),
    scanInterval: intOr(source.scanInterval, COMBAT.SCAN_INTERVAL, { min: 1 }),
    attackInterval: intOr(source.attackInterval, COMBAT.ATTACK_INTERVAL, {
      min: 1,
    }),
    invisibleTimeout: intOr(
      source.invisibleTimeout,
      COMBAT.INVISIBLE_TIMEOUT,
      { min: 1 }
    ),
  });
}

module.exports = {
  HOSTILE_MOBS,
  COMBAT_BLACKLIST,
  ATTACK_WHITELIST,
  COMBAT,
  resolveCombatConfig,
};
