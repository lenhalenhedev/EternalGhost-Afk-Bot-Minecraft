'use strict';

/**
 * Generic, dependency-free helper functions shared across the codebase.
 * All functions here are pure (no I/O, no global state) so they can be unit
 * tested in isolation.
 */

/** Sleep for `ms` milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Clamp a value between min and max (inclusive). */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Random integer in [min, max] inclusive. */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float in [min, max). */
function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/** Format milliseconds to a human-readable uptime string, e.g. "2d 3h 15m 4s". */
function formatUptime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/** Format bytes to a "X.Y MB" string. */
function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Format a Vec3-like position to "(x, y, z)" or "N/A". */
function formatPos(pos) {
  if (!pos) return 'N/A';
  return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

/** Promise that rejects after `ms` ms with a labelled timeout error. */
function rejectAfter(ms, label = 'Operation') {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
  );
}

/** Race a promise against a timeout. */
async function withTimeout(promise, ms, label) {
  return Promise.race([promise, rejectAfter(ms, label)]);
}

/** Exponential backoff delays for reconnect (milliseconds). Attempt index is 0-based. */
const RECONNECT_DELAYS_MS = [5_000, 30_000, 60_000, 90_000, 120_000];

function getReconnectDelay(attempt) {
  const idx = clamp(attempt, 0, RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[idx];
}

/**
 * Check whether reconnect attempts in `history` exceed `maxAttempts` within `windowMs`.
 * @param {number[]} history array of attempt timestamps (ms)
 */
function reconnectLimitReached(history, maxAttempts = 5, windowMs = 600_000) {
  const cutoff = Date.now() - windowMs;
  const recent = history.filter((ts) => ts > cutoff);
  return recent.length >= maxAttempts;
}

module.exports = {
  sleep,
  clamp,
  randInt,
  randFloat,
  formatUptime,
  formatMB,
  formatPos,
  withTimeout,
  rejectAfter,
  getReconnectDelay,
  reconnectLimitReached,
};
