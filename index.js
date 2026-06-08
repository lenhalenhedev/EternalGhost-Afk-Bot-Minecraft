'use strict';
require('dotenv').config();
const config     = require('./src/config');
const { logger } = require('./src/services/logger');
const BotManager = require('./src/manager/BotManager');
const client     = require('./src/discord/client');

async function main() {
  logger.info('═══════════════════════════════════════════════');
  logger.info('  Discord Minecraft AFK Bot System — Starting  ');
  logger.info('═══════════════════════════════════════════════');

  // 1. Load persisted bots and auto-restart wasRunning ones
  await BotManager.initialize();

  // 2. Start Discord bot
  await client.login(config.discord.token);

  // 3. Graceful shutdown handlers
  const shutdown = async (signal) => {
    logger.info(`[Main] Received ${signal}. Graceful shutdown...`);
    try {
      await BotManager.shutdown();
      await client.destroy();
    } catch (err) {
      logger.error(`[Main] Shutdown error: ${err.message}`);
    }
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error(`[Main] Uncaught Exception: ${err.stack || err.message}`);
    // Don't crash – log and continue
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`[Main] Unhandled Rejection: ${reason?.stack || reason}`);
  });
}

main().catch(err => {
  console.error('[Main] Fatal startup error:', err);
  process.exit(1);
});
