# Web Dashboard Implementation Handoff

The repository now contains a same-origin React dashboard integrated into the existing Node process. The Web server and Discord commands share the singleton `BotManager`, PostgreSQL persistence, ownership checks, encryption, and runtime state.

## Run locally

Install dependencies and apply the idempotent schema:

```bash
npm ci
npm run db:schema
npm run build:web
npm start
```

The dashboard listens on `WEB_PORT`, which defaults to `8080`. Add this to `.env` when using the default port:

```dotenv
WEB_PORT=8080
WEB_HTTPS=false
```

The application still requires the existing Discord, database, encryption, and `ADMIN_USER_IDS` settings. Never commit `.env` or real JWTs. See [`cloudflare-reverse-proxy.md`](./cloudflare-reverse-proxy.md) for the HTTP-origin/Cloudflare HTTPS deployment matrix.

## Authentication

An administrator issues a token using Discord `/new-token user:<target> expired:<milliseconds>` or from the Web **Token management** page. The expiry must be an integer number of milliseconds between `1000` and `9007199254740991`, divisible by `1000`; non-whole-second values are rejected. The JWT is displayed only once after issuance. The user pastes it into `/login`; the server verifies it and sets an `httpOnly`, same-origin session cookie.

Each Discord User ID has one active token. Issuing a replacement invalidates the previous token. `/del-token user:<target>` and the Web **Revoke** action invalidate a token immediately. Affected SSE sessions are closed and the browser redirects to `/login`.

## Main routes

| Route               | Function                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `/login`            | Paste a JWT and start a session.                                                                          |
| `/dashboard`        | Responsive bot overview and empty state.                                                                  |
| `/dashboard/:botId` | Lifecycle controls, chat/command input, logs, configuration, and statistics.                              |
| `/admin/tokens`     | Admin-only token creation and revocation.                                                                 |
| `/api/events`       | Authenticated SSE stream for snapshots, state, health, logs, creation, updates, deletion, and revocation. |

## Database update

Run `db/schema.sql` against the configured PostgreSQL database. It adds the `bots.label` field and the `web_tokens` table. The schema uses `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`, so it remains safe to rerun.

## Docker

`Dockerfile` builds the Vite app in a separate stage and copies only `web/dist` into the Node runtime. `docker-compose.yml` maps `${WEB_PORT:-8080}` to the same container port. Docker was not available in the development sandbox, so the Compose/image build was not executed here; run the following in the deployment environment. For Cloudflare HTTPS, set `WEB_HTTPS=true` only after the public HTTPS hostname works and configure the edge redirect in Cloudflare; Node still listens on the origin HTTP port.

```bash
docker compose config
docker compose build
docker compose up -d
```

## Verification completed

The following checks passed in the development sandbox:

```bash
git diff --check
npm run lint
npm run build:web
npm test
npm audit --omit=dev
```

The current repository test suite reports **143 passing tests**. Manual browser verification requires a running PostgreSQL database and Discord configuration; the sandbox did not have those service credentials available.
