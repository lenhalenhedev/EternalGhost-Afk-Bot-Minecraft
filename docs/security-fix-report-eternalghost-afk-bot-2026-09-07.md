# Security Remediation Report — EternalGhost AFK Bot

- **Audit ID:** `eternalghost-afk-bot-2026-09-07`
- **Audit base commit (as recorded in the audit JSON):** `66cf76b0d9517238e6ee4a23a2686bf652516d44` — *this SHA is not present in this environment; the repository was squashed and the audited content is identical at the working baseline below.*
- **Working baseline commit (audited content):** `ce4429d1625040c2351eda7f9e5433f58625b10f` (`main`)
- **Fix branch:** `security-fix/eternalghost-afk-bot-2026-09-07`
- **Timestamp:** 2026-09-07
- **Total findings:** 18
- **Overall status:** Remediated. 12 fixed, 3 fixed-but-verification-limited (EG-005, EG-011, EG-012), 3 documented-only (EG-003, EG-014, EG-015).

> Structured results: `docs/security-fix-results-eternalghost-afk-bot-2026-09-07.json`

---

## 1. Executive summary

All 18 findings from the audit were re-validated individually against the actual
repository source. Every fixable finding received a code fix on the dedicated
branch `security-fix/eternalghost-afk-bot-2026-09-07` with regression tests, and
the full test/lint/build/audit suite passes. Three hardening changes
(trust-proxy configuration EG-005 and container/compose hardening EG-011/EG-012)
could not be exercised end-to-end in this sandbox because no live reverse proxy
or Docker daemon is available, so they are marked **verification_limited** with
their patches present. Three items were **documented_only** because a safe fix
either requires an operator/product decision or a ciphertext migration that
yields negligible benefit.

## 2. Scope and environment

- **Required runtime:** Node.js `>=24.0.0` (per `package.json` engines).
- **Runtime available in sandbox:** Node.js `v22.22.3`, npm `10.9.8` only.
  Node 24 was not installable (only npm-registry egress). **All executed tests,
  lint and builds therefore ran on Node 22** and must be re-run on Node 24
  before production; no full runtime verification on Node 24 is claimed.
- **OS:** Debian 12 (bookworm); repository targets Ubuntu.
- **Docker:** not installed → `docker build` and `docker compose config` were
  `not_run`; EG-011/EG-012 are config/static verified only.
- **Package manager:** npm. Backend and nested `web/` frontend installed
  (`npm ci --ignore-scripts` each); the web frontend was built with Vite.
- **Network safety:** outbound npm registry only. No Discord, Minecraft,
  PostgreSQL, cloud metadata, or production service was contacted. No load,
  brute-force or destructive testing was performed.
- **Source** was modified only on the fix branch; `main` was not touched; the
  read-only audit file `report/security-audit-result.json` was not modified.

## 3. Finding-by-finding results

Legend for statuses: F = fixed, VL = verification_limited, DO = documented_only.

| ID | Title | Sev | Orig audit | Now | Fix / why not |
|----|-------|-----|------------|-----|---------------|
| EG-001 | SSE broadcasts another user's `auth:revoked` | High | confirmed | **F** | Scope `auth:*` events per-user; `sanitizeEventData` drops `userId`. |
| EG-002 | `bot:created` exempt from visibility filter | High | likely | **F** | Fail-closed filter requires ownerId or visible-set membership. |
| EG-003 | Tokens delivered through Discord/browser | Medium | confirmed | **DO** | Warning + docs; distribution model unchanged (do_not_auto_fix). |
| EG-004 | No CSRF defence beyond SameSite=Lax | Medium | likely | **F** | Same-origin guard on unsafe `/api` methods. |
| EG-005 | Trust proxy never configured | Medium | confirmed | **VL** | `WEB_TRUST_PROXY` wiring added + tested; live-proxy unverified. |
| EG-006 | ENCRYPTION_KEY reused as JWT secret | Medium | confirmed | **F** | Dedicated `WEB_JWT_SECRET` (+ fallback + warning). |
| EG-007 | `jwt.verify` no algorithm allowlist | Low | likely | **F** | Pinned `{ algorithms: ['HS256'] }`. |
| EG-008 | Only login route rate limited | Medium | confirmed | **F** | Global + per-route limiters. |
| EG-009 | Chat cooldown consumed before auth | Low | confirmed | **F** | Authorize before consume in `chatBot`. |
| EG-010 | Rate-limiter maps grow unbounded | Low | confirmed | **F** | Prune expired entries + hard cap. |
| EG-011 | Container no runtime hardening | Low | likely | **VL** | chown-only-logs, HEALTHCHECK, read_only/cap_drop (image not built). |
| EG-012 | Compose publishes on all interfaces | Low | confirmed | **VL** | Loopback bind default + hardening (not docker-validated). |
| EG-013 | run.js unignored log.txt + shell | Low | confirmed | **F** | logs/run.log + shell:false + ignores. |
| EG-014 | Ciphertext embeds key fingerprint | Info | potential | **DO** | Accepted; removal needs ciphertext migration. |
| EG-015 | No least-privilege DB role guidance | Info | potential | **DO** | Documented two-role guidance. |
| EG-016 | Unused WebNotifier owner-less publisher | Info | false_positive | **F** | Deleted dead module. |
| EG-017 | Transitive qs 6.15.3 moderate advisories | Medium | potential | **F** | qs → 6.16.0 (npm audit fix non-force); audit 0. |
| EG-018 | Config `process.exit(1)` at require | Low | confirmed | **F** | Config throws; hermetic test env via preload. |

