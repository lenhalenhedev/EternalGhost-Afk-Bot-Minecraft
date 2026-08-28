'use strict';

const MIN_TOKEN_TTL_DAYS = 1;
const MAX_TOKEN_TTL_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1_000;
const MIN_TOKEN_TTL_MS = 1_000;
const MAX_TOKEN_TTL_MS = MAX_TOKEN_TTL_DAYS * MS_PER_DAY;

function validateTokenTtlDays(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_TOKEN_TTL_DAYS ||
    value > MAX_TOKEN_TTL_DAYS
  ) {
    return {
      valid: false,
      reason: `Token expiry must be a whole number of days between ${MIN_TOKEN_TTL_DAYS} and ${MAX_TOKEN_TTL_DAYS}.`,
    };
  }
  return { valid: true, value };
}

function daysToMilliseconds(days) {
  const result = validateTokenTtlDays(days);
  if (!result.valid) throw new Error(result.reason);
  return days * MS_PER_DAY;
}

function validateTokenTtlMs(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_TOKEN_TTL_MS ||
    value > MAX_TOKEN_TTL_MS ||
    value % 1_000 !== 0
  ) {
    return {
      valid: false,
      reason: `Token expiry must be a whole number of days between ${MIN_TOKEN_TTL_DAYS} and ${MAX_TOKEN_TTL_DAYS}.`,
    };
  }
  return { valid: true, value };
}

function toJwtExpiresInSeconds(ttlMs) {
  const result = validateTokenTtlMs(ttlMs);
  if (!result.valid) throw new Error(result.reason);
  return ttlMs / 1_000;
}

module.exports = {
  MIN_TOKEN_TTL_DAYS,
  MAX_TOKEN_TTL_DAYS,
  MIN_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
  validateTokenTtlDays,
  daysToMilliseconds,
  validateTokenTtlMs,
  toJwtExpiresInSeconds,
};
