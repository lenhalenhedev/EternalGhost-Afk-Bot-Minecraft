const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');
const config = require('../../config');
const { publish } = require('../sse/eventHub');
const {
  daysToMilliseconds,
  validateTokenTtlDays,
  validateTokenTtlMs,
  toJwtExpiresInSeconds,
  MIN_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
} = require('./tokenValidation');

function secret() {
  // Prefer a dedicated WEB_JWT_SECRET so session signing is independent of the
  // encryption key. When an operator has not yet set it we fall back to
  // ENCRYPTION_KEY for backward compatibility; config.web.jwtSecretUsesFallback
  // records that state so index.js can emit a startup warning (EG-006).
  const value = config.web.jwtSecret;
  if (!value) throw new Error('Token signing key is not configured.');
  return value;
}

function normalizeUserId(userId) {
  const value = String(userId ?? '').trim();
  if (!/^\d{2,32}$/.test(value)) {
    throw new Error('A valid Discord User ID is required.');
  }
  return value;
}

function hashToken(token) {
  return crypto
    .createHash('sha256')
    .update(String(token), 'utf8')
    .digest('hex');
}

/** Floor a millisecond timestamp to a whole second (JWT `iat`/`exp` granularity). */
function toWholeSecond(ms) {
  return Math.floor(ms / 1_000) * 1_000;
}

/**
 * Sign a dashboard token.
 *
 * EG-002: the payload used to contain only `userId` plus library-generated
 * second-resolution timestamps, so two reissues for the same user and TTL
 * inside one Unix second produced a byte-identical token and therefore an
 * identical `token_hash`. The UPSERT "rotated" the credential without
 * invalidating the previous bearer. Every issuance now carries a random `jti`
 * and an explicitly computed whole-second `iat`/`exp` pair.
 */
function buildSignedToken(userId, ttlMs, options = {}) {
  const validated = validateTokenTtlMs(ttlMs);
  if (!validated.valid) throw new Error(validated.reason);
  const normalizedUserId = normalizeUserId(userId);
  const issuedAtMs = toWholeSecond(options.issuedAtMs ?? Date.now());
  const expiresAtMs = issuedAtMs + validated.value;
  const jti = options.jti || crypto.randomUUID();
  // jsonwebtoken derives `exp` from `payload.iat` when it is present, so
  // supplying the canonical issued-at second pins both claims exactly and
  // removes any race with the wall clock between signing and persisting.
  const token = jwt.sign(
    { userId: normalizedUserId, jti, iat: issuedAtMs / 1_000 },
    secret(),
    {
      algorithm: 'HS256',
      expiresIn: toJwtExpiresInSeconds(validated.value),
    }
  );
  return {
    token,
    jti,
    issuedAt: new Date(issuedAtMs),
    expiresAt: new Date(expiresAtMs),
  };
}

function signToken(userId, ttlMs, options = {}) {
  return buildSignedToken(userId, ttlMs, options).token;
}

function calculateRenewedExpiry(currentExpiry, addedDays, now = new Date()) {
  const validation = validateTokenTtlDays(addedDays);
  if (!validation.valid) throw new Error(validation.reason);
  const expiry = new Date(currentExpiry);
  const current = new Date(now);
  if (Number.isNaN(expiry.getTime()) || Number.isNaN(current.getTime())) {
    throw new Error('Token expiry dates must be valid.');
  }
  const capped = new Date(current);
  capped.setUTCFullYear(capped.getUTCFullYear() + 1);
  const renewed = new Date(expiry.getTime() + daysToMilliseconds(addedDays));
  return renewed < capped ? renewed : capped;
}

async function issueToken(userId, ttlMs) {
  const normalizedUserId = normalizeUserId(userId);
  const issued = buildSignedToken(normalizedUserId, ttlMs);
  const tokenHash = hashToken(issued.token);
  const issuedAt = issued.issuedAt;
  const expiresAt = issued.expiresAt;

  const { rows } = await db.withTransaction((client) =>
    client.query(
      `INSERT INTO web_tokens (user_id, token_hash, issued_at, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         token_hash = EXCLUDED.token_hash,
         issued_at = EXCLUDED.issued_at,
         expires_at = EXCLUDED.expires_at
       RETURNING user_id, issued_at, expires_at`,
      [normalizedUserId, tokenHash, issuedAt, expiresAt]
    )
  );

  publish('auth:revoked', { userId: normalizedUserId });
  return {
    token: issued.token,
    metadata: tokenMetadata(rows[0]),
  };
}

