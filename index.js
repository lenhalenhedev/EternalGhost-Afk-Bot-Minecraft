'use strict';
require('dotenv').config();
const config = require('./src/config');
const { logger, shutdown: shutdownLogger } = require('./src/services/logger');
const BotManager = require('./src/manager/BotManager');
const client = require('./src/discord/client');
const db = require('./src/config/database');

let shuttingDown = false;
let lifecycleHandlersRegistered = false;

async function shutdown(signal) {
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
    process.exit(0);
  }
}

function registerLifecycleHandlers() {
  if (lifecycleHandlersRegistered) return;
  lifecycleHandlersRegistered = true;

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error(`[Main] Uncaught Exception: ${err.stack || err.message}`);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`[Main] Unhandled Rejection: ${reason?.stack || reason}`);
  });
}

async function main() {
  logger.info('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  logger.info('  Discord Minecraft AFK Bot System \u2014 Starting  ');
  logger.info('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  await BotManager.initialize();

  await client.login(config.discord.token);

  registerLifecycleHandlers();
}

main().catch((err) => {
  console.error('[Main] Fatal startup error:', err);
  process.exit(1);
});
