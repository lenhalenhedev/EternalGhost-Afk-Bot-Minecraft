'use strict';
const EventEmitter = require('events');
const mineflayer   = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');

const { BOT_STATES, ALIVE_STATES, STARTABLE_STATES } = require('./states');
const AntiAFK   = require('./AntiAFK');
const Combat    = require('./Combat');
const Inventory = require('./Inventory');
const AutoEat   = require('./AutoEat');
const Queue     = require('../manager/Queue');
const { decrypt }   = require('../services/encryption');
const { botLog, checkAlertCooldown } = require('../services/logger');
const {
  sleep, getReconnectDelay, reconnectLimitReached,
  formatPos, randInt,
} = require('../utils/helpers');
const config = require('../config');

// AuthMe / Login Security prompts (broad multilingual coverage)
const AUTH_PROMPTS = [
  // Vietnamese (confirmed server language)
  /vui lòng đăng ký/i, /đăng ký vào máy chủ/i, /\/register/i,
  /vui lòng đăng nhập/i, /đăng nhập vào máy chủ/i, /\/login/i,
  /chưa đăng nhập/i, /chưa đăng ký/i, /bạn chưa/i,
  /cách dùng.*register/i, /cách dùng.*login/i,
  // English
  /you need to register/i, /please register/i,
  /you need to log ?in/i,  /please log ?in/i,
  /not logged in/i, /please authenticate/i, /you must (log ?in|authenticate)/i,
  /use \/login/i, /use \/register/i, /type \/login/i, /type \/register/i,
  /login to (play|continue|proceed)/i,
  /account (not found|does not exist|unregistered)/i,
  // Dutch
  /inloggen/i, /aanmelden/i, /registreer/i,
  // Russian / East EU
  /пожалуйста/i, /войдите/i, /зарегистрируйтесь/i, /авторизу/i,
  // German
  /anmeld/i, /einloggen/i, /registrier/i,
];

// Success signals from AuthMe / Login Security
const AUTH_SUCCESS = [
  // Vietnamese (confirmed server language – from messages.yml)
  /đăng ký thành công/i,          // "Đăng ký thành công!"
  /đăng nhập thành công/i,        // "Đăng nhập thành công!"
  /thành công/i,                  // broad Vietnamese success catch-all
  /đã đăng (ký|nhập)/i,
  /xác thực thành công/i,
  /chào mừng/i,                   // "Chào mừng trở lại"
  // English
  /you (are|have been) (now |successfully |)logged in/i,
  /successfully logged in/i, /login successful/i,
  /logged in successfully/i, /welcome back/i,
  /you are now authenticated/i, /authentication successful/i,
  /you (may|can) now play/i,
  /logged in!/i, /login accepted/i, /you are logged in/i,
  // Dutch
  /je bent (nu |succesvol |)ingelogd/i, /inloggen geslaagd/i, /welkom terug/i,
  // Russian
  /добро пожаловать/i, /вы (успешно |)авторизованы/i, /вы вошли/i,
  // German
  /erfolgreich (an|ein)gemeldet/i,
];