async function issueTokenDays(userId, days) {
  return issueToken(userId, daysToMilliseconds(days));
}

async function renewToken(userId, addedDays) {
  const normalizedUserId = normalizeUserId(userId);
  const validation = validateTokenTtlDays(addedDays);
  if (!validation.valid) throw new Error(validation.reason);

  const { rows } = await db.query(
    `SELECT user_id, expires_at
       FROM web_tokens
      WHERE user_id = $1`,
    [normalizedUserId]
  );
  if (rows.length === 0) throw new Error('Token not found.');

  const renewed = calculateRenewedExpiry(rows[0].expires_at, addedDays);

  // EG-002: the stored expiry carries millisecond precision from PostgreSQL
  // while JWT `exp` is whole-second, so the raw difference used to fail the
  // `% 1000` TTL validation and renewals rejected their own calculated TTL.
  // Both ends are now canonicalised to whole seconds and clamped to the
  // supported TTL range, so a valid stored session always renews.
  const issuedAtMs = toWholeSecond(Date.now());
  const ttlMs = Math.min(
    Math.max(toWholeSecond(renewed.getTime()) - issuedAtMs, 0),
    MAX_TOKEN_TTL_MS
  );
  if (ttlMs < MIN_TOKEN_TTL_MS)
    throw new Error(
      'Renewal duration must leave at least one second of token lifetime.'
    );

  const issued = buildSignedToken(normalizedUserId, ttlMs, { issuedAtMs });
  const tokenHash = hashToken(issued.token);
  const issuedAt = issued.issuedAt;
  const expiresAt = issued.expiresAt;
  const result = await db.withTransaction((client) =>
    client.query(
      `UPDATE web_tokens
          SET token_hash = $2, issued_at = $3, expires_at = $4
        WHERE user_id = $1
      RETURNING user_id, issued_at, expires_at`,
      [normalizedUserId, tokenHash, issuedAt, expiresAt]
    )
  );
  publish('auth:revoked', { userId: normalizedUserId });
  return { token: issued.token, metadata: tokenMetadata(result.rows[0]) };
}

async function verifyActiveToken(token) {
  if (typeof token !== 'string' || token.length < 20) {
    throw new Error('Invalid token.');
  }
  let payload;
  try {
    // Pin the expected algorithm family. Tokens are HMAC-signed with a string
    // secret; never let a future refactor or a permissive library accept a
    // different algorithm for the same key material (EG-007).
    payload = jwt.verify(token, secret(), { algorithms: ['HS256'] });
  } catch {
    throw new Error('Invalid or expired token.');
  }
  const userId = normalizeUserId(payload?.userId);
  const { rows } = await db.query(
    `SELECT user_id, issued_at, expires_at
       FROM web_tokens
      WHERE user_id = $1
        AND token_hash = $2
        AND expires_at > now()`,
    [userId, hashToken(token)]
  );
  if (rows.length === 0) throw new Error('Token has been revoked.');
  return { userId, issuedAt: rows[0].issued_at, expiresAt: rows[0].expires_at };
}

async function revokeToken(userId) {
  const normalizedUserId = normalizeUserId(userId);
  const result = await db.query(
    'DELETE FROM web_tokens WHERE user_id = $1 RETURNING user_id',
    [normalizedUserId]
  );
  if (result.rowCount > 0)
    publish('auth:revoked', { userId: normalizedUserId });
  return result.rowCount > 0;
}

async function listTokenMetadata() {
  const { rows } = await db.query(
    `SELECT t.user_id, t.issued_at, t.expires_at,
            COUNT(b.id)::int AS bot_count
       FROM web_tokens t
       LEFT JOIN bots b ON b.created_by = t.user_id
      GROUP BY t.user_id, t.issued_at, t.expires_at
      ORDER BY t.issued_at DESC`
  );
  return rows.map(tokenMetadata);
}

function tokenMetadata(row) {
  const expiresAt = new Date(row.expires_at);
  return {
    userId: row.user_id,
    status: expiresAt.getTime() > Date.now() ? 'active' : 'expired',
    issuedAt: new Date(row.issued_at).toISOString(),
    expiresAt: expiresAt.toISOString(),
    botCount: Number(row.bot_count || 0),
  };
}

module.exports = {
  hashToken,
  normalizeUserId,
  buildSignedToken,
  toWholeSecond,
  signToken,
  issueToken,
  issueTokenDays,
  renewToken,
  calculateRenewedExpiry,
  verifyActiveToken,
  revokeToken,
  listTokenMetadata,
  tokenMetadata,
};
