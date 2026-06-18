'use strict';

/**
 * Input validation for all externally-supplied data (Discord command options,
 * persisted records). Treat every value reaching these functions as untrusted.
 * Each validator returns a plain `{ valid, reason?, value? }` result object so
 * callers can aggregate errors without throwing.
 */

// Known supported Minecraft Java Edition versions for mineflayer.
const SUPPORTED_VERSIONS = new Set([
  '1.16.1', '1.16.2', '1.16.3', '1.16.4', '1.16.5',
  '1.17', '1.17.1',
  '1.18', '1.18.1', '1.18.2',
  '1.19', '1.19.1', '1.19.2', '1.19.3', '1.19.4',
  '1.20', '1.20.1', '1.20.2', '1.20.3', '1.20.4', '1.20.5', '1.20.6',
  '1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.4',
]);

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// "Looks like a dotted-quad" – any 4 numeric labels. Used to reject malformed
// IPv4 (e.g. 999.1.1.1) instead of letting it pass as an all-digit hostname.
const DOTTED_QUAD_RE = /^\d+\.\d+\.\d+\.\d+$/;
// Hostname per RFC 1123 (labels of letters/digits/hyphens, not starting/ending with hyphen).
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
// Loose IPv6 matcher (hex groups + colons, optional zone id). Strict parsing is
// delegated to the network stack; this only blocks obviously malformed input.
const IPV6_RE = /^[0-9a-fA-F:]+(%[a-zA-Z0-9]+)?$/;

function isValidIpv4(host) {
  const m = IPV4_RE.exec(host);
  if (!m) return false;
  return m.slice(1).every((octet) => {
    const n = Number(octet);
    return n >= 0 && n <= 255 && String(n) === String(Number(octet));
  });
}

/** Validate a Minecraft version string against the supported set. */
function validateVersion(version) {
  if (!version) return { valid: false, reason: 'Version is required' };
  if (!SUPPORTED_VERSIONS.has(version)) {
    return {
      valid: false,
      reason: `Unsupported version "${version}". Supported: ${[...SUPPORTED_VERSIONS].join(', ')}`,
    };
  }
  return { valid: true };
}

/** Validate a TCP port number. */
function validatePort(port) {
  const n = parseInt(port, 10);
  if (Number.isNaN(n) || n < 1 || n > 65535) {
    return { valid: false, reason: 'Port must be an integer between 1 and 65535' };
  }
  return { valid: true, value: n };
}

/** Validate a Minecraft username (3-16 chars, alphanumeric + underscore). */
function validateUsername(username) {
  if (!username) return { valid: false, reason: 'Username is required' };
  if (username.length < 3 || username.length > 16) {
    return { valid: false, reason: 'Username must be 3-16 characters' };
  }
  if (!USERNAME_RE.test(username)) {
    return { valid: false, reason: 'Username may only contain letters, numbers, and underscores' };
  }
  return { valid: true };
}

/** Validate an IP / hostname string (IPv4, IPv6, or RFC-1123 hostname). */
function validateHost(host) {
  if (!host || host.trim() === '') return { valid: false, reason: 'Server address is required' };
  if (host.length > 255) return { valid: false, reason: 'Server address too long' };
  if (CONTROL_CHARS_RE.test(host) || /\s/.test(host)) {
    return { valid: false, reason: 'Server address contains invalid characters' };
  }
  if (DOTTED_QUAD_RE.test(host)) {
    // Numeric dotted form must be a valid IPv4; never treat it as a hostname.
    return isValidIpv4(host)
      ? { valid: true, value: host }
      : { valid: false, reason: 'Server address must be a valid IPv4/IPv6 address or hostname' };
  }
  if (isValidIpv4(host) || HOSTNAME_RE.test(host) || (host.includes(':') && IPV6_RE.test(host))) {
    return { valid: true, value: host };
  }
  return { valid: false, reason: 'Server address must be a valid IPv4/IPv6 address or hostname' };
}

/**
 * Validate an AuthMe password. Empty is allowed (offline / no-auth servers).
 * Whitespace and control characters are rejected because the credential is sent
 * as a single space-delimited token in `/login <password>` — allowing spaces or
 * newlines would enable in-game chat/command injection.
 */
function validatePassword(password) {
  if (password === undefined || password === null || password === '') {
    return { valid: true, value: '' };
  }
  if (typeof password !== 'string') {
    return { valid: false, reason: 'Password must be a string' };
  }
  if (password.length > 100) {
    return { valid: false, reason: 'Password must be at most 100 characters' };
  }
  if (/\s/.test(password)) {
    return { valid: false, reason: 'Password must not contain spaces or newlines' };
  }
  if (CONTROL_CHARS_RE.test(password)) {
    return { valid: false, reason: 'Password must not contain control characters' };
  }
  return { valid: true, value: password };
}

/**
 * Validate a full bot config object.
 * @returns  valid: boolean, errors: string[] 
 */
function validateBotConfig({ host, port, username, version, password }) {
  const errors = [];
  for (const result of [
    validateHost(host),
    validatePort(port),
    validateUsername(username),
    validateVersion(version),
    validatePassword(password),
  ]) {
    if (!result.valid) errors.push(result.reason);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a chat message for the /chat command.
 * @param {string} message
 * @param {string[]} allowedCommandPrefixes whitelisted in-game `/commands`
 */
function validateChatMessage(message, allowedCommandPrefixes = []) {
  if (!message || message.trim() === '') {
    return { valid: false, reason: 'Message cannot be empty' };
  }
  if (message.length > 200) {
    return { valid: false, reason: 'Message exceeds 200 characters' };
  }
  if (CONTROL_CHARS_RE.test(message)) {
    return { valid: false, reason: 'Message contains invalid control characters' };
  }
  if (message.startsWith('/')) {
    const cmd = message.split(' ')[0].toLowerCase();
    if (!allowedCommandPrefixes.includes(cmd)) {
      return { valid: false, reason: 'Sending game commands is not allowed. Use the whitelist in config.' };
    }
  }
  return { valid: true };
}

/** Check whether a Discord user ID is in the admin list. */
function isAdmin(userId, adminIds) {
  return adminIds.includes(userId);
}

module.exports = {
  validateVersion,
  validatePort,
  validateUsername,
  validateHost,
  validatePassword,
  validateBotConfig,
  validateChatMessage,
  isAdmin,
  SUPPORTED_VERSIONS,
};
