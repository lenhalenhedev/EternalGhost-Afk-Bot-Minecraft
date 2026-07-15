'use strict';
/**
 * Periodic database keep-alive ping.
 *
 * Managed PostgreSQL providers (e.g. Aiven) can suspend or reclaim a database
 * that sees no activity for an extended period. This job runs on a fixed
 * schedule and issues a trivial query through the existing connection pool
 * so the database is never considered idle.
 *
 * Reuses the shared pool in src/config/database.js instead of opening a raw
 * connection — same pattern BotManager.js already uses for its own
 * cron-scheduled log summary, including tracking the task so it can be
 * stopped cleanly on shutdown instead of left running as an orphan.
 */
const cron = require('node-cron');
const db = require('../config/database');
const { logger } = require('../services/logger');

// Every 5 hours, on the hour (00:00, 05:00, 10:00, 15:00, 20:00 UTC).
// Note: 24 isn't evenly divisible by 5, so the gap from 20:00 back to 00:00
// is only 4 hours — a quirk of standard cron syntax, not a bug. If a
// perfectly uniform 5-hour cadence across midnight ever matters, this would
// need a setInterval-based timer instead of a cron expression.
const SCHEDULE = '0 */5 * * *';

/** @type {import('node-cron').ScheduledTask|null} */
let task = null;

/** Ping the database with a trivial query to keep the pool/connection alive. */
async function pingDatabase() {
  try {
    await db.query('SELECT 1');
    logger.info(
      `[CronJob] Database ping successful at ${new Date().toISOString()}`
    );
  } catch (err) {
    logger.error(`[CronJob] Database ping failed: ${err.message}`);
  }
}

/**
 * Start the recurring ping. Safe to call more than once — a repeat call
 * stops any previously scheduled task first instead of stacking duplicates.
 */
function start() {
  if (task) {
    task.stop();
    task = null;
  }
  task = cron.schedule(SCHEDULE, pingDatabase);
  logger.info(`[CronJob] Database keep-alive ping scheduled (${SCHEDULE}).`);
  return task;
}

/** Stop the recurring ping (call on graceful shutdown). */
function stop() {
  if (task) {
    task.stop();
    task = null;
  }
}

module.exports = { start, stop, pingDatabase, SCHEDULE };
