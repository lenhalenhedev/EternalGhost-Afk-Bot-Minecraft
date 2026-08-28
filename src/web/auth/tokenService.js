const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');
const { publish } = require('../sse/eventHub');
const {
  daysToMilliseconds,
  validateTokenTtlDays,
  validateTokenTtlMs,
  toJwtExpiresInSeconds,
} = require('./tokenValidation');

const JWT_SECRET_ENV = 'ENCRYPTION_KEY';

function secret() {
  const value = process.env[JWT_SECRET_ENV];
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

function signToken(userId, ttlMs) {
  const validated = validateTokenTtlMs(ttlMs);
  if (!validated.valid) throw new Error(validated.reason);
  return jwt.sign({ userId: normalizeUserId(userId) }, secret(), {
    expiresIn: toJwtExpiresInSeconds(ttlMs),
  });
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
  const token = signToken(normalizedUserId, ttlMs);
  const tokenHash = hashToken(token);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlMs);

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
    token,
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

  const expiresAt = calculateRenewedExpiry(rows[0].expires_at, addedDays);
  const ttlMs = expiresAt.getTime() - Date.now();
  if (ttlMs < 1_000)
    throw new Error(
      'Renewal duration must leave at least one second of token lifetime.'
    );

  const token = signToken(normalizedUserId, ttlMs);
  const tokenHash = hashToken(token);
  const issuedAt = new Date();
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
  return { token, metadata: tokenMetadata(result.rows[0]) };
}

async function verifyActiveToken(token) {
  if (typeof token !== 'string' || token.length < 20) {
    throw new Error('Invalid token.');
  }
  let payload;
  try {
    payload = jwt.verify(token, secret());
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
