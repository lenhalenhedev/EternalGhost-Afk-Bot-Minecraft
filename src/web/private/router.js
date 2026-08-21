'use strict';

const { parseCookies, sendError, setSecurityHeaders } = require('./http');

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

function mapError(error) {
  if (error?.code === 'RESOURCE_ACCESS_DENIED')
    return { status: 404, code: error.code };
  if (error?.code === 'INVALID_BOT_ID')
    return { status: 400, code: error.code };
  if (
    error?.code === 'PERSISTENCE_QUEUE_FULL' ||
    error?.code === 'PERSISTENCE_WRITE_FAILED'
  ) {
    return { status: 503, code: 'SERVICE_UNAVAILABLE' };
  }
  if (/already exists|Maximum bot limit/i.test(error?.message || '')) {
    return { status: 409, code: 'CONFLICT' };
  }
  return { status: 400, code: 'REQUEST_FAILED' };
}

function createRouter({
  authService,
  authRoutes,
  readRoutes,
  botRoutes,
  staticHandler,
}) {
  async function handle(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const isApi =
      url.pathname.startsWith('/api/') || url.pathname === '/status';
    setSecurityHeaders(response, isApi);

    try {
      if (await authRoutes.handle(request, response, url.pathname)) return;

      const sessionToken = parseCookies(request.headers.cookie).eg_session;
      const session = authService.getSession(sessionToken);
      const principal = session
        ? { userId: session.username, guildId: null, roles: ['web-admin'] }
        : null;

      if (
        MUTATING_METHODS.has(request.method) &&
        url.pathname.startsWith('/api/') &&
        !authService.isCsrfValid(session, request.headers['x-csrf-token'])
      ) {
        return sendError(
          response,
          session ? 403 : 401,
          session ? 'CSRF_REQUIRED' : 'UNAUTHORIZED',
          session ? 'Valid CSRF token required.' : 'Authentication required.'
        );
      }

      if (await readRoutes.handle(request, response, url.pathname, principal))
        return;
      if (await botRoutes.handle(request, response, url.pathname, principal))
        return;
      if (await staticHandler.handle(request, response, url.pathname)) return;
      return sendError(response, 404, 'NOT_FOUND', 'Route not found.');
    } catch (error) {
      const mapped = mapError(error);
      return sendError(
        response,
        mapped.status,
        mapped.code,
        mapped.status >= 500
          ? 'Service temporarily unavailable.'
          : error.message
      );
    }
  }

  return { handle };
}

module.exports = { createRouter, mapError };
