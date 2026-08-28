'use strict';

class CooldownRateLimiter {
  constructor(cooldownMs) {
    this.cooldownMs = cooldownMs;
    this.lastAcceptedAt = new Map();
  }

  consume(key, now = Date.now()) {
    const last = this.lastAcceptedAt.get(key);
    if (last !== undefined && now - last < this.cooldownMs) {
      return { allowed: false, retryAfterMs: this.cooldownMs - (now - last) };
    }
    this.lastAcceptedAt.set(key, now);
    return { allowed: true, retryAfterMs: 0 };
  }

  clear(key) {
    this.lastAcceptedAt.delete(key);
  }
}

class SlidingWindowRateLimiter {
  constructor(maxEvents, windowMs) {
    this.maxEvents = maxEvents;
    this.windowMs = windowMs;
    this.events = new Map();
  }

  consume(key, now = Date.now()) {
    const threshold = now - this.windowMs;
    const events = (this.events.get(key) || []).filter(
      (timestamp) => timestamp > threshold
    );
    if (events.length >= this.maxEvents) {
      return { allowed: false, retryAfterMs: events[0] + this.windowMs - now };
    }
    events.push(now);
    this.events.set(key, events);
    return { allowed: true, retryAfterMs: 0 };
  }

  clear(key) {
    this.events.delete(key);
  }
}

module.exports = { CooldownRateLimiter, SlidingWindowRateLimiter };
