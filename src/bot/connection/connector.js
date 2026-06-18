'use strict';

const mineflayer = require('mineflayer');
const { decrypt } = require('../../services/encryption');
const config = require('../../config');

/**
 * Low-level connection helpers: turning a stored bot record into a live
 * mineflayer client and decrypting its credentials. Isolated from BotInstance
 * so the orchestrator stays free of mineflayer/crypto construction details.
 */

/**
 * Decrypt a record's stored password. Returns '' for offline (no-password)
 * servers. Throws if the ciphertext cannot be decrypted with the known keys.
 */
function decryptPassword(record) {
  if (!record.encryptedPassword) return '';
  const { plaintext } = decrypt(
    record.encryptedPassword,
    config.encryption.key,
    config.encryption.oldKey,
  );
  return plaintext;
}

/** Create a mineflayer bot for an offline-mode server from a record. */
function createMineflayerBot(record) {
  return mineflayer.createBot({
    host: record.host,
    port: record.port,
    username: record.username,
    version: record.version,
    auth: 'offline',
    hideErrors: false,
    checkTimeoutInterval: 30_000,
  });
}

module.exports = { decryptPassword, createMineflayerBot };
