'use strict';

const {
  clearSessionCookie,
  clientAddress,
  parseCookies,
  readJsonBody,
  sendError,
  sendJson,
  setSessionCookie,
} = require('../http');

function createAuthRoutes({ authService, maxBodyBytes }) {
  async function handle(request, response, pathname) {
    if (!pathname.startsWith('/api/auth/')) return false;

    if (request.method === 'GET' && pathname === '/api/auth/session') {
      const session = authService.getSession(
        parseCookies(request.headers.cookie).eg_session
      );
      if (!session) return sendJson(response, 200, { authenticated: false });
      return sendJson(response, 200, {
        authenticated: true,
        username: session.username,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      });
    }

    if (request.method === 'POST' && pathname === '/api/auth/login') {
      let body;
      try {
        body = await readJsonBody(request, maxBodyBytes);
      } catch (error) {
        return sendError(
          response,
          error.code === 'BODY_TOO_LARGE' ? 413 : 400,
          error.code || 'INVALID_REQUEST',
          error.message
        );
      }
      const result = authService.login(body, clientAddress(request));
      if (!result.ok) {
        const status = result.reason === 'rate_limited' ? 429 : 401;
        return sendError(
          response,
          status,
          result.reason.toUpperCase(),
          'Invalid credentials or temporarily rate limited.'
        );
      }
      setSessionCookie(
        response,
        result.token,
        Math.ceil((result.expiresAt - Date.now()) / 1000)
      );
      return sendJson(response, 200, {
        authenticated: true,
        username: body.username,
        csrfToken: result.csrfToken,
        expiresAt: result.expiresAt,
      });
    }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      const token = parseCookies(request.headers.cookie).eg_session;
      authService.logout(token);
      clearSessionCookie(response);
      return sendJson(response, 200, { authenticated: false });
    }

    return sendError(response, 404, 'NOT_FOUND', 'Auth route not found.');
  }

  return { handle };
}

module.exports = { createAuthRoutes };
