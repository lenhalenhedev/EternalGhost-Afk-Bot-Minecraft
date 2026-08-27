const express = require('express');
const BotManager = require('../../manager/BotManager');
const { getBotLogs, logger } = require('../../services/logger');
const { authenticate } = require('../auth/authenticate');
const { validateWebChatInput, parseChatInput } = require('../commandParser');

function safeSnapshot(instance) {
  const snapshot = instance.toJSON();
  return {
    ...snapshot,
    serverKey: `${snapshot.host}:${snapshot.port}`,
    passwordConfigured: Boolean(instance.record.encryptedPassword),
  };
}

function mapError(err) {
  if (err?.code === 'BOT_MUST_BE_STOPPED') return [409, err.message];
  if (err?.code === 'RESOURCE_ACCESS_DENIED') return [404, 'Bot not found.'];
  if (err?.code === 'INVALID_BOT_ID') return [400, err.message];
  if (err?.code === 'PERSISTENCE_WRITE_FAILED') return [503, err.message];
  return [400, err?.message || 'The bot operation could not be completed.'];
}

function createBotsRouter(botManager = BotManager) {
  const router = express.Router();
  router.use(authenticate);

  router.get('/', (req, res) => {
    const bots = botManager.listAuthorizedBots(req.principal).map(safeSnapshot);
    return res.json({ bots });
  });

  router.post('/', async (req, res) => {
    try {
      const result = await botManager.createBot(req.body || {}, req.principal);
      const instance = botManager.resolveAuthorizedBot(
        req.principal,
        result.id
      );
      return res.status(201).json({ bot: safeSnapshot(instance) });
    } catch (err) {
      logger.error(`[Web] create bot failed: ${err?.message || err}`);
      const [status, message] = mapError(err);
      return res.status(status).json({ error: message });
    }
  });

  router.get('/:botId', (req, res) => {
    try {
      const instance = botManager.resolveAuthorizedBot(
        req.principal,
        req.params.botId
      );
      return res.json({
        bot: safeSnapshot(instance),
        logs: getBotLogs(instance.id, 200).map((entry) => ({
          botId: instance.id,
          ts: entry.ts,
          level: entry.level,
          message: entry.msg,
        })),
      });
    } catch (err) {
      const [status, message] = mapError(err);
      return res.status(status).json({ error: message });
    }
  });

  router.patch('/:botId', async (req, res) => {
    try {
      await botManager.editBot(req.principal, req.params.botId, req.body || {});
      const instance = botManager.resolveAuthorizedBot(
        req.principal,
        req.params.botId
      );
      return res.json({ bot: safeSnapshot(instance) });
    } catch (err) {
      logger.error(`[Web] edit bot failed: ${err?.message || err}`);
      const [status, message] = mapError(err);
      return res.status(status).json({ error: message });
    }
  });

  router.delete('/:botId', async (req, res) => {
    try {
      await botManager.deleteBot(req.principal, req.params.botId);
      return res.status(204).end();
    } catch (err) {
      logger.error(`[Web] delete bot failed: ${err?.message || err}`);
      const [status, message] = mapError(err);
      return res.status(status).json({ error: message });
    }
  });

  for (const [action, method] of [
    ['start', 'startBot'],
    ['stop', 'stopBot'],
    ['restart', 'restartBot'],
  ]) {
    router.post('/:botId/' + action, async (req, res) => {
      try {
        await botManager[method](req.principal, req.params.botId);
        const instance = botManager.resolveAuthorizedBot(
          req.principal,
          req.params.botId
        );
        return res.json({ bot: safeSnapshot(instance) });
      } catch (err) {
        logger.error(`[Web] ${action} bot failed: ${err?.message || err}`);
        const [status, message] = mapError(err);
        return res.status(status).json({ error: message });
      }
    });
  }

  router.post('/:botId/chat', async (req, res) => {
    const validation = validateWebChatInput(req.body?.message);
    if (!validation.valid)
      return res.status(422).json({ error: validation.reason });
    try {
      const parsed = parseChatInput(validation.value);
      await botManager.chatBot(req.principal, req.params.botId, parsed.text);
      return res.status(202).json({ kind: parsed.kind });
    } catch (err) {
      logger.error(`[Web] chat failed: ${err?.message || err}`);
      const [status, message] = mapError(err);
      return res.status(status).json({ error: message });
    }
  });

  return router;
}

module.exports = { createBotsRouter, safeSnapshot };
