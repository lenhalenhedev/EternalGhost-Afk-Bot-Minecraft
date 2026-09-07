const express = require('express');
const { authenticate } = require('../auth/authenticate');
const { subscribe } = require('../sse/eventHub');
const { getBotLogs } = require('../../services/logger');
const BotManager = require('../../manager/BotManager');

const activeStreams = new Map();

function writeEvent(res, event) {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.event}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function createEventsRouter(botManager = BotManager) {
  const router = express.Router();
  router.get('/', authenticate, (req, res) => {
    const previous = activeStreams.get(req.principal.userId);
    previous?.close();
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const visibleBotIds = new Set(
      botManager.listAuthorizedBots(req.principal).map((bot) => bot.id)
    );

    const sendInitial = () => {
      for (const instance of botManager.listAuthorizedBots(req.principal)) {
        visibleBotIds.add(instance.id);
        writeEvent(res, {
          id: `initial-${instance.id}`,
          event: 'bot:snapshot',
          data: { botId: instance.id, snapshot: instance.toJSON() },
        });
        for (const entry of getBotLogs(instance.id, 200)) {
          writeEvent(res, {
            id: `log-${instance.id}-${entry.ts}`,
            event: 'bot:log',
            data: {
              botId: instance.id,
              ts: entry.ts,
              level: entry.level,
              message: entry.msg,
            },
          });
        }
      }
      res.write(': connected\n\n');
    };

    sendInitial();
    const onEvent = (event) => {
      const decision = eventDecision(event, {
        userId: req.principal.userId,
        visibleBotIds,
      });
      if (decision === 'ignore') return;
      if (decision === 'revoke') {
        writeEvent(res, { ...event, data: { message: 'Session revoked.' } });
        cleanup();
        res.end();
        return;
      }
      writeEvent(res, {
        ...event,
        data: sanitizeEventData(event.data),
      });
    };
    const unsubscribe = subscribe(onEvent);
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), 20_000);
    let expiryTimer;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      clearTimeout(expiryTimer);
      unsubscribe();
      if (activeStreams.get(req.principal.userId)?.res === res)
        activeStreams.delete(req.principal.userId);
    };

    const closeForSessionExpiry = () => {
      const remaining = new Date(req.session?.expiresAt).getTime() - Date.now();
      if (remaining > 0) {
        expiryTimer = setTimeout(
          closeForSessionExpiry,
          Math.min(remaining, 2_147_483_647)
        );
        expiryTimer.unref?.();
        return;
      }
      if (closed) return;
      writeEvent(res, {
        event: 'auth:expired',
        data: { message: 'Session expired.' },
      });
      cleanup();
      res.end();
    };
    activeStreams.set(req.principal.userId, {
      res,
      close: () => {
        cleanup();
        res.end();
      },
    });
    expiryTimer = setTimeout(closeForSessionExpiry, 0);
    expiryTimer.unref?.();
    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });
  return router;
}

function sanitizeEventData(data) {
  if (!data || typeof data !== 'object') return data;
  const safe = { ...data };
  delete safe.ownerId;
  delete safe.userId;
  return safe;
}

/**
 * Decide whether an SSE hub event may be delivered to a given principal and
 * how. Delivery is strictly scoped (fail-closed):
 *  - auth:* events are per-user and are never broadcast to other users
 *    (fixes EG-001 cross-user auth:revoked disclosure).
 *  - bot events must either carry an ownerId equal to the principal, or
 *    reference a bot already visible to the principal. An ownerless
 *    bot:created snapshot (the historical EG-002 vector) is therefore dropped
 *    for every subscriber.
 *
 * Returns 'ignore' | 'revoke' | 'deliver'.
 */
function eventDecision(event, { userId, visibleBotIds }) {
  const name = event?.event;
  const data = event?.data || {};
  if (typeof name === 'string' && name.startsWith('auth:')) {
    if (name === 'auth:revoked' && data.userId === userId) return 'revoke';
    return 'ignore';
  }
  const botId = data.botId || data.snapshot?.id;
  const ownerId = data.ownerId;
  if (ownerId && ownerId !== userId) return 'ignore';
  if (botId) {
    if (ownerId) {
      // Own bot event: keep it in this user's visible set so follow-up state,
      // health and log events for the same bot keep flowing.
      visibleBotIds.add(botId);
    } else if (!visibleBotIds.has(botId)) {
      // No owner context and not already visible -> deny by default.
      return 'ignore';
    }
  }
  if (name === 'bot:deleted') visibleBotIds.delete(botId);
  return 'deliver';
}

module.exports = {
  createEventsRouter,
  writeEvent,
  sanitizeEventData,
  eventDecision,
};
