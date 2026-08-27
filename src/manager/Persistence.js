'use strict';
/**
 * PostgreSQL-backed persistence facade.
 *
 * Keeps in-memory state synchronized with PostgreSQL through ordered,
 * write-behind transactions. Row mapping and raw queries live in sibling
 * modules to keep this class focused on state and orchestration.
 */
const db = require('../config/database');
const { logger } = require('../services/logger');
const { encrypt, decrypt, needsRotation } = require('../services/encryption');
const config = require('../config');
const {
  DEFAULT_ANTIAFK,
  DEFAULT_AUTOEAT,
  DEFAULT_COMBAT,
} = require('./botRecordFactory');
const { recordFromRow, indexBy } = require('./persistenceHelpers');
const botRepository = require('./botRepository');

const MAX_PENDING_WRITES = 500;
const FLUSH_TIMEOUT_MS = 10_000;

class PersistenceError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

// ─── Persistence ──────────────────────────────────────────────────────
class Persistence {
  constructor() {
    this._data = { bots: {}, userSelections: {} };
    this._loaded = false;
    this._writeChain = Promise.resolve();
    this._pending = 0;
  }

  // ─── Startup ──────────────────────────────────────────────────
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
    const combatById = indexBy(combat.rows, 'bot_id');
    this._data = { bots: {}, userSelections: {} };
    for (const row of botRows.rows) {
      this._data.bots[row.id] = recordFromRow(
        row,
        antiAfkById[row.id],
        autoEatById[row.id],
        combatById[row.id]
      );
    }
    for (const sel of selections.rows) {
      this._data.userSelections[sel.user_id] = sel.bot_id;
    }
    this._loaded = true;
    logger.info(
      `[Persistence] Loaded ${botRows.rows.length} bot(s) from PostgreSQL.`
    );
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
        this._enqueue(
          'UPDATE bots SET encrypted_password = $2, updated_at = now() WHERE id = $1',
          [bot.id, bot.encryptedPassword],
          `rotateKeys(${bot.id})`
        );
        rotated++;
      } catch (err) {
        logger.error(
          `[Persistence] Key rotation failed for bot ${bot.id}: ${err.message}`
        );
      }
    }
    if (rotated > 0)
      logger.info(
        `[Persistence] Key rotation re-encrypted ${rotated} password(s).`
      );
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
    return (
      Object.values(this._data.bots).find(
        (b) => b.host === host && b.port === port && b.username === username
      ) || null
    );
  }

  async saveBot(record) {
    const normalised = this._normaliseRecord(record);
    await this._enqueueTask(
      (client) => botRepository.saveBotFull(client, normalised),
      `saveBot(${normalised.id})`,
      { critical: true }
    );
    this._data.bots[normalised.id] = normalised;
    return normalised;
  }

  async saveBotWithActivity(record, action, actor, meta = {}) {
    const normalised = this._normaliseRecord(record);
    await this._enqueueTask(
      async (client) => {
        await botRepository.saveBotFull(client, normalised);
        await this._insertActivity(client, normalised.id, action, actor, meta);
      },
      `saveBotWithActivity(${normalised.id}, ${action})`,
      { critical: true }
    );
    this._data.bots[normalised.id] = normalised;
    return normalised;
  }

  async deleteBot(id) {
    if (!this._data.bots[id]) return false;
    await this._enqueueTask(
      (client) => botRepository.deleteBotRow(client, id),
      `deleteBot(${id})`,
      { critical: true }
    );
    delete this._data.bots[id];
    for (const [uid, bid] of Object.entries(this._data.userSelections)) {
      if (bid === id) delete this._data.userSelections[uid];
    }
    return true;
  }

  async deleteBotWithActivity(id, action, actor, meta = {}) {
    if (!this._data.bots[id]) return false;
    await this._enqueueTask(
      async (client) => {
        await this._insertActivity(client, id, action, actor, meta);
        await botRepository.deleteBotRow(client, id);
      },
      `deleteBotWithActivity(${id}, ${action})`,
      { critical: true }
    );
    delete this._data.bots[id];
    for (const [uid, bid] of Object.entries(this._data.userSelections)) {
      if (bid === id) delete this._data.userSelections[uid];
    }
    return true;
  }

  async updateBotState(id, patch) {
    const bot = this._data.bots[id];
    if (!bot) return false;
    const update = this._buildBotStateUpdate(id, patch);
    await this._enqueueTask(
      (client) => client.query(update.text, update.params),
      `updateBotState(${id})`,
      { critical: true }
    );
    Object.assign(bot, patch, { updatedAt: new Date().toISOString() });
    return true;
  }

  async updateBotStateWithActivity(id, patch, action, actor, meta = {}) {
    const bot = this._data.bots[id];
    if (!bot) return false;
    const update = this._buildBotStateUpdate(id, patch);
    await this._enqueueTask(
      async (client) => {
        await client.query(update.text, update.params);
        await this._insertActivity(client, id, action, actor, meta);
      },
      `updateBotStateWithActivity(${id}, ${action})`,
      { critical: true }
    );
    Object.assign(bot, patch, { updatedAt: new Date().toISOString() });
    return true;
  }

  updateBotConfig(id, section, patch) {
    const bot = this._data.bots[id];
    if (!bot || !bot[section]) return;
    Object.assign(bot[section], patch);
    this._enqueueTask(async (client) => {
      if (section === 'antiAfk')
        await botRepository.upsertAntiAfk(client, id, bot.antiAfk);
      else if (section === 'autoEat')
        await botRepository.upsertAutoEat(client, id, bot.autoEat);
      else if (section === 'combat')
        await botRepository.upsertCombat(client, id, bot.combat);
    }, `updateBotConfig(${id}, ${section})`);
  }

  // ─── User selections ───────────────────────────────────────────
  getUserSelection(userId) {
    return this._data.userSelections[userId] || null;
  }

  async setUserSelection(userId, botId) {
    await this._enqueueTask(
      (client) =>
        client.query(
          `INSERT INTO user_selections (user_id, bot_id, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET bot_id = $2, updated_at = now()`,
          [userId, botId]
        ),
      `setUserSelection(${userId})`,
      { critical: true }
    );
    this._data.userSelections[userId] = botId;
  }

  // ─── Activity history ─────────────────────────────────────────
  async logActivity(botId, action, actor = null, meta = {}) {
    await this._enqueueTask(
      (client) =>
        client.query(
          `INSERT INTO bot_activity_log (bot_id, action, actor, meta)
         VALUES ($1, $2, $3, $4::jsonb)`,
          [botId, action, actor, JSON.stringify(meta || {})]
        ),
      `logActivity(${botId}, ${action})`,
      { critical: true }
    );
  }

  async getActivityHistory(botId, limit = 50) {
    const { rows } = await db.query(
      `SELECT id, bot_id, action, actor, meta, created_at
       FROM bot_activity_log
       WHERE bot_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [botId, limit]
    );
    return rows;
  }

  // ─── Flush / shutdown ─────────────────────────────────────────
  /**
   * FIX: Await all pending write-behind tasks with a timeout to prevent
   * hanging indefinitely if the DB is unresponsive during shutdown.
   */
  async flush() {
    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => {
        logger.warn(
          `[Persistence] Flush timed out after ${FLUSH_TIMEOUT_MS}ms — some writes may be lost.`
        );
        resolve();
      }, FLUSH_TIMEOUT_MS)
    );
    await Promise.race([this._writeChain, timeoutPromise]);
  }

  // ─── Internal helpers ─────────────────────────────────────────
  _buildBotStateUpdate(id, patch) {
    const columnMap = {
      host: 'host',
      port: 'port',
      username: 'username',
      label: 'label',
      version: 'version',
      encryptedPassword: 'encrypted_password',
      autoReconnect: 'auto_reconnect',
      wasRunning: 'was_running',
      hidden: 'hidden',
    };
    const sets = [];
    const params = [id];
    for (const [key, column] of Object.entries(columnMap)) {
      if (patch[key] !== undefined) {
        params.push(patch[key]);
        sets.push(`${column} = $${params.length}`);
      }
    }
    sets.push('updated_at = now()');
    return {
      text: `UPDATE bots SET ${sets.join(', ')} WHERE id = $1`,
      params,
    };
  }

  _insertActivity(client, botId, action, actor, meta) {
    return client.query(
      `INSERT INTO bot_activity_log (bot_id, action, actor, meta)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [botId, action, actor, JSON.stringify(meta || {})]
    );
  }

  _normaliseRecord(record) {
    const now = new Date().toISOString();
    return {
      id: record.id,
      host: record.host,
      port: record.port,
      username: record.username,
      label: record.label || '',
      encryptedPassword: record.encryptedPassword || '',
      version: record.version,
      autoReconnect:
        record.autoReconnect !== undefined ? record.autoReconnect : true,
      wasRunning: record.wasRunning !== undefined ? record.wasRunning : false,
      hidden: record.hidden !== undefined ? record.hidden : false,
      createdBy: record.createdBy || null,
      createdInGuild: record.createdInGuild || null,
      createdAt: record.createdAt || now,
      updatedAt: record.updatedAt || now,
      antiAfk: { ...DEFAULT_ANTIAFK, ...(record.antiAfk || {}) },
      autoEat: { ...DEFAULT_AUTOEAT, ...(record.autoEat || {}) },
      combat: { ...DEFAULT_COMBAT, ...(record.combat || {}) },
    };
  }

  /** Queue a single parameterised statement. */
  _enqueue(text, params, label) {
    return this._enqueueTask((client) => client.query(text, params), label);
  }

  /**
   * Queue an arbitrary transactional task; tasks run strictly in order.
   *
   * FIX: Added backpressure - if too many writes are pending (e.g., DB is
   * slow/down), new writes are dropped with a warning instead of building
   * an unbounded promise chain that consumes memory indefinitely.
   *
   * FIX: Error in one task no longer breaks the chain for subsequent tasks.
   * The original code's .catch() would swallow the error but the chain
   * reference was already set, so this is safe. We add explicit chain
   * recovery to make it bulletproof.
   */
  _enqueueTask(taskFn, label, { critical = false } = {}) {
    if (this._pending >= MAX_PENDING_WRITES) {
      const err = new PersistenceError(
        'PERSISTENCE_QUEUE_FULL',
        'Persistence is temporarily unavailable.'
      );
      logger.warn(
        `[Persistence] Write queue full (${this._pending} pending) — rejecting: ${label}`
      );
      return critical ? Promise.reject(err) : Promise.resolve();
    }

    this._pending++;
    const execution = this._writeChain.then(() => db.withTransaction(taskFn));
    this._writeChain = execution
      .catch((err) => {
        logger.error(`[Persistence] Write failed (${label}): ${err.message}`);
      })
      .finally(() => {
        this._pending--;
      });

    if (!critical) return this._writeChain;
    return execution.catch((cause) => {
      throw new PersistenceError(
        'PERSISTENCE_WRITE_FAILED',
        'Persistence is temporarily unavailable.',
        cause
      );
    });
  }
}

module.exports = new Persistence();
