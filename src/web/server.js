const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const config = require('../config');
const BotManager = require('../manager/BotManager');
const { createAuthRouter } = require('./routes/auth');
const { createBotsRouter } = require('./routes/bots');
const { createEventsRouter } = require('./routes/events');
const { createAdminTokenRouter } = require('./routes/adminTokens');
const { sameOriginGuard } = require('./middleware/sameOriginGuard');
const { logger } = require('../services/logger');

const WEB_PORT = config.web.port;
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

function makeRateLimiter(perMinute, message) {
  return rateLimit({
    windowMs: 60 * 1_000,
    limit: perMinute,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

const globalLimiter = makeRateLimiter(
  config.web.globalLimitPerMin,
  'Too many requests. Please slow down.'
);
const botsLimiter = makeRateLimiter(
  config.web.botsLimitPerMin,
  'Too many bot API requests. Please slow down.'
);
const eventsLimiter = makeRateLimiter(
  config.web.eventsLimitPerMin,
  'SSE reconnect too frequent. Please slow down.'
);

function createWebApp(botManager = BotManager) {
  const app = express();
  app.disable('x-powered-by');

  // When the operator configures a trusted reverse proxy (Cloudflare and the
  // like), Express must derive the real client IP from X-Forwarded-For so the
  // rate limiters key on the actual client and not the proxy socket (EG-005).
  // Unset means no proxy trust (correct for direct-to-Internet deployments).
  if (config.web.trustProxy !== undefined) {
    app.set('trust proxy', config.web.trustProxy);
  }
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
  app.use((req, _res, next) => {
    req.requestId = crypto.randomUUID();
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  // Baseline throttle on every request (incl. /healthz and the SPA fallback)
  // so an unauthenticated flood cannot saturate the shared Node process that
  // also supervises the Minecraft bots (EG-008).
  app.use(globalLimiter);

  // CSRF defence-in-depth: reject cross-origin state-changing /api requests
  // (EG-004). Mounted before every API router, including auth.
  app.use('/api', sameOriginGuard);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthRouter());
  app.use('/api/bots', botsLimiter, createBotsRouter(botManager));
  app.use('/api/events', eventsLimiter, createEventsRouter(botManager));
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
    logger.error(
      { route: 'web:error-handler', statusCode: 500, err },
      'Unhandled Web request error.'
    );
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
