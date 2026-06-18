'use strict';

const cron = require('node-cron');

const BotInstance = require('../bot/BotInstance');
const Persistence = require('./Persistence');
const DiscordNotifier = require('./DiscordNotifier');
const { buildNewRecord, buildEditPatch } = require('./botRecordFactory');
const { attachInstanceEvents } = require('./instanceEvents');
const { computeStats } = require('./managerStats');
const { logger, flushSummary, clearBotState } = require('../services/logger');
const config = require('../config');

const RESTART_PAUSE_MS = 1_500;
const SUMMARY_INTERVAL_MIN = 15;
const SUMMARY_INTERVAL_BOUNDS = { min: 10, max: 30 };

class BotManager {
  constructor() {
    /** @type {Map<string, BotInstance>} */
    this._bots = new Map();
    /** @type {import('discord.js').Client|null} */
    this._discordClient = null;

    this._notifier = new DiscordNotifier({
      getClient: () => this._discordClient,
      alertChannelId: config.discord.alertChannelId,
      auditChannelId: config.discord.auditChannelId,
      logChannelId: config.discord.logChannelId,
    });
  }

  // ─── Bootstrap ───
  setDiscordClient(client) {
    this._discordClient = client;
    const interval = Math.max(
      SUMMARY_INTERVAL_BOUNDS.min,
      Math.min(SUMMARY_INTERVAL_BOUNDS.max, config.limits.logSummaryIntervalMin || SUMMARY_INTERVAL_MIN),
    );
    cron.schedule(`*/${interval} * * * *`, () => {
      this._notifier.sendLogSummary(flushSummary()).catch(() => {});
    });
    logger.info(`[BotManager] Log summary scheduled every ${interval} minutes.`);
  }

  /** Load persisted bots and restart those that were running. */
  async initialize() {
    Persistence.load();

    if (config.encryption.oldKey) {
      const rotated = Persistence.rotateKeys();
      if (rotated > 0) logger.info(`[BotManager] Key rotation: re-encrypted ${rotated} password(s).`);
    }

    const records = Persistence.getAllBots();
    logger.info(`[BotManager] Loaded ${records.length} bot record(s).`);

    for (const record of records) {
      const instance = this._register(record);
      if (record.wasRunning) {
        logger.info(`[BotManager] Auto-starting bot ${record.id} (wasRunning=true)`);
        instance.start().catch((err) =>
          logger.error(`[BotManager] Auto-start failed for ${record.id}: ${err.message}`),
        );
      }
    }
  }

  // ─── Bot lifecycle ───
  async createBot(opts, createdBy) {
    const record = buildNewRecord(opts, createdBy);

    if (Persistence.findBot(record.host, record.port, record.username)) {
      throw new Error(`A bot for ${record.username}@${record.host}:${record.port} already exists.`);
    }
    if (this._bots.size >= config.limits.maxBots) {
      throw new Error(`Maximum bot limit (${config.limits.maxBots}) reached.`);
    }

    Persistence.saveBot(record);
    this._register(record);

    logger.info(`[BotManager] Bot created: ${record.id} (${record.username}@${record.host}:${record.port})`);
    this._auditLog('Bot created', createdBy, {
      id: record.id, username: record.username, host: record.host, port: record.port, version: record.version,
    });

    return { id: record.id, record };
  }

  async deleteBot(id, deletedBy) {
    const instance = this._getBotOrThrow(id);
    // destroy() performs a forced stop internally; calling stop() separately
    // here previously double-stopped and double-drained the queue.
    await instance.destroy();
    this._bots.delete(id);
    Persistence.deleteBot(id);
    clearBotState(id); // release per-bot log buffer + alert cooldowns (avoids leak)

    logger.info(`[BotManager] Bot deleted: ${id} by ${deletedBy}`);
    this._auditLog('Bot deleted', deletedBy, { id });
  }

  async startBot(id) {
    await this._getBotOrThrow(id).start();
    Persistence.updateBotState(id, { wasRunning: true });
  }

  async stopBot(id, force = false) {
    await this._getBotOrThrow(id).stop(force);
    Persistence.updateBotState(id, { wasRunning: false });
  }

  async restartBot(id) {
    const instance = this._getBotOrThrow(id);
    await instance.stop(true);
    await new Promise((r) => setTimeout(r, RESTART_PAUSE_MS));
    await instance.start();
    Persistence.updateBotState(id, { wasRunning: true });
  }

  async editBot(id, patch, editedBy) {
    const instance = this._getBotOrThrow(id);
    const allowed = buildEditPatch(instance.record, patch);

    Object.assign(instance.record, allowed);
    Persistence.saveBot(instance.record);

    logger.info(`[BotManager] Bot edited: ${id} by ${editedBy}`);
    this._auditLog('Bot edited', editedBy, { id, changes: Object.keys(allowed) });
  }

  async chatBot(id, message) {
    await this._getBotOrThrow(id).chat(message);
  }

  // ─── Queries ───
  getBot(id) {
    return this._bots.get(id) || null;
  }

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

  /** Resolve a bot by id, or fall back to the user's selection. */
  resolveBotForUser(botIdOrNull, userId) {
    if (botIdOrNull) return this.getBot(botIdOrNull);
    return this.getUserSelection(userId);
  }

  getStats() {
    return computeStats(this.getAllBots());
  }

  // ─── Internal ───
  _register(record) {
    const instance = new BotInstance(record);
    this._bots.set(record.id, instance);
    attachInstanceEvents(instance, this._notifier);
    return instance;
  }

  _getBotOrThrow(id) {
    const bot = this._bots.get(id);
    if (!bot) throw new Error(`Bot ${id} not found.`);
    return bot;
  }

  _auditLog(action, userId, meta = {}) {
    logger.info(`[AUDIT] ${action} by ${userId} | ${JSON.stringify(meta)}`);
    this._notifier.sendAudit(action, userId, meta).catch(() => {});
  }

  /** Graceful shutdown. */
  async shutdown() {
    logger.info('[BotManager] Shutting down all bots…');
    await Promise.all([...this._bots.values()].map((b) => b.stop(true).catch(() => {})));
    Persistence.flushSync();
    logger.info('[BotManager] Shutdown complete.');
  }
}

module.exports = new BotManager();