### EG-001 (High, F) — SSE `auth:revoked` cross-user leak
Confirmed in `src/web/routes/events.js`: a foreign `auth:revoked` carried only
`{ userId }`, fell through every filter and was written verbatim to all
subscribers. Fix extracted the authorization into `eventDecision()` which treats
every `auth:*` event as strictly per-user; `sanitizeEventData` also strips any
`userId`. Regression tests in `tests/securitySseScope.test.js`. Commit `660d487`.

### EG-002 (High, F) — `bot:created` visibility exemption
Reachability was *not* currently exploitable (all live publishers include
`ownerId`), but the filter was fail-open. Now bot events require a matching
`ownerId` or membership in the principal's visible set, so an ownerless
`bot:created` snapshot is dropped for every subscriber. Commit `660d487`.

### EG-003 (Medium, DO)
The credential is a bearer token delivered over Discord ephemeral replies and
returned by the token API. Full mitigation is a product decision (claim-code
redemption / Discord OAuth2). Remediation added treat-as-password warnings to
`/new-token` and `/renew-token`, documentation, and short-TTL guidance. Commit
`4229c19`. Residual risk documented.

### EG-004 (Medium, F) — CSRF
Added `src/web/middleware/sameOriginGuard.js`, mounted before all `/api`
routers. Unsafe-method requests with a mismatched `Origin` or
`Sec-Fetch-Site: cross-site` are rejected 403; non-browser clients (no Origin)
and GET/HEAD/OPTIONS are unaffected. Test `tests/webSecurity.test.js`. Commit
`752faf1`.

### EG-005 (Medium, VL) — trust proxy
Added `WEB_TRUST_PROXY` (hop count or IP/CIDR list; explicitly never the boolean
`true`). `server.js` calls `app.set('trust proxy', v)` only when configured. A
loopback probe confirms `trust proxy` is set to `1` when configured and `false`
otherwise. The rate limiters then key on the real client when a proxy is present
and are not spoofable when absent. Live proxied behaviour could not be exercised
(sandbox has no proxy), hence **verification_limited**. Commit `752faf1`.

### EG-006 (Medium, F) — key separation
`config.web.jwtSecret` prefers a new optional `WEB_JWT_SECRET` (>=32 chars) and
falls back to `ENCRYPTION_KEY` for backward compatibility, flagging the fallback
so `index.js` can warn at startup. Rotating `ENCRYPTION_KEY` no longer
invalidates sessions when a dedicated secret is configured. Test
`tests/jwtSecretSeparation.test.js`. Commit `252b1cb`. Operator note: set
`WEB_JWT_SECRET` and restart.

### EG-007 (Low, F) — algorithm pin
`jwt.verify` now passes `{ algorithms: ['HS256'] }`. A token signed HS512 is
rejected before the DB is consulted while an HS256 token still verifies. Test
`tests/tokenServiceAlgorithm.test.js`. Commit `252b1cb`.

### EG-008 (Medium, F) — rate limiting
A baseline global limiter plus tighter per-route limiters on `/api/bots` and
`/api/events` were added, tunable via `WEB_GLOBAL_LIMIT_PER_MIN`,
`WEB_BOTS_LIMIT_PER_MIN`, `WEB_EVENTS_LIMIT_PER_MIN`. Probe confirms HTTP 429
after the budget is exceeded. Commit `752faf1`.

### EG-009 (Low, F)
`BotManager.chatBot` authorizes the target before consuming the caller's chat
cooldown. A denied (foreign/missing) request no longer burns quota. Test
`tests/chatAuthOrder.test.js`. Commit `59a2035`.

### EG-010 (Low, F)
Both rate limiters prune expired entries (lazily and via `prune()`) and enforce
a 10,000-entry hard cap, so per-user maps are bounded. Tests
`tests/rateLimiterPrune.test.js`. Commit `59a2035`.

