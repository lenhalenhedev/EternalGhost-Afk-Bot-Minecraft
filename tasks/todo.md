# Dashboard Implementation Checklist

## Task 1: Add schema and token persistence

- [ ] Add `bots.label` and an idempotent active-token table keyed by Discord user ID.
  - Acceptance: Existing databases can re-run `db/schema.sql`; token hashes, issued time, expiry time, and user ID are persisted without raw JWTs.
  - Verify: SQL syntax review; targeted persistence tests; `npm test`.
  - Dependencies: None.
  - Files likely touched: `db/schema.sql`, `src/manager/botRepository.js`, `src/manager/Persistence.js`.
  - Estimated scope: Medium.

- [ ] Implement token expiry validation, signing, hashing, replacement, listing, and revocation.
  - Acceptance: Only integer milliseconds from 1,000 through 9,007,199,254,740,991 divisible by 1,000 are accepted; replacement leaves one active token; revoke invalidates immediately; raw JWT is never persisted/logged.
  - Verify: Node tests for bounds, conversion, replacement, and revocation.
  - Dependencies: Task 1 schema.
  - Files likely touched: `src/web/auth/tokenService.js`, `src/web/auth/tokenValidation.js`, `tests/webToken.test.js`.
  - Estimated scope: Medium.

## Task 2: Extend shared bot model and runtime events

- [ ] Extend bot records and snapshots with `label`, editable username, and safe metrics.
  - Acceptance: Web create/edit can set label and username; passwords remain write-only; snapshots include only safe fields and only metrics available from runtime.
  - Verify: Factory/snapshot unit tests and existing bot tests.
  - Dependencies: Task 1 schema.
  - Files likely touched: `src/manager/botRecordFactory.js`, `src/manager/botRepository.js`, `src/manager/Persistence.js`, `src/bot/botSnapshot.js`, tests.
  - Estimated scope: Medium.

- [ ] Enforce stopped-only deletion and define exact chat parser.
  - Acceptance: Running bot deletion is rejected; `/` at character zero is treated as a command and every other input is treated as chat; leading whitespace does not qualify.
  - Verify: Unit tests for running deletion and parser examples.
  - Dependencies: Task 2 model.
  - Files likely touched: `src/manager/BotManager.js`, `src/web/commandParser.js`, tests.
  - Estimated scope: Small.

- [ ] Add a sanitized runtime event bridge for state, health, metrics, and logs.
  - Acceptance: Existing `DiscordNotifier` behavior remains intact; SSE subscribers can receive initial buffer plus future sanitized log entries; listeners are removed on disconnect.
  - Verify: Event bridge and logger subscription tests.
  - Dependencies: Task 2 model.
  - Files likely touched: `src/manager/instanceEvents.js`, `src/services/logger.js`, `src/web/sse/eventHub.js`, tests.
  - Estimated scope: Medium.

### Checkpoint: Shared core

- [ ] `npm test` passes.
- [ ] No raw password or token appears in snapshots, logs, or test fixtures.
- [ ] BotManager operations still use the singleton persistence and notifier paths.

## Task 3: Build protected Web backend

- [ ] Implement Express/HTTP server, security headers, JSON limits, static hosting, and configurable `WEB_PORT` defaulting to 8080.
  - Acceptance: Server starts without Discord-specific route coupling and serves the built SPA from the same origin.
  - Verify: Server smoke test and `WEB_PORT=8080` startup check.
  - Dependencies: Task 2.
  - Files likely touched: `src/web/server.js`, `src/web/http.js`, `src/config/index.js`, `index.js`.
  - Estimated scope: Medium.

- [ ] Implement cookie JWT authentication and auth routes.
  - Acceptance: Login verifies JWT and active-token record, sets secure httpOnly sameSite cookie; logout clears it; `/me` never returns the JWT; invalid/expired/revoked sessions return 401.
  - Verify: Auth route integration tests including expiry/revocation and rate-limit behavior.
  - Dependencies: Task 1, Task 3 server.
  - Files likely touched: `src/web/auth/authenticate.js`, `src/web/routes/auth.js`, server tests.
  - Estimated scope: Medium.

- [ ] Implement ownership-protected bot REST routes and SSE stream.
  - Acceptance: CRUD/lifecycle/chat routes call BotManager; every route and SSE subscription enforces ownership; `GET /api/events` sends initial snapshots/logs and live events; errors are generic.
  - Verify: Route tests for owner, foreign user, admin ownership, running deletion, and SSE lifecycle.
  - Dependencies: Task 2 and auth.
  - Files likely touched: `src/web/routes/bots.js`, `src/web/routes/events.js`, `src/web/sse/eventHub.js`, tests.
  - Estimated scope: Large; split if needed.

