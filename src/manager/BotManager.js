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

/**
 * MEMORY LEAK FIXES:
 * - _cronTask is tracked and stopped on shutdown to prevent orphaned cron jobs
 * - Bot deletion properly clears all associated state (log buffers, cooldowns)
 * - setDiscordClient guards against being called multiple times (cron duplication)
 * - shutdown() properly awaits all cleanup operations
 */
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
    // FIX: Track the cron task so it can be stopped on shutdown
    this._cronTask = null;
  }

  // ─── Bootstrap ───
  setDiscordClient(client) {
    this._discordClient = client;

    // FIX: Prevent duplicate cron job registration if setDiscordClient is called
    // multiple times (e.g., during reconnection or hot-reload scenarios).
    if (this._cronTask) {
      this._cronTask.stop();
      this._cronTask = null;
    }

    const interval = Math.max(
      SUMMARY_INTERVAL_BOUNDS.min,
      Math.min(SUMMARY_INTERVAL_BOUNDS.max, config.limits.logSummaryIntervalMin || SUMMARY_INTERVAL_MIN),
    );
    this._cronTask = cron.schedule(`*/${interval} * * * *`, () => {
      this._notifier.sendLogSummary(flushSummary()).catch(() => {});
    });
    logger.info(`[BotManager] Log summary scheduled every ${interval} minutes.`);
  }

  /** Load persisted bots and restart those that were running. */
  async initialize() {
    await Persistence.load();
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
    Persistence.logActivity(record.id, 'created', createdBy, {
      username: record.username, host: record.host, port: record.port, version: record.version,
    });
    this._register(record);
    logger.info(`[BotManager] Bot created: ${record.id} (${record.username}@${record.host}:${record.port})`);
    this._auditLog('Bot created', createdBy, {
      id: record.id, username: record.username, host: record.host, port: record.port, version: record.version,
    });
    return { id: record.id, record };
  }

  async deleteBot(id, deletedBy) {
    const instance = this._getBotOrThrow(id);
    await instance.destroy();
    this._bots.delete(id);
    Persistence.logActivity(id, 'deleted', deletedBy, {});
    Persistence.deleteBot(id);
    // FIX: Clear all per-bot in-memory state to prevent leaks after deletion.
    // This releases the log ring buffer, alert cooldown entries, and any other
    // per-bot state that would otherwise persist forever in memory.
    clearBotState(id);
    logger.info(`[BotManager] Bot deleted: ${id} by ${deletedBy}`);
    this._auditLog('Bot deleted', deletedBy, { id });
  }

  async startBot(id) {
    await this._getBotOrThrow(id).start();
    Persistence.updateBotState(id, { wasRunning: true });
    Persistence.logActivity(id, 'started', null, {});
  }

  async stopBot(id, force = false) {
    await this._getBotOrThrow(id).stop(force);
    Persistence.updateBotState(id, { wasRunning: false });
    Persistence.logActivity(id, 'stopped', null, { force });
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
    Persistence.logActivity(id, 'edited', editedBy, { changes: Object.keys(allowed) });
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

    // FIX: Stop the cron job to prevent it from firing during/after shutdown
    if (this._cronTask) {
      this._cronTask.stop();
      this._cronTask = null;
    }

    await Promise.all([...this._bots.values()].map((b) => b.stop(true).catch(() => {})));
    await Persistence.flush();
    logger.info('[BotManager] Shutdown complete.');
  }
}

module.exports = new BotManager();
