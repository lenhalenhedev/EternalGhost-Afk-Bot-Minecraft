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

| Public URL                                                         | Node origin                           | `WEB_HTTPS` | Cloudflare redirect                        |
| ------------------------------------------------------------------ | ------------------------------------- | ----------: | ------------------------------------------ |
| `http://host:15029`                                                | HTTP `:15029`                         |     `false` | Off                                        |
| `https://dashboard.example.com`                                    | HTTP `:15029`                         |      `true` | On at Cloudflare                           |
| `http://dashboard.example.com` and `https://dashboard.example.com` | HTTP `:15029`                         |     `false` | Off, only if both are intentionally public |
| `https://dashboard.example.com`                                    | HTTPS origin with a valid certificate |      `true` | On at Cloudflare                           |

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

## Recommended Cloudflare setup when no origin certificate exists

The short-term setup is:

1. Create an `A`, `AAAA`, or `CNAME` record for `dashboard.example.com` and set it to **Proxied** (orange cloud) only when the public request will arrive on a supported HTTP/HTTPS port. Cloudflare's proxy handles HTTP and HTTPS traffic for proxied web records [3].
2. In **SSL/TLS → Overview**, choose **Flexible** only when the origin cannot support TLS. Flexible encrypts the visitor-to-Cloudflare connection while Cloudflare-to-origin traffic remains HTTP; Cloudflare explicitly recommends moving to Full or Full (strict) when possible [4].
3. Make sure the reverse proxy or hosting platform forwards the public request to the Node listener at `WEB_PORT=15029` over HTTP.
4. Keep `WEB_HTTPS=false` while testing the origin directly over HTTP. Once the public hostname is served as HTTPS, set `WEB_HTTPS=true` and restart the Node process.
5. In **SSL/TLS → Edge Certificates**, enable **Always Use HTTPS** only after the public HTTPS route works. Cloudflare's current documentation says this redirects all visitor HTTP requests to HTTPS and recommends doing the redirect at Cloudflare rather than at the origin to avoid redirect loops [5].

Flexible mode leaves the Cloudflare-to-origin hop unencrypted. Because this dashboard handles JWT-backed login and bot controls, treat Flexible as a temporary compatibility mode. Cloudflare advises Full or Full (strict) for stronger protection [4].

## Recommended long-term setup

After obtaining a certificate for the origin, use **Full (strict)**. Cloudflare's current mode documentation says Full (strict) validates the origin certificate, while Full does not validate it [6]. In the long-term layout:

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

## References

[1]: https://helmetjs.github.io/ 'Helmet.js official documentation — CSP and HTTPS-related headers'
[2]: https://developers.cloudflare.com/fundamentals/reference/network-ports/ 'Cloudflare official documentation — Network ports'
[3]: https://developers.cloudflare.com/dns/proxy-status/use-cases/ 'Cloudflare official documentation — Proxy use cases'
[4]: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/flexible/ 'Cloudflare official documentation — Flexible SSL/TLS mode'
[5]: https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/ 'Cloudflare official documentation — Always Use HTTPS'
[6]: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/ 'Cloudflare official documentation — SSL/TLS encryption modes'