- [ ] Implement admin-only Web token management routes.
  - Acceptance: Only `ADMIN_USER_IDS` principals can list/create/revoke tokens; user selection accepts manual Discord User ID; create returns raw JWT once; revoke confirms at UI layer and invalidates session immediately.
  - Verify: Admin/non-admin route tests and raw-token redaction tests.
  - Dependencies: Auth and token service.
  - Files likely touched: `src/web/routes/adminTokens.js`, token tests.
  - Estimated scope: Medium.

## Task 4: Build frontend foundation

- [ ] Add the `web/` Vite React app and exact dependency scripts.
  - Acceptance: `npm run build:web` produces `web/dist`; Tailwind tokens match the approved palette; app is same-origin compatible.
  - Verify: `npm run build:web`; lint if configured.
  - Dependencies: Task 3 API contract.
  - Files likely touched: `web/package.json`, `web/vite.config.js`, `web/tailwind.config.js`, `web/src/main.jsx`, root `package.json`.
  - Estimated scope: Medium.

- [ ] Implement router, axios client, Zustand stores, login flow, and protected shell.
  - Acceptance: 401 interceptor navigates to `/login`; credentials are included; no token enters browser storage; root routing and session expiry behavior match the spec.
  - Verify: Frontend unit tests/build and manual browser check.
  - Dependencies: Task 4 app.
  - Files likely touched: `web/src/lib/api.js`, `web/src/state/*`, `web/src/App.jsx`, `web/src/pages/LoginPage.jsx`.
  - Estimated scope: Medium.

- [ ] Implement responsive sidebar, empty state, bot selection, and token-management page.
  - Acceptance: Desktop sidebar opens by default and can collapse; mobile uses overlay/hamburger and closes on selection; admin token page is hidden from non-admin users.
  - Verify: Browser screenshots/DOM checks at mobile and desktop widths.
  - Dependencies: Task 4 shell.
  - Files likely touched: `web/src/components/Sidebar.jsx`, `web/src/components/ResponsiveShell.jsx`, `web/src/pages/DashboardPage.jsx`, `web/src/pages/TokenManagementPage.jsx`.
  - Estimated scope: Medium.

## Task 5: Build bot detail flows

- [ ] Implement configuration form and bot create/delete flows.
  - Acceptance: All requested fields validate client-side; server remains authoritative; running bot save states restart requirement; delete blocks running bots and confirms stopped deletions.
  - Verify: Component tests and manual CRUD flow.
  - Dependencies: Task 4.
  - Files likely touched: `web/src/components/BotForm.jsx`, `web/src/components/DeleteBotDialog.jsx`, detail page files.
  - Estimated scope: Medium.

- [ ] Implement lifecycle controls, chat/command input, logs, metrics, and SSE wiring.
  - Acceptance: Start/stop/restart actions show toasts; exact slash parser behavior is preserved; logs filter by level, auto-scroll, and clear locally; virtualized sidebar/log lists consume SSE updates; metrics show uptime/health/food/ping/player count/state when present.
  - Verify: Frontend tests, SSE fixture test, and browser runtime verification.
  - Dependencies: Tasks 3 and 4.
  - Files likely touched: `web/src/hooks/useSse.js`, `web/src/components/LogPanel.jsx`, `web/src/components/StatsPanel.jsx`, `web/src/components/CommandBar.jsx`.
  - Estimated scope: Large; split if needed.

### Checkpoint: End-to-end UI

- [ ] Login, empty state, bot creation, selection, configuration, lifecycle, logs, chat, statistics, logout, and admin token flows work against the local server.
- [ ] No browser console errors or unexpected network errors.

## Task 6: Package and verify

- [ ] Update Docker build and Compose port exposure.
  - Acceptance: production image builds frontend and exposes/maps `WEB_PORT` with default 8080; `npm start` serves the SPA/API.
  - Verify: `docker compose config` and image build if Docker is available.
  - Dependencies: Tasks 3–5.
  - Files likely touched: `Dockerfile`, `docker-compose.yml`, `.env.example`.
  - Estimated scope: Medium.

- [ ] Run full quality and security checks.
  - Acceptance: `npm test`, `npm run lint`, `npm run build:web`, and native dependency audit complete; no secrets/raw tokens tracked; security headers and authorization checks verified.
  - Verify: Commands in `docs/web-dashboard-spec.md`; final review.
  - Dependencies: All prior tasks.
  - Files likely touched: tests and docs only if fixes are needed.
  - Estimated scope: Medium.
