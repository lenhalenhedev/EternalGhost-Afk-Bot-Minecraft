'use strict';
const EventEmitter = require('events');
const { BOT_STATES, ALIVE_STATES, STARTABLE_STATES } = require('./states');
const Subsystems = require('./subsystems');
const Queue = require('../manager/Queue');
const { AuthFlow } = require('./auth/authFlow');
const ReconnectPolicy = require('./connection/reconnectPolicy');
const { bindBotEvents } = require('./connection/botEventBinder');
const { decryptPassword, createMineflayerBot } = require('./connection/connector');
const { toSnapshot } = require('./botSnapshot');
const { transitionToPlaying, transitionToAFK } = require('./phaseController');
const { logger, botLog } = require('../services/logger');
const { sleep } = require('../utils/helpers');
const config = require('../config');

const CHAT_THROTTLE_MS = 200;

/**
 * Orchestrates a single Minecraft bot's lifecycle: owns the state machine and
 * delegates everything else.
 *
 * MEMORY LEAK FIXES:
 * - Explicit maxListeners to prevent EventEmitter warnings
 * - Nullification of all references in _destroyBot
 * - WeakRef pattern not needed here since bot lifecycle is well-defined
 * - Proper cleanup of _respawnHandler to prevent listener stacking
 */
class BotInstance extends EventEmitter {
  constructor(record) {
    super();
    // FIX: Set explicit max listeners to prevent warnings and detect leaks early.
    // Each BotInstance can have: stateChange, alert, botError, noFood,
    // inventoryFull, healthUpdate, afkStarted, combatStart, combatEnd,
    // reconnecting, stopped = ~11 event types with 1-2 listeners each.
    this.setMaxListeners(20);

    this.id = record.id;
    this.record = record;
    this._state = BOT_STATES.OFFLINE;
    this._bot = null;
    this._password = '';
    this._sub = new Subsystems(this.id);
    this._queue = new Queue(this.id, config.limits.queueSize, config.limits.queueTimeout, logger);
    this._auth = new AuthFlow(this);
    this._reconnect = new ReconnectPolicy(this);
    this._loginTimer = null;
    this._settleTimer = null;
    this._startTime = null;
    this._lastHealthTick = 0;
    this._respawnHandler = null;
    this._destroyed = false; // FIX: Guard against use-after-destroy
  }

  // ─── Public read API ───
  get state() { return this._state; }
  get bot() { return this._bot; }
  get password() { return this._password; }
  get reconnectAttempts() { return this._reconnect.currentAttempts; }
  get uptime() { return this._startTime ? Date.now() - this._startTime : 0; }
  get position() { return this._bot?.entity?.position ?? null; }
  get health() { return this._bot?.health ?? 0; }
  get food() { return this._bot?.food ?? 0; }
  get ping() { return this._bot?._client?.latency ?? 0; }

  // ─── Public commands ───
  async start() {
    if (this._destroyed) throw new Error('BotInstance has been destroyed');
    if (!STARTABLE_STATES.has(this._state)) {
      throw new Error(`Cannot start bot in state ${this._state}`);
    }
    if (this._queue.draining) this._queue.reset();
    return this._queue.enqueue(() => this._connect());
  }

  async stop(force = false) {
    botLog(this.id, 'info', `Stop requested (force=${force}).`);
    this._clearTimers();
    this._queue.drain();
    await this._destroyBot('manual stop');
    this._setState(BOT_STATES.OFFLINE);
    this.emit('stopped');
  }

  async chat(message) {
    if (!this._bot) throw new Error('Bot is not connected');
    if (!ALIVE_STATES.has(this._state)) throw new Error(`Bot is in state ${this._state}`);
    return this._queue.enqueue(async () => {
      this._bot.chat(message);
      await sleep(CHAT_THROTTLE_MS);
    });
  }

  // ─── Connection flow ───
  async _connect() {
    // FIX: Guard against connecting a destroyed instance
    if (this._destroyed) return;

    // Drop any previous mineflayer listeners before creating a new client to
    // prevent listener accumulation across reconnects (memory leak fix).
    if (this._bot) {
      try {
        this._bot.removeAllListeners();
        this._bot.end();
      } catch (_) {
        /* ignore */
      }
      this._bot = null;
    }

    // Stale damage detection across connections would otherwise mis-fire combat.
    this._lastHealthTick = 0;
    this._respawnHandler = null;
    this._setState(BOT_STATES.CONNECTING);
    botLog(this.id, 'info', `Connecting to ${this.record.host}:${this.record.port} as ${this.record.username}`);
    if (!this._decryptPassword()) return;

    let bot;
    try {
      bot = createMineflayerBot(this.record);
    } catch (err) {
      botLog(this.id, 'error', `createBot failed: ${err.message}`);
      this._setState(BOT_STATES.ERROR);
      return;
    }
    this._bot = bot;
    this._auth.reset();
    bindBotEvents(this, bot);
  }

  _decryptPassword() {
    try {
      this._password = decryptPassword(this.record);
      return true;
    } catch (err) {
      botLog(this.id, 'error', `Failed to decrypt password: ${err.message}`);
      this._setState(BOT_STATES.ERROR);
      this.emit('alert', 'loginFailed', 'Password decryption error');
      return false;
    }
  }

  // ─── State transitions ───
  _transitionToPlaying() { transitionToPlaying(this); }
  _transitionToAFK() { transitionToAFK(this); }

  // ─── Internal helpers ───
  _setState(newState) {
    const old = this._state;
    if (old === newState) return;
    this._state = newState;
    botLog(this.id, 'info', `State: ${old} \u2192 ${newState}`);
    this.emit('stateChange', old, newState);
  }

  _clearTimers() {
    this._reconnect.clearTimer();
    clearTimeout(this._loginTimer);
    this._loginTimer = null;
    clearTimeout(this._settleTimer);
    this._settleTimer = null;
    this._auth.reset();
  }

  async _destroyBot(reason) {
    this._sub.stopAll();
    this._clearTimers();
    if (this._bot) {
      try {
        this._bot.pathfinder?.setGoal(null);
      } catch (_) {
        /* ignore */
      }
      try {
        this._bot.removeAllListeners();
        this._bot.quit(reason);
      } catch (_) {
        /* ignore */
      }
      this._bot = null;
    }
    this._lastHealthTick = 0;
    this._respawnHandler = null;
    // FIX: Clear decrypted password from memory after disconnect
    this._password = '';
  }

  /** Full teardown for permanent removal. */
  async destroy() {
    this._destroyed = true;
    await this.stop(true);
    this._queue.drain();
    this.removeAllListeners();
    // FIX: Null out references to allow GC of the entire object graph
    this._sub = null;
    this._queue = null;
    this._auth = null;
    this._reconnect = null;
  }

  toJSON() {
    return toSnapshot(this);
  }
}

module.exports = BotInstance;
