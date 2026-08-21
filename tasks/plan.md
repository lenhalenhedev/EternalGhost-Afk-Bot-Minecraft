# Implementation Plan: EternalGhost Web Admin

## Overview

Bổ sung HTTP web server vào process Node.js hiện có, tái sử dụng `BotManager` và `Persistence` cho một admin web duy nhất. Triển khai theo lát dọc: auth/session, status, bot control, observability, rồi UI và verification.

## Architecture decisions

1. Dùng `node:http` và CommonJS built-in để không thêm web framework nặng vào bot daemon.
2. Dùng `src/web/private` cho server-only modules và `src/web/public` cho static client assets.
3. Dùng session cookie in-memory với TTL và CSRF token header; không dùng JWT/localStorage.
4. Dùng SHA-256 hex theo yêu cầu env của người dùng, so sánh constant-time; không bao giờ nhận plaintext password từ server config.
5. Web principal reuse canonical `BotManager` authorization by using the configured web username and null guild.
6. Tất cả bot CRUD/lifecycle/chat gọi các method hiện có; không duplicate validation/encryption.
7. `/status` public chỉ là sanitized read model; admin APIs mới trả logs/activity.

## Dependency graph

```text
config/env + auth/session helpers
        │
        ├── HTTP router + JSON/static helpers
        │       │
        │       ├── auth routes
        │       ├── public status route
        │       └── protected bot routes
        │               │
        │               └── admin frontend API client/UI
        │
        └── index.js startup/shutdown integration
```

## Slices

### Phase 1: Foundation

- [ ] Add web env configuration and validation helpers.
- [ ] Add web server composition, secure headers, static file serving and path traversal protection.
- [ ] Add tests for auth hash comparison, session, CSRF and body parsing.

### Checkpoint: Foundation

- [ ] Existing tests pass.
- [ ] Web server can start with an isolated fake manager.
- [ ] `/status` is public and `/api/bots` rejects anonymous requests.

### Phase 2: Core control plane

- [ ] Add auth/session routes.
- [ ] Add status/stats/help read routes.
- [ ] Add bot list/create/edit/delete routes.
- [ ] Add lifecycle, chat and selection routes.

### Checkpoint: Core features

- [ ] Every Discord command has a web endpoint or an explicit equivalent.
- [ ] No response contains `encryptedPassword` or auth secrets.
- [ ] Manager errors map to safe HTTP responses.

### Phase 3: Observability and frontend

- [ ] Add logs and activity routes with bounded filters.
- [ ] Build cyberpunk public/admin HTML, CSS and client JS.
- [ ] Add README and `.env.example` documentation.

### Checkpoint: Complete

- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] Format check passes.
- [ ] Manual curl/browser smoke test passes.
- [ ] No secrets or unintended files staged.

## Risks and mitigations

| Risk                                            | Impact | Mitigation                                                                                      |
| ----------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Existing config exits on missing Discord/DB env | High   | Keep web env optional during module import; require it only when server is enabled/startup.     |
| HTTP public exposure                            | High   | Bind configurable host, document TLS limitation, use session/CSRF/rate limits/security headers. |
| Bot manager principal scope                     | High   | Use a stable web principal and verify every route through `resolveAuthorizedBot`/list methods.  |
| Password disclosure in snapshots                | High   | Central response sanitizer and tests asserting forbidden keys.                                  |
| Large logs/body causing memory growth           | Medium | Hard caps for body, lines, hours and response payload.                                          |
| Adding framework dependency                     | Medium | Use built-in `node:http` to minimize RAM and supply-chain surface.                              |

## Verification commands

```bash
npm test
npm run lint
npm run format:check
```

Manual smoke test uses a test process with fake manager dependencies where possible and checks status code, JSON shape, headers, auth flow, CSRF rejection, static files and path traversal rejection.
