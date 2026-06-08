'use strict';

/**
 * Sleep for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clamp a value between min and max.
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Random integer in [min, max] inclusive.
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Random float in [min, max).
 */
function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Format milliseconds to human-readable uptime string.
 * @param {number} ms
 * @returns {string}  e.g. "2d 3h 15m 4s"
 */
function formatUptime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const d  = Math.floor(totalSec / 86400);
  const h  = Math.floor((totalSec % 86400) / 3600);
  const m  = Math.floor((totalSec % 3600) / 60);
  const s  = totalSec % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Format bytes to MB string.
 */
function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Format a Vec3 position to string.
 */
function formatPos(pos) {
  if (!pos) return 'N/A';
  return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

/**
 * Parse server address, returning { host, port }.
 * @param {string} ip
 * @param {number|string} port
 */
function parseServer(ip, port) {
  // Allow "host:port" syntax in the IP field
  if (ip.includes(':') && !ip.startsWith('[')) {
    const idx = ip.lastIndexOf(':');
    return { host: ip.slice(0, idx), port: parseInt(ip.slice(idx + 1), 10) };
  }
  return { host: ip, port: parseInt(port, 10) || 25565 };
}

/**
 * Truncate a string with ellipsis.
 */
function truncate(str, maxLen = 100) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen - 3) + '…';
}

/**
 * Promise that rejects after `ms` ms with a TimeoutError.
 */
function rejectAfter(ms, label = 'Operation') {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
}

/**
 * Race a promise against a timeout.
 */
async function withTimeout(promise, ms, label) {
  return Promise.race([promise, rejectAfter(ms, label)]);
}

/**
 * Exponential backoff delays for reconnect (seconds).
 * Attempt index 0-based.
 */
const RECONNECT_DELAYS_MS = [5_000, 30_000, 60_000, 90_000, 120_000];

function getReconnectDelay(attempt) {
  const idx = clamp(attempt, 0, RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[idx];
}

/**
 * Check whether reconnect attempts in history exceed limit within window.
 * @param {number[]} history  – array of timestamps
 * @param {number} maxAttempts
 * @param {number} windowMs
 */
function reconnectLimitReached(history, maxAttempts = 5, windowMs = 600_000) {
  const cutoff = Date.now() - windowMs;
  const recent = history.filter(ts => ts > cutoff);
  return recent.length >= maxAttempts;
}

module.exports = {
  sleep, clamp, randInt, randFloat,
  formatUptime, formatMB, formatPos, parseServer, truncate,
  withTimeout, rejectAfter,
  getReconnectDelay, reconnectLimitReached,
  RECONNECT_DELAYS_MS,
};
