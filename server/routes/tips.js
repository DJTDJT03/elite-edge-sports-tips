module.exports = function(deps) {
  const router = require('express').Router();
  const { db, jwt, JWT_SECRET } = deps;

  // Determine user's actual access level from the database (not JWT claims)
  async function getUserAccess(req) {
    var authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return 'free';
    try {
      var decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      if (decoded.role === 'admin') return 'admin';
      // Always check database for current subscription — JWT may be stale
      var user = await db.getUserById(decoded.id);
      if (!user) return 'free';
      if (user.role === 'admin') return 'admin';
      if (user.subscription === 'premium') return 'premium';
      if (user.trialActive) return 'premium';
      return 'free';
    } catch (e) {
      return 'free';
    }
  }

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
            analysis: { summary: 'Full analysis available to Premium subscribers. Start your 7-day free trial to access all tips, detailed analysis, and our complete edge calculations.' },
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
