module.exports = function(deps) {
  const router = require('express').Router();
  const { db, jwt, JWT_SECRET } = deps;

  // Determine user's actual access level — checks DB, not just JWT
  async function getUserAccess(req) {
    var authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[Tips] No auth header — access: free');
      return 'free';
    }
    var token = authHeader.split(' ')[1];
    if (!token || token === 'null' || token === 'undefined') {
      console.log('[Tips] Empty/null token — access: free');
      return 'free';
    }
    try {
      var decoded = jwt.verify(token, JWT_SECRET);
      if (!decoded || !decoded.id) {
        console.log('[Tips] JWT decoded but no id — access: free');
        return 'free';
      }
      // Admin in JWT = admin
      if (decoded.role === 'admin') return 'admin';
      // ALWAYS check database for current subscription
      var user = await db.getUserById(decoded.id);
      if (!user) {
        console.log('[Tips] User not found in DB for id:', decoded.id, '— access: free');
        return 'free';
      }
      if (user.role === 'admin') return 'admin';
      if (user.subscription === 'premium') return 'premium';
      if (user.trialActive === true) return 'premium';
      console.log('[Tips] User', user.email, 'sub:', user.subscription, 'trial:', user.trialActive, '— access: free');
      return 'free';
    } catch (e) {
      console.error('[Tips] JWT verify error:', e.message);
      return 'free';
    }
  }

  // DEBUG: test access level
  router.get('/tips/debug-access', async (req, res) => {
    var access = await getUserAccess(req);
    var authHeader = req.headers.authorization;
    var tokenPresent = !!(authHeader && authHeader.startsWith('Bearer '));
    var tokenValue = tokenPresent ? authHeader.split(' ')[1].substring(0, 20) + '...' : 'none';
    var decoded = null;
    var dbUser = null;
    if (tokenPresent) {
      try {
        decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        dbUser = await db.getUserById(decoded.id);
      } catch(e) { decoded = { error: e.message }; }
    }
    res.json({
      access: access,
      tokenPresent: tokenPresent,
      tokenPreview: tokenValue,
      jwtClaims: decoded ? { role: decoded.role, subscription: decoded.subscription, id: decoded.id } : null,
      dbUser: dbUser ? { id: dbUser.id, email: dbUser.email, subscription: dbUser.subscription, trialActive: dbUser.trialActive, role: dbUser.role } : null,
    });
  });

  // GET /api/tips
  router.get('/tips', async (req, res) => {
    try {
      const tips = await db.getTips();
      const { sport, date, premium } = req.query;
      var todayStr = new Date().toISOString().split('T')[0];

      let filtered = tips.filter(function(t) {
        if (t.isWeeklyAcca) return true;
        if (t.status && t.status !== 'active') return false;
        if (t.date && t.date < todayStr) return false;
        return true;
      });

      if (sport) filtered = filtered.filter(t => t.sport === sport);
      if (date) filtered = filtered.filter(t => t.date === date);
      if (premium === 'true') filtered = filtered.filter(t => t.isPremium);
      if (premium === 'false') filtered = filtered.filter(t => !t.isPremium);

      var access = await getUserAccess(req);

      const result = filtered.map(tip => {
        if (tip.isPremium && access !== 'premium' && access !== 'admin') {
          return {
            ...tip,
            selection: 'Premium Pick — Upgrade to View',
            analysis: { summary: 'Full analysis available to Premium subscribers. Start your 7-day free trial to access all tips.' },
            locked: true,
          };
        }
        return { ...tip, locked: false };
      });

      res.json(result);
    } catch (err) {
      console.error('[Tips] GET /tips error:', err.message);
      res.status(500).json({ error: 'Failed to fetch tips' });
    }
  });

  // GET /api/tips/:id
  router.get('/tips/:id', async (req, res) => {
    try {
      const tip = await db.getTipById(req.params.id);
      if (!tip) return res.status(404).json({ error: 'Tip not found' });

      var access = await getUserAccess(req);

      if (tip.isPremium && access !== 'premium' && access !== 'admin') {
        return res.json({
          ...tip,
          selection: 'Premium Pick — Upgrade to View',
          analysis: { summary: 'Full analysis available to Premium subscribers.' },
          locked: true,
        });
      }
      res.json({ ...tip, locked: false });
    } catch (err) {
      console.error('[Tips] GET /tips/:id error:', err.message);
      res.status(500).json({ error: 'Failed to fetch tip' });
    }
  });

  return router;
};
