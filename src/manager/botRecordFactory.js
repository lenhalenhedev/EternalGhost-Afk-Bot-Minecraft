'use strict';

const { v4: uuidv4 } = require('uuid');
const { encrypt } = require('../services/encryption');
const { validateBotConfig, validatePort } = require('../utils/validators');
const { assertNoPollutingKeys } = require('../utils/security');
const config = require('../config');

/**
 * Builds and validates persisted bot records. Centralising this here keeps the
 * BotManager focused on orchestration and guarantees create and edit share the
 * exact same validation, encryption, and hardening rules.
 */

const DEFAULT_ANTIAFK = Object.freeze({
  enabled: true,
  minRadius: 5,
  maxRadius: 10,
  minInterval: 5000,
  maxInterval: 15000,
  maxRetries: 3,
  moveTimeout: 20000,
  stuckTimeout: 12000,
  rotationInterval: 3000,
});

const DEFAULT_AUTOEAT = Object.freeze({
  enabled: true,
  eatThreshold: 14,
  eatCooldown: 1500,
  checkInterval: 3000,
});

const DEFAULT_COMBAT = Object.freeze({
  enabled: true,
  scanRange: 15,
  engageRange: 4,
  maxCombatDuration: 12000,
  retreatHpPct: 0.3,
  scanInterval: 1000,
  attackInterval: 600,
  invisibleTimeout: 3000,
});

function encryptCredential(password) {
  if (password === undefined || password === null || password === '') {
    return '';
  }
  const buffer = Buffer.from(String(password), 'utf8');
  try {
    return encrypt(buffer, config.encryption.key);
  } finally {
    buffer.fill(0);
  }
}

function buildNewRecord(opts, createdBy, createdInGuild = null) {
  assertNoPollutingKeys(opts, 'createBot');

  const {
    host,
    port,
    username,
    password = '',
    version,
    autoReconnect = true,
  } = opts;

  if (typeof autoReconnect !== 'boolean') {
    throw new Error('autoReconnect must be a boolean');
  }

  const validation = validateBotConfig({
    host,
    port,
    username,
    version,
    password,
  });
  if (!validation.valid) throw new Error(validation.errors.join(', '));

  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    host,
    port: validatePort(port).value,
    username,
    encryptedPassword: encryptCredential(password),
    version,
    autoReconnect,
    wasRunning: false,
    hidden: false,
    createdAt: now,
    updatedAt: now,
    createdBy,
    createdInGuild,
    antiAfk: { ...DEFAULT_ANTIAFK },
    autoEat: { ...DEFAULT_AUTOEAT },
    combat: { ...DEFAULT_COMBAT },
  };
}

function buildEditPatch(record, patch) {
  assertNoPollutingKeys(patch, 'editBot');

  const passwordProvided =
    Object.prototype.hasOwnProperty.call(patch, 'password') &&
    patch.password !== undefined &&
    patch.password !== null;

  const merged = {
    host: patch.host !== undefined ? patch.host : record.host,
    port: patch.port !== undefined ? patch.port : record.port,
    username: record.username,
    version: patch.version !== undefined ? patch.version : record.version,
  };
  if (passwordProvided) merged.password = patch.password;

  const validation = validateBotConfig(merged);
  if (!validation.valid) throw new Error(validation.errors.join(', '));

  const allowed = { updatedAt: new Date().toISOString() };

  if (patch.host !== undefined) allowed.host = patch.host;
  if (patch.port !== undefined) allowed.port = validatePort(patch.port).value;
  if (patch.version !== undefined) allowed.version = patch.version;

  if (patch.autoReconnect !== undefined) {
    if (typeof patch.autoReconnect !== 'boolean') {
      throw new Error('autoReconnect must be a boolean');
    }
    allowed.autoReconnect = patch.autoReconnect;
  }

  if (passwordProvided && merged.password !== '') {
    allowed.encryptedPassword = encryptCredential(merged.password);
  }

  return allowed;
}

module.exports = {
  buildNewRecord,
  buildEditPatch,
  DEFAULT_ANTIAFK,
  DEFAULT_AUTOEAT,
  DEFAULT_COMBAT,
};
