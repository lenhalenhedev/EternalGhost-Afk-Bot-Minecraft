'use strict';
// Pure, dependency-free log-buffering primitives.
//
// MEMORY LEAK FIXES:
// - _cooldowns Map now has periodic pruning of expired entries to prevent
//   unbounded growth over time (each unique alert key stays forever otherwise)
// - clearBot() uses Array.from() to safely iterate while deleting from Map
// - Added pruneCooldowns() method for explicit cleanup
// - Added destroy() for graceful shutdown

const BOT_BUFFER_SIZE = 200; // max retained log lines per bot
const SUMMARY_MAX = 100; // max summary entries retained between flushes
const ALERT_COOLDOWN_MS = 45_000; // min spacing between identical alerts
const COOLDOWN_PRUNE_INTERVAL = 300_000; // prune expired cooldowns every 5 min
const MAX_COOLDOWN_ENTRIES = 10_000; // hard cap to prevent unbounded growth

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
    this._lastPrune = Date.now();

    // FIX: Set up periodic pruning of expired cooldown entries.
    // Without this, the cooldowns Map grows indefinitely as new unique keys
    // are added (e.g., botId:death, botId:disconnect for every bot over time).
    this._pruneTimer = setInterval(
      () => this.pruneCooldowns(),
      COOLDOWN_PRUNE_INTERVAL
    );
    // Ensure the timer doesn't prevent process exit
    if (this._pruneTimer.unref) this._pruneTimer.unref();
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

    // FIX: Inline safety check - if the map grows beyond a hard cap, force prune.
    if (this._cooldowns.size > MAX_COOLDOWN_ENTRIES) {
      this.pruneCooldowns(now);
    }
    return true;
  }

  /**
   * FIX: Remove expired cooldown entries from the Map.
   * Prevents unbounded growth when many unique alert keys accumulate.
   */
  pruneCooldowns(now = Date.now()) {
    const expiry = now - this._alertCooldownMs * 2;
    for (const [key, ts] of this._cooldowns) {
      if (ts < expiry) {
        this._cooldowns.delete(key);
      }
    }
    this._lastPrune = now;
  }

  /** Drop all retained state for a bot (call on deletion to avoid leaks). */
  clearBot(botId) {
    this._botLogs.delete(botId);
    const prefix = `${botId}:`;
    // FIX: Use Array.from() to safely iterate while deleting from the Map.
    for (const key of Array.from(this._cooldowns.keys())) {
      if (key === botId || key.startsWith(prefix)) this._cooldowns.delete(key);
    }
  }

  /** Stop the internal prune timer (call on shutdown). */
  destroy() {
    clearInterval(this._pruneTimer);
    this._pruneTimer = null;
  }
}

module.exports = {
  LogBuffers,
  BOT_BUFFER_SIZE,
  SUMMARY_MAX,
  ALERT_COOLDOWN_MS,
};
