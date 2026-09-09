'use strict';

const config = require('../../config');

/**
 * CSRF defence-in-depth (EG-004 / EG-011).
 *
 * State-changing (unsafe-method) requests are only accepted when they can be
 * shown to originate from the dashboard's own origin:
 *  - Sec-Fetch-Site is present and is `same-origin` / `none`, OR
 *  - the Origin header, when present, matches the deployment's origin exactly, OR
 *  - neither Origin nor Sec-Fetch-Site is present (a non-browser client such as
 *    a server-side caller, which cannot carry ambient cookies cross-origin).
 *
 * EG-011: the fallback used to compare only the *hostname* and deliberately
 * stripped the request port. Because browser cookies are host-scoped rather
 * than port-scoped, an attacker-controlled alternate HTTPS origin on the same
 * host (a second tenant or a compromised app on another port) could pass while
 * still being cross-origin. The comparison is now the full URL origin — scheme,
 * host and port — against either a configured canonical `WEB_PUBLIC_ORIGIN` or
 * the origin implied by the request Host and `WEB_HTTPS`.
 *
 * SameSite=Lax plus JSON-only body parsing already block the classic form-CSRF
 * path; this middleware closes the residual same-host / legacy-client gap.
 * GET/HEAD/OPTIONS are never state-changing and are always allowed.
 */

/** Normalise an operator-supplied origin, or null when it is not usable. */
function canonicalOrigin(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The origin this deployment serves.
 *
 * `WEB_PUBLIC_ORIGIN` wins so a reverse-proxied deployment can state its public
 * origin explicitly instead of relying on Host-header inference. Otherwise the
 * scheme comes from `WEB_HTTPS` (which already documents whether the *public*
 * connection is HTTPS) and the authority from the request Host header, so the
 * comparison stays correct behind a TLS-terminating proxy.
 */
function expectedRequestOrigin(req) {
  const configured = canonicalOrigin(config.web.publicOrigin);
  if (configured) return configured;
  const host = String(req.headers.host || '').trim();
  if (!host) return null;
  const scheme = config.web.https ? 'https' : 'http';
  try {
    return new URL(`${scheme}://${host}`).origin;
  } catch {
    return null;
  }
}

function sameOriginGuard(req, res, next) {
  const method = req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const site = req.headers['sec-fetch-site'];
  if (site) {
    if (site === 'same-origin' || site === 'none') return next();
    return res.status(403).json({ error: 'Cross-origin request rejected.' });
  }

  const origin = req.headers['origin'];
  if (origin) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      return res.status(403).json({ error: 'Invalid Origin header.' });
    }
    const expected = expectedRequestOrigin(req);
    // Fail closed: without a determinable deployment origin there is nothing to
    // compare against, so the request cannot be proven same-origin.
    if (!expected || url.origin !== expected) {
      return res.status(403).json({ error: 'Cross-origin request rejected.' });
    }
  }
  return next();
}

module.exports = { sameOriginGuard, expectedRequestOrigin, canonicalOrigin };