### EG-011 (Low, VL) — container hardening
Dockerfile chowns only `/app/logs` (app code & `node_modules` stay root-owned
and read-only for the runtime user), adds a `HEALTHCHECK`, and runs `node
index.js` directly. Compose sets `read_only: true`, a `/tmp` tmpfs,
`cap_drop: ALL` and `no-new-privileges: true`. Docker was unavailable so the
image was not built/run — **verification_limited**. Commit `03141a5`.

### EG-012 (Low, VL) — compose exposure
`docker-compose.yml` publishes to `127.0.0.1` by default
(`WEB_BIND_HOST` overrides). The hardening notes document when and how to widen.
`docker compose config` could not be run (no Docker) — **verification_limited**.
Commit `03141a5`.

### EG-013 (Low, F)
`run.js` writes to `logs/run.log` (gitignored), spawns without a shell, and
`log.txt`/`web/dist` are now ignored. Test `tests/securityOperationalHygiene.test.js`.
Commit `03141a5`.

### EG-014 (Info, DO)
Accepted and documented. The 8-hex `SHA-256(key)` fingerprint is a recognised
key-rotation design; removal requires a ciphertext-migrating change to an opaque
`ENCRYPTION_KEY_ID` for negligible benefit. Commit `4229c19` (documentation).

### EG-015 (Info, DO)
Documented a two-role (schema owner/migration vs. least-privilege runtime) setup
with GRANT guidance. Preventative; no injection path was found. Commit `4229c19`
(documentation).

### EG-016 (Info, F)
Deleted the provably-unreferenced `src/web/sse/WebNotifier.js`, which duplicated
`instanceEvents.js` without `ownerId`; only the ownerId-carrying publisher
remains. Commit `660d487`.

### EG-017 (Medium, F) — qs advisory
`npm audit fix` (non-force) updated the transitive `qs` from `6.15.3` to the
patched `6.16.0`. `npm audit --audit-level=moderate` now reports **0
vulnerabilities**. No route consumes `req.query`, so the array-limit advisory was
already non-reachable; the parsing-cost advisory is now cleared at the
dependency level. Commit `9462ffe`.

### EG-018 (Low, F) — env-dependent test suite
`src/config` now throws `CONFIG_INVALID` instead of calling `process.exit(1)` at
require time; `index.js` preserves the fail-closed startup exit. The `npm test`
script preloads `tests/support/envSetup.js`, so the whole suite runs from a clean
checkout with no manual environment setup. Test `tests/config.test.js`. Commit
`2a7d873`.

## 4. Dependency and infrastructure changes

- **Dependency:** `qs` 6.15.3 → 6.16.0 in `package-lock.json` (transitive via
  express). `npm audit` (root and `web/`) both report 0 moderate-or-higher
  vulnerabilities.
- **Runtime secret/env additions:** `WEB_JWT_SECRET` (optional, >=32 chars),
  `WEB_TRUST_PROXY` (hop count or proxy IP/CIDR list), `WEB_GLOBAL_LIMIT_PER_MIN`,
  `WEB_BOTS_LIMIT_PER_MIN`, `WEB_EVENTS_LIMIT_PER_MIN`, `WEB_BIND_HOST`
  (compose). Documented in `.env.example`.
- **Dockerfile:** root-owned read-only app code; `/app/logs` writable; HEALTHCHECK;
  direct `node index.js` entrypoint.
- **docker-compose.yml:** loopback bind by default, `read_only`, `/tmp` tmpfs,
  `cap_drop: ALL`, `no-new-privileges: true`.
- **DB:** no schema change; least-privilege guidance documented only.
- **Compatibility/rollback:** key-separation and trust-proxy are opt-in env
  settings with backward-compatible defaults (fallback secret + startup
  warning). Compose bind change defaults to loopback; set `WEB_BIND_HOST=0.0.0.0`
  to restore all-interface publishing. All behaviour-affecting changes are
  reverted by reverting the corresponding commit.

## 5. Verification matrix

All commands ran on **Node v22.22.3 / npm 10.9.8**.

