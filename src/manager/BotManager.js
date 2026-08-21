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
const CANONICAL_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class BotAccessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BotAccessError';
    this.code = code;
  }
}

function assertPrincipal(principal) {
  const validUserId =
    typeof principal?.userId === 'string' && principal.userId.trim() !== '';
  const validGuildId =
    principal?.guildId === null ||
    principal?.guildId === undefined ||
    (typeof principal?.guildId === 'string' && principal.guildId.trim() !== '');

  if (!validUserId || !validGuildId || !Array.isArray(principal?.roles)) {
    throw new BotAccessError(
      'INVALID_PRINCIPAL',
      'Invalid authenticated principal.'
    );
  }
}

function inaccessibleBotError() {
  return new BotAccessError(
    'RESOURCE_ACCESS_DENIED',
    'Bot not found or access denied.'
  );
}

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
      Math.min(
        SUMMARY_INTERVAL_BOUNDS.max,
        config.limits.logSummaryIntervalMin || SUMMARY_INTERVAL_MIN
      )
    );
    this._cronTask = cron.schedule(`*/${interval} * * * *`, () => {
      this._notifier.sendLogSummary(flushSummary()).catch(() => {});
    });
    logger.info(
      `[BotManager] Log summary scheduled every ${interval} minutes.`
    );
  }

  /** Load persisted bots and restart those that were running. */
  async initialize() {
    await Persistence.load();
    if (config.encryption.oldKey) {
      const rotated = Persistence.rotateKeys();
      if (rotated > 0)
        logger.info(
          `[BotManager] Key rotation: re-encrypted ${rotated} password(s).`
        );
    }
    const records = Persistence.getAllBots();
    logger.info(`[BotManager] Loaded ${records.length} bot record(s).`);
    for (const record of records) {
      const instance = this._register(record);
      if (record.wasRunning) {
        logger.info(
          `[BotManager] Auto-starting bot ${record.id} (wasRunning=true)`
        );
        instance
          .start()
          .catch((err) =>
            logger.error(
              `[BotManager] Auto-start failed for ${record.id}: ${err.message}`
            )
          );
      }
    }
  }

  // ─── Bot lifecycle ───
  async createBot(opts, principal) {
    assertPrincipal(principal);
    const record = buildNewRecord(
      opts,
      principal.userId,
      principal.guildId || null
    );
    if (Persistence.findBot(record.host, record.port, record.username)) {
      throw new Error(
        `A bot for ${record.username}@${record.host}:${record.port} already exists.`
      );
    }
    if (this._bots.size >= config.limits.maxBots) {
      throw new Error(`Maximum bot limit (${config.limits.maxBots}) reached.`);
    }
    await Persistence.saveBotWithActivity(record, 'created', principal.userId, {
      username: record.username,
      host: record.host,
      port: record.port,
      version: record.version,
    });
    this._register(record);
    logger.info(
      `[BotManager] Bot created: ${record.id} (${record.username}@${record.host}:${record.port})`
    );
    this._auditLog('Bot created', principal.userId, {
      id: record.id,
      username: record.username,
      host: record.host,
      port: record.port,
      version: record.version,
    });
    return { id: record.id, record };
  }

  async deleteBot(principal, id) {
    const instance = this.resolveAuthorizedBot(principal, id);
    await Persistence.deleteBotWithActivity(
      instance.id,
      'deleted',
      principal.userId
    );
    await instance.destroy();
    this._bots.delete(instance.id);
    // Clear all per-bot in-memory state after the record is no longer active.
    clearBotState(instance.id);
    logger.info(
      `[BotManager] Bot deleted: ${instance.id} by ${principal.userId}`
    );
    this._auditLog('Bot deleted', principal.userId, { id: instance.id });
  }

  async startBot(principal, id) {
    const instance = this.resolveAuthorizedBot(principal, id);
    await instance.start();
    await this._recordLifecycleState(
      instance,
      { wasRunning: true },
      'started',
      principal.userId,
      () => instance.stop(true)
    );
  }

  async stopBot(principal, id, force = false) {
    const instance = this.resolveAuthorizedBot(principal, id);
    await instance.stop(force);
    await this._recordLifecycleState(
      instance,
      { wasRunning: false },
      'stopped',
      principal.userId,
      () => instance.start(),
      { force }
    );
  }

  async restartBot(principal, id) {
    const instance = this.resolveAuthorizedBot(principal, id);
    await instance.stop(true);
    await new Promise((r) => setTimeout(r, RESTART_PAUSE_MS));
    await instance.start();
    await this._recordLifecycleState(
      instance,
      { wasRunning: true },
      'restarted',
      principal.userId
    );
  }

  async editBot(principal, id, patch) {
    const instance = this.resolveAuthorizedBot(principal, id);
    const allowed = buildEditPatch(instance.record, patch);
    const updatedRecord = { ...instance.record, ...allowed };
    await Persistence.saveBotWithActivity(
      updatedRecord,
      'edited',
      principal.userId,
      {
        changes: Object.keys(allowed),
      }
    );
    Object.assign(instance.record, allowed);
    logger.info(
      `[BotManager] Bot edited: ${instance.id} by ${principal.userId}`
    );
    this._auditLog('Bot edited', principal.userId, {
      id: instance.id,
      changes: Object.keys(allowed),
    });
  }

  async chatBot(principal, id, message) {
    await this.resolveAuthorizedBot(principal, id).chat(message);
  }

  // ─── Queries ───
  /**
   * Resolve a command-visible bot only after principal and exact target checks.
   * A missing, stale, foreign, or otherwise inaccessible target has one generic
   * response so callers cannot use this boundary as a resource-existence oracle.
   */
  resolveAuthorizedBot(
    principal,
    requestedId,
    { allowSelection = false } = {}
  ) {
    assertPrincipal(principal);

    let botId = requestedId;
    if (botId === null || botId === undefined || String(botId).trim() === '') {
      if (!allowSelection) throw inaccessibleBotError();
      botId = Persistence.getUserSelection(principal.userId);
    }

    if (typeof botId !== 'string' || !CANONICAL_UUID_V4.test(botId)) {
      if (
        requestedId === null ||
        requestedId === undefined ||
        String(requestedId).trim() === ''
      ) {
        throw inaccessibleBotError();
      }
      throw new BotAccessError(
        'INVALID_BOT_ID',
        'A full canonical bot ID is required.'
      );
    }

    const bot = this._bots.get(botId);
    if (!bot || !this._principalOwnsRecord(principal, bot.record)) {
      throw inaccessibleBotError();
    }
    return bot;
  }

  _principalOwnsRecord(principal, record) {
    if (!record) return false;
    if (principal.roles?.includes('web-admin')) return true;
    if (record.createdBy !== principal.userId) return false;
    return (
      !record.createdInGuild || record.createdInGuild === principal.guildId
    );
  }

  getPublicSnapshots() {
    return [...this._bots.values()]
      .filter((bot) => !bot.record.hidden)
      .map((bot) => bot.toJSON());
  }

  async _recordLifecycleState(
    instance,
    patch,
    action,
    actor,
    compensate,
    meta = {}
  ) {
    try {
      await Persistence.updateBotStateWithActivity(
        instance.id,
        patch,
        action,
        actor,
        meta
      );
    } catch (error) {
      if (compensate) {
        await compensate().catch(() => {
          logger.error(
            `[BotManager] Lifecycle compensation failed for ${instance.id}.`
          );
        });
      }
      throw error;
    }
  }

  listAuthorizedBots(principal) {
    assertPrincipal(principal);
    return [...this._bots.values()].filter((bot) =>
      this._principalOwnsRecord(principal, bot.record)
    );
  }

  getUserSelection(principal) {
    try {
      return this.resolveAuthorizedBot(principal, null, {
        allowSelection: true,
      });
    } catch (err) {
      if (err?.code === 'RESOURCE_ACCESS_DENIED') return null;
      throw err;
    }
  }

  async setUserSelection(principal, botId) {
    const instance = this.resolveAuthorizedBot(principal, botId);
    await Persistence.setUserSelection(principal.userId, instance.id);
    return instance;
  }

  getStats(principal) {
    return computeStats(this.listAuthorizedBots(principal));
  }

  // ─── Internal ───
  _register(record) {
    const instance = new BotInstance(record);
    this._bots.set(record.id, instance);
    attachInstanceEvents(instance, this._notifier);
    return instance;
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

    await Promise.all(
      [...this._bots.values()].map((b) => b.stop(true).catch(() => {}))
    );
    await Persistence.flush();
    logger.info('[BotManager] Shutdown complete.');
  }
}

module.exports = new BotManager();
