const { verifyActiveToken } = require('./tokenService');
const config = require('../../config');

const COOKIE_NAME = 'eg_session';

async function authenticate(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token)
    return res.status(401).json({ error: 'Authentication required.' });
  try {
    const session = await verifyActiveToken(token);
    req.principal = Object.freeze({
      userId: session.userId,
      guildId: null,
      roles: config.access.adminIds.includes(session.userId) ? ['admin'] : [],
    });
    req.session = session;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.principal?.roles?.includes('admin')) {
    return res.status(403).json({ error: 'Administrator access required.' });
  }
  return next();
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: config.web.https,
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

module.exports = { COOKIE_NAME, authenticate, requireAdmin, cookieOptions };