| Check | Command | Result |
|-------|---------|--------|
| Runtime | `node --version` | v22.22.3 (required >=24 — limitation) |
| npm | `npm --version` | 10.9.8 |
| Whitespace | `git diff --check` | pass (rc 0) |
| Tests | `npm test` | **pass** — 196/196 |
| Lint | `npm run lint` | **pass** (rc 0) |
| Backend build | `npm run build:web` (vite) | **pass** (1671 modules built) |
| Root audit | `npm audit --audit-level=moderate` | **pass** — 0 vulnerabilities |
| Frontend install | `npm --prefix web ci --ignore-scripts` | **pass** (161 pkgs, 0 vuln) |
| Frontend build | `npm --prefix web run build` | **pass** |
| Frontend audit | `npm --prefix web audit --audit-level=moderate` | **pass** — 0 vulnerabilities |
| Targeted tests | SSE scope, token alg/key, web security, chat order, limiter prune, config, hygiene | all pass |
| Docker build | `docker build .` | **not_run** — Docker unavailable |
| Compose config | `docker compose config` | **not_run** — Docker unavailable |

## 6. Unresolved and limited findings

- **EG-005 / EG-011 / EG-012 (verification_limited):** patches are in place and
  statically/unit verified, but end-to-end runtime confirmation requires a live
  reverse proxy and a Docker daemon, both unavailable in the sandbox. Follow-up:
  run behind Cloudflare with `WEB_TRUST_PROXY=1` and build/run the image under
  `docker compose` before production; confirm the compose bind setting against
  the operator's proxy topology.
- **Node 22 vs >=24:** every executed check ran on Node 22. Re-run `npm test`,
  `npm run lint`, and both builds on Node 24 LTS before shipping.
- **EG-003 / EG-014 / EG-015 (documented_only):** EG-003 residual risk (token
  delivered over Discord) is acceptable for ephemeral operator use but should be
  re-visited (claim-code redemption / OAuth2). EG-014 residual risk accepted.
  EG-015 is an operational hardening recommendation.

## 7. Change summary

| Commit | Scope | Files |
|--------|-------|-------|
| `9462ffe` | EG-017 | `package-lock.json` (qs → 6.16.0) |
| `2a7d873` | EG-018 | `package.json`, `index.js`, `src/config/index.js`, `tests/support/envSetup.js`, `tests/config.test.js` |
| `660d487` | EG-001/002/016 | `src/web/routes/events.js`, `src/web/sse/WebNotifier.js` (removed), `tests/securitySseScope.test.js` |
| `252b1cb` | EG-006/007 | `src/config/index.js`, `src/web/auth/tokenService.js`, `index.js`, `.env.example`, `tests/tokenServiceAlgorithm.test.js`, `tests/jwtSecretSeparation.test.js` |
| `752faf1` | EG-004/005/008 | `src/config/index.js`, `src/web/server.js`, `src/web/middleware/sameOriginGuard.js`, `tasks/check-web-security.js`, `tests/webSecurity.test.js`, `.env.example` |
| `59a2035` | EG-009/010 | `src/manager/BotManager.js`, `src/utils/rateLimiter.js`, `tests/chatAuthOrder.test.js`, `tests/rateLimiterPrune.test.js` |
| `03141a5` | EG-011/012/013 | `Dockerfile`, `docker-compose.yml`, `run.js`, `.gitignore`, `.dockerignore`, `tests/securityOperationalHygiene.test.js` |
| `4229c19` | EG-003/014/015 + docs | `src/discord/commands/new-token.js`, `src/discord/commands/renew-token.js`, `docs/security-deployment.md` |
| `bd0ba47` | lint scope | `eslint.config.mjs` |
| (this commit) | artifacts | `.gitignore`, `docs/security-fix-report-*.md`, `docs/security-fix-results-*.json` |

Files intentionally untouched / out of scope: the read-only
`report/security-audit-result.json`; DB schema logic (`db/schema.sql` unchanged
— only documented); no unrelated refactoring performed. `web/` source is
unchanged except through the build-ignore entry; the SPA already consumed the
SSE/cookie model unchanged by these fixes.

## 8. Security and operational risks

- Rate-limit defaults are tuned conservatively; an operator with heavier
  dashboard usage must raise `WEB_*_LIMIT_PER_MIN` or users may see 429s.
- Setting `WEB_TRUST_PROXY` incorrectly can make the limiter key on a spoofable
  header. Default (unset) is safe. Never set it to the literal `true`.
- The compose loopback-bind default changes default exposure; operators with a
  proxy on a different host must set `WEB_BIND_HOST`.
- New `WEB_JWT_SECRET` is optional; if unset the app logs a warning and uses
  `ENCRYPTION_KEY` (previous behaviour).
- Container `read_only`/`cap_drop` may surface an unanticipated writable-path
  at runtime; validate by building/running the image (currently unverified).

## 9. PR handoff

- Fix branch: `security-fix/eternalghost-afk-bot-2026-09-07`
- Base branch: `main`
- Commit list: `9462ffe … HEAD` (10 remediation commits + artifacts commit).
- PR URL/number: to be recorded after push.
- **Merge was not performed** and must not be performed by this agent.
