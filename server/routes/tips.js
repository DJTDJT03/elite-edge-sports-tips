module.exports = function(deps) {
  const router = require('express').Router();
  const { db, jwt, JWT_SECRET } = deps;

  // GET /api/tips
  router.get('/tips', async (req, res) => {
    try {
      const tips = await db.getTips();
      const { sport, date, premium } = req.query;
      var todayStr = new Date().toISOString().split('T')[0];

      // Only return active tips from today onwards (plus weekly acca)
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

      // For unauthenticated / free users, redact premium content
      const authHeader = req.headers.authorization;
      let userRole = 'free';
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
          userRole = decoded.role === 'admin' ? 'admin' : decoded.subscription;
        } catch {}
      }

      // Also check if user is on active trial — they get premium access
      if (userRole === 'free' && authHeader) {
        try {
          var decoded2 = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
          var dbUser = await db.getUserById(decoded2.id);
          if (dbUser && (dbUser.subscription === 'premium' || dbUser.trialActive)) {
            userRole = 'premium';
          }
        } catch {}
      }

      const result = filtered.map(tip => {
        if (tip.isPremium && userRole !== 'premium' && userRole !== 'admin') {
          return {
            ...tip,
            selection: 'Premium Pick — Upgrade to View',
            analysis: { summary: 'Full analysis available to Premium subscribers. Upgrade now to access all tips, detailed analysis, and our complete edge calculations.' },
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

      const authHeader = req.headers.authorization;
      let userRole = 'free';
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
          userRole = decoded.role === 'admin' ? 'admin' : decoded.subscription;
        } catch {}
      }

      if (tip.isPremium && userRole !== 'premium' && userRole !== 'admin') {
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
