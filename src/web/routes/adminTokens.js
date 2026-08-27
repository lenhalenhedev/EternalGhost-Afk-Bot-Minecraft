const express = require('express');
const { authenticate, requireAdmin } = require('../auth/authenticate');
const {
  issueToken,
  listTokenMetadata,
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
    const ttlMs = req.body?.ttlMs;
    try {
      const result = await issueToken(userId, ttlMs);
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
