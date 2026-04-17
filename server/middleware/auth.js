/**
 * Elite Edge Sports Tips — Auth Middleware
 *
 * Factory function that returns authenticate, requireAdmin, requirePremium middleware.
 */
module.exports = function createAuthMiddleware(JWT_SECRET, db) {
  const jwt = require('jsonwebtoken');

  async function authenticate(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await db.getUserById(decoded.id);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      // Check session matches (single-session enforcement)
      if (decoded.sessionId && user.sessionId && decoded.sessionId !== user.sessionId) {
        return res.status(401).json({ error: 'Session expired — logged in from another device' });
      }
      // Check account lock
      if (user.lockUntil && new Date(user.lockUntil).getTime() > Date.now()) {
        return res.status(403).json({ error: 'Account temporarily locked. Try again later.' });
      }
      req.user = user;
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired — please log in again' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  }

  function requirePremium(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role === 'admin') return next();
    if (req.user.subscription !== 'premium') {
      return res.status(403).json({ error: 'Premium subscription required', upgrade: true });
    }
    if (req.user.subscriptionExpiry && new Date(req.user.subscriptionExpiry) < new Date()) {
      return res.status(403).json({ error: 'Premium subscription expired', upgrade: true });
    }
    next();
  }

  return { authenticate, requireAdmin, requirePremium };
};
