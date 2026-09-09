'use strict';

/**
 * Shared async event-boundary helpers (EG-001).
 *
 * External event emitters (the Discord client, BotInstance, timers, SSE
 * subscribers) hand control to application code and then forget about the
 * Promise that code returns. A rejection produced after the synchronous
 * callback returns therefore escapes the emitter entirely and reaches
 * `process.on('unhandledRejection')`, which index.js deliberately turns into a
 * full process shutdown.
 *
 * These helpers give every such boundary a defined rejection sink so a single
 * failed handler degrades that handler instead of the whole fleet.
 */

const { redactDiagnostic } = require('./security');

/**
 * Best-effort, redacted console sink used when no reporter is supplied.
 * Never throws: a reporter that throws would recreate the very unhandled
 * rejection this module exists to prevent.
 */
function defaultReport(label, error) {
  try {
    process.stderr.write(
      `[async-boundary] ${label} failed: ${redactDiagnostic(error)}\n`
    );
  } catch {
    /* the reporter itself must never throw */
  }
}

/**
 * Wrap a (possibly async) handler so that both synchronous throws and
 * asynchronous rejections are reported instead of escaping the emitter.
 *
 * @param {string} label    human-readable boundary name used in telemetry
 * @param {Function} handler the real handler
 * @param {Function} [report] redacted reporter, called as report(label, error)
 * @returns {Function} a listener safe to register on any EventEmitter
 */
function safeEventListener(label, handler, report = defaultReport) {
  const safeReport = (error) => {
    try {
      report(label, error);
    } catch {
      /* a broken reporter must not create a new unhandled rejection */
    }
  };

  return function safeListener(...args) {
    let result;
    try {
      result = handler(...args);
    } catch (error) {
      safeReport(error);
      return undefined;
    }
    if (result && typeof result.then === 'function') {
      result.then(undefined, safeReport);
    }
    return undefined;
  };
}

/**
 * Attach a handler to an EventEmitter with a defined rejection sink.
 *
 * @param {import('node:events').EventEmitter} emitter
 * @param {string} event
 * @param {Function} handler
 * @param {{once?: boolean, report?: Function}} [options]
 * @returns {Function} the wrapped listener (useful for tests/removal)
 */
function attachSafeListener(emitter, event, handler, options = {}) {
  const listener = safeEventListener(
    `${emitter?.constructor?.name || 'emitter'}:${event}`,
    handler,
    options.report
  );
  if (options.once) emitter.once(event, listener);
  else emitter.on(event, listener);
  return listener;
}

module.exports = { safeEventListener, attachSafeListener, defaultReport };
