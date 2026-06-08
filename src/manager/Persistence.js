'use strict';
const fs   = require('fs');
const path = require('path');
const { logger }       = require('../services/logger');
const { encrypt, decrypt, needsRotation } = require('../services/encryption');
const config = require('../config');

const DATA_FILE = path.resolve(config.storage.dataFile);
const DATA_DIR  = path.dirname(DATA_FILE);

// ─── Schema ───────────────────────────────────────────────────────────────────
/**
 * Stored bot record shape:
 * {
 *   id:                string (UUID)
 *   host:              string
 *   port:              number
 *   username:          string
 *   encryptedPassword: string   (AES-256-GCM payload)
 *   version:           string
 *   autoReconnect:     boolean
 *   wasRunning:        boolean  (true = restart on Node.js reboot)
 *   createdAt:         string   (ISO)
 *   updatedAt:         string   (ISO)
 *   createdBy:         string   (Discord userId)
 * }
 */

class Persistence {
  constructor() {
    this._data    = null; // { bots: {id: BotRecord}, userSelections: {userId: botId} }
    this._dirty   = false;
    this._saveTimer = null;
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  /** Load data from disk (call once at startup). */
  load() {
    if (!fs.existsSync(DATA_FILE)) {
      this._data = { bots: {}, userSelections: {} };
      logger.info('[Persistence] No data file found – starting fresh.');
      return this._data;
    }
    try {
      const raw  = fs.readFileSync(DATA_FILE, 'utf8');
      this._data = JSON.parse(raw);
      if (!this._data.bots)           this._data.bots           = {};
      if (!this._data.userSelections) this._data.userSelections = {};
      logger.info(`[Persistence] Loaded ${Object.keys(this._data.bots).length} bot(s) from ${DATA_FILE}`);
    } catch (err) {
      logger.error(`[Persistence] Failed to parse data file: ${err.message}`);
      logger.warn('[Persistence] Starting with empty data. Old file renamed to .bak');
      try { fs.renameSync(DATA_FILE, DATA_FILE + '.bak'); } catch (_) { /* ignore */ }
      this._data = { bots: {}, userSelections: {} };
    }
    return this._data;
  }

  /** Perform key rotation: re-encrypt all passwords with current key. */
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
        rotated++;
      } catch (err) {
        logger.error(`[Persistence] Key rotation failed for bot ${bot.id}: ${err.message}`);
      }
    }
    if (rotated > 0) {
      this._dirty = true;
      this._flush();
      logger.info(`[Persistence] Key rotation complete – re-encrypted ${rotated} password(s).`);
    }
    return rotated;
  }

  // ─── Bot CRUD ───────────────────────────────────────────────────────────────

  getBot(id) {
    return this._data.bots[id] || null;
  }

  getAllBots() {
    return Object.values(this._data.bots);
  }

  /** Find bot by server+username (uniqueness check). */
  findBot(host, port, username) {
    return Object.values(this._data.bots).find(
      b => b.host === host && b.port === port && b.username === username
    ) || null;
  }

  saveBot(record) {
    this._data.bots[record.id] = record;
    this._scheduleSave();
  }

  deleteBot(id) {
    if (!this._data.bots[id]) return false;
    delete this._data.bots[id];
    // Remove user selections pointing to this bot
    for (const [uid, bid] of Object.entries(this._data.userSelections)) {
      if (bid === id) delete this._data.userSelections[uid];
    }
    this._scheduleSave();
    return true;
  }

  updateBotState(id, patch) {
    if (!this._data.bots[id]) return;
    Object.assign(this._data.bots[id], patch, { updatedAt: new Date().toISOString() });
    this._scheduleSave();
  }

  // ─── User → Bot selection ───────────────────────────────────────────────────

  getUserSelection(userId) {
    return this._data.userSelections[userId] || null;
  }

  setUserSelection(userId, botId) {
    this._data.userSelections[userId] = botId;
    this._scheduleSave();
  }

  // ─── Save mechanics ─────────────────────────────────────────────────────────

  /** Debounce saves – write at most every 2s under burst. */
  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._flush();
    }, 2000);
  }

  /** Atomic write using a temp file + rename. */
  _flush() {
    if (!this._dirty) return;
    try {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._data, null, 2), 'utf8');
      fs.renameSync(tmp, DATA_FILE);
      this._dirty = false;
    } catch (err) {
      logger.error(`[Persistence] Failed to write data file: ${err.message}`);
    }
  }

  /** Force-save (call on shutdown). */
  flushSync() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this._flush();
  }
}

module.exports = new Persistence();
