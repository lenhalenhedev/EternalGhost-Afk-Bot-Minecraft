'use strict';
/**
 * Pure helper functions for the persistence layer: row → record mappers and
 * small utilities. Extracted from Persistence.js as part of a structural
 * (SRP) refactor — no behavior changes.
 *
 * These functions are intentionally side-effect free (no DB calls, no
 * logging) so they can be unit tested in isolation from the write-behind
 * queue and the pg pool.
 */
const {
  DEFAULT_ANTIAFK,
  DEFAULT_AUTOEAT,
  DEFAULT_COMBAT,
} = require('./botRecordFactory');

// ─── Row ↔ record mappers ──────────────────────────────────────────────────
function antiAfkFromRow(r) {
  if (!r) return { ...DEFAULT_ANTIAFK };
  return {
    enabled: r.enabled,
    minRadius: r.min_radius,
    maxRadius: r.max_radius,
    minInterval: r.min_interval,
    maxInterval: r.max_interval,
    maxRetries: r.max_retries,
    moveTimeout: r.move_timeout,
    stuckTimeout: r.stuck_timeout,
    rotationInterval: r.rotation_interval,
  };
}

function autoEatFromRow(r) {
  if (!r) return { ...DEFAULT_AUTOEAT };
  return {
    enabled: r.enabled,
    eatThreshold: r.eat_threshold,
    eatCooldown: r.eat_cooldown,
    checkInterval: r.check_interval,
  };
}

function combatFromRow(r) {
  if (!r) return { ...DEFAULT_COMBAT };
  return {
    enabled: r.enabled,
    scanRange: r.scan_range,
    engageRange: r.engage_range,
    maxCombatDuration: r.max_combat_duration,
    retreatHpPct: r.retreat_hp_pct,
    scanInterval: r.scan_interval,
    attackInterval: r.attack_interval,
    invisibleTimeout: r.invisible_timeout,
  };
}

function recordFromRow(row, antiAfkRow, autoEatRow, combatRow) {
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    username: row.username,
    encryptedPassword: row.encrypted_password || '',
    version: row.version,
    autoReconnect: row.auto_reconnect,
    wasRunning: row.was_running,
    hidden: row.hidden,
    createdBy: row.created_by,
    createdInGuild: row.created_in_guild || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    antiAfk: antiAfkFromRow(antiAfkRow),
    autoEat: autoEatFromRow(autoEatRow),
    combat: combatFromRow(combatRow),
  };
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

/** Index an array of rows by a given column, e.g. indexBy(rows, 'bot_id'). */
function indexBy(rows, key) {
  const out = {};
  for (const row of rows) out[row[key]] = row;
  return out;
}

module.exports = {
  antiAfkFromRow,
  autoEatFromRow,
  combatFromRow,
  recordFromRow,
  toIso,
  indexBy,
};
