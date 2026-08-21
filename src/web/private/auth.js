'use strict';

const crypto = require('node:crypto');

const SHA256_RE = /^[0-9a-f]{64}$/i;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 10;

function sha256Hex(value) {
  return crypto
    .createHash('sha256')
    .update(String(value), 'utf8')
    .digest('hex');
}

function isSha256Hex(value) {
  return typeof value === 'string' && SHA256_RE.test(value);
}

function timingSafeHashEqual(actual, expected) {
  if (!isSha256Hex(actual) || !isSha256Hex(expected)) return false;
  const actualBuffer = Buffer.from(actual.toLowerCase(), 'hex');
  const expectedBuffer = Buffer.from(expected.toLowerCase(), 'hex');
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function normaliseUsername(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createAuthService(options = {}) {
  const username = normaliseUsername(options.username);
  const passwordHash = normaliseUsername(options.passwordHash).toLowerCase();
  const sessionTtlMs = options.sessionTtlMs || DEFAULT_SESSION_TTL_MS;
  const loginWindowMs = options.loginWindowMs || DEFAULT_LOGIN_WINDOW_MS;
  const loginMaxAttempts =
    options.loginMaxAttempts || DEFAULT_LOGIN_MAX_ATTEMPTS;
  const now = options.now || (() => Date.now());
  const sessions = new Map();
  const failures = new Map();

  function prune() {
    const timestamp = now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= timestamp) sessions.delete(token);
    }
    for (const [key, entry] of failures) {
      if (entry.resetAt <= timestamp) failures.delete(key);
    }
  }

  function isRateLimited(clientKey) {
    const entry = failures.get(clientKey);
    return Boolean(
      entry && entry.resetAt > now() && entry.attempts >= loginMaxAttempts
    );
  }

  function recordFailure(clientKey) {
    const timestamp = now();
    const existing = failures.get(clientKey);
    if (!existing || existing.resetAt <= timestamp) {
      failures.set(clientKey, {
        attempts: 1,
        resetAt: timestamp + loginWindowMs,
      });
      return;
    }
    existing.attempts += 1;
  }

  function clearFailures(clientKey) {
    failures.delete(clientKey);
  }

  function login(credentials = {}, clientKey = 'unknown') {
    prune();
    const key = String(clientKey || 'unknown').slice(0, 128);
    if (isRateLimited(key)) return { ok: false, reason: 'rate_limited' };

    const suppliedUsername = normaliseUsername(credentials.username);
    const suppliedPassword =
      typeof credentials.password === 'string' ? credentials.password : '';
    const usernameMatches = suppliedUsername === username;
    const passwordMatches = timingSafeHashEqual(
      sha256Hex(suppliedPassword),
      passwordHash
    );
    if (!usernameMatches || !passwordMatches) {
      recordFailure(key);
      return { ok: false, reason: 'invalid_credentials' };
    }

    clearFailures(key);
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(24).toString('base64url');
    sessions.set(token, {
      token,
      username,
      csrfToken,
      createdAt: now(),
      expiresAt: now() + sessionTtlMs,
    });
    return { ok: true, token, csrfToken, expiresAt: now() + sessionTtlMs };
  }

  function getSession(token) {
    prune();
    if (typeof token !== 'string' || token.length < 32) return null;
    const session = sessions.get(token);
    return session ? { ...session } : null;
  }

  function isCsrfValid(session, csrfToken) {
    return Boolean(
      session &&
      typeof csrfToken === 'string' &&
      csrfToken.length === session.csrfToken.length &&
      crypto.timingSafeEqual(
        Buffer.from(csrfToken),
        Buffer.from(session.csrfToken)
      )
    );
  }

  function logout(token) {
    if (typeof token !== 'string') return false;
    return sessions.delete(token);
  }

  function clear() {
    sessions.clear();
    failures.clear();
  }

  return {
    login,
    getSession,
    isCsrfValid,
    logout,
    clear,
    get activeSessionCount() {
      prune();
      return sessions.size;
    },
  };
}

module.exports = {
  createAuthService,
  isSha256Hex,
  sha256Hex,
  timingSafeHashEqual,
};
