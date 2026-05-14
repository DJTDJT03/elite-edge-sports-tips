module.exports = function(deps) {
  const router = require('express').Router();
  const { db, JWT_SECRET } = deps;
  const jwt = require('jsonwebtoken');

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
      if (user.subscription === 'vip') return 'premium';
      if (user.subscription === 'premium') return 'premium';
      if (user.trialActive === true) return 'premium';
      if (user.subscription === 'starter') return 'starter';
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
      // Use UK time for date comparison (server may be UTC)
      var ukNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
      var todayStr = ukNow.getFullYear() + '-' + String(ukNow.getMonth() + 1).padStart(2, '0') + '-' + String(ukNow.getDate()).padStart(2, '0');

      // Normalise date to YYYY-MM-DD string for comparison
      function normDate(d) {
        if (!d) return '';
        if (d instanceof Date) {
          return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }
        return d.toString().split('T')[0].substring(0, 10);
      }

      // Debug: log first few tip dates to trace the comparison issue
      if (tips.length > 0 && tips.length <= 20) {
        tips.slice(0, 5).forEach(function(t) {
          console.log('[Tips Debug] id:' + t.id + ' rawDate:' + t.date + ' type:' + typeof t.date + ' norm:' + normDate(t.date) + ' today:' + todayStr + ' isWeekly:' + t.isWeeklyAcca);
        });
      }

      let filtered = tips.filter(function(t) {
        if (t.isWeeklyAcca) return true;
        if (t.status && t.status !== 'active') return false;
        var tipDate = normDate(t.date);
        if (tipDate && tipDate < todayStr) return false;
        return true;
      });
      console.log('[Tips] Total:' + tips.length + ' Filtered:' + filtered.length + ' Today:' + todayStr);

      if (sport) filtered = filtered.filter(t => t.sport === sport);
      if (date) filtered = filtered.filter(t => normDate(t.date) === date);
      if (premium === 'true') filtered = filtered.filter(t => t.isPremium);
      if (premium === 'false') filtered = filtered.filter(t => !t.isPremium);

      var access = await getUserAccess(req);

      // Starter: sees 3 tips (selection + odds only, no analysis)
      var starterCount = 0;
      var STARTER_TIP_LIMIT = 3;

      const result = filtered.map(tip => {
        // Free users: locked on premium tips
        if (tip.isPremium && access === 'free') {
          return {
            ...tip,
            selection: 'Premium Pick — Upgrade to View',
            analysis: { summary: 'Full analysis available to Premium subscribers. Start your 14-day free trial to access all tips.' },
            locked: true,
          };
        }
        // Starter users: see 3 tips with selection + odds, but no analysis
        if (tip.isPremium && access === 'starter') {
          starterCount++;
          if (starterCount <= STARTER_TIP_LIMIT) {
            return {
              ...tip,
              analysis: { summary: 'Upgrade to Premium for full analysis, form breakdown, going assessment, and staking advice.' },
              locked: false,
              starterLimited: true,
            };
          } else {
            return {
              ...tip,
              selection: 'Premium Pick — Upgrade for Full Access',
              analysis: { summary: 'Starter plan includes 3 tips per day. Upgrade to Premium for all tips and full analysis.' },
              locked: true,
            };
          }
        }
        // Premium/VIP/Admin: full access
        return { ...tip, locked: false };
      });

      res.json(result);
    } catch (err) {
      console.error('[Tips] GET /tips error:', err.message);
      res.status(500).json({ error: 'Failed to fetch tips' });
    }
  });

  // GET /api/tips/:id — view individual tip (costs 1 credit for non-premium)
  router.get('/tips/:id', async (req, res) => {
    try {
      const tip = await db.getTipById(req.params.id);
      if (!tip) return res.status(404).json({ error: 'Tip not found' });

      var access = await getUserAccess(req);

      // Premium/VIP/Admin: full access, no credits spent
      if (access === 'premium' || access === 'admin') {
        return res.json({ ...tip, locked: false });
      }

      // Free/Starter: premium tips require credits
      if (tip.isPremium) {
        // Check if user has credits
        var authHeader = req.headers.authorization;
        var userId = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          try {
            var decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
            userId = decoded.id;
          } catch (e) {}
        }

        if (!userId) {
          return res.json({ ...tip, selection: 'Premium Pick — Sign Up to View', analysis: { summary: 'Create a free account to get 5 credits.' }, locked: true });
        }

        var user = await db.getUserById(userId);
        if (!user || user.credits <= 0) {
          return res.json({
            ...tip,
            selection: tip.selection, // show selection name
            odds: tip.odds, // show odds
            analysis: { summary: 'You have 0 credits. Buy more credits or upgrade your plan to unlock full analysis.' },
            locked: true,
            outOfCredits: true,
          });
        }

        // Deduct 1 credit for viewing tip (use query param ?spend=true to actually deduct)
        if (req.query.spend === 'true') {
          var newBalance = await db.deductCredits(userId, 1, 'view_tip', 'Viewed: ' + (tip.selection || 'tip'), tip.id);
          if (newBalance < 0) {
            return res.json({ ...tip, analysis: { summary: 'Insufficient credits.' }, locked: true, outOfCredits: true });
          }
          // Starter: show tip but not full analysis
          if (access === 'starter') {
            return res.json({
              ...tip, locked: false, starterLimited: true, creditsRemaining: newBalance,
              analysis: { summary: tip.analysis ? tip.analysis.summary : 'Upgrade to Premium for full breakdown.' },
            });
          }
          return res.json({ ...tip, locked: false, creditsRemaining: newBalance });
        }

        // Preview mode: show selection + odds, prompt to spend credit
        return res.json({
          ...tip,
          analysis: { summary: 'Spend 1 credit to unlock this tip. You have ' + user.credits + ' credits remaining.' },
          locked: true,
          creditCost: 1,
          creditsRemaining: user.credits,
        });
      }

      // Free tip: no credits needed
      res.json({ ...tip, locked: false });
    } catch (err) {
      console.error('[Tips] GET /tips/:id error:', err.message);
      res.status(500).json({ error: 'Failed to fetch tip' });
    }
  });

  return router;
};
