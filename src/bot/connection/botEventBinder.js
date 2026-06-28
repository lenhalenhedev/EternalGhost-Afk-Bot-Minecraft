'use strict';
const { pathfinder } = require('mineflayer-pathfinder');
const { BOT_STATES } = require('../states');
const authPatterns = require('../auth/authPatterns');
const { botLog, checkAlertCooldown } = require('../../services/logger');
const { formatPos, randInt } = require('../../utils/helpers');

const NO_AUTH_TIMEOUT_MS = 8_000;
const DUP_LOGIN_MIN_MS = 60_000;
const DUP_LOGIN_MAX_MS = 120_000;
const DAMAGE_EPSILON = 0.5;

// Marker so the same mineflayer bot is never wired twice. Each reconnect builds
// a fresh bot (old one is removeAllListeners'd in BotInstance._connect), but this
// guard makes double-binding impossible even if bindBotEvents is called again.
//
// FIX: Using a module-scoped Symbol.for ensures the marker is consistent even
// if this module is somehow loaded multiple times (e.g., different require paths).
const BOUND = Symbol.for('eternalghost.botEventsBound');

/**
 * Wire every mineflayer event handler for one connection onto the BotInstance.
 *
 * MEMORY LEAK FIXES:
 * - Idempotent binding via BOUND symbol prevents listener accumulation
 * - The old bot's listeners are removed in BotInstance._connect() before this
 *   is called, so we never have stale listeners on a dead connection
 * - Death handler uses bot.once('spawn') with explicit removal tracking to
 *   prevent respawn handler stacking
 * - All event handlers use arrow functions bound to the specific instance/bot
 *   pair, so they don't retain references to previous connections
 */
function bindBotEvents(instance, bot) {
  if (bot[BOUND]) {
    botLog(instance.id, 'debug', 'bindBotEvents skipped – bot already bound.');
    return;
  }
  bot[BOUND] = true;

  bot.once('login', () =>
    botLog(instance.id, 'info', 'TCP login established. Waiting for spawn…')
  );

  bot.once('spawn', () => {
    botLog(instance.id, 'info', 'Spawned in world.');
    instance._startTime = Date.now();
    instance._loginTimer = setTimeout(() => {
      if (instance.state === BOT_STATES.CONNECTING) {
        botLog(
          instance.id,
          'info',
          'No auth prompt received – assuming no-auth server.'
        );
        instance._transitionToPlaying();
      }
    }, NO_AUTH_TIMEOUT_MS);
  });

  bot.on('message', (jsonMsg) => onServerMessage(instance, jsonMsg));
  bot.on('health', () => onHealth(instance, bot));
  bot.on('death', () => onDeath(instance, bot));

  bot.on('playerCollect', (collector) => {
    if (collector?.username === bot.username && instance._sub?.inventory) {
      instance._sub.inventory.checkAndClean().catch(() => {});
    }
  });

  bot.on('error', (err) => {
    botLog(instance.id, 'error', `Bot error: ${err.message}`);
    instance.emit('botError', err);
  });

  bot.on('kicked', (reason) => {
    const msg =
      typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
    botLog(instance.id, 'warn', `Kicked: ${msg}`);
    instance._reconnect.handleDisconnect(`Kicked: ${msg}`);
  });

  bot.on('end', (reason) => {
    if (instance.state === BOT_STATES.OFFLINE) return;
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
    botLog(
      instance.id,
      'warn',
      `Duplicate login detected. Backing off ${Math.round(delay / 1000)}s…`
    );
    instance
      ._destroyBot('duplicate login')
      .then(() => instance._reconnect.reconnectAfter(delay))
      .catch(() => {});
    return;
  }

  if (state === BOT_STATES.CONNECTING && authPatterns.isAuthPrompt(msg)) {
    clearTimeout(instance._loginTimer);
    instance._setState(BOT_STATES.AUTHENTICATING);
    instance._auth
      .authenticate(msg)
      .catch((err) =>
        botLog(instance.id, 'error', `Auth error: ${err.message}`)
      );
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

  if (
    state === BOT_STATES.AUTHENTICATING &&
    bot.health > 0 &&
    instance._auth.loginSent
  ) {
    botLog(instance.id, 'info', 'Auth success via health event.');
    instance._auth.onSuccess();
    return;
  }

  if (
    state !== BOT_STATES.PLAYING &&
    state !== BOT_STATES.AFK &&
    state !== BOT_STATES.COMBAT
  )
    return;
  instance.emit('healthUpdate', { health: bot.health, food: bot.food });

  if (bot.health <= 0) {
    instance._lastHealthTick = bot.health;
    return;
  }

  if (
    instance._lastHealthTick > 0 &&
    bot.health < instance._lastHealthTick - DAMAGE_EPSILON
  ) {
    if (instance._sub?.combat) instance._sub.combat.onAttacked();
  }
  instance._lastHealthTick = bot.health;
}

function onDeath(instance, bot) {
  botLog(instance.id, 'warn', `Bot died (HP=${bot.health}).`);

  // Stop combat + anti-AFK ticking immediately
  if (instance._sub?.combat) instance._sub.combat.stop();
  if (instance._sub?.antiAFK) instance._sub.antiAFK.stop();
  try {
    bot.pathfinder?.setGoal(null);
  } catch (_) {
    /* ignore */
  }

  // FIX: Clear the settle timer to prevent orphaned timers from double-firing
  // transitionToAFK after respawn.
  clearTimeout(instance._settleTimer);
  instance._settleTimer = null;
  instance._setState(BOT_STATES.PLAYING);

  if (checkAlertCooldown(`${instance.id}:death`)) {
    instance.emit(
      'alert',
      'death',
      `Bot died at ${formatPos(bot.entity?.position)}`
    );
  }

  // FIX: Single respawn handler with explicit removal of any previous one.
  // This prevents handler stacking when the bot dies multiple times before
  // respawning (each death would add another 'spawn' listener without this).
  if (instance._respawnHandler) {
    try {
      bot.removeListener('spawn', instance._respawnHandler);
    } catch (_) {
      /* ignore */
    }
    instance._respawnHandler = null;
  }

  const onRespawn = () => {
    instance._respawnHandler = null;
    instance._transitionToAFK();
  };
  instance._respawnHandler = onRespawn;
  bot.once('spawn', onRespawn);
}

module.exports = { bindBotEvents };
