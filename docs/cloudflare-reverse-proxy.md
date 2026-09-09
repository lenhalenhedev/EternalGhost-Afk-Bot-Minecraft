# Cloudflare Reverse Proxy and HTTP/HTTPS Deployment

This repository serves the dashboard, REST API, and SSE endpoint from the same Node origin. **Node does not terminate TLS.** Cloudflare terminates the public HTTPS connection and forwards the request to the Node origin. The `WEB_HTTPS` flag tells the application whether the **public** connection is HTTPS; it does not create certificates or turn the Node listener into an HTTPS server.

The current browser errors have two distinct causes. First, Helmet's default Content Security Policy includes `upgrade-insecure-requests`, which can upgrade HTTP asset URLs to HTTPS; Helmet documents that this directive causes browsers to upgrade HTTP requests and shows disabling it when developing without HTTPS [1]. Second, `https://hk1.quvo.pro:15029` is not the same origin as `http://hk1.quvo.pro:15029`; a plain HTTP listener cannot answer an HTTPS TLS handshake, which produces `ERR_SSL_PROTOCOL_ERROR`.

## Application settings

Use the following origin configuration while the hosting platform exposes a plain HTTP port:

```dotenv
WEB_PORT=15029
WEB_HTTPS=false
```

With `WEB_HTTPS=false`, the server disables `upgrade-insecure-requests`, HSTS, COOP, and Origin-Agent-Cluster headers that are inappropriate for an untrusted HTTP origin. Session cookies remain `httpOnly` but are not marked `Secure`, so login works over HTTP during development or a private origin connection.

Use this configuration only when the public connection is genuinely HTTPS at Cloudflare:

```dotenv
WEB_PORT=15029
WEB_HTTPS=true
```

With `WEB_HTTPS=true`, the server enables HTTPS-oriented browser policies and marks the session cookie `Secure`. The Node listener remains HTTP on `WEB_PORT`; Cloudflare must be configured to accept HTTPS publicly and proxy to that origin. Do not set this flag merely because the origin is behind a proxy: set it when the public URL users open is HTTPS.

| Public URL                                                         | Node origin                           | `WEB_HTTPS` | Cloudflare SSL mode / redirect             | Intended for production?                                    |
| ------------------------------------------------------------------ | ------------------------------------- | ----------: | ------------------------------------------ | ----------------------------------------------------------- |
| `http://host:15029`                                                | HTTP `:15029`                         |     `false` | Off                                        | No — local development or an isolated private network only  |
| `https://dashboard.example.com`                                    | HTTP `:15029`                         |      `true` | Flexible — origin hop is plaintext         | No — emergency exception only (see below)                   |
| `http://dashboard.example.com` and `https://dashboard.example.com` | HTTP `:15029`                         |     `false` | Off, both public                           | No — session cookie is not `Secure`                         |
| `https://dashboard.example.com`                                    | HTTPS origin with a valid certificate |      `true` | Full (strict), Always Use HTTPS on         | **Yes — the only supported public configuration**            |

## Important port requirement

Cloudflare's current default proxy port list includes HTTP ports `80`, `8080`, `8880`, `2052`, `2082`, `2086`, and `2095`, and HTTPS ports `443`, `2053`, `2083`, `2087`, `2096`, and `8443` [2]. **Port `15029` is not in that default list.** Therefore, do not expect a normal proxied URL such as `https://hk1.quvo.pro:15029` to work through Cloudflare's standard HTTP proxy.

The recommended layout is:

```text
Browser https://dashboard.example.com:443
        │
        ▼
Cloudflare edge TLS + HTTP proxy
        │  origin HTTP
        ▼
Node dashboard http://container-or-origin:15029
```

Expose the public hostname through a Cloudflare-supported edge port, normally `443`, and configure the hosting platform or a local reverse proxy to forward that request to the container's `WEB_PORT=15029`. If the platform only provides `http://host:15029` and cannot map a supported public port, the choices are to keep the hostname DNS-only and use HTTP, change the origin exposure to a supported Cloudflare port, or use Cloudflare Spectrum. Cloudflare documents Spectrum as the product for additional ports, with all TCP/UDP ports available only on Enterprise [2].

