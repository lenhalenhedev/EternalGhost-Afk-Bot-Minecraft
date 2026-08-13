'use strict';
const net = require('net');
const { strictInt } = require('./security');

/**
 * Input validation for all externally-supplied data (Discord command options,
 * persisted records). Every value reaching these functions is treated as
 * untrusted. Each validator returns a plain result object so callers can
 * aggregate errors without throwing.
 */

const SUPPORTED_VERSIONS = new Set([
  '1.8',
  '1.9',
  '1.10',
  '1.11',
  '1.12',
  '1.13',
  '1.14',
  '1.15',
  '1.16',
  '1.16.1',
  '1.16.2',
  '1.16.3',
  '1.16.4',
  '1.16.5',
  '1.17',
  '1.17.1',
  '1.18',
  '1.18.1',
  '1.18.2',
  '1.19',
  '1.19.1',
  '1.19.2',
  '1.19.3',
  '1.19.4',
  '1.20',
  '1.20.1',
  '1.20.2',
  '1.20.3',
  '1.20.4',
  '1.20.5',
  '1.20.6',
  '1.21',
  '1.21.1',
  '1.21.2',
  '1.21.3',
  '1.21.4',
  '1.21.9',
  '1.21.11',
]);

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
// Intentional: this validator must reject ASCII control characters.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;
const NON_ASCII_RE = /[^\u0020-\u007e]/;
const DOTTED_QUAD_RE = /^\d+\.\d+\.\d+\.\d+$/;
const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9.-]+(?<!-)$/;

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

function validatePort(port) {
  const result = strictInt(port, { min: 1, max: 65535 });
  if (!result.valid) {
    return {
      valid: false,
      reason: 'Port must be an integer between 1 and 65535',
    };
  }
  return { valid: true, value: result.value };
}

function validateUsername(username) {
  if (typeof username !== 'string' || username.length === 0) {
    return { valid: false, reason: 'Username is required' };
  }
  if (CONTROL_CHARS_RE.test(username) || NON_ASCII_RE.test(username)) {
    return {
      valid: false,
      reason: 'Username must not contain Unicode or control characters',
    };
  }
  if (!USERNAME_RE.test(username)) {
    if (username.length < 3 || username.length > 16) {
      return { valid: false, reason: 'Username must be 3-16 characters' };
    }
    return {
      valid: false,
      reason: 'Username may only contain letters, numbers, and underscores',
    };
  }
  return { valid: true, value: username };
}

function validateHost(host) {
  if (typeof host !== 'string' || host.trim() === '') {
    return { valid: false, reason: 'Server address is required' };
  }
  if (host.length > 253) {
    return { valid: false, reason: 'Server address too long' };
  }
  if (CONTROL_CHARS_RE.test(host) || /\s/.test(host)) {
    return {
      valid: false,
      reason: 'Server address contains invalid characters',
    };
  }

  if (net.isIP(host) !== 0) {
    return { valid: true, value: host };
  }

  if (host.includes(':')) {
    const base = host.split('%')[0];
    if (net.isIP(base) !== 0) return { valid: true, value: host };
    return {
      valid: false,
      reason: 'Server address must be a valid IPv4/IPv6 address or hostname',
    };
  }

  if (DOTTED_QUAD_RE.test(host)) {
    return {
      valid: false,
      reason: 'Server address must be a valid IPv4/IPv6 address or hostname',
    };
  }

  if (HOSTNAME_RE.test(host)) {
    return { valid: true, value: host };
  }

  return {
    valid: false,
    reason: 'Server address must be a valid IPv4/IPv6 address or hostname',
  };
}

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
    return {
      valid: false,
      reason: 'Password must not contain spaces or newlines',
    };
  }
  if (CONTROL_CHARS_RE.test(password)) {
    return {
      valid: false,
      reason: 'Password must not contain control characters',
    };
  }
  return { valid: true, value: password };
}

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

function validateChatMessage(message, allowedCommandPrefixes = []) {
  if (!message || message.trim() === '') {
    return { valid: false, reason: 'Message cannot be empty' };
  }
  if (message.length > 200) {
    return { valid: false, reason: 'Message exceeds 200 characters' };
  }
  if (CONTROL_CHARS_RE.test(message)) {
    return {
      valid: false,
      reason: 'Message contains invalid control characters',
    };
  }
  if (message.startsWith('/')) {
    const cmd = message.split(' ')[0].toLowerCase();
    if (!allowedCommandPrefixes.includes(cmd)) {
      return {
        valid: false,
        reason:
          'Sending game commands is not allowed. Use the whitelist in config.',
      };
    }
  }
  return { valid: true };
}

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
