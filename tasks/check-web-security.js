'use strict';

/**
 * Local, loopback-only probe helper used by tests to verify web-layer security
 * behaviour without contacting any external service. It reads its own
 * environment (config is built from process.env at require time), so callers
 * set WEB_TRUST_PROXY / WEB_GLOBAL_LIMIT_PER_MIN / etc. before spawning it.
 *
 * ACT=trustproxy  -> prints app.get('trust proxy') after createWebApp()
 * ACT=ratelimit   -> sends 6 requests to /healthz, prints status counts
 * ACT=csrforigin  -> posts to /api/auth/logout under same/cross-origin and
 *                    Sec-Fetch-Site conditions, prints observed status codes
 */

async function start() {
  // Force a fresh module graph each invocation.
  delete require.cache[require.resolve('../src/web/server')];
  const { createWebApp } = require('../src/web/server');
  const app = createWebApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address();
  return { app, server, base: `http://127.0.0.1:${port}` };
}

async function main() {
  const act = process.env.ACT;
  const { app, server, base } = await start();
  try {
    if (act === 'trustproxy') {
      console.log(JSON.stringify({ trustProxy: app.get('trust proxy') }));
      return;
    }

    if (act === 'ratelimit') {
      const counts = { ok: 0, limited: 0, other: 0 };
      for (let i = 0; i < 6; i += 1) {
        const res = await fetch(`${base}/healthz`);
        if (res.status === 200) counts.ok += 1;
        else if (res.status === 429) counts.limited += 1;
        else counts.other += 1;
      }
      console.log(JSON.stringify(counts));
      return;
    }

    if (act === 'csrforigin') {
      const statuses = {};
      const cross = await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example' },
      });
      statuses.crossOrigin = cross.status;

      const same = await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { Origin: base },
      });
      statuses.sameOrigin = same.status;

      const crossSiteFetch = await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      });
      statuses.crossSiteFetchSite = crossSiteFetch.status;

      console.log(JSON.stringify(statuses));
      return;
    }

    throw new Error(`Unknown ACT=${act}`);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