## The only recommended public deployment path: Full (strict)

This dashboard carries JWT-backed session cookies, bot credentials in transit,
and privileged bot-control requests. **Full (strict) with a validated origin
certificate is the only supported configuration for a public deployment.**
`WEB_HTTPS` never creates a TLS listener in Node — it only changes browser
headers and cookie flags — so the application cannot compensate for a plaintext
origin hop.

Prerequisites before any public hostname is published:

1. Terminate TLS at the origin or at a reverse proxy in front of the Node
   listener, using a Cloudflare Origin CA certificate or another certificate
   the edge validates.
2. In **SSL/TLS → Overview**, select **Full (strict)**. Cloudflare's mode
   documentation states Full (strict) validates the origin certificate while
   Full does not [6].
3. In **SSL/TLS → Edge Certificates**, enable **Always Use HTTPS**. Cloudflare
   documents this as redirecting visitor HTTP requests to HTTPS and recommends
   doing the redirect at the edge rather than the origin to avoid redirect
   loops [5].
4. Set `WEB_HTTPS=true` so the session cookie is marked `Secure` and the
   HTTPS-oriented browser policies are enabled, then restart the process.
5. Keep the origin itself unpublished: firewall it or use an origin access
   policy so the edge is the only public entry point, and set
   `WEB_PUBLIC_ORIGIN` to the public origin so the same-origin CSRF guard
   compares against the real deployment origin.

## Emergency exception: Flexible (non-production only)

Flexible encrypts the visitor-to-Cloudflare connection while the
Cloudflare-to-origin hop stays HTTP [4]. It is **not** a supported production
configuration for this dashboard, and following it on an origin path that
crosses an untrusted or shared network exposes authenticated session traffic to
observation and tampering.

Use it only when all of the following hold:

- the edge-to-origin path is fully trusted and isolated (loopback, a private
  VPC, or a container network with no other tenants), which
  `docker-compose.yml` already provides by publishing to `127.0.0.1`;
- the deployment carries no privileged traffic, or the exposure is time-boxed
  for a specific migration;
- a **dated migration plan** exists to move to Full (strict), and the plan is
  tracked rather than deferred indefinitely.

Steps, and their constraints:

1. Create an `A`, `AAAA`, or `CNAME` record for `dashboard.example.com` and set
   it to **Proxied** (orange cloud) only when the public request arrives on a
   supported HTTP/HTTPS port [3].
2. In **SSL/TLS → Overview**, choose **Flexible**. Cloudflare explicitly
   recommends moving to Full or Full (strict) when possible [4].
3. Forward the public request to the Node listener at `WEB_PORT=15029`.
4. `WEB_HTTPS=false` is correct only while the public connection is genuinely
   HTTP. Because `WEB_HTTPS=false` leaves the session cookie without the
   `Secure` flag, a browser that reaches the origin over HTTP can send it back
   over a downgrade — so never combine this exception with an
   `Always Use HTTPS` redirect that leaves any HTTP route reachable.
5. Migrate to Full (strict) and set `WEB_HTTPS=true` on the planned date.

## Long-term setup (target state)

After obtaining a certificate for the origin, use **Full (strict)**. In the
target layout:

```dotenv
WEB_PORT=15029
WEB_HTTPS=true
```

Then configure Cloudflare **SSL/TLS → Overview → Full (strict)**. If TLS is terminated only at Cloudflare and the Node origin stays HTTP, do not claim end-to-end encryption; use a Cloudflare Origin CA certificate or another valid origin certificate and terminate TLS at the origin/reverse proxy before selecting Full (strict).

## Fixing the reported browser errors

