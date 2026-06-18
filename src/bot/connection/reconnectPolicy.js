'use strict';

const { BOT_STATES } = require('../states');
const { botLog, checkAlertCooldown } = require('../../services/logger');
const { getReconnectDelay, reconnectLimitReached } = require('../../utils/helpers');

const MAX_RECONNECTS = 5;
const RECONNECT_WINDOW_MS = 600_000; // 10 minutes

/**
 * Owns reconnect bookkeeping for a single BotInstance: the backoff counter, the
 * flap-detection history window, and the pending reconnect timer.
 *
 * Extracted from BotInstance so the orchestrator no longer mixes reconnect math
 * with state transitions (single responsibility).
 */
class ReconnectPolicy {
  /** @param {import('../BotInstance')} instance */
  constructor(instance) {
    this._i = instance;
    this._attempts = 0;
    this._history = []; // timestamps of reconnect attempts
    this._timer = null;
  }

  get currentAttempts() {
    return this._attempts;
  }

  /**
   * Reset the backoff counter after a healthy connection.
   * History is intentionally preserved so rapid flapping is still caught by the
   * time-window limit.
   */
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
   * React to a disconnect/kick/end. Stops subsystems, then either gives up
   * (limit reached / autoReconnect off) or schedules a backoff reconnect.
   * @param {string} reason
   */
  handleDisconnect(reason) {
    const i = this._i;
    i._stopSubsystems();
    i._setState(BOT_STATES.DISCONNECTED);

    if (checkAlertCooldown(`${i.id}:disconnect`)) {
      i.emit('alert', 'disconnect', `Disconnected: ${reason}`);
    }

    if (!i.record.autoReconnect) {
      botLog(i.id, 'info', 'autoReconnect disabled – staying DISCONNECTED.');
      return;
    }

    if (reconnectLimitReached(this._history, MAX_RECONNECTS, RECONNECT_WINDOW_MS)) {
      botLog(i.id, 'error', `Reconnect limit (${MAX_RECONNECTS}/10min) reached. Giving up.`);
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

    botLog(i.id, 'info', `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this._attempts}/${MAX_RECONNECTS})…`);
    i._setState(BOT_STATES.RECONNECTING);
    i.emit('reconnecting', this._attempts, delay);
    this._armTimer(delay);
  }

  /**
   * Reconnect after a fixed delay WITHOUT consuming the attempt budget.
   * Used for duplicate-login backoff, which is not a failure of our connection.
   * @param {number} delayMs
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
      if (i.state !== BOT_STATES.RECONNECTING) return; // cancelled by stop()
      i._connect().catch((err) => botLog(i.id, 'error', `Reconnect failed: ${err.message}`));
    }, delayMs);
  }
}

module.exports = ReconnectPolicy;
