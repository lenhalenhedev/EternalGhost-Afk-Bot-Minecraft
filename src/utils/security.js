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

const SENSITIVE_DIAGNOSTIC_KEY =
  /^(?:password|passphrase|passwd|pwd|token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|set-cookie|secret|encryptedpassword|database[_-]?url|connection[_-]?string)$/i;
const REDACTED = '[REDACTED]';

function serialiseDiagnostic(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Error)
    return value.stack || value.message || String(value);
  if (typeof value === 'string') return value;

  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (key, nested) => {
      if (SENSITIVE_DIAGNOSTIC_KEY.test(key)) return REDACTED;
      if (nested && typeof nested === 'object') {
        if (seen.has(nested)) return '[Circular]';
        seen.add(nested);
      }
      return nested;
    });
  } catch {
    return String(value);
  }
}

/**
 * Redacts diagnostic data immediately before it leaves a trust boundary.
 * This is deliberately lossy: a diagnostic channel must never trade secret
 * disclosure for debuggability.
 */
function redactDiagnostic(value) {
  let text = serialiseDiagnostic(value);

  text = text
    .replace(
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/gi,
      REDACTED
    )
    .replace(
      /\b(authorization)\s*[:=]\s*bearer\s+[^\s,;]+/gi,
      `$1: ${REDACTED}`
    )
    .replace(/\b(cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi, `$1: ${REDACTED}`)
    .replace(
      /\b(password|passphrase|passwd|pwd|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|encryptedpassword|database[_-]?url|connection[_-]?string)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&\]]+)/gi,
      `$1: ${REDACTED}`
    )
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
      `$1$2:${REDACTED}@`
    );

  return Array.from(text)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        (codePoint >= 0x20 && codePoint !== 0x7f)
      );
    })
    .join('');
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
  redactDiagnostic,
  strictInt,
  FORBIDDEN_KEYS,
};
