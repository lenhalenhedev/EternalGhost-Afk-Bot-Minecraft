const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const config = require('../config');
const BotManager = require('../manager/BotManager');
const { createAuthRouter } = require('./routes/auth');
const { createBotsRouter } = require('./routes/bots');
const { createEventsRouter } = require('./routes/events');
const { createAdminTokenRouter } = require('./routes/adminTokens');
const { logger } = require('../services/logger');

const WEB_PORT = config.web.port;
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

function createWebApp(botManager = BotManager) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      // The public protocol is terminated by Cloudflare. Keep the origin
      // HTTP-compatible unless the deployment explicitly enables HTTPS mode.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.web.https ? [] : null,
        },
      },
      strictTransportSecurity: config.web.https ? undefined : false,
      crossOriginOpenerPolicy: config.web.https
        ? { policy: 'same-origin' }
        : false,
      originAgentCluster: config.web.https,
    })
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthRouter());
  app.use('/api/bots', createBotsRouter(botManager));
  app.use('/api/events', createEventsRouter(botManager));
  app.use('/api/admin/tokens', createAdminTokenRouter());

  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false }));
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      return res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((err, _req, res, next) => {
    void next;
    logger.error(`[Web] Unhandled request error: ${err?.stack || err}`);
    return res.status(500).json({ error: 'Internal server error.' });
  });
  return app;
}

function startWebServer(botManager = BotManager) {
  const app = createWebApp(botManager);
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(WEB_PORT, () => {
      server.off('error', reject);
      logger.info(`[Web] Dashboard listening on port ${WEB_PORT}.`);
      resolve(server);
    });
  });
}

function closeWebServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

module.exports = {
  WEB_PORT,
  WEB_DIST,
  createWebApp,
  startWebServer,
  closeWebServer,
};
