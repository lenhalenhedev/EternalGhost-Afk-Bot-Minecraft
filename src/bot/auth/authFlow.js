'use strict';

const { BOT_STATES } = require('../states');
const { botLog, checkAlertCooldown } = require('../../services/logger');
const { sleep, randInt } = require('../../utils/helpers');

const MAX_LOGIN_ATTEMPTS = 5;
const AUTH_SEND_MIN_MS = 3_000;
const AUTH_SEND_MAX_MS = 5_000;
const AUTH_RETRY_MS = 10_000;

/**
 * Drives the AuthMe /register + /login handshake for one BotInstance.
 *
 * Re-entrancy is guarded so overlapping server prompts cannot fire multiple
 * concurrent attempts, and the flow reschedules itself until the server
 * confirms success or the attempt budget is exhausted.
 */
class AuthFlow {
  /** @param {import('../BotInstance')} instance */
  constructor(instance) {
    this._i = instance;
    this._attempts = 0;
    this._inProgress = false;
    this._retryTimer = null;
    this._loginSent = false;
  }

  /** True once a /login or /register command has actually been transmitted. */
  get loginSent() {
    return this._loginSent;
  }

  /** Reset per-connection auth state (called at the start of every connect). */
  reset() {
    this.clearTimer();
    this._attempts = 0;
    this._inProgress = false;
    this._loginSent = false;
  }

  clearTimer() {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  /** Auth confirmed (via success message or health fallback). */
  onSuccess() {
    const i = this._i;
    if (i.state !== BOT_STATES.AUTHENTICATING) return; // already transitioned
    this.clearTimer();
    this._inProgress = false;
    this._attempts = 0;
    i._transitionToPlaying();
  }

  /** Server returned a non-recoverable failure (wrong password, ban, lockout). */
  onHardFail(message) {
    botLog(this._i.id, 'error', `Auth hard-fail from server: "${message}"`);
    // Force the next/in-flight tick to abort instead of wasting retries.
    this._attempts = MAX_LOGIN_ATTEMPTS + 1;
  }

  /**
   * Attempt to authenticate against the server prompt.
   * @param {string} prompt the last auth-related server message
   */
  async authenticate(prompt) {
    const i = this._i;
    if (this._inProgress) {
      botLog(i.id, 'debug', 'Auth already in progress – ignoring duplicate trigger.');
      return;
    }
    this._inProgress = true;
    this._attempts += 1;

    if (this._attempts > MAX_LOGIN_ATTEMPTS) {
      await this._abort();
      return;
    }

    const password = i.password;
    // Defense in depth: a credential containing whitespace would break the
    // space-delimited /login command and could smuggle extra chat tokens.
    // Creation-time validation already rejects this, so reaching here is a bug
    // or tampering – fail closed.
    if (/\s/.test(password)) {
      botLog(i.id, 'error', 'Stored password contains whitespace; aborting to avoid command injection.');
      await this._abort('invalid stored password');
      return;
    }

    const delay = randInt(AUTH_SEND_MIN_MS, AUTH_SEND_MAX_MS);
    botLog(i.id, 'info', `Auth attempt ${this._attempts}/${MAX_LOGIN_ATTEMPTS} – sending in ${delay}ms`);
    await sleep(delay);

    // Bail if the connection died or auth already succeeded while we waited.
    if (!i.bot || i.state !== BOT_STATES.AUTHENTICATING) {
      this._inProgress = false;
      return;
    }

    try {
      if (/register/i.test(prompt) && this._attempts === 1) {
        botLog(i.id, 'info', 'Server requested registration – sending /register');
        i.bot.chat(`/register ${password} ${password}`);
      } else {
        i.bot.chat(`/login ${password}`);
      }
      this._loginSent = true;
    } catch (err) {
      botLog(i.id, 'error', `Auth command failed: ${err.message}`);
    }

    this._inProgress = false;
    this._scheduleRetry();
  }

  _scheduleRetry() {
    const i = this._i;
    this.clearTimer();
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (i.state !== BOT_STATES.AUTHENTICATING) return;
      botLog(i.id, 'warn', `No auth response after ${AUTH_RETRY_MS / 1000}s – retrying.`);
      this.authenticate('/login').catch((err) => botLog(i.id, 'error', `Auth retry error: ${err.message}`));
    }, AUTH_RETRY_MS);
  }

  async _abort(reasonLabel = `after ${MAX_LOGIN_ATTEMPTS} attempts`) {
    const i = this._i;
    botLog(i.id, 'error', `Authentication failed ${reasonLabel}.`);
    this._inProgress = false;
    this.clearTimer();
    i._setState(BOT_STATES.ERROR);
    if (checkAlertCooldown(`${i.id}:loginFailed`)) {
      i.emit('alert', 'loginFailed', `Authentication failed ${reasonLabel}`);
    }
    await i._destroyBot('auth failure');
  }
}

module.exports = { AuthFlow, MAX_LOGIN_ATTEMPTS };
