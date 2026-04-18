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
      // Strict single-session: if the DB has a sessionId and it doesn't match the token, reject
      if (user.sessionId && decoded.sessionId !== user.sessionId) {
        return res.status(401).json({ error: 'Session expired — your account was accessed from another device. Only one active session is allowed per subscription. Please log in again.', code: 'session_expired' });
      }
      // Check account lock
      if (user.lockUntil && new Date(user.lockUntil).getTime() > Date.now()) {
        return res.status(403).json({ error: 'Account temporarily locked. Try again later.' });
      }
      // Auto-expire trial if past trial end date
      if (user.trialActive && user.trialEnd && new Date(user.trialEnd) < new Date()) {
        await db.updateUser(user.id, { trialActive: false, subscription: 'free', role: user.role === 'admin' ? 'admin' : 'free' });
        user.trialActive = false;
        user.subscription = 'free';
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
