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

const BOUND = Symbol.for('eternalghost.botEventsBound');

/**
 * Wire every mineflayer event handler for one connection onto the BotInstance.
 *
 * Every handler is wrapped so a malformed or malicious packet can never crash
 * the process: failures are logged generically and the connection is torn down
 * via bot.end(), and rejected promises are contained so they never unwind to
 * the Node.js event loop as unhandled rejections.
 */
function bindBotEvents(instance, bot) {
  if (bot[BOUND]) {
    botLog(instance.id, 'debug', 'bindBotEvents skipped - bot already bound.');
    return;
  }
  bot[BOUND] = true;

  const guard = makeGuard(instance, bot);

  bot.once(
    'login',
    guard('login', () =>
      botLog(instance.id, 'info', 'TCP login established. Waiting for spawn...')
    )
  );

  bot.once(
    'spawn',
    guard('spawn', () => {
      botLog(instance.id, 'info', 'Spawned in world.');
      instance._startTime = Date.now();
      instance._loginTimer = setTimeout(() => {
        if (instance.state === BOT_STATES.CONNECTING) {
          botLog(
            instance.id,
            'info',
            'No auth prompt received - assuming no-auth server.'
          );
          instance._transitionToPlaying();
        }
      }, NO_AUTH_TIMEOUT_MS);
    })
  );

  bot.on(
    'message',
    guard('message', (jsonMsg) => onServerMessage(instance, jsonMsg))
  );
  bot.on(
    'health',
    guard('health', () => onHealth(instance, bot))
  );
  bot.on(
    'death',
    guard('death', () => onDeath(instance, bot))
  );

  bot.on(
    'playerCollect',
    guard('playerCollect', (collector) => {
      if (collector?.username === bot.username && instance._sub?.inventory) {
        instance._sub.inventory.checkAndClean().catch(() => {});
      }
    })
  );

  bot.on(
    'error',
    guard(
      'error',
      (err) => {
        botLog(instance.id, 'error', `Bot error: ${err?.message ?? 'unknown'}`);
        instance.emit('botError', err);
      },
      { terminateOnError: false }
    )
  );

  bot.on(
    'kicked',
    guard('kicked', (reason) => {
      const msg =
        typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
      botLog(instance.id, 'warn', `Kicked: ${msg}`);
      instance._reconnect.handleDisconnect(`Kicked: ${msg}`);
    })
  );

  bot.on(
    'end',
    guard(
      'end',
      (reason) => {
        if (instance.state === BOT_STATES.OFFLINE) return;
        botLog(instance.id, 'warn', `Connection ended: ${reason}`);
        instance._reconnect.handleDisconnect(String(reason));
      },
      { terminateOnError: false }
    )
  );

  try {
    bot.loadPlugin(pathfinder);
  } catch (err) {
    botLog(instance.id, 'warn', `Pathfinder load failed: ${err.message}`);
  }
}

function makeGuard(instance, bot) {
  return (label, fn, opts = {}) => {
    const terminateOnError = opts.terminateOnError !== false;
    return (...args) => {
      try {
        const result = fn(...args);
        if (result && typeof result.then === 'function') {
          result.catch(() => {
            botLog(instance.id, 'error', `Async handler failure in "${label}"`);
            if (terminateOnError) safeEnd(bot);
          });
        }
      } catch {
        botLog(
          instance.id,
          'error',
          `Handler failure in "${label}"; terminating connection`
        );
        if (terminateOnError) safeEnd(bot);
      }
    };
  };
}

function safeEnd(bot) {
  try {
    bot.end();
  } catch {
    /* ignore */
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
      `Duplicate login detected. Backing off ${Math.round(delay / 1000)}s...`
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

  if (instance._sub?.combat) instance._sub.combat.stop();
  if (instance._sub?.antiAFK) instance._sub.antiAFK.stop();
  try {
    bot.pathfinder?.setGoal(null);
  } catch {
    /* ignore */
  }

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

  if (instance._respawnHandler) {
    try {
      bot.removeListener('spawn', instance._respawnHandler);
    } catch {
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
