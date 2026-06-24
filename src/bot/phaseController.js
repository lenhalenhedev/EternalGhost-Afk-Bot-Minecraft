'use strict';

const { BOT_STATES } = require('./states');
const { botLog } = require('../services/logger');

// Grace period after spawn/auth before anti-AFK wandering begins. Lets the
// world finish loading so the bot doesn't path through unloaded chunks.
const SETTLE_BEFORE_AFK_MS = 3_000;

/**
 * Lifecycle phase transitions for a BotInstance.
 *
 * Extracted from BotInstance so the orchestrator owns only construction and the
 * public command surface, while the (cross-subsystem) PLAYING -> AFK <-> COMBAT
 * choreography lives here in one place (single responsibility). Each function
 * receives the instance explicitly, matching the pattern used by
 * `connection/botEventBinder` and `connection/reconnectPolicy`.
 */

/** Healthy connection reached PLAYING: reset backoff, start subsystems, settle. */
function transitionToPlaying(instance) {
  clearTimeout(instance._loginTimer);
  instance._reconnect.resetAttempts(); // healthy connection – reset backoff counter
  instance._setState(BOT_STATES.PLAYING);
  botLog(instance.id, 'info', `PLAYING. Settling ${SETTLE_BEFORE_AFK_MS / 1000}s before AFK\u2026`);

  instance._sub.startPlaying(instance._bot, (event, ...args) => instance.emit(event, ...args));

  // Tracked so a stop()/disconnect during the settle window cancels it instead
  // of leaving a dangling timer that fires after teardown.
  clearTimeout(instance._settleTimer);
  instance._settleTimer = setTimeout(() => transitionToAFK(instance), SETTLE_BEFORE_AFK_MS);
}

/** Begin anti-AFK + combat scanning once settled (no-op if torn down). */
function transitionToAFK(instance) {
  // Clear the settle timer that may have scheduled this call. Combined with the
  // idempotent startAFK below, this guarantees no duplicate path (e.g. respawn
  // handler + a stale settle timer) can spin up two subsystem sets.
  clearTimeout(instance._settleTimer);
  instance._settleTimer = null;

  if (instance._state === BOT_STATES.OFFLINE || instance._state === BOT_STATES.DISCONNECTED) return;
  if (!instance._bot) return;

  instance._setState(BOT_STATES.AFK);
  // startAFK is idempotent: it stops any previous antiAFK/combat before creating
  // new ones, so even a redundant call here cannot leak interval timers.
  instance._sub.startAFK(instance._bot, (event, ...args) => handleCombatEvent(instance, event, ...args));
  botLog(instance.id, 'info', 'Entered AFK mode.');
  instance.emit('afkStarted');
}

/** Route combat subsystem events into state transitions + outward emits. */
function handleCombatEvent(instance, event, ...args) {
  if (event === 'combatStart') {
    instance._setState(BOT_STATES.COMBAT);
    instance._sub.enterCombat();
    instance.emit('combatStart', ...args);
  } else if (event === 'combatEnd') {
    if (instance._state === BOT_STATES.COMBAT) instance._setState(BOT_STATES.AFK);
    instance._sub.exitCombat();
    instance.emit('combatEnd', ...args);
  } else {
    instance.emit(event, ...args);
  }
}

module.exports = { transitionToPlaying, transitionToAFK, handleCombatEvent, SETTLE_BEFORE_AFK_MS };
