'use strict';

const { sendError, sendJson } = require('../http');

const BOT_ID_RE = '[0-9a-fA-F-]{36}';
const BOT_ROUTE_RE = new RegExp(
  `^/api/bots/(${BOT_ID_RE})/(status|logs|activity)$`
);

const HELP = {
  service: 'EternalGhost-Afk-Bot-Minecraft',
  commands: [
    'create-bot',
    'edit-bot',
    'delete-bot',
    'start',
    'stop',
    'restart',
    'chat',
    'list-bot',
    'status-bot',
    'stats',
    'logs-bot',
    'select-bot',
    'help',
  ],
  note: 'Web routes map to the existing Discord command capabilities.',
};

function createReadRoutes({ statusService }) {
  async function handle(request, response, pathname, principal) {
    if (request.method !== 'GET') return false;

    if (pathname === '/status' || pathname === '/api/status') {
      return sendJson(response, 200, statusService.publicStatus());
    }

    if (!pathname.startsWith('/api/')) return false;
    if (!principal)
      return sendError(
        response,
        401,
        'UNAUTHORIZED',
        'Authentication required.'
      );

    if (pathname === '/api/help') return sendJson(response, 200, HELP);
    if (pathname === '/api/bots')
      return sendJson(response, 200, {
        bots: statusService.authorisedBots(principal),
      });
    if (pathname === '/api/stats')
      return sendJson(response, 200, statusService.stats(principal));

    const match = BOT_ROUTE_RE.exec(pathname);
    if (!match) return false;
    const [, id, action] = match;
    const url = new URL(request.url, 'http://localhost');
    if (action === 'status')
      return sendJson(response, 200, statusService.botStatus(principal, id));
    if (action === 'logs')
      return sendJson(
        response,
        200,
        statusService.botLogs(
          principal,
          id,
          Object.fromEntries(url.searchParams)
        )
      );
    if (action === 'activity')
      return sendJson(
        response,
        200,
        await statusService.activity(
          principal,
          id,
          Object.fromEntries(url.searchParams)
        )
      );
    return sendError(response, 404, 'NOT_FOUND', 'Read route not found.');
  }

  return { handle };
}

module.exports = { createReadRoutes };
