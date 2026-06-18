'use strict';

// Pure, dependency-free log-buffering primitives.
//
// Deliberately requires NOTHING (no winston, no config) so it stays unit
// testable and side-effect free. `logger.js` owns the winston transports and
// composes a single LogBuffers instance for the per-bot ring buffer, the
// Discord summary buffer, and alert-cooldown tracking.

const BOT_BUFFER_SIZE = 200; // max retained log lines per bot
const SUMMARY_MAX = 100; // max summary entries retained between flushes
const ALERT_COOLDOWN_MS = 45_000; // min spacing between identical alerts

class LogBuffers {
  constructor(opts = {}) {
    this._botBufferSize = opts.botBufferSize ?? BOT_BUFFER_SIZE;
    this._summaryMax = opts.summaryMax ?? SUMMARY_MAX;
    this._alertCooldownMs = opts.alertCooldownMs ?? ALERT_COOLDOWN_MS;

    /** @type {Map<string, Array<{ts:number,level:string,msg:string}>>} */
    this._botLogs = new Map();
    /** @type {Array<{ts:number,level:string,prefix:string,message:string}>} */
    this._summary = [];
    /** @type {Map<string, number>} key => lastSentTs */
    this._cooldowns = new Map();
  }

  _bufferFor(botId) {
    let buf = this._botLogs.get(botId);
    if (!buf) {
      buf = [];
      this._botLogs.set(botId, buf);
    }
    return buf;
  }

  /** Append a line to a bot's ring buffer, dropping the oldest past the cap. */
  pushBotLog(botId, level, message, now = Date.now()) {
    const buf = this._bufferFor(botId);
    buf.push({ ts: now, level, msg: message });
    if (buf.length > this._botBufferSize) buf.shift();
  }

  /**
   * Recent logs for a bot, newest last.
   * @param {number} maxLines  cap on returned lines
   * @param {number} maxAgeMs  0 means no age limit
   */
  getBotLogs(botId, maxLines = 50, maxAgeMs = 0, now = Date.now()) {
    const buf = this._botLogs.get(botId) || [];
    const filtered = maxAgeMs ? buf.filter((e) => e.ts >= now - maxAgeMs) : buf;
    return filtered.slice(-maxLines);
  }

  /** Queue a line for the next Discord summary flush. */
  addToSummary(level, botId, message, now = Date.now()) {
    const prefix = botId ? `[Bot:${botId.slice(0, 8)}]` : '[SYS]';
    this._summary.push({ ts: now, level, prefix, message });
    if (this._summary.length > this._summaryMax) this._summary.shift();
  }

  /** Remove and return all queued summary entries (empty array if none). */
  drainSummary() {
    return this._summary.splice(0, this._summary.length);
  }

  /**
   * Returns true at most once per cooldown window for a given key, recording
   * the send time when it returns true.
   */
  checkAlertCooldown(key, now = Date.now()) {
    const last = this._cooldowns.get(key) || 0;
    if (now - last < this._alertCooldownMs) return false;
    this._cooldowns.set(key, now);
    return true;
  }

  /** Drop all retained state for a bot (call on deletion to avoid leaks). */
  clearBot(botId) {
    this._botLogs.delete(botId);
    const prefix = `${botId}:`;
    for (const key of this._cooldowns.keys()) {
      if (key === botId || key.startsWith(prefix)) this._cooldowns.delete(key);
    }
  }
}

module.exports = { LogBuffers, BOT_BUFFER_SIZE, SUMMARY_MAX, ALERT_COOLDOWN_MS };
