'use strict';

const mineflayer = require('mineflayer');
const { decrypt } = require('../../services/encryption');
const config = require('../../config');
const { logger, botLog } = require('../../services/logger');
const { strictInt, sanitizeForLog } = require('../../utils/security');
const { assertPublicDestination } = require('../../utils/validators');

const DEFAULT_VIEW_DISTANCE = 4;
const MIN_VIEW_DISTANCE = 2;
const MAX_VIEW_DISTANCE = 16;

function resolveViewDistance(botId) {
  const raw =
    process.env.MINECRAFT_VIEW_DISTANCE ?? config.limits?.viewDistance;
  const parsed = strictInt(raw, {
    min: MIN_VIEW_DISTANCE,
    max: MAX_VIEW_DISTANCE,
  });

  if (!parsed.valid) {
    const message = `Invalid viewDistance "${sanitizeForLog(raw)}", falling back to ${DEFAULT_VIEW_DISTANCE}`;
    if (botId) botLog(botId, 'warn', message);
    else logger.warn(message);
    return DEFAULT_VIEW_DISTANCE;
  }

  return parsed.value;
}

function decryptPassword(record) {
  if (!record.encryptedPassword) return '';
  const { plaintext } = decrypt(
    record.encryptedPassword,
    config.encryption.key,
    config.encryption.oldKey
  );
  return plaintext;
}

async function createMineflayerBot(
  record,
  { resolveDestination = assertPublicDestination } = {}
) {
  const destination = await resolveDestination(record.host, {
    allowPrivateIps: config.egress?.privateDestinationAllowlist || [],
  });
  return mineflayer.createBot({
    host: destination.address,
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
