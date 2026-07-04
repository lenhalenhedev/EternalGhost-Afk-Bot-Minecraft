'use strict';

const { BOT_STATES } = require('./states');
const { botLog } = require('../services/logger');

const SETTLE_BEFORE_AFK_MS = 3_000;

function subsystemConfig(instance) {
  const record = instance.record || {};
  return {
    antiAfk: record.antiAfk,
    autoEat: record.autoEat,
    combat: record.combat,
  };
}

function transitionToPlaying(instance) {
  clearTimeout(instance._loginTimer);
  instance._reconnect.resetAttempts();
  instance._setState(BOT_STATES.PLAYING);
  botLog(
    instance.id,
    'info',
    `PLAYING. Settling ${SETTLE_BEFORE_AFK_MS / 1000}s before AFK\u2026`
  );

  instance._sub.startPlaying(
    instance._bot,
    (event, ...args) => instance.emit(event, ...args),
    subsystemConfig(instance)
  );

  clearTimeout(instance._settleTimer);
  instance._settleTimer = setTimeout(
    () => transitionToAFK(instance),
    SETTLE_BEFORE_AFK_MS
  );
}

function transitionToAFK(instance) {
  clearTimeout(instance._settleTimer);
  instance._settleTimer = null;

  if (
    instance._state === BOT_STATES.OFFLINE ||
    instance._state === BOT_STATES.DISCONNECTED
  )
    return;
  if (!instance._bot) return;

  instance._setState(BOT_STATES.AFK);
  instance._sub.startAFK(
    instance._bot,
    (event, ...args) => handleCombatEvent(instance, event, ...args),
    subsystemConfig(instance)
  );
  botLog(instance.id, 'info', 'Entered AFK mode.');
  instance.emit('afkStarted');
}

function handleCombatEvent(instance, event, ...args) {
  if (event === 'combatStart') {
    instance._setState(BOT_STATES.COMBAT);
    instance._sub.enterCombat();
    instance.emit('combatStart', ...args);
  } else if (event === 'combatEnd') {
    if (instance._state === BOT_STATES.COMBAT)
      instance._setState(BOT_STATES.AFK);
    instance._sub.exitCombat();
    instance.emit('combatEnd', ...args);
  } else {
    instance.emit(event, ...args);
  }
}

module.exports = {
  transitionToPlaying,
  transitionToAFK,
  handleCombatEvent,
  SETTLE_BEFORE_AFK_MS,
};
