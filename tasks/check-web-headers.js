const { createWebApp } = require('../src/web/server');

const server = createWebApp().listen(0, async () => {
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const headers = Object.fromEntries(response.headers.entries());
    console.log(
      JSON.stringify(
        {
          status: response.status,
          csp: headers['content-security-policy'] || null,
          hsts: headers['strict-transport-security'] || null,
          coop: headers['cross-origin-opener-policy'] || null,
          oac: headers['origin-agent-cluster'] || null,
        },
        null,
        2
      )
    );
  } finally {
    server.close();
  }
});
