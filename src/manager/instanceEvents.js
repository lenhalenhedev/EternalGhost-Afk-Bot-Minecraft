'use strict';

const Persistence = require('./Persistence');
const { BOT_STATES } = require('../bot/states');
const { checkAlertCooldown } = require('../services/logger');

/** True when a state means the bot should be considered "running" for persistence. */
function isRunningState(state) {
  return state !== BOT_STATES.OFFLINE && state !== BOT_STATES.DISCONNECTED;
}

/**
 * Wire a BotInstance's events to persistence and Discord notifications.
 * Extracted from BotManager so event-routing is testable and isolated.
 */
function attachInstanceEvents(instance, notifier) {
  instance.on('stateChange', (_old, newState) => {
    Persistence.updateBotState(instance.id, { wasRunning: isRunningState(newState) });
  });

  instance.on('alert', (type, message) => {
    notifier.sendAlert(instance, type, message).catch(() => {});
  });

  // Forward runtime/bug errors to the dedicated log channel.
  instance.on('botError', (err) => {
    notifier.sendErrorLog(instance, 'Bot runtime error', err).catch(() => {});
  });

  instance.on('noFood', () => {
    if (checkAlertCooldown(`${instance.id}:noFood`)) {
      notifier.sendAlert(instance, 'noFood', 'Bot has run out of food! Auto-eat disabled.').catch(() => {});
    }
  });

  instance.on('inventoryFull', () => {
    if (checkAlertCooldown(`${instance.id}:inventoryFull`)) {
      notifier
        .sendAlert(instance, 'inventoryFull', 'Bot inventory is full and has no droppable items.')
        .catch(() => {});
    }
  });
}

module.exports = { attachInstanceEvents, isRunningState };
