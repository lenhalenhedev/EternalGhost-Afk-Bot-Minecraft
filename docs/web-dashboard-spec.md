# Web Dashboard Specification

## Objective

Add a remote Web dashboard to the existing Discord-managed Minecraft AFK bot system. The Web interface and Discord interface must call the same `BotManager` instance so that bot lifecycle, ownership, persistence, and runtime state remain consistent. The dashboard is an English-only operational admin panel, not a marketing page.

The target users are Discord users who receive a Web JWT from an administrator. A normal user can create, edit, start, stop, restart, inspect, and delete only the bots whose `createdBy` Discord User ID matches the authenticated user. A user may receive a token before owning any bot; creating a user/token record must not require a pre-existing bot.

## User-visible capabilities

The dashboard must provide the following behavior:

| Area              | Required behavior                                                                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication    | `/login` accepts a JWT pasted manually. The server verifies it with `ENCRYPTION_KEY` and sets an `httpOnly` session cookie. Logout clears the cookie. Expired or revoked sessions redirect to `/login` with an expiry message.                                                                |
| Bot list          | Responsive sidebar lists owned bots as rows grouped by `host + port`, with status dot and status text. Desktop uses an open sidebar that can be collapsed; screens below the standard Tailwind `md` breakpoint use a hamburger-triggered overlay that closes after bot selection.             |
| Bot lifecycle     | Create, start, stop, restart, and delete. New bots remain stopped. Restart runs without confirmation. A running bot cannot be deleted. Delete requires confirmation.                                                                                                                          |
| Bot configuration | Create and edit `label`, `host`, `port`, `username`, `version`, `password`, and `autoReconnect`. A running bot may save configuration, but the UI must state that restart is required. A stopped bot applies the saved configuration immediately. Passwords are never returned to the client. |
| Realtime stream   | Server-Sent Events (SSE) deliver status, health, log, and other metrics already exposed by the bot runtime. The server must not poll Minecraft or invent unavailable data.                                                                                                                    |
| Logs              | Load the recent per-bot buffer on selection, then append live entries. Support `info`, `warn`, and `error` filters, automatic scrolling, and client-only clearing. Server buffers and files are not changed by the client clear action.                                                       |
| Console/chat      | One input sends a normal chat message unless `/` is the first character. Only an exact first-character slash is treated as a command; leading whitespace means normal chat.                                                                                                                   |
| Statistics        | Display the values available from the runtime snapshot: uptime, health, food, ping, player count when supplied by the repo, and state. Missing runtime values are shown as unavailable rather than synthesized by polling.                                                                    |
| Token management  | Admin users have `/admin/tokens` and can create/revoke one active token per target Discord User ID. The full JWT is shown only once after creation. Existing rows show Discord User ID, token state, created time, expiry time, bot count, and revoke action. Revoke requires confirmation.   |
| Authorization     | `ADMIN_USER_IDS` determines the dashboard admin role for token management only. Admin users still pass the same bot ownership checks as normal users.                                                                                                                                         |

## Authentication and token contract

JWTs are signed and verified with `jsonwebtoken` and `process.env.ENCRYPTION_KEY`. The payload contains `userId`; `jsonwebtoken` supplies `iat` and `exp`. The command/form input is milliseconds, validated as an integer in the inclusive range `1,000` through `9,007,199,254,740,991`, and must be divisible by `1,000`. The resulting integer seconds are passed to `jwt.sign` as `expiresIn`.

Only a SHA-256 hash of the issued JWT is persisted in the database. The raw JWT is placed in the `httpOnly` cookie and is returned to the admin exactly once in the create-token response. A user has at most one active token. Creating a token for a user revokes/replaces the previous active token immediately. Revocation removes or invalidates the active token record so `jwt.verify` alone is not sufficient for authorization.

The session cookie is same-origin, `httpOnly`, and `sameSite=lax`; its `secure` flag follows `WEB_HTTPS`, not `NODE_ENV`. With `WEB_HTTPS=false`, HTTP origin deployments remain usable. With `WEB_HTTPS=true`, the public Cloudflare URL must be HTTPS. No authentication token is stored in localStorage, sessionStorage, or a JavaScript-readable cookie. Login must be rate-limited and protected routes must return generic errors without stack traces or secrets.

