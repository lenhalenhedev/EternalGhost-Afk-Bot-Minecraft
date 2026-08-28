'use strict';
const cron = require('node-cron');
const BotInstance = require('../bot/BotInstance');
const Persistence = require('./Persistence');
const DiscordNotifier = require('./DiscordNotifier');
const { buildNewRecord, buildEditPatch } = require('./botRecordFactory');
const { attachInstanceEvents } = require('./instanceEvents');
const { computeStats } = require('./managerStats');
const { logger, flushSummary, clearBotState } = require('../services/logger');
const { publish } = require('../web/sse/eventHub');
const config = require('../config');
const {
  consumeChat,
  consumeBotCreation,
} = require('../services/accountRateLimits');

const RESTART_PAUSE_MS = 1_500;
const SUMMARY_INTERVAL_MIN = 15;
const SUMMARY_INTERVAL_BOUNDS = { min: 10, max: 30 };
const CANONICAL_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_PREFIX = /^[0-9a-f]+(?:-[0-9a-f]+)*$/i;

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

function ambiguousBotError() {
  return new BotAccessError(
    'AMBIGUOUS_BOT_ID',
    'Multiple owned bots match this ID prefix. Enter more characters.'
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
    const creationLimit = consumeBotCreation(principal.userId);
    if (!creationLimit.allowed) {
      const error = new Error('Too many bot creation requests.');
      error.code = 'RATE_LIMITED';
      error.retryAfterMs = creationLimit.retryAfterMs;
      throw error;
    }
    const ownedBotCount = [...this._bots.values()].filter(
      (instance) => instance.record.createdBy === principal.userId
    ).length;
    if (ownedBotCount >= config.limits.maxBotsPerUser) {
      const error = new Error(
        `Maximum bot limit per user (${config.limits.maxBotsPerUser}) reached.`
      );
      error.code = 'BOT_USER_QUOTA_REACHED';
      throw error;
    }
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
    const instance = this._register(record);
    publish('bot:created', {
      botId: instance.id,
      ownerId: record.createdBy,
      snapshot: instance.toJSON(),
    });
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
    if (instance.state !== 'OFFLINE') {
      throw new BotAccessError(
        'BOT_MUST_BE_STOPPED',
        'Bot must be stopped before it can be deleted.'
      );
    }
    await Persistence.deleteBotWithActivity(
      instance.id,
      'deleted',
      principal.userId
    );
    publish('bot:deleted', {
      botId: instance.id,
      ownerId: instance.record.createdBy,
    });
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
    const duplicate = Persistence.findBot(
      allowed.host ?? instance.record.host,
      allowed.port ?? instance.record.port,
      allowed.username ?? instance.record.username
    );
    if (duplicate && duplicate.id !== instance.id) {
      throw new Error(
        `A bot for ${allowed.username ?? instance.record.username}@${allowed.host ?? instance.record.host}:${allowed.port ?? instance.record.port} already exists.`
      );
    }
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
    publish('bot:updated', {
      botId: instance.id,
      ownerId: instance.record.createdBy,
      snapshot: instance.toJSON(),
    });
    logger.info(
      `[BotManager] Bot edited: ${instance.id} by ${principal.userId}`
    );
    this._auditLog('Bot edited', principal.userId, {
      id: instance.id,
      changes: Object.keys(allowed),
    });
  }

  async chatBot(principal, id, message) {
    const chatLimit = consumeChat(principal.userId);
    if (!chatLimit.allowed) {
      const error = new Error('Chat cooldown active.');
      error.code = 'RATE_LIMITED';
      error.retryAfterMs = chatLimit.retryAfterMs;
      throw error;
    }
    await this.resolveAuthorizedBot(principal, id).sendInput(message);
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
    if (!record || record.createdBy !== principal.userId) return false;
    return (
      !record.createdInGuild ||
      principal.guildId === null ||
      principal.guildId === undefined ||
      record.createdInGuild === principal.guildId
    );
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

  listAllInstances() {
    return [...this._bots.values()];
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

  resolveAuthorizedBotPrefix(principal, requestedId) {
    assertPrincipal(principal);
    const prefix = String(requestedId ?? '')
      .trim()
      .toLowerCase();
    if (prefix.length < 8 || prefix.length > 36 || !UUID_PREFIX.test(prefix)) {
      throw new BotAccessError(
        'INVALID_BOT_ID',
        'Enter at least 8 hexadecimal characters from the bot ID.'
      );
    }

    const matches = this.listAuthorizedBots(principal).filter((bot) =>
      bot.id.toLowerCase().startsWith(prefix)
    );
    if (matches.length > 1) throw ambiguousBotError();
    if (matches.length === 0) throw inaccessibleBotError();
    return matches[0];
  }

  async setUserSelection(principal, botId) {
    const instance = this.resolveAuthorizedBotPrefix(principal, botId);
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
