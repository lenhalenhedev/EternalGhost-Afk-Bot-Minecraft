'use strict';

const Persistence = require('./Persistence');
const { BOT_STATES } = require('../bot/states');
const { logger, checkAlertCooldown } = require('../services/logger');
const { redactDiagnostic } = require('../utils/security');
const { safeEventListener } = require('../utils/asyncBoundary');
const { publish } = require('../web/sse/eventHub');

/** True when a state means the bot should be considered "running" for persistence. */
function isRunningState(state) {
  return state !== BOT_STATES.OFFLINE && state !== BOT_STATES.DISCONNECTED;
}

// EG-001: a rejected critical state write used to escape the stateChange
// listener as an unhandled rejection, and index.js turns that into a full
// process exit. Writes are now retried with a bounded backoff and, when they
// still fail, the instance enters a measurable degraded-persistence state.
const STATE_WRITE_MAX_ATTEMPTS = 3;
const STATE_WRITE_RETRY_BASE_MS = 250;
const STATE_WRITE_RETRY_MAX_MS = 2_000;

/** Bounded, key-free counters so long-running processes cannot leak state. */
const stateWriteStats = { attempts: 0, failures: 0, exhausted: 0 };

function retryDelayMs(attempt) {
  return Math.min(
    STATE_WRITE_RETRY_MAX_MS,
    STATE_WRITE_RETRY_BASE_MS * 2 ** (attempt - 1)
  );
}

/**
 * Persist a lifecycle state change without ever letting the rejection escape.
 * Resolves to `true` when the write eventually succeeded and `false` when the
 * retry budget was exhausted (degraded persistence).
 */
function persistBotState(instance, newState) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      stateWriteStats.attempts += 1;
      Persistence.updateBotState(instance.id, {
        wasRunning: isRunningState(newState),
      }).then(
        () => resolve(true),
        (err) => {
          stateWriteStats.failures += 1;
          if (n >= STATE_WRITE_MAX_ATTEMPTS) {
            stateWriteStats.exhausted += 1;
            logger.error(
              { botId: instance.id, route: 'persistence:state' },
              `[Persistence] Bot state write failed after ${n} attempt(s); ` +
                `entering degraded persistence: ${redactDiagnostic(err)}`
            );
            if (checkAlertCooldown(`${instance.id}:persistenceDegraded`)) {
              instance.emit(
                'alert',
                'persistenceDegraded',
                'Bot state could not be saved to the database.'
              );
            }
            resolve(false);
            return;
          }
          logger.warn(
            { botId: instance.id, route: 'persistence:state' },
            `[Persistence] Bot state write failed (attempt ${n}/${STATE_WRITE_MAX_ATTEMPTS}); retrying.`
          );
          const timer = setTimeout(() => attempt(n + 1), retryDelayMs(n));
          // Never keep the process alive just for a retry.
          timer.unref?.();
        }
      );
    };
    attempt(1);
  });
}

/**
 * Wire a BotInstance's events to persistence and Discord notifications.
 * Extracted from BotManager so event-routing is testable and isolated.
 */
function attachInstanceEvents(instance, notifier) {
  const on = (event, handler) =>
    safeEventListener(`BotInstance:${event}`, handler, (label, err) =>
      logger.error({ botId: instance.id, route: label }, redactDiagnostic(err))
    );

  instance.on(
    'stateChange',
    on('stateChange', (_old, newState) => {
      // Persist first so a transient database outage cannot become a process
      // exit (EG-001); the SSE publish below is synchronous and cannot reject.
      void persistBotState(instance, newState);
      publish('bot:state', {
        botId: instance.id,
        ownerId: instance.record.createdBy,
        state: newState,
        snapshot: instance.toJSON(),
      });
    })
  );

  instance.on(
    'healthUpdate',
    on('healthUpdate', (metrics) => {
      publish('bot:health', {
        botId: instance.id,
        ownerId: instance.record.createdBy,
        ...metrics,
        snapshot: instance.toJSON(),
      });
    })
  );

  instance.on(
    'alert',
    on('alert', (type, message) =>
      notifier.sendAlert(instance, type, message).catch(() => {})
    )
  );

  // Forward runtime/bug errors to the dedicated log channel.
  instance.on(
    'botError',
    on('botError', (err) =>
      notifier.sendErrorLog(instance, 'Bot runtime error', err).catch(() => {})
    )
  );

  instance.on(
    'noFood',
    on('noFood', () => {
      if (checkAlertCooldown(`${instance.id}:noFood`)) {
        notifier
          .sendAlert(
            instance,
            'noFood',
            'Bot has run out of food! Auto-eat disabled.'
          )
          .catch(() => {});
      }
    })
  );

  instance.on(
    'inventoryFull',
    on('inventoryFull', () => {
      if (checkAlertCooldown(`${instance.id}:inventoryFull`)) {
        notifier
          .sendAlert(
            instance,
            'inventoryFull',
            'Bot inventory is full and has no droppable items.'
          )
          .catch(() => {});
      }
    })
  );
}

module.exports = {
  attachInstanceEvents,
  isRunningState,
  persistBotState,
  getStateWriteStats: () => ({ ...stateWriteStats }),
};
