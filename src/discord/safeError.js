'use strict';

/**
 * Shared with interactionCreate.js's crash net. Individual commands
 * (create-bot, edit-bot, chat, start, stop, ...) each catch their own
 * BotManager/Persistence errors to show a friendly embed immediately rather
 * than falling through to the generic handler. This helper keeps that same
 * "only show messages we deliberately wrote" rule in one place instead of
 * duplicating the check across every command file.
 */
function isSafeOperationalError(err) {
  return err instanceof Error && err.constructor === Error && !!err.message;
}

function safeErrorMessage(err, fallback = 'Something went wrong. This has been logged.') {
  return isSafeOperationalError(err) ? err.message : fallback;
}

module.exports = { isSafeOperationalError, safeErrorMessage };
