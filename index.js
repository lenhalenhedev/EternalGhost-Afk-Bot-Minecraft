'use strict';
require('dotenv').config();
const config = require('./src/config');
const { logger } = require('./src/services/logger');
const BotManager = require('./src/manager/BotManager');
const client = require('./src/discord/client');
const db = require('./src/config/database');

async function main() {
  logger.info('═══════════════════════════════════════════════');
  logger.info('  Discord Minecraft AFK Bot System — Starting  ');
  logger.info('═══════════════════════════════════════════════');

  // 1. Load persisted bots and auto-restart wasRunning ones
  await BotManager.initialize();

  // 2. Start Discord bot
  await client.login(config.discord.token);

  // 3. Graceful shutdown handlers
  // FIX: Use named handler references and register only once to prevent
  // accumulation of process event listeners on repeated calls or hot-reloads.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return; // Prevent double-shutdown race
    shuttingDown = true;
    logger.info(`[Main] Received ${signal}. Graceful shutdown...`);
    try {
      await BotManager.shutdown();
      await client.destroy();
      await db.close(); // FIX: Close the database pool on shutdown
    } catch (err) {
      logger.error(`[Main] Shutdown error: ${err.message}`);
    }
    process.exit(0);
  };

  // FIX: Remove any previously registered handlers before adding new ones
  // to prevent listener accumulation if main() is somehow called multiple times.
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // FIX: Use `once` or guard against duplicate registration for error handlers.
  // These should only be registered once per process lifetime.
  if (!process._uncaughtExceptionHandlerRegistered) {
    process._uncaughtExceptionHandlerRegistered = true;
    process.on('uncaughtException', (err) => {
      logger.error(`[Main] Uncaught Exception: ${err.stack || err.message}`);
      // Don't crash – log and continue
    });
    process.on('unhandledRejection', (reason) => {
      logger.error(`[Main] Unhandled Rejection: ${reason?.stack || reason}`);
    });
  }
}

main().catch((err) => {
  console.error('[Main] Fatal startup error:', err);
  process.exit(1);
});