class BotInstance extends EventEmitter {
  /**
   * @param {object} record – persisted bot config record
   */
  constructor(record) {
    super();
    this.id       = record.id;
    this.record   = record; // reference – manager updates this
    this._state   = BOT_STATES.OFFLINE;

    // Mineflayer bot handle
    this._bot     = null;

    // Subsystems
    this._antiAFK   = null;
    this._combat    = null;
    this._inventory = null;
    this._autoEat   = null;

    // Async task queue
    this._queue = new Queue(this.id, config.limits.queueSize, config.limits.queueTimeout);

    // Reconnect tracking
    this._reconnectAttempts  = 0;
    this._reconnectHistory   = [];   // timestamps of recent reconnect initiations
    this._reconnectTimer     = null;

    // Login attempt tracking (per-connection)
    this._loginAttempts  = 0;
    this._loginTimer     = null;
    this._authRetryTimer = null;  // cleared on auth success to prevent phantom retries
    this._authInProgress = false; // concurrent guard – only one _handleAuth at a time

    // Stats
    this._startTime      = null;
    this._lastHealthTick = 0;

    // Duplicate-login delay (from server message)
    this._dupLoginDelay = false;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  get state()    { return this._state; }
  get bot()      { return this._bot; }
  get uptime()   { return this._startTime ? Date.now() - this._startTime : 0; }
  get position() { return this._bot?.entity?.position ?? null; }
  get health()   { return this._bot?.health ?? 0; }
  get food()     { return this._bot?.food ?? 0; }
  get ping()     { return this._bot?._client?.latency ?? 0; }

  /** Start the bot (enqueue so concurrent calls are safe). */
  async start() {
    if (!STARTABLE_STATES.has(this._state)) {
      throw new Error(`Cannot start bot in state ${this._state}`);
    }
    // Reset queue drain state from previous stop() call
    if (this._queue.draining) {
      this._queue.reset();
    }
    return this._queue.enqueue(() => this._connect());
  }

  /** Stop the bot. */
  async stop(force = false) {
    botLog(this.id, 'info', `Stop requested (force=${force})`);
    this._clearReconnectTimer();
    this._queue.drain();
    await this._destroyBot('manual stop');
    this._setState(BOT_STATES.OFFLINE);
    this.emit('stopped');
  }

  /** Send a chat message in-game. */
  async chat(message) {
    if (!this._bot) throw new Error('Bot is not connected');
    if (!ALIVE_STATES.has(this._state)) throw new Error(`Bot state is ${this._state}`);
    return this._queue.enqueue(async () => {
      this._bot.chat(message);
      await sleep(200);
    });
  }

  // ─── Connection flow ─────────────────────────────────────────────────────────

  async _connect() {
    this._setState(BOT_STATES.CONNECTING);
    botLog(this.id, 'info', `Connecting to ${this.record.host}:${this.record.port} as ${this.record.username}`);

    // Decrypt password
    let password = '';
    if (this.record.encryptedPassword) {
      try {
        const { plaintext } = decrypt(
          this.record.encryptedPassword,
          config.encryption.key,
          config.encryption.oldKey
        );
        password = plaintext;
      } catch (err) {
        botLog(this.id, 'error', `Failed to decrypt password: ${err.message}`);
        this._setState(BOT_STATES.ERROR);
        this.emit('alert', 'loginFailed', 'Password decryption error');
        return;
      }
    }
    this._plainPassword = password; // store temporarily during session

    // Create mineflayer bot
    let bot;
    try {
      bot = mineflayer.createBot({
        host:     this.record.host,
        port:     this.record.port,
        username: this.record.username,
        version:  this.record.version,
        auth:     'offline',
        hideErrors: false,
        checkTimeoutInterval: 30_000,
      });
    } catch (err) {
      botLog(this.id, 'error', `createBot failed: ${err.message}`);
      this._setState(BOT_STATES.ERROR);
      return;
    }

    this._bot = bot;
    this._loginAttempts  = 0;
    this._authInProgress = false;
    clearTimeout(this._authRetryTimer);
    this._authRetryTimer = null;
    this._attachBotEvents(bot, password);
  }

  _attachBotEvents(bot, password) {
    // ── Login ──────────────────────────────────────────────────────────────────
    bot.once('login', () => {
      botLog(this.id, 'info', 'TCP login established. Waiting for spawn…');
    });

    bot.once('spawn', () => {
      botLog(this.id, 'info', 'Spawned in world.');
      this._startTime = Date.now();

      // If server is an AuthMe server, we need to authenticate first
      // Wait a moment then check – if no auth prompt received, go straight to playing
      this._loginTimer = setTimeout(() => {
        // No auth prompt in 8s → assume no auth required
        if (this._state === BOT_STATES.CONNECTING) {
          this._transitionToPlaying();
        }
      }, 8_000);
    });

    // ── AuthMe Chat Handling ───────────────────────────────────────────────────
    bot.on('message', (jsonMsg) => {
      const msg = jsonMsg.toString().trim();
      if (!msg) return;

      // Log every server message during auth phases for debugging
      if (this._state === BOT_STATES.CONNECTING || this._state === BOT_STATES.AUTHENTICATING) {
        botLog(this.id, 'debug', `[Server msg] ${msg}`);
      }

      // Detect duplicate login "someone else is using this account"
      if (/already logged in|duplicate login|someone else/i.test(msg) && this._state === BOT_STATES.CONNECTING) {
        const delay = randInt(60_000, 120_000);
        botLog(this.id, 'warn', `Duplicate login detected. Waiting ${delay / 1000}s…`);
        this._dupLoginDelay = true;
        this._destroyBot('duplicate login').then(() => {
          this._setState(BOT_STATES.RECONNECTING);
          this._reconnectTimer = setTimeout(() => this._connect(), delay);
        });
        return;
      }

      // Auth prompts – only trigger when CONNECTING (not already AUTHENTICATING)
      if (AUTH_PROMPTS.some(r => r.test(msg)) && this._state === BOT_STATES.CONNECTING) {
        clearTimeout(this._loginTimer);
        this._setState(BOT_STATES.AUTHENTICATING);
        this._handleAuth(password, msg);
        return;
      }

      // Auth success detection
      if (this._state === BOT_STATES.AUTHENTICATING && AUTH_SUCCESS.some(r => r.test(msg))) {
        botLog(this.id, 'info', `AuthMe success detected via message: "${msg}"`);
        this._onAuthSuccess();
        return;
      }

      // Wrong password / banned – abort immediately instead of wasting retries
      if (this._state === BOT_STATES.AUTHENTICATING &&
          /wrong password|incorrect password|too many (attempts|tries)|banned|account (blocked|locked)/i.test(msg)) {
        botLog(this.id, 'error', `Auth hard-fail from server: "${msg}"`);
        this._loginAttempts = 99; // force abort on next _handleAuth tick
      }
    });

    // ── Fallback: health event after auth = server accepted us ────────────────
    // Many AuthMe servers don't send a text success – they just give you HP/food.
    // After sending /login, if health updates while AUTHENTICATING → treat as success.
    bot.on('health', () => {
      if (this._state === BOT_STATES.AUTHENTICATING && bot.health > 0 && this._loginAttempts > 0) {
        botLog(this.id, 'info', 'AuthMe success detected via health event (server gave HP without text confirmation).');
        this._onAuthSuccess();
      }
    });

    // ── Health monitoring ──────────────────────────────────────────────────────
    bot.on('health', () => {
      if (this._state !== BOT_STATES.PLAYING && this._state !== BOT_STATES.AFK && this._state !== BOT_STATES.COMBAT) return;
      this.emit('healthUpdate', { health: bot.health, food: bot.food });

      // Detect damage → trigger combat check
      if (this._lastHealthTick > 0 && bot.health < this._lastHealthTick - 0.5) {
        if (this._combat) this._combat.onAttacked();
      }
      this._lastHealthTick = bot.health;
    });

    // ── Death ──────────────────────────────────────────────────────────────────
    bot.on('death', () => {
      botLog(this.id, 'warn', `Bot died! HP=${bot.health}`);
      if (this._combat) this._combat.stop();
      if (this._antiAFK) this._antiAFK.stop();
      this._setState(BOT_STATES.PLAYING);
      if (checkAlertCooldown(`${this.id}:death`)) this.emit('alert', 'death', `Bot died at ${formatPos(bot.entity?.position)}`);
      // After respawn, re-enter AFK
      bot.once('spawn', () => this._transitionToAFK());
    });

    // ── Inventory ─────────────────────────────────────────────────────────────
    bot.on('playerCollect', (collector) => {
      if (collector?.username === bot.username && this._inventory) {
        this._inventory.checkAndClean().catch(() => {});
      }
    });

    // ── Error & Disconnect ─────────────────────────────────────────────────────
    bot.on('error', (err) => {
      botLog(this.id, 'error', `Bot error: ${err.message}`);
      this.emit('botError', err);
    });

    bot.on('kicked', (reason) => {
      const msg = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
      botLog(this.id, 'warn', `Kicked: ${msg}`);
      this._handleDisconnect(`Kicked: ${msg}`);
    });

    bot.on('end', (reason) => {
      if (this._state === BOT_STATES.OFFLINE) return; // manual stop, ignore
      botLog(this.id, 'warn', `Connection ended: ${reason}`);
      this._handleDisconnect(reason);
    });

    // ── Pathfinder ────────────────────────────────────────────────────────────
    try {
      bot.loadPlugin(pathfinder);
    } catch (err) {
      botLog(this.id, 'warn', `Pathfinder load failed: ${err.message}`);
    }
  }

  // ─── AuthMe flow ─────────────────────────────────────────────────────────────

  /** Called from both message handler and health fallback. */
  _onAuthSuccess() {
    if (this._state !== BOT_STATES.AUTHENTICATING) return; // already transitioned
    clearTimeout(this._authRetryTimer);           // Bug fix #2: kill pending retry
    this._authRetryTimer = null;
    this._authInProgress = false;
    this._loginAttempts  = 0;
    this._transitionToPlaying();
  }

  async _handleAuth(password, prompt) {
    // Bug fix #3: concurrent guard – only one auth loop at a time
    if (this._authInProgress) {
      botLog(this.id, 'debug', 'Auth already in progress – ignoring duplicate call.');
      return;
    }
    this._authInProgress = true;
    this._loginAttempts++;
    const maxAttempts = 5;

    if (this._loginAttempts > maxAttempts) {
      botLog(this.id, 'error', `Auth failed after ${maxAttempts} attempts.`);
      this._authInProgress = false;
      this._setState(BOT_STATES.ERROR);
      if (checkAlertCooldown(`${this.id}:loginFailed`)) {
        this.emit('alert', 'loginFailed', `Auth failed after ${maxAttempts} attempts`);
      }
      await this._destroyBot('auth failure');
      return;
    }

    const delay = randInt(3_000, 5_000);
    botLog(this.id, 'info', `Auth attempt ${this._loginAttempts}/${maxAttempts} – sending /login in ${delay}ms`);
    await sleep(delay);

    if (!this._bot || this._state !== BOT_STATES.AUTHENTICATING) {
      this._authInProgress = false;
      return; // disconnected or already succeeded while sleeping
    }

    try {
      // Always try /login first; /register only if server explicitly says unregistered
      if (/register/i.test(prompt) && this._loginAttempts === 1) {
        botLog(this.id, 'info', 'Server asked to register – sending /register');
        this._bot.chat(`/register ${password} ${password}`);
        // After registering, server will prompt /login → handled by next message event
      } else {
        this._bot.chat(`/login ${password}`);
      }
    } catch (err) {
      botLog(this.id, 'error', `Auth command failed: ${err.message}`);
    }

    this._authInProgress = false; // release lock so next retry can run

    // Bug fix #2: store timer reference so we can clearTimeout on success
    this._authRetryTimer = setTimeout(() => {
      this._authRetryTimer = null;
      if (this._state === BOT_STATES.AUTHENTICATING) {
        botLog(this.id, 'warn', `Auth no response after 10s – retry ${this._loginAttempts + 1}/${maxAttempts}`);
        this._handleAuth(password, '/login');
      }
    }, 10_000);
  }

  // ─── State transitions ───────────────────────────────────────────────────────

  _transitionToPlaying() {
    clearTimeout(this._loginTimer);
    this._setState(BOT_STATES.PLAYING);
    botLog(this.id, 'info', 'Bot is in PLAYING state. Settling 3s before AFK mode…');

    // Load subsystems
    this._inventory = new Inventory(this._bot, this.id, (ev, ...args) => this.emit(ev, ...args));
    this._autoEat   = new AutoEat(this._bot, this.id, (ev, ...args) => this.emit(ev, ...args));
    this._autoEat.start();

    // Settle then switch to AFK
    setTimeout(() => this._transitionToAFK(), 3_000);
  }

  _transitionToAFK() {
    if (this._state === BOT_STATES.OFFLINE || this._state === BOT_STATES.DISCONNECTED) return;
    this._setState(BOT_STATES.AFK);

    // Start anti-AFK
    this._antiAFK = new AntiAFK(this._bot, this.id);
    this._antiAFK.start();

    // Start combat scanner
    this._combat = new Combat(this._bot, this.id, (ev, ...args) => {
      if (ev === 'combatStart') {
        this._setState(BOT_STATES.COMBAT);
        if (this._antiAFK) this._antiAFK.pauseForCombat();
        if (this._autoEat) this._autoEat.setCombat(true);
        this.emit('combatStart', ...args);
      } else if (ev === 'combatEnd') {
        this._setState(BOT_STATES.AFK);
        if (this._antiAFK) this._antiAFK.resumeAfterCombat();
        if (this._autoEat) this._autoEat.setCombat(false);
        this.emit('combatEnd', ...args);
      } else {
        this.emit(ev, ...args);
      }
    });
    this._combat.startScanning();

    botLog(this.id, 'info', 'Bot entered AFK mode.');
    this.emit('afkStarted');
  }

  // ─── Disconnect / Reconnect ──────────────────────────────────────────────────

  async _handleDisconnect(reason) {
    this._stopSubsystems();
    this._setState(BOT_STATES.DISCONNECTED);

    if (checkAlertCooldown(`${this.id}:disconnect`)) {
      this.emit('alert', 'disconnect', `Disconnected: ${reason}`);
    }

    if (!this.record.autoReconnect) {
      botLog(this.id, 'info', 'autoReconnect disabled – staying DISCONNECTED.');
      return;
    }

    if (reconnectLimitReached(this._reconnectHistory, 5, 600_000)) {
      botLog(this.id, 'error', 'Reconnect limit (5/10min) reached. Giving up.');
      this._setState(BOT_STATES.ERROR);
      if (checkAlertCooldown(`${this.id}:reconnectFailed`)) {
        this.emit('alert', 'reconnectFailed', 'Reconnect limit reached');
      }
      return;
    }

    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    const delay = getReconnectDelay(this._reconnectAttempts);
    this._reconnectAttempts++;
    this._reconnectHistory.push(Date.now());

    botLog(this.id, 'info', `Reconnecting in ${delay / 1000}s (attempt ${this._reconnectAttempts}/5)…`);
    this._setState(BOT_STATES.RECONNECTING);
    this.emit('reconnecting', this._reconnectAttempts, delay);

    this._reconnectTimer = setTimeout(async () => {
      if (this._state !== BOT_STATES.RECONNECTING) return;
      await this._connect();
    }, delay);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    clearTimeout(this._loginTimer);
    this._loginTimer = null;
    // Also clear auth retry timer to prevent phantom retries after stop
    if (this._authRetryTimer) {
      clearTimeout(this._authRetryTimer);
      this._authRetryTimer = null;
    }
    this._authInProgress = false;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _setState(newState) {
    const old = this._state;
    this._state = newState;
    botLog(this.id, 'info', `State: ${old} → ${newState}`);
    this.emit('stateChange', old, newState);
  }

  _stopSubsystems() {
    if (this._antiAFK) { this._antiAFK.stop(); this._antiAFK = null; }
    if (this._combat)  { this._combat.stop();  this._combat  = null; }
    if (this._autoEat) { this._autoEat.stop();  this._autoEat = null; }
    this._inventory = null;
  }

  async _destroyBot(reason) {
    this._stopSubsystems();
    this._clearReconnectTimer();
    if (this._bot) {
      try {
        this._bot.removeAllListeners();
        this._bot.quit(reason);
      } catch (_) { /* ignore */ }
      this._bot = null;
    }
  }

  /** Full teardown (called by manager on delete). */
  async destroy() {
    await this.stop(true);
    this._queue.drain();
    this.removeAllListeners();
  }

  toJSON() {
    return {
      id:                 this.id,
      host:               this.record.host,
      port:               this.record.port,
      username:           this.record.username,
      version:            this.record.version,
      state:              this._state,
      uptime:             this.uptime,
      health:             this.health,
      food:               this.food,
      ping:               this.ping,
      position:           this.position,
      reconnectAttempts:  this._reconnectAttempts,
      autoReconnect:      this.record.autoReconnect,
    };
  }
}

module.exports = BotInstance;
