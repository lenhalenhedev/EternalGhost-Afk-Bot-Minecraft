'use strict';
const { BOT_STATES } = require('../states');
const { botLog, checkAlertCooldown } = require('../../services/logger');
const {
  getReconnectDelay,
  reconnectLimitReached,
} = require('../../utils/helpers');

const MAX_RECONNECTS = 5;
const RECONNECT_WINDOW_MS = 600_000; // 10 minutes

/**
 * Owns reconnect bookkeeping for a single BotInstance.
 *
 * MEMORY LEAK FIXES:
 * - _history array is now bounded: entries older than the window are pruned
 *   on every access to prevent unbounded growth over long-running sessions
 * - clearTimer() is idempotent and always nullifies the reference
 * - Timer references are properly cleared to allow GC
 */
class ReconnectPolicy {
  constructor(instance) {
    this._i = instance;
    this._attempts = 0;
    this._history = []; // timestamps of reconnect attempts
    this._timer = null;
  }

  get currentAttempts() {
    return this._attempts;
  }

  resetAttempts() {
    this._attempts = 0;
  }

  clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * React to a disconnect/kick/end.
   */
  handleDisconnect(reason) {
    const i = this._i;
    i._sub.stopAll();
    i._setState(BOT_STATES.DISCONNECTED);
    if (checkAlertCooldown(`${i.id}:disconnect`)) {
      i.emit('alert', 'disconnect', `Disconnected: ${reason}`);
    }
    if (!i.record.autoReconnect) {
      botLog(i.id, 'info', 'autoReconnect disabled – staying DISCONNECTED.');
      return;
    }

    // FIX: Prune history entries older than the window to prevent unbounded growth.
    // Without this, a bot running for months would accumulate thousands of entries.
    this._pruneHistory();

    if (
      reconnectLimitReached(this._history, MAX_RECONNECTS, RECONNECT_WINDOW_MS)
    ) {
      botLog(
        i.id,
        'error',
        `Reconnect limit (${MAX_RECONNECTS}/10min) reached. Giving up.`
      );
      i._setState(BOT_STATES.ERROR);
      if (checkAlertCooldown(`${i.id}:reconnectFailed`)) {
        i.emit('alert', 'reconnectFailed', 'Reconnect limit reached');
      }
      return;
    }
    this._scheduleBackoff();
  }

  _scheduleBackoff() {
    const i = this._i;
    const delay = getReconnectDelay(this._attempts);
    this._attempts += 1;
    this._history.push(Date.now());
    botLog(
      i.id,
      'info',
      `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this._attempts}/${MAX_RECONNECTS})…`
    );
    i._setState(BOT_STATES.RECONNECTING);
    i.emit('reconnecting', this._attempts, delay);
    this._armTimer(delay);
  }

  /**
   * Reconnect after a fixed delay WITHOUT consuming the attempt budget.
   */
  reconnectAfter(delayMs) {
    this._i._setState(BOT_STATES.RECONNECTING);
    this._armTimer(delayMs);
  }

  _armTimer(delayMs) {
    const i = this._i;
    this.clearTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      if (i.state !== BOT_STATES.RECONNECTING) return;
      i._connect().catch((err) =>
        botLog(i.id, 'error', `Reconnect failed: ${err.message}`)
      );
    }, delayMs);
  }

  /**
   * FIX: Remove history entries older than the reconnect window.
   * This prevents the _history array from growing unboundedly over the
   * lifetime of a long-running bot (potential memory leak for bots that
   * disconnect/reconnect frequently over days/weeks).
   */
  _pruneHistory() {
    const cutoff = Date.now() - RECONNECT_WINDOW_MS;
    // Filter in-place to avoid creating a new array on every call
    let writeIdx = 0;
    for (let i = 0; i < this._history.length; i++) {
      if (this._history[i] > cutoff) {
        this._history[writeIdx++] = this._history[i];
      }
    }
    this._history.length = writeIdx;
  }
}

module.exports = ReconnectPolicy;
