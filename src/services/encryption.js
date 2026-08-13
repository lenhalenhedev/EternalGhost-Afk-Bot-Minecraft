'use strict';
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SEP = ':';
const VERSION = '1';
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;

function assertValidHexKey(hexKey) {
  if (typeof hexKey !== 'string' || !HEX_KEY_RE.test(hexKey)) {
    throw new Error(
      'Encryption key must be a 64-character hex string (32 bytes)'
    );
  }
}

function fingerprint(hexKey) {
  assertValidHexKey(hexKey);
  return crypto
    .createHash('sha256')
    .update(hexKey, 'hex')
    .digest('hex')
    .slice(0, 8);
}

function isEmptyPlaintext(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === '') {
    return true;
  }
  return Buffer.isBuffer(plaintext) && plaintext.length === 0;
}

function encrypt(plaintext, hexKey) {
  assertValidHexKey(hexKey);
  if (isEmptyPlaintext(plaintext)) return '';

  const data = Buffer.isBuffer(plaintext)
    ? Buffer.from(plaintext)
    : Buffer.from(String(plaintext), 'utf8');
  const key = Buffer.from(hexKey, 'hex');

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_LENGTH,
    });
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      fingerprint(hexKey),
      iv.toString('hex'),
      tag.toString('hex'),
      enc.toString('hex'),
    ].join(SEP);
  } catch (err) {
    throw new Error('Credential encryption failed', { cause: err });
  } finally {
    data.fill(0);
    key.fill(0);
  }
}

function decrypt(payload, currentKey, oldKey = null) {
  if (!payload) return { plaintext: '', rotationNeeded: false };
  assertValidHexKey(currentKey);
  if (oldKey) assertValidHexKey(oldKey);

  const parts = payload.split(SEP);
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('Invalid encrypted payload format');
  }

  const [, fp, ivHex, tagHex, cipherHex] = parts;

  if (fp === fingerprint(currentKey)) {
    return {
      plaintext: _decrypt(cipherHex, ivHex, tagHex, currentKey),
      rotationNeeded: false,
    };
  }

  if (oldKey && fp === fingerprint(oldKey)) {
    return {
      plaintext: _decrypt(cipherHex, ivHex, tagHex, oldKey),
      rotationNeeded: true,
    };
  }

  throw new Error(
    `No matching key for fingerprint "${fp}". Check ENCRYPTION_KEY / OLD_ENCRYPTION_KEY.`
  );
}

function _decrypt(cipherHex, ivHex, tagHex, hexKey) {
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const cipher = Buffer.from(cipherHex, 'hex');

  if (
    iv.length !== IV_LENGTH ||
    tag.length !== TAG_LENGTH ||
    cipher.length === 0
  ) {
    throw new Error('Invalid encrypted payload format');
  }

  const key = Buffer.from(hexKey, 'hex');
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cipher), decipher.final()]).toString(
      'utf8'
    );
  } finally {
    key.fill(0);
  }
}

function needsRotation(payload, currentKey) {
  if (!payload) return false;
  const parts = payload.split(SEP);
  if (parts.length !== 5) return false;
  return parts[1] !== fingerprint(currentKey);
}

module.exports = { encrypt, decrypt, needsRotation, fingerprint };
