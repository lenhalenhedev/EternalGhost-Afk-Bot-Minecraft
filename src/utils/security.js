'use strict';

/**
 * Cross-cutting security primitives shared by every layer that touches
 * untrusted input (Discord options, persisted records, network messages).
 */

const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'prototype', 'constructor']);
const FORBIDDEN_SET = new Set(FORBIDDEN_KEYS);

function assertNoPollutingKeys(value, path = 'payload', seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, idx) =>
      assertNoPollutingKeys(item, `${path}[${idx}]`, seen)
    );
    return value;
  }

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_SET.has(key)) {
      throw new Error(`Illegal property "${key}" detected in ${path}`);
    }
    assertNoPollutingKeys(value[key], `${path}.${key}`, seen);
  }
  return value;
}

function sanitizeForLog(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.replace(/[\r\n\t]/g, ' ');
}

function strictInt(value, opts = {}) {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = opts;
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    n = Number(value.trim());
  } else {
    return { valid: false };
  }
  if (!Number.isInteger(n) || n < min || n > max) return { valid: false };
  return { valid: true, value: n };
}

module.exports = {
  assertNoPollutingKeys,
  sanitizeForLog,
  strictInt,
  FORBIDDEN_KEYS,
};
