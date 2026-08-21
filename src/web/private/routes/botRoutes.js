'use strict';

const { readJsonBody, sendError, sendJson } = require('../http');

const BOT_ID_RE = '[0-9a-fA-F-]{36}';
const BOT_RE = new RegExp(
  `^/api/bots(?:/(${BOT_ID_RE})(?:/(start|stop|restart|chat|select))?)?$`
);

function createBotRoutes({ botManager, statusService, maxBodyBytes }) {
  async function body(request, response) {
    try {
      return await readJsonBody(request, maxBodyBytes);
    } catch (error) {
      sendError(
        response,
        error.code === 'BODY_TOO_LARGE' ? 413 : 400,
        error.code || 'INVALID_REQUEST',
        error.message
      );
      return null;
    }
  }

  async function handle(request, response, pathname, principal) {
    if (!pathname.startsWith('/api/bots')) return false;
    if (!principal) {
      sendError(response, 401, 'UNAUTHORIZED', 'Authentication required.');
      return true;
    }

    const match = BOT_RE.exec(pathname);
    if (!match) return false;
    const [, id, action] = match;

    if (request.method === 'POST' && !id) {
      const input = await body(request, response);
      if (!input) return true;
      const result = await botManager.createBot(input, principal);
      return sendJson(response, 201, {
        bot: statusService.botStatus(principal, result.id),
      });
    }

    if (!id) return false;

    if (request.method === 'PATCH' && !action) {
      const input = await body(request, response);
      if (!input) return true;
      await botManager.editBot(principal, id, input);
      return sendJson(response, 200, {
        bot: statusService.botStatus(principal, id),
      });
    }

    if (request.method === 'DELETE' && !action) {
      await botManager.deleteBot(principal, id);
      return sendJson(response, 200, { deleted: true, id });
    }

    if (request.method !== 'POST' || !action) return false;

    if (action === 'start') {
      await botManager.startBot(principal, id);
      return sendJson(response, 200, {
        bot: statusService.botStatus(principal, id),
      });
    }
    if (action === 'stop') {
      const input = await body(request, response);
      if (!input) return true;
      await botManager.stopBot(principal, id, input.force === true);
      return sendJson(response, 200, {
        bot: statusService.botStatus(principal, id),
      });
    }
    if (action === 'restart') {
      await botManager.restartBot(principal, id);
      return sendJson(response, 200, {
        bot: statusService.botStatus(principal, id),
      });
    }
    if (action === 'chat') {
      const input = await body(request, response);
      if (!input) return true;
      await botManager.chatBot(principal, id, input.message);
      return sendJson(response, 200, { sent: true });
    }
    if (action === 'select') {
      await botManager.setUserSelection(principal, id);
      return sendJson(response, 200, { selected: id });
    }

    return false;
  }

  return { handle };
}

module.exports = { createBotRoutes };
