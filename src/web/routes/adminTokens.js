const express = require('express');
const { authenticate, requireAdmin } = require('../auth/authenticate');
const {
  issueTokenDays,
  listTokenMetadata,
  renewToken,
  revokeToken,
} = require('../auth/tokenService');

function createAdminTokenRouter() {
  const router = express.Router();
  router.use(authenticate, requireAdmin);

  router.get('/', async (_req, res) => {
    try {
      return res.json({ tokens: await listTokenMetadata() });
    } catch {
      return res
        .status(503)
        .json({ error: 'Token data is temporarily unavailable.' });
    }
  });

  router.post('/', async (req, res) => {
    const userId = req.body?.userId;
    const days = req.body?.days;
    try {
      const result = await issueTokenDays(userId, days);
      return res.status(201).json({
        token: result.token,
        tokenMetadata: result.metadata,
      });
    } catch (err) {
      return res
        .status(422)
        .json({ error: err?.message || 'Could not create token.' });
    }
  });

  router.post('/:userId/renew', async (req, res) => {
    const time = req.body?.time;
    try {
      const result = await renewToken(req.params.userId, time);
      return res.json({ token: result.token, tokenMetadata: result.metadata });
    } catch (err) {
      return res
        .status(422)
        .json({ error: err?.message || 'Could not renew token.' });
    }
  });

  router.delete('/:userId', async (req, res) => {
    try {
      await revokeToken(req.params.userId);
      return res.status(204).end();
    } catch (err) {
      return res
        .status(422)
        .json({ error: err?.message || 'Could not revoke token.' });
    }
  });

  return router;
}

module.exports = { createAdminTokenRouter };
