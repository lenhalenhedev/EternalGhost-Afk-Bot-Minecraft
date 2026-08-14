'use strict';
const net = require('net');
const dns = require('node:dns').promises;
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

function isPublicIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIpv6Groups(address) {
  if (typeof address !== 'string' || address.includes('%')) return null;
  let value = address.toLowerCase();
  if (value.includes('.')) {
    const index = value.lastIndexOf(':');
    const ipv4 = value.slice(index + 1);
    if (index < 0 || net.isIP(ipv4) !== 4) return null;
    const [a, b, c, d] = ipv4.split('.').map(Number);
    value = `${value.slice(0, index)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const parts = value.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const groups = [
    ...left,
    ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }
  return groups.map((group) => Number.parseInt(group, 16));
}

function isPublicIpv6(address) {
  const groups = parseIpv6Groups(address);
  if (!groups) return false;
  const allZero = groups.every((group) => group === 0);
  const loopback =
    groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const mappedIpv4 =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (allZero || loopback) return false;
  if (mappedIpv4) {
    return isPublicIpv4(
      `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
    );
  }
  if ((groups[0] & 0xfe00) === 0xfc00) return false; // Unique local (fc00::/7)
  if ((groups[0] & 0xffc0) === 0xfe80) return false; // Link-local (fe80::/10)
  if ((groups[0] & 0xff00) === 0xff00) return false; // Multicast (ff00::/8)
  return true;
}

function isPublicIpAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function destinationDenied() {
  return new Error('Destination is not permitted.');
}

/**
 * Resolves a hostname once, validates every returned address, and returns a
 * verified address for the connector to use. Passing a resolved address rather
 * than the hostname prevents a second DNS lookup from changing the target.
 */
async function assertPublicDestination(host, options = {}) {
  const lookup = options.lookup || dns.lookup;
  const allowPrivateIps = new Set(
    (options.allowPrivateIps || []).map((address) =>
      String(address).toLowerCase()
    )
  );
  if (typeof host !== 'string' || host.trim() === '') throw destinationDenied();
  const requested = host.trim();
  const directFamily = net.isIP(requested);

  if (directFamily) {
    const explicitlyAllowedPrivate = allowPrivateIps.has(
      requested.toLowerCase()
    );
    if (!isPublicIpAddress(requested) && !explicitlyAllowedPrivate) {
      throw destinationDenied();
    }
    return { host: requested, address: requested, family: directFamily };
  }

  let resolved;
  try {
    resolved = await lookup(requested, { all: true, verbatim: true });
  } catch {
    throw destinationDenied();
  }
  const addresses = Array.isArray(resolved) ? resolved : [resolved];
  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicIpAddress(entry?.address))
  ) {
    throw destinationDenied();
  }

  const [selected] = addresses;
  return {
    host: requested,
    address: selected.address,
    family: selected.family,
  };
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
  isPublicIpAddress,
  assertPublicDestination,
  validatePassword,
  validateBotConfig,
  validateChatMessage,
  isAdmin,
  SUPPORTED_VERSIONS,
};
