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
