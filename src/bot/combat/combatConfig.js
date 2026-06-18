'use strict';

/**
 * Combat tuning constants and mob target lists. Pure data module.
 */

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'spider', 'cave_spider', 'creeper', 'enderman',
  'witch', 'blaze', 'ghast', 'slime', 'magma_cube', 'phantom',
  'drowned', 'husk', 'stray', 'pillager', 'vindicator', 'vex',
  'warden', 'ravager', 'hoglin', 'piglin_brute', 'zoglin',
]);

/** Mobs we do NOT engage – too dangerous or griefing risk. */
const COMBAT_BLACKLIST = new Set(['creeper', 'enderman', 'warden', 'ghast']);

/** Attack only these mobs (the rest of HOSTILE_MOBS). */
const ATTACK_WHITELIST = new Set([...HOSTILE_MOBS].filter((m) => !COMBAT_BLACKLIST.has(m)));

const COMBAT = Object.freeze({
  SCAN_RANGE: 15, // blocks
  ENGAGE_RANGE: 4, // must be this close before swinging
  MAX_COMBAT_DURATION: 12_000, // ms per target
  RETREAT_HP_PCT: 0.3, // retreat when HP < 30%
  SCAN_INTERVAL: 1_000,
  ATTACK_INTERVAL: 600, // ms between attacks
  INVISIBLE_TIMEOUT: 3_000, // give up if target stays invisible this long
});

module.exports = { HOSTILE_MOBS, COMBAT_BLACKLIST, ATTACK_WHITELIST, COMBAT };
