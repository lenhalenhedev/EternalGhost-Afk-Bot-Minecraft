'use strict';
/**
 * Bot repository: raw parameterised queries against `bots`,
 * `bot_antiafk_config`, `bot_autoeat_config` and `bot_combat_config`.
 *
 * Extracted from Persistence.js as part of a structural (SRP) refactor.
 * These functions take an already-checked-out pg client (from
 * db.withTransaction) and do not manage transactions themselves — that
 * responsibility stays in Persistence.js's write-behind queue, so behavior
 * (including the "always release the client in finally" guarantee from
 * src/config/database.js) is unchanged.
 */

/** Insert/update the `bots` row for a normalised bot record. */
function upsertBotRow(client, normalised) {
  return client.query(
    `INSERT INTO bots
       (id, host, port, username, encrypted_password, version,
        auto_reconnect, was_running, hidden, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       host=$2, port=$3, username=$4, encrypted_password=$5, version=$6,
       auto_reconnect=$7, was_running=$8, hidden=$9, created_by=$10,
       created_at=$11, updated_at=$12`,
    [
      normalised.id,
      normalised.host,
      normalised.port,
      normalised.username,
      normalised.encryptedPassword,
      normalised.version,
      normalised.autoReconnect,
      normalised.wasRunning,
      normalised.hidden,
      normalised.createdBy,
      normalised.createdAt,
      normalised.updatedAt,
    ]
  );
}

function upsertAntiAfk(client, botId, c) {
  return client.query(
    `INSERT INTO bot_antiafk_config
       (bot_id, enabled, min_radius, max_radius, min_interval, max_interval,
        max_retries, move_timeout, stuck_timeout, rotation_interval)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (bot_id) DO UPDATE SET
       enabled=$2, min_radius=$3, max_radius=$4, min_interval=$5,
       max_interval=$6, max_retries=$7, move_timeout=$8, stuck_timeout=$9,
       rotation_interval=$10`,
    [
      botId,
      c.enabled,
      c.minRadius,
      c.maxRadius,
      c.minInterval,
      c.maxInterval,
      c.maxRetries,
      c.moveTimeout,
      c.stuckTimeout,
      c.rotationInterval,
    ]
  );
}

function upsertAutoEat(client, botId, c) {
  return client.query(
    `INSERT INTO bot_autoeat_config
       (bot_id, enabled, eat_threshold, eat_cooldown, check_interval)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (bot_id) DO UPDATE SET
       enabled=$2, eat_threshold=$3, eat_cooldown=$4, check_interval=$5`,
    [botId, c.enabled, c.eatThreshold, c.eatCooldown, c.checkInterval]
  );
}

function upsertCombat(client, botId, c) {
  return client.query(
    `INSERT INTO bot_combat_config
       (bot_id, enabled, scan_range, engage_range, max_combat_duration,
        retreat_hp_pct, scan_interval, attack_interval, invisible_timeout)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (bot_id) DO UPDATE SET
       enabled=$2, scan_range=$3, engage_range=$4, max_combat_duration=$5,
       retreat_hp_pct=$6, scan_interval=$7, attack_interval=$8,
       invisible_timeout=$9`,
    [
      botId,
      c.enabled,
      c.scanRange,
      c.engageRange,
      c.maxCombatDuration,
      c.retreatHpPct,
      c.scanInterval,
      c.attackInterval,
      c.invisibleTimeout,
    ]
  );
}

/**
 * Convenience helper: persist a full bot record (base row + all three
 * per-subsystem config tables) within a single already-open transaction
 * client. Mirrors what the original inline saveBot() task did.
 */
async function saveBotFull(client, normalised) {
  await upsertBotRow(client, normalised);
  await upsertAntiAfk(client, normalised.id, normalised.antiAfk);
  await upsertAutoEat(client, normalised.id, normalised.autoEat);
  await upsertCombat(client, normalised.id, normalised.combat);
}

function deleteBotRow(client, id) {
  return client.query('DELETE FROM bots WHERE id = $1', [id]);
}

module.exports = {
  upsertBotRow,
  upsertAntiAfk,
  upsertAutoEat,
  upsertCombat,
  saveBotFull,
  deleteBotRow,
};
