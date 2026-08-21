'use strict';

const http = require('node:http');
const config = require('../../config');
const BotManager = require('../../manager/BotManager');
const Persistence = require('../../manager/Persistence');
const { logger } = require('../../services/logger');
const { createAuthService, isSha256Hex } = require('./auth');
const { createRouter } = require('./router');
const { createStaticHandler } = require('./static');
const { createAuthRoutes } = require('./routes/authRoutes');
const { createReadRoutes } = require('./routes/readRoutes');
const { createBotRoutes } = require('./routes/botRoutes');
const { createStatusService } = require('./statusService');

function assertWebCredentials(webConfig) {
  if (!webConfig.username || !isSha256Hex(webConfig.passwordHash)) {
    throw new Error(
      'WEB_ADMIN_USERNAME and WEB_ADMIN_PASSWORD_SHA256 (64-char hex) are required when WEB_ENABLED=true'
    );
  }
}

function createWebServer({
  webConfig = config.web,
  botManager = BotManager,
  persistence = Persistence,
  appLogger = logger,
} = {}) {
  if (!webConfig.enabled) {
    return {
      enabled: false,
      start: async () => null,
      stop: async () => null,
    };
  }

  assertWebCredentials(webConfig);
  const authService = createAuthService({
    username: webConfig.username,
    passwordHash: webConfig.passwordHash,
    sessionTtlMs: webConfig.sessionTtlMs,
    loginWindowMs: webConfig.loginWindowMs,
    loginMaxAttempts: webConfig.loginMaxAttempts,
  });
  const statusService = createStatusService({ botManager, persistence });
  const authRoutes = createAuthRoutes({
    authService,
    maxBodyBytes: webConfig.maxBodyBytes,
  });
  const readRoutes = createReadRoutes({ statusService });
  const botRoutes = createBotRoutes({
    botManager,
    statusService,
    maxBodyBytes: webConfig.maxBodyBytes,
  });
  const staticHandler = createStaticHandler();
  const router = createRouter({
    authService,
    authRoutes,
    readRoutes,
    botRoutes,
    staticHandler,
  });
  const server = http.createServer((request, response) => {
    router.handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;

  let started = false;
  async function start() {
    if (started) return server.address();
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(webConfig.port, webConfig.host);
    });
    started = true;
    const address = server.address();
    appLogger.info(
      `[Web] HTTP admin server listening on ${webConfig.host}:${webConfig.port}`
    );
    return address;
  }

  async function stop() {
    authService.clear();
    if (!started) return;
    await new Promise((resolve) => server.close(() => resolve()));
    started = false;
    appLogger.info('[Web] HTTP admin server stopped.');
  }

  return {
    enabled: true,
    authService,
    server,
    start,
    stop,
  };
}

module.exports = { assertWebCredentials, createWebServer };
