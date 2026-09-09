const express = require('express');
const { authenticate } = require('../auth/authenticate');
const { subscribe } = require('../sse/eventHub');
const { SseWriter } = require('../sse/sseWriter');
const { getBotLogs } = require('../../services/logger');
const BotManager = require('../../manager/BotManager');
const config = require('../../config');

const activeStreams = new Map();

/** Serialise one SSE frame. */
function formatEvent(event) {
  return `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** Frames that may be dropped when a client stalls (EG-004). */
function eventKind(name) {
  return name === 'bot:log' ? 'log' : 'event';
}

function writeEvent(res, event) {
  res.write(formatEvent(event));
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

    // EG-004: honour res.write() backpressure and bound what a slow client can
    // make us buffer, so one flooding bot cannot grow memory per subscriber.
    const writer = new SseWriter(res, {
      maxBuffered: config.limits.sseMaxBufferedEvents,
    });
    const send = (event) =>
      writer.write(formatEvent(event), eventKind(event.event));

    const visibleBotIds = new Set(
      botManager.listAuthorizedBots(req.principal).map((bot) => bot.id)
    );

    const sendInitial = () => {
      for (const instance of botManager.listAuthorizedBots(req.principal)) {
        visibleBotIds.add(instance.id);
        send({
          id: `initial-${instance.id}`,
          event: 'bot:snapshot',
          data: { botId: instance.id, snapshot: instance.toJSON() },
        });
        for (const entry of getBotLogs(instance.id, 200)) {
          send({
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
      writer.write(': connected\n\n', 'log');
    };

    sendInitial();
    const onEvent = (event) => {
      const decision = eventDecision(event, {
        userId: req.principal.userId,
        visibleBotIds,
      });
      if (decision === 'ignore') return;
      if (decision === 'revoke') {
        send({ ...event, data: { message: 'Session revoked.' } });
        cleanup();
        res.end();
        return;
      }
      send({
        ...event,
        data: sanitizeEventData(event.data),
      });
    };
    const unsubscribe = subscribe(onEvent);
    const keepalive = setInterval(
      () => writer.write(': keepalive\n\n', 'log'),
      20_000
    );
    let expiryTimer;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      clearTimeout(expiryTimer);
      unsubscribe();
      writer.close();
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
      send({
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
  formatEvent,
  writeEvent,
  sanitizeEventData,
  eventDecision,
};
