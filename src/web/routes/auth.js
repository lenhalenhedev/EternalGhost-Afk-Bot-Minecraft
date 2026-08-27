const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  COOKIE_NAME,
  authenticate,
  cookieOptions,
} = require('../auth/authenticate');
const { verifyActiveToken } = require('../auth/tokenService');
const config = require('../../config');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

function createAuthRouter() {
  const router = express.Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const token =
      typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) return res.status(422).json({ error: 'Token is required.' });

    try {
      const session = await verifyActiveToken(token);
      const maxAge = Math.max(
        1,
        new Date(session.expiresAt).getTime() - Date.now()
      );
      res.cookie(COOKIE_NAME, token, cookieOptions(maxAge));
      return res.json({
        userId: session.userId,
        isAdmin: config.access.adminIds.includes(session.userId),
      });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, cookieOptions(0));
    return res.status(204).end();
  });

  router.get('/me', authenticate, (req, res) =>
    res.json({
      userId: req.principal.userId,
      isAdmin: req.principal.roles.includes('admin'),
    })
  );

  return router;
}

module.exports = { createAuthRouter };
