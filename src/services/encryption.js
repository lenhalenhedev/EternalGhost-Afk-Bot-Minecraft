'use strict';
const crypto = require('crypto');

const ALGORITHM    = 'aes-256-gcm';
const IV_LENGTH    = 12;   // 96-bit IV is optimal for GCM
const TAG_LENGTH   = 16;   // 128-bit auth tag
const SEP          = ':';
const VERSION      = '1';  // format version prefix for future migrations

/**
 * Derive a short fingerprint from a hex key so we can detect which key
 * was used to encrypt a payload – enables key rotation without storing
 * the key itself.
 */
function fingerprint(hexKey) {
  return crypto.createHash('sha256').update(hexKey, 'hex').digest('hex').slice(0, 8);
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Output format: `v1:<fp>:<ivHex>:<tagHex>:<cipherHex>`
 *
 * @param {string} plaintext
 * @param {string} hexKey  – 64-char hex key (32 bytes)
 * @returns {string} encrypted payload
 */
function encrypt(plaintext, hexKey) {
  if (!plaintext) return '';
  const key = Buffer.from(hexKey, 'hex');
  const iv  = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, fingerprint(hexKey), iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(SEP);
}

/**
 * Decrypt an encrypted payload.
 * Tries currentKey first; if the fingerprint doesn't match, tries oldKey (rotation).
 *
 * @param {string} payload   – output of encrypt()
 * @param {string} currentKey
 * @param {string|null} oldKey
 * @returns {{ plaintext: string, rotationNeeded: boolean }}
 */
function decrypt(payload, currentKey, oldKey = null) {
  if (!payload) return { plaintext: '', rotationNeeded: false };

  const parts = payload.split(SEP);
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('Invalid encrypted payload format');
  }

  const [, fp, ivHex, tagHex, cipherHex] = parts;

  const currentFp = fingerprint(currentKey);
  if (fp === currentFp) {
    return { plaintext: _decrypt(cipherHex, ivHex, tagHex, currentKey), rotationNeeded: false };
  }

  if (oldKey) {
    const oldFp = fingerprint(oldKey);
    if (fp === oldFp) {
      return { plaintext: _decrypt(cipherHex, ivHex, tagHex, oldKey), rotationNeeded: true };
    }
  }

  throw new Error(`No matching key for fingerprint "${fp}". Check ENCRYPTION_KEY / OLD_ENCRYPTION_KEY.`);
}

function _decrypt(cipherHex, ivHex, tagHex, hexKey) {
  const key      = Buffer.from(hexKey, 'hex');
  const iv       = Buffer.from(ivHex, 'hex');
  const tag      = Buffer.from(tagHex, 'hex');
  const cipher   = Buffer.from(cipherHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8');
}

/**
 * Check whether a stored payload needs re-encryption under the current key.
 */
function needsRotation(payload, currentKey) {
  if (!payload) return false;
  const parts = payload.split(SEP);
  if (parts.length !== 5) return false;
  return parts[1] !== fingerprint(currentKey);
}

module.exports = { encrypt, decrypt, needsRotation, fingerprint };