## API contract

All API paths are same-origin and use JSON. Protected requests authenticate from the session cookie. The server must perform ownership checks before every bot read or mutation.

| Method   | Path                        | Purpose                                                                                            |
| -------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/auth/login`           | Verify pasted JWT, verify active-token record, set session cookie, return safe principal metadata. |
| `POST`   | `/api/auth/logout`          | Clear the session cookie.                                                                          |
| `GET`    | `/api/auth/me`              | Return authenticated user ID and `isAdmin`; never return the JWT.                                  |
| `GET`    | `/api/bots`                 | List authorized bot snapshots grouped by `host + port`.                                            |
| `POST`   | `/api/bots`                 | Create an owned stopped bot using the shared `BotManager`.                                         |
| `GET`    | `/api/bots/:botId`          | Return one authorized bot snapshot and recent log buffer.                                          |
| `PATCH`  | `/api/bots/:botId`          | Validate and edit all supported bot fields through `BotManager`.                                   |
| `DELETE` | `/api/bots/:botId`          | Delete only a stopped authorized bot.                                                              |
| `POST`   | `/api/bots/:botId/start`    | Start an authorized bot.                                                                           |
| `POST`   | `/api/bots/:botId/stop`     | Stop an authorized bot.                                                                            |
| `POST`   | `/api/bots/:botId/restart`  | Restart an authorized bot immediately.                                                             |
| `POST`   | `/api/bots/:botId/chat`     | Send one chat/command input using the exact first-character slash rule.                            |
| `GET`    | `/api/events`               | Open one same-origin SSE stream for all authorized bots, with initial snapshots and live events.   |
| `GET`    | `/api/admin/tokens`         | Admin-only list of token metadata and owned-bot counts.                                            |
| `POST`   | `/api/admin/tokens`         | Admin-only create token for a manually entered Discord User ID and millisecond expiry.             |
| `DELETE` | `/api/admin/tokens/:userId` | Admin-only revoke the target user's active token.                                                  |

SSE events use `event:` names and JSON `data:` payloads. At minimum, the stream supports `bot:snapshot`, `bot:state`, `bot:health`, `bot:log`, `bot:deleted`, `auth:revoked`, and periodic keepalive comments. A client may reconnect using `Last-Event-ID`; events must remain safe to replay or be treated as transient updates.

## Discord contract

Add two administrator-only commands:

- `/new-token user:<Discord user ID or user option> expired:<milliseconds>` creates or replaces the selected user's token and returns the raw JWT only in the command response. The expiry must satisfy the same integer, bounds, and divisibility rules as the Web form.
- `/del-token user:<active token selection>` revokes the selected user's token and removes the active-token record. The command must not reveal the raw JWT. The selection must be backed by current persisted token metadata, not a stale hard-coded choice.

The token service must be shared by Web and Discord so both interfaces enforce identical replacement, hashing, expiry, and revocation behavior. When a user later creates a bot through Discord, the existing `BotManager` ownership field (`createdBy`) must be the same Discord User ID used by the Web token, making the bot visible through the Web API without a separate synchronization process. A bot created on Web must likewise be visible to Discord commands because both call `BotManager`.

## Frontend design

The frontend lives in the repository and is built with React, Vite, Tailwind CSS, Zustand, axios, `react-hook-form`, `@tanstack/react-virtual`, `lucide-react`, and `react-router`. Tailwind custom colors must use the approved tokens:

| Token            | Value     |
| ---------------- | --------- |
| `canvas`         | `#F7F8FA` |
| `surface`        | `#FFFFFF` |
| `border`         | `#E2E5EA` |
| `text-primary`   | `#1A1D23` |
| `text-secondary` | `#5C6270` |
| `accent`         | `#2563EB` |
| `status-online`  | `#16A34A` |
| `status-offline` | `#6B7280` |
| `status-error`   | `#DC2626` |
| `status-pending` | `#D97706` |

