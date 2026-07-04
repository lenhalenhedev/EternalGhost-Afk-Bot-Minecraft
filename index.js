'use strict';
require('dotenv').config();
const config = require('./src/config');
const { logger, shutdown: shutdownLogger } = require('./src/services/logger');
const BotManager = require('./src/manager/BotManager');
const client = require('./src/discord/client');
const db = require('./src/config/database');

let shuttingDown = false;
let lifecycleHandlersRegistered = false;

const CRASH_SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Graceful shutdown for clean signals (SIGINT/SIGTERM) and for the fatal
 * crash path (uncaughtException/unhandledRejection). `exitCode` lets the
 * crash path signal failure to the process manager (pm2/systemd/Docker)
 * so restarts and alerting behave correctly, while a clean signal still
 * exits 0.
 */
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[Main] Received ${signal}. Graceful shutdown...`);
  try {
    await BotManager.shutdown();
    await client.destroy();
    await db.close();
  } catch (err) {
    logger.error(`[Main] Shutdown error: ${err.message}`);
  } finally {
    shutdownLogger();
    process.exit(exitCode);
  }
}

/**
 * Fail-safe path for errors that escape every per-bot guard in
 * botEventBinder.js. Per Node's own guidance, the process is in an
 * undefined state after an uncaughtException — continuing to serve
 * traffic from it is the actual risk, not the crash itself. We log with
 * full detail (server-side only, never surfaced to Discord), attempt one
 * graceful shutdown so in-flight writes get a chance to flush, and hard-exit
 * on a timeout so a wedged shutdown can't leave a zombie process behind.
 * A process manager is expected to restart the service after exit(1).
 */
function crashExit(source, err) {
  logger.error(`[Main] Fatal ${source}: ${err?.stack || err?.message || err}`);
  if (shuttingDown) return;

  const forceTimer = setTimeout(() => {
    console.error('[Main] Graceful shutdown timed out; forcing exit.');
    process.exit(1);
  }, CRASH_SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  shutdown(source, 1).catch(() => process.exit(1));
}

function registerLifecycleHandlers() {
  if (lifecycleHandlersRegistered) return;
  lifecycleHandlersRegistered = true;

  process.once('SIGINT', () => shutdown('SIGINT', 0));
  process.once('SIGTERM', () => shutdown('SIGTERM', 0));

  process.on('uncaughtException', (err) => crashExit('uncaughtException', err));
  process.on('unhandledRejection', (reason) =>
    crashExit('unhandledRejection', reason)
  );
}

async function main() {
  logger.info('════════════════════════════════════════════════');
  logger.info('  Discord Minecraft AFK Bot System — Starting  ');
  logger.info('════════════════════════════════════════════════');

  // Register crash handlers before anything else can throw.
  registerLifecycleHandlers();

  await BotManager.initialize();
  await client.login(config.discord.token);
}

main().catch((err) => {
  console.error('[Main] Fatal startup error:', err);
  process.exit(1);
});
