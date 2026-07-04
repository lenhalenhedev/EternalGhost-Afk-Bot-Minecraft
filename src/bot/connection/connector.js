'use strict';

const mineflayer = require('mineflayer');
const { decrypt } = require('../../services/encryption');
const config = require('../../config');
const { logger, botLog } = require('../../services/logger');

const DEFAULT_VIEW_DISTANCE = 4;
const MIN_VIEW_DISTANCE = 2;
const MAX_VIEW_DISTANCE = 16;

function resolveViewDistance(botId) {
  const raw = process.env.MINECRAFT_VIEW_DISTANCE ?? config.limits?.viewDistance;
  const parsed = parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < MIN_VIEW_DISTANCE || parsed > MAX_VIEW_DISTANCE) {
    const message = `Invalid viewDistance "${raw}", falling back to ${DEFAULT_VIEW_DISTANCE}`;
    if (botId) botLog(botId, 'warn', message);
    else logger.warn(message);
    return DEFAULT_VIEW_DISTANCE;
  }

  return parsed;
}

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
    config.encryption.oldKey
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
    viewDistance: resolveViewDistance(record.id),
  });
}

module.exports = { decryptPassword, createMineflayerBot };
