'use strict';

/**
 * PostgreSQL-backed persistence layer.
 *
 * ---------------------------------------------------------------------------
 *  Compatibility contract
 * ---------------------------------------------------------------------------
 *  The previous implementation stored everything in bots.json and exposed a
 *  SYNCHRONOUS API that BotManager / instanceEvents call WITHOUT `await`:
 *
 *      load() rotateKeys() getBot() getAllBots() findBot() saveBot()
 *      deleteBot() updateBotState() getUserSelection() setUserSelection()
 *      flushSync()
 *
 *  To keep those call sites working unchanged we keep an in-memory cache as the
 *  runtime source of truth (exactly like before) and WRITE-BEHIND every change
 *  to Postgres through a serialised async queue. Reads are served from the
 *  cache and stay synchronous; writes return immediately and are flushed to the
 *  database in order.
 *
 *  Only two call sites need a one-line tweak (documented in BotManager.js):
 *    - `await Persistence.load()`   (was a sync call at startup)
 *    - `await Persistence.flush()`  (replaces flushSync() on shutdown)
 *  Both remain present and backwards-safe.
 *
 *  Record shape returned to callers (superset of the old shape – additive):
 *  {
 *    id, host, port, username, encryptedPassword, version,
 *    autoReconnect, wasRunning, hidden, createdBy, createdAt, updatedAt,
 *    antiAfk: { ...}, autoEat: { ...}, combat: { ... }
 *  }
 */

const db = require('../config/database');
const { logger } = require('../services/logger');
const { encrypt, decrypt, needsRotation } = require('../services/encryption');
const config = require('../config');
const { DEFAULT_ANTIAFK, DEFAULT_AUTOEAT, DEFAULT_COMBAT } = require('./botRecordFactory');

// ─── Row ↔ record mappers ──────────────────────────────────────────────────

function antiAfkFromRow(r) {
  if (!r) return { ...DEFAULT_ANTIAFK };
  return {
    enabled:          r.enabled,
    minRadius:        r.min_radius,
    maxRadius:        r.max_radius,
    minInterval:      r.min_interval,
    maxInterval:      r.max_interval,
    maxRetries:       r.max_retries,
    moveTimeout:      r.move_timeout,
    stuckTimeout:     r.stuck_timeout,
    rotationInterval: r.rotation_interval,
  };
}

function autoEatFromRow(r) {
  if (!r) return { ...DEFAULT_AUTOEAT };
  return {
    enabled:       r.enabled,
    eatThreshold:  r.eat_threshold,
    eatCooldown:   r.eat_cooldown,
    checkInterval: r.check_interval,
  };
}

function combatFromRow(r) {
  if (!r) return { ...DEFAULT_COMBAT };
  return {
    enabled:           r.enabled,
    scanRange:         r.scan_range,
    engageRange:       r.engage_range,
    maxCombatDuration: r.max_combat_duration,
    retreatHpPct:      r.retreat_hp_pct,
    scanInterval:      r.scan_interval,
    attackInterval:    r.attack_interval,
    invisibleTimeout:  r.invisible_timeout,
  };
}