| Browser message                                        | Meaning                                                                                                        | Fix                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_SSL_PROTOCOL_ERROR` for CSS/JS/favicon            | The browser requested HTTPS from a plain HTTP listener, commonly due to CSP upgrade or a mixed-protocol frame. | Deploy with `WEB_HTTPS=false` for direct HTTP; clear cached redirects; access `http://...`; or use a real Cloudflare HTTPS hostname and set `WEB_HTTPS=true`. |
| COOP ignored because origin is untrustworthy           | HTTP is not a trustworthy origin for this browser isolation policy.                                            | Non-fatal. HTTP mode now disables COOP. Use HTTPS for the policy.                                                                                             |
| Origin-Agent-Cluster could not be origin-keyed         | The browser received origin-keying headers on an HTTP/site-keyed origin.                                       | Non-fatal. HTTP mode now disables Origin-Agent-Cluster. Use one consistent protocol per public origin.                                                        |
| Unsafe attempt to load `https://...` from `http://...` | A frame or resource crossed protocol/port boundaries.                                                          | Use same-origin relative asset URLs, do not mix HTTP page with HTTPS port, and let Cloudflare perform the HTTP→HTTPS redirect.                                |

Cloudflare also notes that Always Use HTTPS does not itself fix mixed-content resources; pages should use relative or HTTPS URLs [5]. This application uses relative Vite asset URLs, so the remaining requirement is to use one consistent public protocol.

## Verification checklist

Check the origin directly before enabling the Cloudflare redirect:

```bash
curl -I http://ORIGIN_HOST:15029/healthz
curl -I http://ORIGIN_HOST:15029/
```

Expected origin behavior with `WEB_HTTPS=false` is HTTP `200` for `/healthz` and an HTTP response for `/`. The response must not contain `Content-Security-Policy: ... upgrade-insecure-requests` or `Strict-Transport-Security`.

After configuring Cloudflare and setting `WEB_HTTPS=true`, test the public hostname without the origin port:

```bash
curl -I http://dashboard.example.com/
curl -I https://dashboard.example.com/
curl -N https://dashboard.example.com/api/events
```

The HTTP request should return a Cloudflare redirect when **Always Use HTTPS** is enabled. The HTTPS request should return the application response, and the SSE request should remain open with `Content-Type: text/event-stream`.

Do not use `https://ORIGIN_HOST:15029` unless that exact port is running a TLS listener. `WEB_HTTPS=true` does not create a TLS listener and cannot replace a certificate or reverse proxy.

## Pre-publication checklist

Do not publish a public hostname until every line is satisfied. This is the
deployment-side counterpart to the application's own transport rules; the
application cannot enforce them for you.

- [ ] Cloudflare **SSL/TLS → Overview** is set to **Full (strict)**, not
      Flexible, Full, or Off.
- [ ] TLS is terminated at the origin or at a reverse proxy in front of the
      Node listener, with a certificate the edge validates.
- [ ] **Always Use HTTPS** is enabled and no HTTP route reaches the dashboard.
- [ ] `WEB_HTTPS=true`, so the session cookie carries the `Secure` flag.
- [ ] `WEB_PUBLIC_ORIGIN` matches the public origin exactly (scheme, host and
      port), so the same-origin CSRF guard compares against the real
      deployment origin rather than an inferred one.
- [ ] The origin port is not published to the Internet: it is reachable only
      from the edge (firewall rule, origin access policy, or the compose file's
      loopback binding).
- [ ] `WEB_TRUST_PROXY` is set to a hop count or explicit proxy list only if a
      trusted proxy really is in front, and is unset otherwise.
- [ ] If the Flexible exception was ever used, its dated migration to Full
      (strict) has been completed and the exception removed.

## References

[1]: https://helmetjs.github.io/ 'Helmet.js official documentation — CSP and HTTPS-related headers'
[2]: https://developers.cloudflare.com/fundamentals/reference/network-ports/ 'Cloudflare official documentation — Network ports'
[3]: https://developers.cloudflare.com/dns/proxy-status/use-cases/ 'Cloudflare official documentation — Proxy use cases'
[4]: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/flexible/ 'Cloudflare official documentation — Flexible SSL/TLS mode'
[5]: https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/ 'Cloudflare official documentation — Always Use HTTPS'
[6]: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/ 'Cloudflare official documentation — SSL/TLS encryption modes'