Routes are `/login`, `/dashboard`, `/dashboard/:botId`, and `/admin/tokens`. `/` redirects to `/login` when unauthenticated and `/dashboard` when authenticated. Axios uses `withCredentials: true` and a centralized 401 interceptor that clears client state and navigates to `/login`. `EventSource` is used directly for SSE; it relies on same-origin cookies and does not store tokens in client storage.

The selected bot view has `Log`, `Configuration`, and `Statistics` tabs. The sidebar and log list use `@tanstack/react-virtual` when their data sets are long. Every status indicator pairs color with readable status text. Buttons use only short transitions; there are no decorative animations, large radii, or heavy shadows.

## Project structure

The implementation may adapt this outline to existing conventions, but responsibilities must remain separated:

```text
src/web/
  server.js                 Express + HTTP server + static frontend hosting
  auth/                     JWT/token service and cookie middleware
  routes/                   auth, bots, events, and admin token routes
  sse/                      connection registry and event serialization
  commands/                 optional shared Web command parsing helpers
web/
  src/                      React/Vite application
  public/                   static assets
  dist/                     build output (not committed if generated)
```

The exact structure must preserve the existing CommonJS Node runtime and the current `BotManager` singleton. The Web server starts from `index.js` alongside Discord initialization and shuts down before database/logger teardown.

## Testing strategy

Use the repository's Node built-in test runner (`npm test`). Add focused unit tests for token expiry validation, JWT conversion, token hashing/revocation, first-character slash parsing, ownership checks, SSE event serialization, and safe bot snapshots. Add integration tests for protected REST routes where the existing database boundary can be safely exercised with fakes or a test database. Add a frontend build/type/lint check and manually verify login, empty state, bot CRUD, realtime updates, responsive sidebar, and admin token management.

Every new security-sensitive behavior needs a test. Tests must assert outcomes and authorization boundaries rather than internal call ordering. The full suite and lint must pass after implementation.

## Commands

```bash
npm ci
npm test
npm run lint
npm run build:web
npm run start
```

The existing `npm start` command remains the production entrypoint. `WEB_PORT` is read from the environment and defaults to `8080`; `WEB_HTTPS` is a strict boolean defaulting to `false` and controls HTTPS-oriented headers/cookies for the public reverse-proxy protocol. The container exposes the port through `docker-compose.yml`.

## Boundaries

### Always do

- Reuse `BotManager` and parameterized persistence operations.
- Enforce authentication and ownership server-side for every protected route and SSE subscription.
- Validate user input at API, command, and form boundaries.
- Store only token hashes, never raw tokens in the database or logs.
- Redact passwords and JWTs from snapshots, logs, errors, and audit metadata.
- Keep the generated frontend same-origin with the Node server.
- Run focused tests after each implementation slice and the full suite before delivery.

### Ask first

- Changing the ownership semantics or granting admins global bot access.
- Adding a second authentication mechanism or exposing raw tokens after initial creation.
- Changing the existing BotManager lifecycle contract.
- Replacing PostgreSQL or the existing persistence queue.

### Never do

- Never let the client read or write bot configuration/log files directly.
- Never trust client-side validation as authorization.
- Never put JWTs in localStorage or return passwords to the frontend.
- Never use Socket.IO or polling for realtime updates; SSE is the agreed transport.
- Never delete a running bot or silently auto-start a newly created bot.
- Never commit `.env`, real credentials, generated secrets, or raw token data.

## Success criteria

1. `npm test` and `npm run lint` pass, and the Web production build succeeds.
2. The Node process serves the frontend and `/api` routes on `WEB_PORT`, defaulting to `8080`.
3. A valid active JWT can log in via `/login`; invalid, expired, and revoked tokens cannot create a session.
4. Normal users can access only their owned bots, while admin status grants token-management access but not global bot access.
5. Web and Discord token creation/revocation share one service and enforce one active token, milliseconds bounds, and whole-second conversion.
6. Web and Discord bot CRUD operate on the same `BotManager` state and persisted records.
7. SSE delivers initial snapshots/logs and live state, health, metrics, and log events without polling.
8. The dashboard works at mobile and desktop breakpoints, supports the required lifecycle/configuration/log/chat/statistics flows, and uses the approved visual tokens.
9. Passwords, JWTs, and internal stack traces never appear in client responses or logs.