function recordFromRow(row, antiAfkRow, autoEatRow, combatRow) {
  return {
    id:                row.id,
    host:              row.host,
    port:              row.port,
    username:          row.username,
    encryptedPassword: row.encrypted_password || '',
    version:           row.version,
    autoReconnect:     row.auto_reconnect,
    wasRunning:        row.was_running,
    hidden:            row.hidden,
    createdBy:         row.created_by,
    createdAt:         toIso(row.created_at),
    updatedAt:         toIso(row.updated_at),
    antiAfk:           antiAfkFromRow(antiAfkRow),
    autoEat:           autoEatFromRow(autoEatRow),
    combat:            combatFromRow(combatRow),
  };
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ─── Persistence ──────────────────────────────────────────────────────
class Persistence {
  constructor() {
    // In-memory mirror of the database – runtime source of truth for sync reads.
    this._data = { bots: {}, userSelections: {} };
    this._loaded = false;
    // Serialised write-behind queue: every mutation appends a task; tasks run
    // strictly in order so concurrent edits can never interleave/clobber.
    this._writeChain = Promise.resolve();
    this._pending = 0;
  }

  // ─── Startup ──────────────────────────────────────────────────
  /**
   * Connect, verify the schema, and hydrate the in-memory cache.
   * Returns the cache object (same shape the old load() returned).
   * NOTE: now async – callers must `await Persistence.load()`.
   */
  async load() {
    await db.assertConnection();

    const [botRows, antiAfk, autoEat, combat, selections] = await Promise.all([
      db.query('SELECT * FROM bots'),
      db.query('SELECT * FROM bot_antiafk_config'),
      db.query('SELECT * FROM bot_autoeat_config'),
      db.query('SELECT * FROM bot_combat_config'),
      db.query('SELECT user_id, bot_id FROM user_selections'),
    ]);

    const antiAfkById = indexBy(antiAfk.rows, 'bot_id');
    const autoEatById = indexBy(autoEat.rows, 'bot_id');
    const combatById  = indexBy(combat.rows, 'bot_id');

    this._data = { bots: {}, userSelections: {} };
    for (const row of botRows.rows) {
      this._data.bots[row.id] = recordFromRow(
        row, antiAfkById[row.id], autoEatById[row.id], combatById[row.id],
      );
    }
    for (const sel of selections.rows) {
      this._data.userSelections[sel.user_id] = sel.bot_id;
    }

    this._loaded = true;
    logger.info(`[Persistence] Loaded ${botRows.rows.length} bot(s) from PostgreSQL.`);
    return this._data;
  }

  /** Re-encrypt all passwords with the current key (key rotation). */
  rotateKeys() {
    const { key, oldKey } = config.encryption;
    if (!oldKey) return 0;

    let rotated = 0;
    for (const bot of Object.values(this._data.bots)) {
      if (!bot.encryptedPassword) continue;
      if (!needsRotation(bot.encryptedPassword, key)) continue;
      try {
        const { plaintext } = decrypt(bot.encryptedPassword, key, oldKey);
        bot.encryptedPassword = encrypt(plaintext, key);
        bot.updatedAt = new Date().toISOString();
        // Persist just the re-encrypted credential.
        this._enqueue(
          'UPDATE bots SET encrypted_password = $2, updated_at = now() WHERE id = $1',
          [bot.id, bot.encryptedPassword],
          `rotateKeys(${bot.id})`,
        );
        rotated++;
      } catch (err) {
        logger.error(`[Persistence] Key rotation failed for bot ${bot.id}: ${err.message}`);
      }
    }
    if (rotated > 0) logger.info(`[Persistence] Key rotation re-encrypted ${rotated} password(s).`);
    return rotated;
  }

  // ─── Bot CRUD (sync interface, write-behind to PG) ─────────────────────────
  getBot(id) {
    return this._data.bots[id] || null;
  }

  getAllBots() {
    return Object.values(this._data.bots);
  }

  findBot(host, port, username) {
    return Object.values(this._data.bots).find(
      (b) => b.host === host && b.port === port && b.username === username,
    ) || null;
  }

  /**
   * Insert or replace a full bot record (used by create + edit).
   * Updates the cache synchronously and persists (bot row + 3 config rows) in
   * a single transaction behind the write queue.
   */
  saveBot(record) {
    // Normalise: guarantee config sub-objects + timestamps exist.
    const normalised = this._normaliseRecord(record);
    this._data.bots[normalised.id] = normalised;

    this._enqueueTask(async (client) => {
      await client.query(
        `INSERT INTO bots
           (id, host, port, username, encrypted_password, version,
            auto_reconnect, was_running, hidden, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           host=$2, port=$3, username=$4, encrypted_password=$5, version=$6,
           auto_reconnect=$7, was_running=$8, hidden=$9, created_by=$10,
           created_at=$11, updated_at=$12`,
        [
          normalised.id, normalised.host, normalised.port, normalised.username,
          normalised.encryptedPassword, normalised.version, normalised.autoReconnect,
          normalised.wasRunning, normalised.hidden, normalised.createdBy,
          normalised.createdAt, normalised.updatedAt,
        ],
      );
      await this._upsertAntiAfk(client, normalised.id, normalised.antiAfk);
      await this._upsertAutoEat(client, normalised.id, normalised.autoEat);
      await this._upsertCombat(client, normalised.id, normalised.combat);
    }, `saveBot(${normalised.id})`);
  }

  deleteBot(id) {
    if (!this._data.bots[id]) return false;
    delete this._data.bots[id];
    for (const [uid, bid] of Object.entries(this._data.userSelections)) {
      if (bid === id) delete this._data.userSelections[uid];
    }
    // ON DELETE CASCADE removes config + selection rows automatically.
    this._enqueue('DELETE FROM bots WHERE id = $1', [id], `deleteBot(${id})`);
    return true;
  }

  /** Partial update of mutable top-level fields (e.g. { wasRunning: true }). */
  updateBotState(id, patch) {
    const bot = this._data.bots[id];
    if (!bot) return;
    Object.assign(bot, patch, { updatedAt: new Date().toISOString() });

    const COLUMN_MAP = {
      host: 'host', port: 'port', version: 'version',
      encryptedPassword: 'encrypted_password', autoReconnect: 'auto_reconnect',
      wasRunning: 'was_running', hidden: 'hidden',
    };
    const sets = [];
    const params = [id];
    for (const [key, col] of Object.entries(COLUMN_MAP)) {
      if (patch[key] !== undefined) {
        params.push(patch[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    sets.push('updated_at = now()');
    this._enqueue(`UPDATE bots SET ${sets.join(', ')} WHERE id = $1`, params, `updateBotState(${id})`);
  }

  /** Update a subsystem config (antiAfk | autoEat | combat) for a bot. */
  updateBotConfig(id, section, patch) {
    const bot = this._data.bots[id];
    if (!bot || !bot[section]) return;
    Object.assign(bot[section], patch);
    this._enqueueTask(async (client) => {
      if (section === 'antiAfk') await this._upsertAntiAfk(client, id, bot.antiAfk);
      else if (section === 'autoEat') await this._upsertAutoEat(client, id, bot.autoEat);
      else if (section === 'combat') await this._upsertCombat(client, id, bot.combat);
    }, `updateBotConfig(${id}, ${section})`);
  }

  // ─── User selections ───────────────────────────────────────────
  getUserSelection(userId) {
    return this._data.userSelections[userId] || null;
  }

  setUserSelection(userId, botId) {
    this._data.userSelections[userId] = botId;
    this._enqueue(
      `INSERT INTO user_selections (user_id, bot_id, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET bot_id = $2, updated_at = now()`,
      [userId, botId],
      `setUserSelection(${userId})`,
    );
  }

  // ─── Activity history ─────────────────────────────────────────
  /** Append an entry to a bot's activity history (fire-and-forget). */
  logActivity(botId, action, actor = null, meta = {}) {
    this._enqueue(
      `INSERT INTO bot_activity_log (bot_id, action, actor, meta)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [botId, action, actor, JSON.stringify(meta || {})],
      `logActivity(${botId}, ${action})`,
    );
  }

  /** Read recent activity history for a bot (async – not cached). */
  async getActivityHistory(botId, limit = 50) {
    const { rows } = await db.query(
      `SELECT id, bot_id, action, actor, meta, created_at
       FROM bot_activity_log
       WHERE bot_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [botId, limit],
    );
    return rows;
  }

  // ─── Flush / shutdown ─────────────────────────────────────────
  /** Await all pending write-behind tasks. Use this on shutdown. */
  async flush() {
    await this._writeChain;
  }

  /**
   * Backwards-compatible shim for the old synchronous flushSync(). It can no
   * longer block (DB writes are async) but it returns the drain promise so
   * callers may optionally await it. Existing non-awaiting callers still work.
   */
  flushSync() {
    return this.flush();
  }

  // ─── Internal helpers ─────────────────────────────────────────
  _normaliseRecord(record) {
    const now = new Date().toISOString();
    return {
      id:                record.id,
      host:              record.host,
      port:              record.port,
      username:          record.username,
      encryptedPassword: record.encryptedPassword || '',
      version:           record.version,
      autoReconnect:     record.autoReconnect !== undefined ? record.autoReconnect : true,
      wasRunning:        record.wasRunning !== undefined ? record.wasRunning : false,
      hidden:            record.hidden !== undefined ? record.hidden : false,
      createdBy:         record.createdBy || null,
      createdAt:         record.createdAt || now,
      updatedAt:         record.updatedAt || now,
      antiAfk:           { ...DEFAULT_ANTIAFK, ...(record.antiAfk || {}) },
      autoEat:           { ...DEFAULT_AUTOEAT, ...(record.autoEat || {}) },
      combat:            { ...DEFAULT_COMBAT, ...(record.combat || {}) },
    };
  }

  _upsertAntiAfk(client, botId, c) {
    return client.query(
      `INSERT INTO bot_antiafk_config
         (bot_id, enabled, min_radius, max_radius, min_interval, max_interval,
          max_retries, move_timeout, stuck_timeout, rotation_interval)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (bot_id) DO UPDATE SET
         enabled=$2, min_radius=$3, max_radius=$4, min_interval=$5,
         max_interval=$6, max_retries=$7, move_timeout=$8, stuck_timeout=$9,
         rotation_interval=$10`,
      [botId, c.enabled, c.minRadius, c.maxRadius, c.minInterval, c.maxInterval,
       c.maxRetries, c.moveTimeout, c.stuckTimeout, c.rotationInterval],
    );
  }

  _upsertAutoEat(client, botId, c) {
    return client.query(
      `INSERT INTO bot_autoeat_config
         (bot_id, enabled, eat_threshold, eat_cooldown, check_interval)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (bot_id) DO UPDATE SET
         enabled=$2, eat_threshold=$3, eat_cooldown=$4, check_interval=$5`,
      [botId, c.enabled, c.eatThreshold, c.eatCooldown, c.checkInterval],
    );
  }

  _upsertCombat(client, botId, c) {
    return client.query(
      `INSERT INTO bot_combat_config
         (bot_id, enabled, scan_range, engage_range, max_combat_duration,
          retreat_hp_pct, scan_interval, attack_interval, invisible_timeout)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (bot_id) DO UPDATE SET
         enabled=$2, scan_range=$3, engage_range=$4, max_combat_duration=$5,
         retreat_hp_pct=$6, scan_interval=$7, attack_interval=$8,
         invisible_timeout=$9`,
      [botId, c.enabled, c.scanRange, c.engageRange, c.maxCombatDuration,
       c.retreatHpPct, c.scanInterval, c.attackInterval, c.invisibleTimeout],
    );
  }

  /** Queue a single parameterised statement. */
  _enqueue(text, params, label) {
    this._enqueueTask((client) => client.query(text, params), label);
  }

  /** Queue an arbitrary transactional task; tasks run strictly in order. */
  _enqueueTask(taskFn, label) {
    this._pending++;
    this._writeChain = this._writeChain
      .then(() => db.withTransaction(taskFn))
      .catch((err) => {
        logger.error(`[Persistence] Write failed (${label}): ${err.message}`);
      })
      .finally(() => { this._pending--; });
    return this._writeChain;
  }
}

function indexBy(rows, key) {
  const out = {};
  for (const row of rows) out[row[key]] = row;
  return out;
}

module.exports = new Persistence();
