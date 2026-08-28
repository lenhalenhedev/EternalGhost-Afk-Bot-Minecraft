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
      if (
        event.event === 'auth:revoked' &&
        event.data?.userId === req.principal.userId
      ) {
        writeEvent(res, { ...event, data: { message: 'Session revoked.' } });
        cleanup();
        res.end();
        return;
      }
      const botId = event.data?.botId || event.data?.snapshot?.id;
      if (event.data?.ownerId && event.data.ownerId !== req.principal.userId)
        return;
      if (botId && event.event !== 'bot:created' && !visibleBotIds.has(botId))
        return;
      if (
        event.event === 'bot:created' &&
        event.data?.ownerId === req.principal.userId
      ) {
        visibleBotIds.add(botId);
      }
      if (event.event === 'bot:deleted') visibleBotIds.delete(botId);
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
  return safe;
}

module.exports = { createEventsRouter, writeEvent, sanitizeEventData };
