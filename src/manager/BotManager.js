'use strict';
const { v4: uuidv4 }  = require('uuid');
const cron            = require('node-cron');

const BotInstance   = require('../bot/BotInstance');
const Persistence   = require('./Persistence');
const { encrypt }   = require('../services/encryption');
const { logger, botLog, flushSummary, checkAlertCooldown } = require('../services/logger');
const { validateBotConfig } = require('../utils/validators');
const { BOT_STATES, STARTABLE_STATES } = require('../bot/states');
const config = require('../config');

class BotManager {
  constructor() {
    /** @type {Map<string, BotInstance>} */
    this._bots = new Map();

    /** @type {import('discord.js').Client|null} */
    this._discordClient = null;

    this._alertChannelId = config.discord.alertChannelId;
    this._auditChannelId = config.discord.auditChannelId;
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────────

  setDiscordClient(client) {
    this._discordClient = client;
    // Schedule periodic log summary
    const interval = Math.max(10, Math.min(30, config.limits.logSummaryIntervalMin));
    cron.schedule(`*/${interval} * * * *`, () => this._sendLogSummary());
    logger.info(`[BotManager] Log summary scheduled every ${interval} minutes.`);
  }

  /** Load persisted bots and restart those that were running. */
  async initialize() {
    Persistence.load();

    // Key rotation
    if (config.encryption.oldKey) {
      const rotated = Persistence.rotateKeys();
      if (rotated > 0) logger.info(`[BotManager] Key rotation: re-encrypted ${rotated} password(s).`);
    }

    const records = Persistence.getAllBots();
    logger.info(`[BotManager] Loaded ${records.length} bot record(s).`);

    for (const record of records) {
      const instance = new BotInstance(record);
      this._bots.set(record.id, instance);
      this._attachInstanceEvents(instance);

      if (record.wasRunning) {
        logger.info(`[BotManager] Auto-starting bot ${record.id} (wasRunning=true)`);
        instance.start().catch(err =>
          logger.error(`[BotManager] Auto-start failed for ${record.id}: ${err.message}`)
        );
      }
    }
  }

  // ─── Bot lifecycle ────────────────────────────────────────────────────────────

  /**
   * Create and persist a new bot.
   * @param {object} opts
   * @param {string} createdBy  – Discord userId
   * @returns {{ id: string, record: object }}
   */
  async createBot(opts, createdBy) {
    const { host, port, username, password, version, autoReconnect = true } = opts;

    // Validate
    const validation = validateBotConfig({ host, port, username, version });
    if (!validation.valid) throw new Error(validation.errors.join(', '));

    // Uniqueness check
    if (Persistence.findBot(host, parseInt(port, 10), username)) {
      throw new Error(`A bot for ${username}@${host}:${port} already exists.`);
    }

    // Max bot limit
    if (this._bots.size >= config.limits.maxBots) {
      throw new Error(`Maximum bot limit (${config.limits.maxBots}) reached.`);
    }

    const encryptedPassword = password ? encrypt(password, config.encryption.key) : '';

    const record = {
      id:                uuidv4(),
      host,
      port:              parseInt(port, 10),
      username,
      encryptedPassword,
      version,
      autoReconnect,
      wasRunning:        false,
      createdAt:         new Date().toISOString(),
      updatedAt:         new Date().toISOString(),
      createdBy,
    };

    Persistence.saveBot(record);

    const instance = new BotInstance(record);
    this._bots.set(record.id, instance);
    this._attachInstanceEvents(instance);

    logger.info(`[BotManager] Bot created: ${record.id} (${username}@${host}:${port})`);
    this._auditLog(`Bot created`, createdBy, { id: record.id, username, host, port, version });

    return { id: record.id, record };
  }

  async deleteBot(id, deletedBy) {
    const instance = this._bots.get(id);
    if (!instance) throw new Error(`Bot ${id} not found.`);

    if (STARTABLE_STATES.has(instance.state) === false) {
      // Bot is alive – stop it first
      await instance.stop(true);
    }

    await instance.destroy();
    this._bots.delete(id);
    Persistence.deleteBot(id);

    logger.info(`[BotManager] Bot deleted: ${id} by ${deletedBy}`);
    this._auditLog(`Bot deleted`, deletedBy, { id });
  }

  async startBot(id) {
    const instance = this._getBotOrThrow(id);
    await instance.start();
    Persistence.updateBotState(id, { wasRunning: true });
  }

  async stopBot(id, force = false) {
    const instance = this._getBotOrThrow(id);
    await instance.stop(force);
    Persistence.updateBotState(id, { wasRunning: false });
  }

  async restartBot(id) {
    const instance = this._getBotOrThrow(id);
    await instance.stop(true);
    // Small pause
    await new Promise(r => setTimeout(r, 1500));
    await instance.start();
    Persistence.updateBotState(id, { wasRunning: true });
  }

  async editBot(id, patch, editedBy) {
    const instance = this._getBotOrThrow(id);
    const record   = instance.record;

    const allowed = {};
    if (patch.host     !== undefined) allowed.host     = patch.host;
    if (patch.port     !== undefined) allowed.port     = parseInt(patch.port, 10);
    if (patch.version  !== undefined) allowed.version  = patch.version;
    if (patch.autoReconnect !== undefined) allowed.autoReconnect = !!patch.autoReconnect;
    if (patch.password !== undefined && patch.password !== '') {
      allowed.encryptedPassword = encrypt(patch.password, config.encryption.key);
    }
    allowed.updatedAt = new Date().toISOString();

    Object.assign(record, allowed);
    Persistence.saveBot(record);

    logger.info(`[BotManager] Bot edited: ${id} by ${editedBy}`);
    this._auditLog(`Bot edited`, editedBy, { id, changes: Object.keys(allowed) });
  }

  async chatBot(id, message) {
    const instance = this._getBotOrThrow(id);
    await instance.chat(message);
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────

  getBot(id) { return this._bots.get(id) || null; }

  getAllBots() {
    return [...this._bots.values()];
  }

  getUserSelection(userId) {
    const botId = Persistence.getUserSelection(userId);
    if (!botId) return null;
    return this._bots.get(botId) || null;
  }

  setUserSelection(userId, botId) {
    if (!this._bots.has(botId)) throw new Error(`Bot ${botId} not found.`);
    Persistence.setUserSelection(userId, botId);
  }

  /** Resolve a bot by id, or fall back to user's selection. */
  resolveBotForUser(botIdOrNull, userId) {
    if (botIdOrNull) return this.getBot(botIdOrNull);
    return this.getUserSelection(userId);
  }

  getStats() {
    const mem   = process.memoryUsage();
    const bots  = this.getAllBots();
    const alive = bots.filter(b => b.state !== BOT_STATES.OFFLINE && b.state !== BOT_STATES.DISCONNECTED);
    return {
      uptime:      process.uptime(),
      totalBots:   bots.length,
      aliveBots:   alive.length,
      memHeapUsed: mem.heapUsed,
      memRSS:      mem.rss,
      memExternal: mem.external,
      // Rough per-bot estimate: heap / alive bots
      estimatedPerBotMB: alive.length ? Math.round(mem.heapUsed / alive.length / 1024 / 1024) : 0,
    };
  }

  // ─── Instance event wiring ────────────────────────────────────────────────────

  _attachInstanceEvents(instance) {
    instance.on('stateChange', (oldState, newState) => {
      Persistence.updateBotState(instance.id, {
        wasRunning: newState !== BOT_STATES.OFFLINE && newState !== BOT_STATES.DISCONNECTED,
      });
    });

    instance.on('alert', (type, message) => {
      this._sendAlert(instance, type, message).catch(() => {});
    });

    instance.on('noFood', () => {
      if (checkAlertCooldown(`${instance.id}:noFood`)) {
        this._sendAlert(instance, 'noFood', 'Bot has run out of food! Auto-eat disabled.').catch(() => {});
      }
    });

    instance.on('inventoryFull', () => {
      if (checkAlertCooldown(`${instance.id}:inventoryFull`)) {
        this._sendAlert(instance, 'inventoryFull', 'Bot inventory is full and has no droppable items.').catch(() => {});
      }
    });
  }

  _getBotOrThrow(id) {
    const b = this._bots.get(id);
    if (!b) throw new Error(`Bot ${id} not found.`);
    return b;
  }

  // ─── Discord alerts ───────────────────────────────────────────────────────────

  async _sendAlert(instance, type, message) {
    if (!this._discordClient || !this._alertChannelId) return;
    try {
      const ch = await this._discordClient.channels.fetch(this._alertChannelId);
      if (!ch?.isTextBased()) return;

      const emoji = { death: '💀', disconnect: '🔌', loginFailed: '🔐', reconnectFailed: '🔄', noFood: '🍖', inventoryFull: '🎒' };
      const e     = emoji[type] || '⚠️';

      const { EmbedBuilder } = require('discord.js');
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`${e} Bot Alert — ${type}`)
        .setDescription(message)
        .addFields(
          { name: 'Bot',    value: `\`${instance.record.username}\`@\`${instance.record.host}:${instance.record.port}\``, inline: true },
          { name: 'State',  value: instance.state, inline: true },
          { name: 'Bot ID', value: `\`${instance.id.slice(0, 8)}\``, inline: true }
        )
        .setTimestamp();

      await ch.send({ embeds: [embed] });
    } catch (err) {
      logger.error(`[BotManager] Failed to send Discord alert: ${err.message}`);
    }
  }

  async _sendLogSummary() {
    if (!this._discordClient || !this._alertChannelId) return;
    const summary = flushSummary();
    if (!summary) return;
    try {
      const ch = await this._discordClient.channels.fetch(this._alertChannelId);
      if (!ch?.isTextBased()) return;
      const { EmbedBuilder } = require('discord.js');
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('📋 System Log Summary')
        .setDescription(summary.slice(0, 4000)) // Discord embed limit
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    } catch (err) {
      logger.error(`[BotManager] Log summary send failed: ${err.message}`);
    }
  }

  _auditLog(action, userId, meta = {}) {
    const msg = `[AUDIT] ${action} by ${userId} | ${JSON.stringify(meta)}`;
    logger.info(msg);

    if (this._discordClient && this._auditChannelId) {
      this._discordClient.channels.fetch(this._auditChannelId).then(ch => {
        if (!ch?.isTextBased()) return;
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle('📝 Audit Log')
          .addFields(
            { name: 'Action',  value: action, inline: true },
            { name: 'User ID', value: userId, inline: true },
            { name: 'Details', value: `\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`` }
          )
          .setTimestamp();
        ch.send({ embeds: [embed] });
      }).catch(() => {});
    }
  }

  /** Graceful shutdown. */
  async shutdown() {
    logger.info('[BotManager] Shutting down all bots…');
    const stops = [...this._bots.values()].map(b => b.stop(true).catch(() => {}));
    await Promise.all(stops);
    Persistence.flushSync();
    logger.info('[BotManager] Shutdown complete.');
  }
}

module.exports = new BotManager();
