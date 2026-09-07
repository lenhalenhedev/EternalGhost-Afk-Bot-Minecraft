'use strict';

/**
 * CSRF defence-in-depth (EG-004).
 *
 * State-changing (unsafe-method) requests are only accepted when they can be
 * shown to originate from the dashboard's own origin:
 *  - Sec-Fetch-Site is present and is `same-origin` / `none`, OR
 *  - the Origin header, when present, matches the request Host, OR
 *  - neither Origin nor Sec-Fetch-Site is present (a non-browser client such
 *    as a server-side caller, which cannot carry ambient cookies cross-origin).
 *
 * SameSite=Lax plus JSON-only body parsing already block the classic form-CSRF
 * path; this middleware closes the residual same-site-subdomain / legacy-client
 * gap. GET/HEAD/OPTIONS are never state-changing and are always allowed.
 */
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
    const originHost = url.hostname.toLowerCase();
    const hostHeader = String(req.headers.host || '').toLowerCase();
    // Host may include a port; Origin hostname never includes user-info.
    const requestHost = hostHeader.startsWith('[')
      ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
      : hostHeader.split(':')[0];
    if (originHost !== requestHost) {
      return res.status(403).json({ error: 'Cross-origin request rejected.' });
    }
  }
  return next();
}

module.exports = { sameOriginGuard };
