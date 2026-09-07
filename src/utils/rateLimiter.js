'use strict';

/**
 * In-memory rate limiters keyed by an arbitrary identity (Discord user id).
 *
 * Entries are only ever removed when they expire, so to avoid unbounded memory
 * growth on a long-lived process both limiters prune expired keys lazily on
 * each consume (once per pruneIntervalMs) and enforce a hard entry cap. Callers
 * that need to guarantee cleanup before the next window can also call
 * prune(now) explicitly (EG-010).
 */

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_PRUNE_INTERVAL_MS = 5 * 60 * 1_000;

class CooldownRateLimiter {
  constructor(cooldownMs, opts = {}) {
    this.cooldownMs = cooldownMs;
    this.maxEntries = opts.maxEntries || DEFAULT_MAX_ENTRIES;
    this.pruneIntervalMs = opts.pruneIntervalMs || DEFAULT_PRUNE_INTERVAL_MS;
    this.lastAcceptedAt = new Map();
    this._lastPruneAt = 0;
  }

  consume(key, now = Date.now()) {
    this._maybePrune(now);
    const last = this.lastAcceptedAt.get(key);
    if (last !== undefined && now - last < this.cooldownMs) {
      return { allowed: false, retryAfterMs: this.cooldownMs - (now - last) };
    }
    this.lastAcceptedAt.set(key, now);
    this._enforceCap();
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Drop every entry that is older than the cooldown window. */
  prune(now = Date.now()) {
    const expiry = now - this.cooldownMs;
    for (const [key, ts] of this.lastAcceptedAt) {
      if (ts <= expiry) this.lastAcceptedAt.delete(key);
    }
    this._lastPruneAt = now;
  }

  clear(key) {
    this.lastAcceptedAt.delete(key);
  }

  _maybePrune(now) {
    if (now - this._lastPruneAt >= this.pruneIntervalMs) this.prune(now);
  }

  _enforceCap() {
    if (this.lastAcceptedAt.size <= this.maxEntries) return;
    for (const key of this.lastAcceptedAt.keys()) {
      this.lastAcceptedAt.delete(key);
      if (this.lastAcceptedAt.size <= this.maxEntries) break;
    }
  }
}

class SlidingWindowRateLimiter {
  constructor(maxEvents, windowMs, opts = {}) {
    this.maxEvents = maxEvents;
    this.windowMs = windowMs;
    this.maxEntries = opts.maxEntries || DEFAULT_MAX_ENTRIES;
    this.pruneIntervalMs = opts.pruneIntervalMs || DEFAULT_PRUNE_INTERVAL_MS;
    this.events = new Map();
    this._lastPruneAt = 0;
  }

  consume(key, now = Date.now()) {
    this._maybePrune(now);
    const threshold = now - this.windowMs;
    const events = (this.events.get(key) || []).filter(
      (timestamp) => timestamp > threshold
    );
    if (events.length >= this.maxEvents) {
      return { allowed: false, retryAfterMs: events[0] + this.windowMs - now };
    }
    events.push(now);
    this.events.set(key, events);
    this._enforceCap();
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Drop keys whose timestamp lists are empty (all events expired). */
  prune(now = Date.now()) {
    const threshold = now - this.windowMs;
    for (const [key, events] of this.events) {
      const remaining = events.filter((timestamp) => timestamp > threshold);
      if (remaining.length === 0) this.events.delete(key);
      else this.events.set(key, remaining);
    }
    this._lastPruneAt = now;
  }

  clear(key) {
    this.events.delete(key);
  }

  _maybePrune(now) {
    if (now - this._lastPruneAt >= this.pruneIntervalMs) this.prune(now);
  }

  _enforceCap() {
    if (this.events.size <= this.maxEntries) return;
    for (const key of this.events.keys()) {
      this.events.delete(key);
      if (this.events.size <= this.maxEntries) break;
    }
  }
}

module.exports = { CooldownRateLimiter, SlidingWindowRateLimiter };
