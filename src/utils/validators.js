'use strict';

// Known supported Minecraft Java Edition versions by mineflayer
const SUPPORTED_VERSIONS = new Set([
  '1.16.1', '1.16.2', '1.16.3', '1.16.4', '1.16.5',
  '1.17', '1.17.1',
  '1.18', '1.18.1', '1.18.2',
  '1.19', '1.19.1', '1.19.2', '1.19.3', '1.19.4',
  '1.20', '1.20.1', '1.20.2', '1.20.3', '1.20.4', '1.20.5', '1.20.6',
  '1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.4',
]);

/**
 * Validate a Minecraft version string.
 * @param {string} version
 * @returns {{ valid: boolean, reason?: string }}
 */
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

/**
 * Validate a TCP port number.
 */
function validatePort(port) {
  const n = parseInt(port, 10);
  if (isNaN(n) || n < 1 || n > 65535) {
    return { valid: false, reason: 'Port must be an integer between 1 and 65535' };
  }
  return { valid: true, value: n };
}

/**
 * Validate a Minecraft username (offline-mode or Mojang).
 * 3-16 chars, alphanumeric + underscore.
 */
function validateUsername(username) {
  if (!username) return { valid: false, reason: 'Username is required' };
  if (username.length < 3 || username.length > 16) {
    return { valid: false, reason: 'Username must be 3-16 characters' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { valid: false, reason: 'Username may only contain letters, numbers, and underscores' };
  }
  return { valid: true };
}

/**
 * Validate an IP / hostname string.
 */
function validateHost(host) {
  if (!host || host.trim() === '') return { valid: false, reason: 'Server address is required' };
  // Very basic check – allow hostnames and IPs
  if (host.length > 255) return { valid: false, reason: 'Server address too long' };
  return { valid: true };
}

/**
 * Validate a full bot config object.
 * Returns { valid: boolean, errors: string[] }
 */
function validateBotConfig({ host, port, username, version }) {
  const errors = [];

  const h = validateHost(host);
  if (!h.valid) errors.push(h.reason);

  const p = validatePort(port);
  if (!p.valid) errors.push(p.reason);

  const u = validateUsername(username);
  if (!u.valid) errors.push(u.reason);

  const v = validateVersion(version);
  if (!v.valid) errors.push(v.reason);

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a chat message for the /chat command.
 * @param {string} message
 * @param {string[]} allowedCommandPrefixes  – whitelisted /commands
 */
function validateChatMessage(message, allowedCommandPrefixes = []) {
  if (!message || message.trim() === '') {
    return { valid: false, reason: 'Message cannot be empty' };
  }
  if (message.length > 200) {
    return { valid: false, reason: 'Message exceeds 200 characters' };
  }
  if (message.startsWith('/')) {
    const cmd = message.split(' ')[0].toLowerCase();
    if (!allowedCommandPrefixes.includes(cmd)) {
      return { valid: false, reason: 'Sending game commands is not allowed. Use the whitelist in config.' };
    }
  }
  return { valid: true };
}

/**
 * Check whether a Discord user ID is in the admin list.
 */
function isAdmin(userId, adminIds) {
  return adminIds.includes(userId);
}

module.exports = {
  validateVersion,
  validatePort,
  validateUsername,
  validateHost,
  validateBotConfig,
  validateChatMessage,
  isAdmin,
  SUPPORTED_VERSIONS,
};
