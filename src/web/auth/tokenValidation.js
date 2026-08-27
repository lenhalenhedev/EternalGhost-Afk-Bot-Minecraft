const MIN_TOKEN_TTL_MS = 1_000;
const MAX_TOKEN_TTL_MS = Number.MAX_SAFE_INTEGER;

function validateTokenTtlMs(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_TOKEN_TTL_MS ||
    value > MAX_TOKEN_TTL_MS ||
    value % 1_000 !== 0
  ) {
    return {
      valid: false,
      reason:
        'Token expiry must be a safe integer in milliseconds, divisible by 1000, between 1000 and 9007199254740991.',
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
  MIN_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
  validateTokenTtlMs,
  toJwtExpiresInSeconds,
};
