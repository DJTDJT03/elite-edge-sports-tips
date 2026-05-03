/**
 * Elite Edge — User Bets (Personal ROI Dashboard)
 *
 * Server-side bet tracking. Syncs with localStorage on the frontend.
 * Auto-settles against results table. Provides rich ROI analytics.
 */

module.exports = function(deps) {
  var router = require('express').Router();
  var db = deps.db;
  var authenticate = deps.authenticate;

  // POST /api/user/bets/back — back a tip
  router.post('/user/bets/back', authenticate, async function(req, res) {
    try {
      var userId = req.user.id;
      var { tipId, selection, event, sport, market, odds, confidence, analyst, date, stake } = req.body;
      if (!tipId) return res.status(400).json({ error: 'tipId required' });

      var id = await db.backTip(userId, {
        tipId, selection, event, sport, market,
        odds: parseFloat(odds) || 2.0, confidence: parseInt(confidence) || 7,
        analyst: analyst || 'The Edge', date: date || new Date().toISOString().split('T')[0],
        stake: parseFloat(stake) || 1,
      });

      res.json({ ok: true, id: id });
    } catch (err) {
      console.error('[UserBets] Back error:', err.message);
      res.status(500).json({ error: 'Failed to back tip' });
    }
  });

  // DELETE /api/user/bets/back/:tipId — unback a tip
  router.delete('/user/bets/back/:tipId', authenticate, async function(req, res) {
    try {
      await db.unbackTip(req.user.id, req.params.tipId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to unback tip' });
    }
  });

  // GET /api/user/bets — get all user bets
  router.get('/user/bets', authenticate, async function(req, res) {
    try {
      var bets = await db.getUserBets(req.user.id, parseInt(req.query.limit) || 200);
      res.json(bets);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch bets' });
    }
  });

  // GET /api/user/bets/roi — full Personal ROI analytics
  router.get('/user/bets/roi', authenticate, async function(req, res) {
    try {
      // Settle any unsettled bets first
      var settled = await db.settleUserBets();
      if (settled > 0) console.log('[UserBets] Auto-settled ' + settled + ' bet(s) for ' + req.user.email);

      var roi = await db.getUserROI(req.user.id);

      // Get bet history for chart data
      var bets = await db.getUserBets(req.user.id, 500);
      var settledBets = bets.filter(function(b) { return b.settled; }).sort(function(a, b) {
        return new Date(a.date) - new Date(b.date);
      });

      // Build running P/L series for chart
      var runningPnl = 0;
      var chartData = settledBets.map(function(b) {
        runningPnl += b.pnl;
        return { date: b.date, pnl: Math.round(runningPnl * 100) / 100, selection: b.selection, result: b.result };
      });

      // Current streak
      var streak = 0;
      var streakType = null;
      for (var i = settledBets.length - 1; i >= 0; i--) {
        var r = settledBets[i].result;
        if (r === 'void') continue;
        if (!streakType) streakType = (r === 'won' || r === 'placed') ? 'win' : 'loss';
        if (streakType === 'win' && (r === 'won' || r === 'placed')) streak++;
        else if (streakType === 'loss' && r === 'lost') streak++;
        else break;
      }

      // Best winning run
      var bestRun = 0;
      var currentRun = 0;
      settledBets.forEach(function(b) {
        if (b.result === 'won' || b.result === 'placed') { currentRun++; if (currentRun > bestRun) bestRun = currentRun; }
        else if (b.result !== 'void') currentRun = 0;
      });

      // "What If" — if they'd followed ALL tips
      var allResults = [];
      try {
        allResults = await db.getResults();
      } catch(e) {}
      var whatIfPnl = allResults.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
      var whatIfSettled = allResults.filter(function(r) { return r.result && r.result !== 'void'; }).length;
      var whatIfWins = allResults.filter(function(r) { return r.result === 'won' || r.result === 'placed'; }).length;

      roi.chart = chartData;
      roi.streak = { count: streak, type: streakType || 'none' };
      roi.bestRun = bestRun;
      roi.whatIf = {
        totalTips: whatIfSettled,
        wins: whatIfWins,
        pnl: Math.round(whatIfPnl * 100) / 100,
        strikeRate: whatIfSettled > 0 ? Math.round((whatIfWins / whatIfSettled) * 1000) / 10 : 0,
      };
      roi.memberSince = req.user.createdAt || req.user.joinDate || null;

      res.json(roi);
    } catch (err) {
      console.error('[UserBets] ROI error:', err.message);
      res.status(500).json({ error: 'Failed to calculate ROI' });
    }
  });

  // POST /api/user/bets/sync — sync localStorage bets to server
  router.post('/user/bets/sync', authenticate, async function(req, res) {
    try {
      var userId = req.user.id;
      var localBets = req.body.bets || [];
      var synced = 0;

      for (var i = 0; i < localBets.length; i++) {
        var b = localBets[i];
        if (!b.tipId) continue;
        var id = await db.backTip(userId, {
          tipId: b.tipId, selection: b.selection || '', event: b.event || '',
          sport: b.sport || '', market: b.market || '', odds: parseFloat(b.odds) || 2.0,
          confidence: parseInt(b.confidence) || 7, analyst: b.analyst || 'The Edge',
          date: b.date || new Date().toISOString().split('T')[0], stake: parseFloat(b.stake) || 1,
        });
        if (id) synced++;
      }

      // Settle any that have results
      await db.settleUserBets();

      res.json({ ok: true, synced: synced });
    } catch (err) {
      console.error('[UserBets] Sync error:', err.message);
      res.status(500).json({ error: 'Sync failed' });
    }
  });

  return router;
};
