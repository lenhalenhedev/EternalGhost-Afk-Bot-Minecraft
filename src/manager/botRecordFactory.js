'use strict';

const { v4: uuidv4 } = require('uuid');
const { encrypt } = require('../services/encryption');
const { validateBotConfig } = require('../utils/validators');
const config = require('../config');

/**
 * Builds and validates persisted bot records. Centralising this here keeps the
 * BotManager focused on orchestration and guarantees create and edit share the
 * exact same validation + encryption rules (DRY / single source of truth).
 */

/**
 * Validate inputs and build a fresh persisted bot record.
 * @throws if the configuration is invalid.
 */
function buildNewRecord(opts, createdBy) {
  const { host, port, username, password = '', version, autoReconnect = true } = opts;

  const validation = validateBotConfig({ host, port, username, version, password });
  if (!validation.valid) throw new Error(validation.errors.join(', '));

  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    host,
    port: parseInt(port, 10),
    username,
    encryptedPassword: password ? encrypt(password, config.encryption.key) : '',
    version,
    autoReconnect,
    wasRunning: false,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

/**
 * Validate a partial edit against the existing record and return the patch of
 * allowed fields to persist. Username is immutable. The merged config is
 * validated so partial edits cannot bypass checks.
 * @throws if the merged configuration is invalid.
 */
function buildEditPatch(record, patch) {
  const merged = {
    host: patch.host !== undefined ? patch.host : record.host,
    port: patch.port !== undefined ? patch.port : record.port,
    username: record.username,
    version: patch.version !== undefined ? patch.version : record.version,
    password: patch.password !== undefined ? patch.password : '',
  };
  const validation = validateBotConfig(merged);
  if (!validation.valid) throw new Error(validation.errors.join(', '));

  const allowed = { updatedAt: new Date().toISOString() };
  if (patch.host !== undefined) allowed.host = patch.host;
  if (patch.port !== undefined) allowed.port = parseInt(patch.port, 10);
  if (patch.version !== undefined) allowed.version = patch.version;
  if (patch.autoReconnect !== undefined) allowed.autoReconnect = !!patch.autoReconnect;
  if (patch.password !== undefined && patch.password !== '') {
    allowed.encryptedPassword = encrypt(patch.password, config.encryption.key);
  }
  return allowed;
}

module.exports = { buildNewRecord, buildEditPatch };
