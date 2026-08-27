'use strict';
const EventEmitter = require('events');
const { BOT_STATES, ALIVE_STATES, STARTABLE_STATES } = require('./states');
const Subsystems = require('./subsystems');
const Queue = require('../manager/Queue');
const { AuthFlow } = require('./auth/authFlow');
const ReconnectPolicy = require('./connection/reconnectPolicy');
const { bindBotEvents } = require('./connection/botEventBinder');
const {
  decryptPassword,
  createMineflayerBot,
} = require('./connection/connector');
const { toSnapshot } = require('./botSnapshot');
const { transitionToPlaying, transitionToAFK } = require('./phaseController');
const { logger, botLog } = require('../services/logger');
const { sleep } = require('../utils/helpers');
const { parseChatInput } = require('../utils/chatInput');
const config = require('../config');

const CHAT_THROTTLE_MS = 200;
const MAX_EVENT_LISTENERS = 20;

/**
 * Orchestrates a single Minecraft bot's lifecycle: owns the state machine and
 * delegates everything else. Every connection allocates timers, listeners, an
 * AbortController, and gameplay subsystems; teardown paths clear, remove, and
 * null all of them so nothing survives a disconnect, reconnect, or destroy.
 */
class BotInstance extends EventEmitter {
  constructor(record) {
    super();
    this.setMaxListeners(MAX_EVENT_LISTENERS);

    this.id = record.id;
    this.record = record;
    this._state = BOT_STATES.OFFLINE;
    this._bot = null;
    this._password = '';
    this._sub = new Subsystems(this.id);
    this._queue = new Queue(
      this.id,
      config.limits.queueSize,
      config.limits.queueTimeout,
      logger
    );
    this._auth = new AuthFlow(this);
    this._reconnect = new ReconnectPolicy(this);
    this._loginTimer = null;
    this._settleTimer = null;
    this._startTime = null;
    this._lastHealthTick = 0;
    this._respawnHandler = null;
    this._abort = null;
    this._connectGeneration = 0;
    this._destroyed = false;
  }

  get state() {
    return this._state;
  }
  get bot() {
    return this._bot;
  }
  get password() {
    return this._password;
  }
  get abortSignal() {
    return this._abort ? this._abort.signal : null;
  }
  get reconnectAttempts() {
    return this._reconnect.currentAttempts;
  }
  get uptime() {
    return this._startTime ? Date.now() - this._startTime : 0;
  }
  get position() {
    return this._bot?.entity?.position ?? null;
  }
  get health() {
    return this._bot?.health ?? 0;
  }
  get food() {
    return this._bot?.food ?? 0;
  }
  get ping() {
    return this._bot?._client?.latency ?? 0;
  }

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

  async sendInput(message) {
    if (!this._bot) throw new Error('Bot is not connected');
    if (!ALIVE_STATES.has(this._state))
      throw new Error(`Bot is in state ${this._state}`);

    const parsed = parseChatInput(message);
    return this._queue.enqueue(async () => {
      // Mineflayer documents bot.chat(), not bot.command(). Keep the slash in
      // the original message so the Minecraft server receives the command.
      this._bot.chat(parsed.text);
      await sleep(CHAT_THROTTLE_MS);
    }, this.abortSignal);
  }

  async chat(message) {
    return this.sendInput(message);
  }

  async _connect() {
    if (this._destroyed) return;

    const generation = ++this._connectGeneration;
    this._teardownConnection();

    this._lastHealthTick = 0;
    this._respawnHandler = null;
    this._abort = new AbortController();
    const abortController = this._abort;
    const isCurrentConnection = () =>
      !this._destroyed &&
      this._connectGeneration === generation &&
      this._abort === abortController &&
      !abortController.signal.aborted;
    this._setState(BOT_STATES.CONNECTING);
    botLog(
      this.id,
      'info',
      `Connecting to ${this.record.host}:${this.record.port} as ${this.record.username}`
    );
    if (!this._decryptPassword()) return;

    let bot;
    try {
      bot = await createMineflayerBot(this.record);
    } catch (err) {
      if (!isCurrentConnection()) return;
      botLog(this.id, 'error', `createBot failed: ${err.message}`);
      this._setState(BOT_STATES.ERROR);
      return;
    }

    if (!isCurrentConnection()) {
      try {
        bot.end();
      } catch {
        /* ignore stale connection teardown errors */
      }
      return;
    }

    this._bot = bot;
    this._auth.reset();

    try {
      bindBotEvents(this, bot);
    } catch (err) {
      botLog(this.id, 'error', `Event binding failed: ${err.message}`);
      await this._destroyBot('event binding failure');
      this._setState(BOT_STATES.ERROR);
    }
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

  _transitionToPlaying() {
    transitionToPlaying(this);
  }
  _transitionToAFK() {
    transitionToAFK(this);
  }

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

  _abortInFlight() {
    if (this._abort) {
      try {
        this._abort.abort();
      } catch {
        /* ignore */
      }
      this._abort = null;
    }
  }

  _teardownConnection() {
    if (this._bot) {
      try {
        this._bot.pathfinder?.setGoal(null);
      } catch {
        /* ignore */
      }
      if (this._respawnHandler) {
        try {
          this._bot.removeListener('spawn', this._respawnHandler);
        } catch {
          /* ignore */
        }
      }
      try {
        this._bot.removeAllListeners();
        this._bot.end();
      } catch {
        /* ignore */
      }
      this._bot = null;
    }
    this._respawnHandler = null;
  }

  async _destroyBot(reason) {
    this._sub.stopAll();
    this._clearTimers();
    this._abortInFlight();
    if (this._bot) {
      try {
        this._bot.quit(reason);
      } catch {
        /* ignore */
      }
    }
    this._teardownConnection();
    this._lastHealthTick = 0;
    this._password = '';
  }

  async destroy() {
    this._destroyed = true;
    await this.stop(true);
    this._queue.drain();
    this.removeAllListeners();
    this._sub = null;
    this._queue = null;
    this._auth = null;
    this._reconnect = null;
    this._abort = null;
  }

  toJSON() {
    return toSnapshot(this);
  }
}

module.exports = BotInstance;
