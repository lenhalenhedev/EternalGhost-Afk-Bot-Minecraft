# Security deployment notes

The dashboard supports both direct HTTP development deployments and public HTTPS deployments behind a trusted reverse proxy. HTTP is appropriate only for localhost or a private, trusted network. Never expose a plain HTTP origin containing dashboard sessions directly to the Internet.

When the public URL is HTTPS, set `WEB_HTTPS=true`. This marks the `eg_session` cookie as `Secure` and enables HTTPS-oriented browser headers. The setting does **not** create a TLS listener in Node; the reverse proxy or hosting platform must terminate TLS.

For Cloudflare or another reverse proxy, keep the Node origin private with firewall rules or an origin access policy. Do not publish the container port directly to the Internet if the proxy is intended to be the only public entry point. Prefer TLS from the browser to the edge and from the edge to the origin when the network between them is not fully trusted.

The application intentionally does not force HTTPS globally because localhost, Docker, private-network, and platform-specific deployments may use HTTP by design. Operators are responsible for choosing a transport appropriate to their threat model.

## Token and rate-limit behavior

Dashboard token creation and renewal use whole days. Token lifetime is capped at 365 days. Renewal extends the stored expiry by the requested number of days, then applies the hard cap of the current UTC time plus 12 months.

The current chat and bot-creation limiters are process-local by design. They do not use Redis, Valkey, or database-backed shared state. In a multi-replica deployment, each replica therefore has its own limiter state and the limits are not globally consistent. This trade-off is intentional to avoid adding a mandatory infrastructure dependency; a future contribution may add a shared limiter adapter.

## Multi-tab SSE

The browser dashboard maintains one SSE connection for all tabs. One tab is elected Master and forwards events over the same-origin `BroadcastChannel`; Slave tabs consume the forwarded events. If the Master disappears for more than the heartbeat timeout, the remaining tabs elect a replacement. Reconnect uses exponential backoff with jitter, starting at approximately one second and capped at 30 seconds.

## Security hardening notes (post-audit)

These notes document decisions and residual risks from the security remediation.

### Session cookies, CSRF and same-origin enforcement

Authenticated state-changing endpoints use a same-origin guard on top of
`SameSite=Lax` and JSON-only body parsing. Cross-origin unsafe-method requests
(checked via the `Origin` and `Sec-Fetch-Site` headers) are rejected with HTTP
403. Non-browser server-side clients (no `Origin`) remain supported.

### Trusting a reverse proxy and client-IP rate limiting

Rate limiters key on `req.ip`. When the origin sits behind Cloudflare or another
trusted reverse proxy, Express must be told to trust it so it can read the real
client IP from `X-Forwarded-For` instead of keying every request on the proxy's
socket address. Set `WEB_TRUST_PROXY` to a hop count (`1`) or to a comma/space
list of trusted proxy IPs/CIDRs. **Leave it unset for direct-to-Internet
deployments** and never set it to the literal boolean `true`, which would let an
attacker spoof `X-Forwarded-For`.

Requests are throttled by a baseline global limiter plus tighter per-route
limits on `/api/bots` and `/api/events`. Defaults are `WEB_GLOBAL_LIMIT_PER_MIN`,
`WEB_BOTS_LIMIT_PER_MIN` and `WEB_EVENTS_LIMIT_PER_MIN`; tune them to real
dashboard usage.

### Container and compose hardening

`docker-compose.yml` now publishes the dashboard port to the host loopback
(`127.0.0.1`) by default instead of `0.0.0.0`, so a plaintext HTTP origin is not
exposed to the network unless the operator chooses to. To widen deliberately
(e.g. a reverse proxy on another host), set `WEB_BIND_HOST=0.0.0.0`, or better,
place the app on an internal Docker network with the proxy as the only
publisher. The service also runs with a read-only root filesystem, `cap_drop:
[ALL]`, `no-new-privileges: true`, an init process, and a `/tmp` tmpfs. The
Dockerfile keeps the application code and `node_modules` root-owned and makes
only `/app/logs` writable by the runtime user, and adds a health check. Because
these depend on the operator's exact topology, they must be re-validated against
the deployment's firewall/proxy layout.

### Web dashboard tokens

Dashboard tokens are long-lived bearer credentials delivered over Discord
ephemeral replies and returned by the token-management API. Even with ephemeral
delivery they should be treated like passwords: do not screenshot them, do not
paste them into shared chats or support DMs, and prefer the shortest practical
expiry. Token lifetime is capped at 365 days; revoking a token immediately
invalidates it. Consider DM-only delivery with a short-lived one-time claim code
or Discord OAuth2 as a future hardening step.

### Key separation (encryption vs. JWT signing)

Prefer setting a dedicated `WEB_JWT_SECRET` (>= 32 characters) for dashboard JWT
signing. When unset the application falls back to `ENCRYPTION_KEY` with a
startup warning for backward compatibility. Separating the two means rotating
`ENCRYPTION_KEY` does not silently log out every session, and a single leaked
secret does not grant both session forgery and Minecraft-password decryption.

### Database least privilege

Apply the schema with a separate migration/owner role and run the application
with a least-privilege role that has only `SELECT`/`INSERT`/`UPDATE`/`DELETE` on
the application tables plus `USAGE` on the sequences it needs. A database role
that can also execute the schema DDL turns any future injection or credential
leak into full schema destruction. PostgreSQL Row-Level Security keyed on
`created_by` is an additional optional defence-in-depth layer.

### Encrypted-password fingerprint (residual risk, accepted)

Stored ciphertext payloads embed an 8-hex-character `SHA-256(key)` fingerprint
used to select the correct key during rotation. Because the encryption key is 32
random bytes, this leaks no usable key material; its only theoretical value is
confirming a key candidate or correlating rows across deployments after a
partial key leak. It is a recognised design for key rotation and does not weaken
AES-256-GCM, so it is accepted as-is. An opaque `ENCRYPTION_KEY_ID` configured
alongside the key could remove it in a future (ciphertext-migrating) change.
