'use strict';

const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWebServer } = require('../src/web/private/server');
const { sha256Hex } = require('../src/web/private/auth');

const BOT_ID = '11111111-1111-4111-8111-111111111111';

function snapshot() {
  return {
    id: BOT_ID,
    host: 'play.example.test',
    port: 25565,
    username: 'GhostBot',
    version: '1.20.4',
    state: 'OFFLINE',
    uptime: 0,
    health: 0,
    food: 0,
    ping: 0,
    position: null,
    reconnectAttempts: 0,
    autoReconnect: true,
  };
}

function createFakeDependencies(calls) {
  const value = snapshot();
  const instance = {
    id: BOT_ID,
    record: { ...value, encryptedPassword: 'must-never-leave-server' },
    toJSON: () => ({ ...value }),
  };
  return {
    botManager: {
      getPublicSnapshots: () => [{ ...value }],
      listAuthorizedBots: () => [instance],
      getStats: () => ({
        uptime: 1,
        totalBots: 1,
        aliveBots: 0,
        memHeapUsed: 10,
        memRSS: 20,
        memExternal: 2,
        estimatedPerBotMB: 0,
      }),
      resolveAuthorizedBot: () => instance,
      createBot: async () => ({ id: BOT_ID }),
      editBot: async () => calls.push('edit'),
      deleteBot: async () => calls.push('delete'),
      startBot: async () => calls.push('start'),
      stopBot: async (_principal, _id, force) => calls.push(`stop:${force}`),
      restartBot: async () => calls.push('restart'),
      chatBot: async (_principal, _id, message) =>
        calls.push(`chat:${message}`),
      setUserSelection: async () => calls.push('select'),
    },
    persistence: {
      getActivityHistory: async () => [
        { action: 'created', actor: 'web-admin' },
      ],
    },
  };
}

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : '';
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: options.method || 'GET',
        headers: {
          ...(body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }
            : {}),
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            /* static text */
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: parsed,
          });
        });
      }
    );
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

test('web server exposes sanitized public status and serves the public landing page', async () => {
  const dependencies = createFakeDependencies([]);
  const web = createWebServer({
    ...dependencies,
    webConfig: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      username: 'admin',
      passwordHash: sha256Hex('secret'),
      sessionTtlMs: 60_000,
      loginWindowMs: 60_000,
      loginMaxAttempts: 3,
      maxBodyBytes: 10_000,
    },
    appLogger: { info() {} },
  });
  await web.start();
  const port = web.server.address().port;
  const status = await request(port, '/api/status');
  const landing = await request(port, '/');
  const admin = await request(port, '/admin');
  const privateFile = await request(port, '/src/web/private/auth.js');
  await web.stop();

  assert.equal(status.status, 200);
  assert.equal(status.body.fleet.totalBots, 1);
  assert.equal(
    JSON.stringify(status.body).includes('encryptedPassword'),
    false
  );
  assert.equal(landing.status, 200);
  assert.match(landing.body, /EternalGhost/);
  assert.equal(admin.status, 200);
  assert.match(admin.body, /Authenticate operator/);
  assert.equal(privateFile.status, 404);
  assert.equal(status.headers['x-content-type-options'], 'nosniff');
});

test('web admin requires login and CSRF before executing bot operations', async () => {
  const calls = [];
  const dependencies = createFakeDependencies(calls);
  const web = createWebServer({
    ...dependencies,
    webConfig: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      username: 'admin',
      passwordHash: sha256Hex('secret'),
      sessionTtlMs: 60_000,
      loginWindowMs: 60_000,
      loginMaxAttempts: 3,
      maxBodyBytes: 10_000,
    },
    appLogger: { info() {} },
  });
  await web.start();
  const port = web.server.address().port;
  const anonymous = await request(port, '/api/bots');
  const login = await request(port, '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'secret' },
  });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const bots = await request(port, '/api/bots', { cookie });
  const missingCsrf = await request(port, `/api/bots/${BOT_ID}/start`, {
    method: 'POST',
    cookie,
  });
  const started = await request(port, `/api/bots/${BOT_ID}/start`, {
    method: 'POST',
    cookie,
    csrf: login.body.csrfToken,
  });
  await web.stop();

  assert.equal(anonymous.status, 401);
  assert.equal(login.status, 200);
  assert.match(login.headers['set-cookie'][0], /HttpOnly/);
  assert.match(login.headers['set-cookie'][0], /SameSite=Lax/);
  assert.equal(bots.status, 200);
  assert.equal(bots.body.bots[0].encryptedPassword, undefined);
  assert.equal(missingCsrf.status, 403);
  assert.equal(started.status, 200);
  assert.deepEqual(calls, ['start']);
});
