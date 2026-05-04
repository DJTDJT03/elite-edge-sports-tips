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

  // POST /api/user/push/subscribe — save push subscription
  router.post('/user/push/subscribe', authenticate, async function(req, res) {
    try {
      var sub = req.body.subscription;
      if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
      await db.savePushSubscription(req.user.id, sub);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save subscription' });
    }
  });

  // DELETE /api/user/push/unsubscribe — remove push subscription
  router.delete('/user/push/unsubscribe', authenticate, async function(req, res) {
    try {
      var subs = await db.getPushSubscriptions(req.user.id);
      for (var i = 0; i < subs.length; i++) { await db.removePushSubscription(subs[i].id); }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to unsubscribe' });
    }
  });

  // GET /api/user/push/vapid-key — public VAPID key for frontend
  router.get('/user/push/vapid-key', function(req, res) {
    var pushSvc = deps.pushService;
    res.json({ key: pushSvc ? pushSvc.publicKey : '' });
  });

  // GET /api/track-record — public verified track record stats (no auth required)
  router.get('/track-record', async function(req, res) {
    try {
      var results = await db.getResults() || [];
      var tips = await db.getTips() || [];
      var counted = results.filter(function(r) { return r.result && r.result !== 'void'; });
      var wins = counted.filter(function(r) { return r.result === 'won' || r.result === 'placed'; });
      var losses = counted.filter(function(r) { return r.result === 'lost'; });
      var totalPnl = counted.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
      var totalStaked = counted.reduce(function(s, r) { return s + (r.stake || 1); }, 0);
      var roi = totalStaked > 0 ? Math.round((totalPnl / totalStaked) * 10000) / 100 : 0;
      var strikeRate = counted.length > 0 ? Math.round((wins.length / counted.length) * 1000) / 10 : 0;

      // By sport
      var sports = {};
      counted.forEach(function(r) {
        var s = r.sport || 'other';
        if (!sports[s]) sports[s] = { total: 0, wins: 0, pnl: 0, staked: 0 };
        sports[s].total++;
        if (r.result === 'won' || r.result === 'placed') sports[s].wins++;
        sports[s].pnl += r.pnl || 0;
        sports[s].staked += r.stake || 1;
      });
      Object.keys(sports).forEach(function(s) {
        sports[s].pnl = Math.round(sports[s].pnl * 100) / 100;
        sports[s].strikeRate = sports[s].total > 0 ? Math.round((sports[s].wins / sports[s].total) * 1000) / 10 : 0;
        sports[s].roi = sports[s].staked > 0 ? Math.round((sports[s].pnl / sports[s].staked) * 10000) / 100 : 0;
      });

      // By analyst
      var analysts = {};
      counted.forEach(function(r) {
        var a = r.tipsterProfile || 'Unknown';
        if (!analysts[a]) analysts[a] = { total: 0, wins: 0, pnl: 0 };
        analysts[a].total++;
        if (r.result === 'won' || r.result === 'placed') analysts[a].wins++;
        analysts[a].pnl += r.pnl || 0;
      });
      Object.keys(analysts).forEach(function(a) {
        analysts[a].pnl = Math.round(analysts[a].pnl * 100) / 100;
        analysts[a].strikeRate = analysts[a].total > 0 ? Math.round((analysts[a].wins / analysts[a].total) * 1000) / 10 : 0;
      });

      // By confidence tier
      var tipMap = {};
      tips.forEach(function(t) { if (t.id) tipMap[t.id] = t; });
      var confTiers = { elite: { min: 9, wins: 0, total: 0, pnl: 0 }, strong: { min: 7, wins: 0, total: 0, pnl: 0 }, other: { min: 0, wins: 0, total: 0, pnl: 0 } };
      counted.forEach(function(r) {
        var tip = tipMap[r.tipId] || {};
        var conf = tip.confidence || r.confidence || 5;
        var tier = conf >= 9 ? 'elite' : conf >= 7 ? 'strong' : 'other';
        confTiers[tier].total++;
        if (r.result === 'won' || r.result === 'placed') confTiers[tier].wins++;
        confTiers[tier].pnl += r.pnl || 0;
      });
      Object.keys(confTiers).forEach(function(t) {
        confTiers[t].pnl = Math.round(confTiers[t].pnl * 100) / 100;
        confTiers[t].strikeRate = confTiers[t].total > 0 ? Math.round((confTiers[t].wins / confTiers[t].total) * 1000) / 10 : 0;
      });

      // Monthly breakdown
      var monthly = {};
      counted.forEach(function(r) {
        var d = (r.date || '').toString().substring(0, 7); // YYYY-MM
        if (!d) return;
        if (!monthly[d]) monthly[d] = { wins: 0, losses: 0, pnl: 0 };
        if (r.result === 'won' || r.result === 'placed') monthly[d].wins++;
        else monthly[d].losses++;
        monthly[d].pnl += r.pnl || 0;
      });
      Object.keys(monthly).forEach(function(m) { monthly[m].pnl = Math.round(monthly[m].pnl * 100) / 100; });

      // Best winners
      var bestWinners = counted.filter(function(r) { return r.result === 'won' && r.pnl > 0; })
        .sort(function(a, b) { return b.pnl - a.pnl; }).slice(0, 10)
        .map(function(r) { return { selection: r.selection, event: r.event, odds: r.odds, pnl: Math.round(r.pnl * 100) / 100, date: r.date, sport: r.sport }; });

      // Longest winning streak
      var sorted = counted.slice().sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
      var maxStreak = 0, currentStreak = 0;
      sorted.forEach(function(r) {
        if (r.result === 'won' || r.result === 'placed') { currentStreak++; if (currentStreak > maxStreak) maxStreak = currentStreak; }
        else currentStreak = 0;
      });

      // Match prediction stats (table may not exist yet)
      var matchPredStats = {};
      try { if (db.getMatchPredictionStats) matchPredStats = await db.getMatchPredictionStats(365); } catch(e) {}

      // First and latest tip dates
      var dates = counted.map(function(r) { return r.date || ''; }).filter(Boolean).sort();

      res.json({
        overview: {
          totalTips: counted.length, wins: wins.length, losses: losses.length,
          strikeRate: strikeRate, roi: roi,
          totalPnl: Math.round(totalPnl * 100) / 100,
          totalStaked: Math.round(totalStaked * 100) / 100,
          longestStreak: maxStreak,
          firstTipDate: dates[0] || null,
          latestTipDate: dates[dates.length - 1] || null,
        },
        bySport: sports,
        byAnalyst: analysts,
        byConfidence: confTiers,
        monthly: monthly,
        bestWinners: bestWinners,
        matchPredictions: matchPredStats,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[TrackRecord] Error:', err.message, err.stack);
      res.status(500).json({ error: 'Failed to generate track record: ' + err.message });
    }
  });

  // GET /api/user/race-predictions — race prediction accuracy
  router.get('/user/race-predictions', authenticate, async function(req, res) {
    try {
      var date = req.query.date || null;
      var predictions = date ? await db.getRacePredictions({ date: date }) : [];
      var correct = predictions.filter(function(p) { return p.correct === true; }).length;
      var incorrect = predictions.filter(function(p) { return p.correct === false; }).length;
      var placed = predictions.filter(function(p) { return p.finish_position && p.finish_position <= 3 && !p.correct; }).length;
      var settled = correct + incorrect;
      res.json({
        predictions: predictions,
        stats: {
          total: predictions.length, correct: correct, incorrect: incorrect, placed: placed,
          winRate: settled > 0 ? Math.round((correct / settled) * 1000) / 10 : 0,
          placeRate: settled > 0 ? Math.round(((correct + placed) / settled) * 1000) / 10 : 0,
        }
      });
    } catch (err) {
      res.json({ predictions: [], stats: {} });
    }
  });

  // GET /api/user/match-predictions — match prediction accuracy stats
  router.get('/user/match-predictions', authenticate, async function(req, res) {
    try {
      var date = req.query.date || null;
      var days = parseInt(req.query.days) || 30;
      var predictions = date ? await db.getMatchPredictions({ date: date }) : [];
      var stats = await db.getMatchPredictionStats(days);
      res.json({ predictions: predictions, stats: stats });
    } catch (err) {
      res.json({ predictions: [], stats: {} });
    }
  });

  // GET /api/user/bets/leaderboard — anonymous subscriber leaderboard
  router.get('/user/bets/leaderboard', async function(req, res) {
    try {
      var period = req.query.period || 'week'; // week, month, all
      var dateFilter = '';
      if (period === 'week') dateFilter = "AND ub.date >= CURRENT_DATE - 7";
      else if (period === 'month') dateFilter = "AND ub.date >= CURRENT_DATE - 30";

      var result = await db.query(`
        SELECT
          u.name,
          COUNT(*) FILTER (WHERE ub.settled = true) as total_bets,
          COUNT(*) FILTER (WHERE ub.result = 'won' OR ub.result = 'placed') as wins,
          COALESCE(SUM(ub.pnl) FILTER (WHERE ub.settled = true), 0) as total_pnl,
          ROUND(COALESCE(SUM(ub.pnl) FILTER (WHERE ub.settled = true), 0) / NULLIF(SUM(ub.stake) FILTER (WHERE ub.settled = true), 0) * 100, 1) as roi
        FROM user_bets ub
        JOIN users u ON ub.user_id = u.id
        WHERE ub.settled = true ${dateFilter}
        GROUP BY u.id, u.name
        HAVING COUNT(*) FILTER (WHERE ub.settled = true) >= 5
        ORDER BY total_pnl DESC
        LIMIT 20
      `);

      // Anonymise names: "Darren T." format
      var leaderboard = (result.rows || []).map(function(r, i) {
        var nameParts = (r.name || 'User').split(' ');
        var displayName = nameParts[0] + (nameParts.length > 1 ? ' ' + nameParts[1].charAt(0) + '.' : '');
        return {
          rank: i + 1,
          name: displayName,
          bets: parseInt(r.total_bets),
          wins: parseInt(r.wins),
          pnl: parseFloat(r.total_pnl) || 0,
          roi: parseFloat(r.roi) || 0,
          strikeRate: parseInt(r.total_bets) > 0 ? Math.round((parseInt(r.wins) / parseInt(r.total_bets)) * 100) : 0,
        };
      });

      res.json({ period: period, leaderboard: leaderboard });
    } catch (err) {
      console.error('[Leaderboard] Error:', err.message);
      res.json({ period: req.query.period || 'week', leaderboard: [] });
    }
  });

  return router;
};
