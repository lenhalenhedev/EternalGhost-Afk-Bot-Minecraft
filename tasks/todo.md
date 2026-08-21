# Web implementation checklist

- [x] Task 1: Add optional web configuration and `.env.example` variables.
  - Acceptance: `WEB_ENABLED`, `WEB_HOST`, `WEB_PORT`, `WEB_ADMIN_USERNAME`, and `WEB_ADMIN_PASSWORD_SHA256` are documented; malformed enabled configuration fails safely at web startup.
  - Verify: unit tests for hash format and config behavior; lint.
  - Dependencies: None.
  - Files likely touched: `src/config/index.js`, `.env.example`, `tasks/plan.md`.

- [x] Task 2: Implement reusable auth/session/HTTP utility modules.
  - Acceptance: SHA-256 comparison is constant-time; sessions expire; CSRF is required for mutations; body/path parsing is bounded and safe.
  - Verify: focused native Node tests for success and abuse cases.
  - Dependencies: Task 1.
  - Files likely touched: `src/web/private/auth.js`, `src/web/private/http.js`, `tests/webAuth.test.js`.

- [x] Task 3: Implement public status and protected read routes.
  - Acceptance: `/status` and `/api/status` expose sanitized raw JSON; `/api/bots`, `/api/stats`, `/api/help`, status/log/activity reads require auth and cap query limits.
  - Verify: route integration tests and forbidden-field assertions.
  - Dependencies: Task 2.
  - Files likely touched: `src/web/private/statusService.js`, `src/web/private/routes/readRoutes.js`, `tests/webStatus.test.js`.

- [x] Task 4: Implement bot CRUD/lifecycle/chat/selection routes against `BotManager`.
  - Acceptance: web equivalents of all Discord commands call canonical manager methods; errors use safe JSON; mutations enforce CSRF.
  - Verify: route tests with fake manager and existing manager/validator tests.
  - Dependencies: Task 3.
  - Files likely touched: `src/web/private/routes/botRoutes.js`, `src/web/private/router.js`, `tests/webBotRoutes.test.js`.

- [x] Task 5: Integrate server startup/shutdown and static public assets.
  - Acceptance: server starts on configured HTTP host/port, serves `/`, `/admin`, `/status`, blocks traversal, sets security headers and closes during process shutdown.
  - Verify: start/stop smoke test and curl checks.
  - Dependencies: Task 4.
  - Files likely touched: `src/web/private/server.js`, `src/web/private/static.js`, `index.js`, `tests/webServer.test.js`.

- [x] Task 6: Build responsive Dark Neon Cyberpunk client.
  - Acceptance: no emoji; login/admin/status navigation; fleet cards; bot CRUD/lifecycle/log/activity/chat controls; public assets contain no secrets.
  - Verify: static asset checks, lint, browser smoke test/screenshots if available.
  - Dependencies: Task 5.
  - Files likely touched: `src/web/public/index.html`, `src/web/public/styles.css`, `src/web/public/app.js`.

- [x] Task 7: Document operation, limitations and command mapping; run full quality gate.
  - Acceptance: README includes env setup, HTTP/public IP warning, routes and Discord parity; test/lint/format pass; no secrets staged.
  - Verify: `npm test`, `npm run lint`, `npm run format:check`, `git diff --check`, secret grep.
  - Dependencies: Tasks 1-6.
  - Files likely touched: `README.md`, `docs/web-spec.md`, `tasks/todo.md`.
