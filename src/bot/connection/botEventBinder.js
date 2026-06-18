'use strict';

const { pathfinder } = require('mineflayer-pathfinder');
const { BOT_STATES } = require('../states');
const authPatterns = require('../auth/authPatterns');
const { botLog, checkAlertCooldown } = require('../../services/logger');
const { formatPos, randInt } = require('../../utils/helpers');

const NO_AUTH_TIMEOUT_MS = 8_000; // assume no-auth server if no prompt arrives
const DUP_LOGIN_MIN_MS = 60_000;
const DUP_LOGIN_MAX_MS = 120_000;
const DAMAGE_EPSILON = 0.5; // ignore sub-half-heart HP jitter

/**
 * Wire every mineflayer event handler for one connection onto the BotInstance.
 *
 * Extracted from BotInstance so the orchestrator only owns state, while this
 * module owns the (large, side-effect-heavy) protocol event surface.
 *
 * @param {import('../BotInstance')} instance
 * @param {object} bot mineflayer bot
 */
function bindBotEvents(instance, bot) {
  bot.once('login', () => botLog(instance.id, 'info', 'TCP login established. Waiting for spawn…'));

  bot.once('spawn', () => {
    botLog(instance.id, 'info', 'Spawned in world.');
    instance._startTime = Date.now();
    instance._loginTimer = setTimeout(() => {
      if (instance.state === BOT_STATES.CONNECTING) {
        botLog(instance.id, 'info', 'No auth prompt received – assuming no-auth server.');
        instance._transitionToPlaying();
      }
    }, NO_AUTH_TIMEOUT_MS);
  });

  bot.on('message', (jsonMsg) => onServerMessage(instance, jsonMsg));
  bot.on('health', () => onHealth(instance, bot)); // single merged handler
  bot.on('death', () => onDeath(instance, bot));

  bot.on('playerCollect', (collector) => {
    if (collector?.username === bot.username && instance._sub.inventory) {
      instance._sub.inventory.checkAndClean().catch(() => {});
    }
  });

  bot.on('error', (err) => {
    botLog(instance.id, 'error', `Bot error: ${err.message}`);
    instance.emit('botError', err);
  });

  bot.on('kicked', (reason) => {
    const msg = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
    botLog(instance.id, 'warn', `Kicked: ${msg}`);
    instance._reconnect.handleDisconnect(`Kicked: ${msg}`);
  });

  bot.on('end', (reason) => {
    if (instance.state === BOT_STATES.OFFLINE) return; // expected: manual stop
    botLog(instance.id, 'warn', `Connection ended: ${reason}`);
    instance._reconnect.handleDisconnect(String(reason));
  });

  try {
    bot.loadPlugin(pathfinder);
  } catch (err) {
    botLog(instance.id, 'warn', `Pathfinder load failed: ${err.message}`);
  }
}

function onServerMessage(instance, jsonMsg) {
  const msg = jsonMsg.toString().trim();
  if (!msg) return;
  const state = instance.state;

  if (state === BOT_STATES.CONNECTING || state === BOT_STATES.AUTHENTICATING) {
    botLog(instance.id, 'debug', `[server] ${msg}`);
  }

  if (state === BOT_STATES.CONNECTING && authPatterns.isDuplicateLogin(msg)) {
    const delay = randInt(DUP_LOGIN_MIN_MS, DUP_LOGIN_MAX_MS);
    botLog(instance.id, 'warn', `Duplicate login detected. Backing off ${Math.round(delay / 1000)}s…`);
    instance
      ._destroyBot('duplicate login')
      .then(() => instance._reconnect.reconnectAfter(delay))
      .catch(() => {});
    return;
  }

  if (state === BOT_STATES.CONNECTING && authPatterns.isAuthPrompt(msg)) {
    clearTimeout(instance._loginTimer);
    instance._setState(BOT_STATES.AUTHENTICATING);
    instance._auth.authenticate(msg).catch((err) => botLog(instance.id, 'error', `Auth error: ${err.message}`));
    return;
  }

  if (state === BOT_STATES.AUTHENTICATING && authPatterns.isAuthSuccess(msg)) {
    botLog(instance.id, 'info', `Auth success via message: "${msg}"`);
    instance._auth.onSuccess();
    return;
  }

  if (state === BOT_STATES.AUTHENTICATING && authPatterns.isAuthHardFail(msg)) {
    instance._auth.onHardFail(msg);
  }
}

function onHealth(instance, bot) {
  const state = instance.state;

  // Fallback: many AuthMe servers grant HP without a textual confirmation.
  // Only trust this AFTER a /login was actually sent, to avoid false positives.
  if (state === BOT_STATES.AUTHENTICATING && bot.health > 0 && instance._auth.loginSent) {
    botLog(instance.id, 'info', 'Auth success via health event.');
    instance._auth.onSuccess();
    return;
  }

  if (state !== BOT_STATES.PLAYING && state !== BOT_STATES.AFK && state !== BOT_STATES.COMBAT) return;

  instance.emit('healthUpdate', { health: bot.health, food: bot.food });

  if (instance._lastHealthTick > 0 && bot.health < instance._lastHealthTick - DAMAGE_EPSILON) {
    if (instance._sub.combat) instance._sub.combat.onAttacked();
  }
  instance._lastHealthTick = bot.health;
}

function onDeath(instance, bot) {
  botLog(instance.id, 'warn', `Bot died (HP=${bot.health}).`);
  if (instance._sub.combat) instance._sub.combat.stop();
  if (instance._sub.antiAFK) instance._sub.antiAFK.stop();
  instance._setState(BOT_STATES.PLAYING);
  if (checkAlertCooldown(`${instance.id}:death`)) {
    instance.emit('alert', 'death', `Bot died at ${formatPos(bot.entity?.position)}`);
  }
  bot.once('spawn', () => instance._transitionToAFK());
}

module.exports = { bindBotEvents };
