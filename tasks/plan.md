# Implementation Plan: Remote Web Dashboard

## Overview

Integrate a same-origin React/Vite/Tailwind dashboard into the existing CommonJS Node service. The Node process will expose REST endpoints, a cookie-based JWT session, and one SSE stream while continuing to use the singleton `BotManager` for every bot mutation and query. Discord commands will use the same token service as the Web admin screen.

## Architecture decisions

| Decision | Rationale |
|---|---|
| Keep Web backend inside the existing Node process | Avoid a second source of truth and reuse the singleton `BotManager`, persistence queue, validators, and encryption. |
| Use REST for actions and SSE for all realtime | REST is straightforward for mutations; SSE matches the approved one-way server-to-browser update model and native `EventSource`. |
| Store one hash of the active JWT per Discord user | Enables immediate revocation without storing raw credentials. Replacement is atomic at the application/database boundary. |
| Reuse BotManager ownership checks | Existing `createdBy` semantics are the authoritative access boundary. Admin role is limited to token management. |
| Serve Vite build from the Node server | Preserves same-origin cookies and avoids CORS configuration. |
| Publish runtime updates through a small event bridge | Existing state/health events and logger buffer are available, but live logs currently have no subscription hook. |

## Findings and risks

1. `BotManager` already provides create/delete/start/stop/restart/edit/chat/list/stats methods and performs ownership checks, but snapshots omit `label` and player count.
2. `botRecordFactory` currently does not accept/edit `label` or `username`; the Web requirement needs a deliberate extension while preserving Discord compatibility.
3. `instanceEvents.js` forwards state and health to Discord only. It must be extended to publish a shared runtime event without changing existing Discord behavior.
4. `logger.botLog` fills the buffer but does not emit live entries. Add a safe subscriber API that publishes sanitized log entries and removes listeners on disconnect.
5. PostgreSQL has no token table or label column. Schema and repository changes must be idempotent and parameterized.
6. The current Node runtime is CommonJS and the existing package specifies Node >=24. The frontend will be a nested Vite project built into `web/dist`; production dependencies should not be shipped unnecessarily.
7. `deleteBot` currently destroys an instance regardless of state. The Web route must reject running bots before calling it, and the shared method should enforce the invariant to prevent bypass.
8. The requested slash-first chat behavior conflicts with the current `validateChatMessage` allowlist. The Web endpoint must use an explicit exact-first-character parser and preserve message text safely through `BotInstance.chat`.

## Dependency order

```text
schema + repository/token service
        ↓
BotManager/model/runtime event bridge
        ↓
REST/auth/SSE server
        ↓
Vite frontend + API/SSE clients
        ↓
Docker/build wiring
        ↓
tests, lint, manual runtime verification
```

## Vertical slices

### Slice 1: persistence and token/auth foundations

Add the label column, token table, token service, expiry validation, and redacted record helpers. Verify with unit tests and schema/query tests where available.

### Slice 2: shared BotManager and runtime event contract

Extend bot labels/editable username, enforce stopped-only deletion, expose safe snapshots, add event publication for state/health/log/metrics, and test the new behavior.

### Slice 3: protected REST + SSE backend

Implement login/logout/me, bot CRUD/lifecycle/chat routes, admin token routes, and SSE connection filtering. Verify with route-level tests using fakes at the database/runtime boundaries.

### Slice 4: frontend shell and authentication

Create the Vite React app, Tailwind tokens, router, Zustand store, axios interceptor, login page, protected shell, responsive sidebar, and empty state. Verify production build and responsive DOM behavior.

### Slice 5: bot operations and realtime UX

Add create/edit/delete/lifecycle/chat/log/statistics screens, virtualized lists, SSE event handling, toasts, confirmations, and admin token management. Verify the critical flows against the backend contract.

### Slice 6: packaging and release verification

Wire `index.js`, `WEB_PORT`, static hosting, Docker Compose port exposure, scripts, tests, lint, dependency audit, and manual startup checks.

## Checkpoints

### Foundation checkpoint

- Schema is idempotent.
- Token validation/revocation tests pass.
- Existing test suite remains green.

### Backend checkpoint

- Protected routes enforce ownership and admin-only token management.
- SSE sends initial snapshots/logs and live updates.
- `npm test` and lint pass.

### UI checkpoint

- `npm run build:web` succeeds.
- Login, empty state, bot selection, configuration, logs, chat, metrics, and token management render without console errors.
- Mobile overlay and desktop sidebar behavior are verified.

### Complete checkpoint

- Full test/lint/build suite passes.
- No secrets or raw JWTs appear in tracked files, logs, or API responses.
- Docker Compose exposes `WEB_PORT` with default `8080`.

## Verification commands

```bash
npm ci
npm test
npm run lint
npm run build:web
npm audit --omit=dev
```

## Open implementation questions to resolve from code

- Exact database migration strategy for existing deployments that already ran `schema.sql`.
- Whether Mineflayer exposes player count in the current runtime object; if not, the snapshot should omit it rather than poll.
- Whether Discord command registration accepts dynamic autocomplete for `/del-token`; implement autocomplete only if the existing interaction router supports it cleanly.
