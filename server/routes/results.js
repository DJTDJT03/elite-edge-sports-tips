module.exports = function(deps) {
  const router = require('express').Router();
  const { db, jwt, JWT_SECRET, scoringModel } = deps;

  // GET /api/activity-feed
  router.get('/activity-feed', async (req, res) => {
    try {
      const results = await db.getResults();
      const tips = await db.getTips();
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const todayStr = now.toISOString().split('T')[0];

      // Helper: random-but-realistic member count
      function randMembers(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      // Helper: format odds as fractional string for display
      function formatOddsFrac(decimal) {
        if (!decimal || decimal <= 1) return String(decimal);
        var common = [
          [1.1,'1/10'],[1.2,'1/5'],[1.25,'1/4'],[1.33,'1/3'],[1.4,'2/5'],[1.5,'1/2'],
          [1.57,'4/7'],[1.62,'8/13'],[1.67,'4/6'],[1.73,'8/11'],[1.8,'4/5'],[1.83,'5/6'],
          [1.91,'10/11'],[2,'Evs'],[2.1,'11/10'],[2.2,'6/5'],[2.25,'5/4'],[2.38,'11/8'],
          [2.5,'6/4'],[2.62,'13/8'],[2.75,'7/4'],[2.88,'15/8'],[3,'2/1'],[3.25,'9/4'],
          [3.5,'5/2'],[3.75,'11/4'],[4,'3/1'],[4.33,'10/3'],[4.5,'7/2'],[5,'4/1'],
          [5.5,'9/2'],[6,'5/1'],[7,'6/1'],[8,'7/1'],[9,'8/1'],[10,'9/1'],
          [11,'10/1'],[13,'12/1'],[15,'14/1'],[17,'16/1'],[21,'20/1'],[26,'25/1'],
          [34,'33/1'],[51,'50/1'],[101,'100/1']
        ];
        var closest = common.reduce(function(prev, curr) {
          return Math.abs(curr[0] - decimal) < Math.abs(prev[0] - decimal) ? curr : prev;
        });
        if (Math.abs(closest[0] - decimal) < 0.15) return closest[1];
        return decimal.toFixed(2);
      }

      var messages = [];

      // 1. Recent WON results
      var recentWins = results.filter(function(r) {
        return r.result === 'won' && r.date >= sevenDaysAgo;
      }).slice(-6);
      recentWins.forEach(function(r) {
        var members = randMembers(8, 35);
        messages.push({
          text: members + ' members backed ' + r.selection + ' — WON at ' + formatOddsFrac(r.odds),
          type: 'won',
          timestamp: r.date
        });
        // Also add settled message
        if (r.pnl && r.pnl > 0) {
          messages.push({
            text: 'Premium tip settled: +' + r.pnl.toFixed(2) + 'u on ' + r.selection,
            type: 'settled',
            timestamp: r.date
          });
        }
      });

      // 2. Active tips (NAP and regular)
      var activeTips = tips.filter(function(t) {
        return t.status === 'active' && t.date >= todayStr;
      }).slice(0, 5);
      activeTips.forEach(function(t) {
        var members = randMembers(8, 28);
        if (t.isNap) {
          messages.push({
            text: 'NAP of the Day: ' + t.selection + ' at ' + (t.event || '') + ' — ' + members + ' members following',
            type: 'tip',
            timestamp: t.date || todayStr
          });
        } else {
          messages.push({
            text: t.selection + ' at ' + (t.event || '') + ' — ' + members + ' members tracking',
            type: 'tip',
            timestamp: t.date || todayStr
          });
        }
      });

      // 3. Weekly acca if present
      var acca = tips.find(function(t) { return t.isWeeklyAcca && t.status === 'active'; });
      if (acca) {
        messages.push({
          text: 'Weekly acca at ' + (acca.odds ? acca.odds.toFixed(2) : '?.??') + ' combined odds — ' + randMembers(15, 30) + ' members tracking',
          type: 'tip',
          timestamp: todayStr
        });
      }

      // 4. General social proof messages
      var cities = ['London', 'Manchester', 'Birmingham', 'Leeds', 'Liverpool', 'Glasgow', 'Edinburgh', 'Bristol', 'Cardiff', 'Belfast', 'Newcastle', 'Sheffield'];
      messages.push({
        text: 'New member joined from ' + cities[Math.floor(Math.random() * cities.length)],
        type: 'general',
        timestamp: todayStr
      });

      // Shuffle and limit to 8-12
      messages.sort(function() { return Math.random() - 0.5; });
      messages = messages.slice(0, Math.min(12, Math.max(8, messages.length)));

      res.json(messages);
    } catch (err) {
      console.error('[Results] GET /activity-feed error:', err.message);
      res.status(500).json({ error: 'Failed to fetch activity feed' });
    }
  });

  // GET /api/results
  router.get('/results', async (req, res) => {
    try {
      const results = await db.getResults();
      const { sport, market, date, league, analyst, confidence, days } = req.query;
      let filtered = results;
      if (sport) filtered = filtered.filter(r => r.sport === sport);
      if (market) filtered = filtered.filter(r => (r.market || '').toLowerCase().indexOf(market.toLowerCase()) !== -1);
      if (date) filtered = filtered.filter(r => r.date && r.date.toString().substring(0, 10) === date);
      if (league) filtered = filtered.filter(r => (r.event || '').toLowerCase().indexOf(league.toLowerCase()) !== -1 || (r.league || '').toLowerCase().indexOf(league.toLowerCase()) !== -1);
      if (analyst) filtered = filtered.filter(r => (r.tipsterProfile || '').toLowerCase().indexOf(analyst.toLowerCase()) !== -1);
      if (confidence) filtered = filtered.filter(r => r.confidence >= parseInt(confidence));
      if (days) {
        var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - parseInt(days));
        var cutoffStr = cutoff.toISOString().split('T')[0];
        filtered = filtered.filter(r => r.date && r.date.toString().substring(0, 10) >= cutoffStr);
      }
      res.json(filtered);
    } catch (err) {
      console.error('[Results] GET /results error:', err.message);
      res.status(500).json({ error: 'Failed to fetch results' });
    }
  });

  // GET /api/results/archive — grouped by date with daily summaries
  router.get('/results/archive', async (req, res) => {
    try {
      const results = await db.getResults();
      const { sport, days } = req.query;
      var maxDays = parseInt(days) || 30;
      var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - maxDays);
      var cutoffStr = cutoff.toISOString().split('T')[0];

      var filtered = results.filter(function(r) {
        if (sport && r.sport !== sport) return false;
        if (!r.date) return false;
        return r.date.toString().substring(0, 10) >= cutoffStr;
      });

      // Group by date
      var byDate = {};
      filtered.forEach(function(r) {
        var d = r.date.toString().substring(0, 10);
        if (!byDate[d]) byDate[d] = { date: d, results: [], wins: 0, losses: 0, voids: 0, pnl: 0 };
        byDate[d].results.push({
          id: r.id, tipId: r.tipId, sport: r.sport, event: r.event, selection: r.selection,
          market: r.market, odds: r.odds, result: r.result, pnl: r.pnl,
          confidence: r.confidence, analyst: r.tipsterProfile || 'Elite Edge',
          actualOutcome: r.actualOutcome, isPremium: r.isPremium,
        });
        if (r.result === 'won' || r.result === 'placed') byDate[d].wins++;
        else if (r.result === 'lost') byDate[d].losses++;
        else byDate[d].voids++;
        byDate[d].pnl += (r.pnl || 0);
      });

      // Convert to sorted array (newest first)
      var archive = Object.values(byDate).sort(function(a, b) { return b.date.localeCompare(a.date); });

      // Calculate running totals
      var totalWins = 0, totalLosses = 0, totalPnl = 0, totalTips = 0;
      filtered.forEach(function(r) {
        totalTips++;
        if (r.result === 'won' || r.result === 'placed') totalWins++;
        else if (r.result === 'lost') totalLosses++;
        totalPnl += (r.pnl || 0);
      });

      res.json({
        archive: archive,
        summary: {
          totalTips: totalTips,
          wins: totalWins,
          losses: totalLosses,
          strikeRate: totalTips > 0 ? Math.round((totalWins / totalTips) * 100) : 0,
          pnl: Math.round(totalPnl * 100) / 100,
          roi: totalTips > 0 ? Math.round((totalPnl / totalTips) * 100) : 0,
          days: archive.length,
        }
      });
    } catch (err) {
      console.error('[Results] GET /results/archive error:', err.message);
      res.status(500).json({ error: 'Failed to fetch archive' });
    }
  });

  // GET /api/results/performance
  router.get('/results/performance', async (req, res) => {
    try {
      const results = await db.getResults();
      const { sport, premium } = req.query;
      let filtered = results;
      if (sport) filtered = filtered.filter(r => r.sport === sport);
      if (premium === 'true') filtered = filtered.filter(r => r.isPremium);
      if (premium === 'false') filtered = filtered.filter(r => !r.isPremium);

      const performance = scoringModel.calculatePerformance(filtered);
      res.json(performance);
    } catch (err) {
      console.error('[Results] GET /results/performance error:', err.message);
      res.status(500).json({ error: 'Failed to fetch performance' });
    }
  });

  // GET /api/results/by-confidence
  router.get('/results/by-confidence', async (req, res) => {
    try {
      const results = await db.getResults();
      const tips = await db.getTips();

      // Build a map of tipId -> confidence for quick lookup
      const confMap = {};
      tips.forEach(function(t) {
        if (t && t.id) confMap[t.id] = t.confidence;
      });

      const tierDefs = [
        { tier: 'Elite', min: 9, max: 10, recommended: true },
        { tier: 'Strong', min: 7, max: 8, recommended: true },
        { tier: 'Medium', min: 5, max: 6, recommended: false },
        { tier: 'Speculative', min: 1, max: 4, recommended: false },
      ];

      const tiers = tierDefs.map(function(def) {
        const bucket = results.filter(function(r) {
          if (!r) return false;
          if (r.result === 'void') return false;
          let conf = typeof r.confidence === 'number' ? r.confidence : confMap[r.tipId];
          if (typeof conf !== 'number') return false;
          return conf >= def.min && conf <= def.max;
        });

        const totalTips = bucket.length;
        const wins = bucket.filter(function(r) { return r.result === 'won' || r.result === 'placed'; }).length;
        const pnl = bucket.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
        const totalStaked = bucket.reduce(function(s, r) { return s + (r.stake || 1); }, 0);
        const strikeRate = totalTips > 0 ? Math.round((wins / totalTips) * 1000) / 10 : 0;
        const roi = totalStaked > 0 ? Math.round((pnl / totalStaked) * 1000) / 10 : 0;

        return {
          tier: def.tier,
          range: def.min + '-' + def.max,
          recommended: def.recommended,
          totalTips: totalTips,
          wins: wins,
          strikeRate: strikeRate,
          pnl: Math.round(pnl * 100) / 100,
          roi: roi,
        };
      });

      res.json({ tiers: tiers });
    } catch (err) {
      console.error('[Results] GET /results/by-confidence error:', err.message);
      res.status(500).json({ error: 'Failed to fetch results by confidence' });
    }
  });

  // GET /api/notifications
  router.get('/notifications', async (req, res) => {
    try {
      const all = await db.getNotifications();

      // Detect user role from optional token
      const authHeader = req.headers.authorization;
      let audience = 'all';
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
          if (decoded && (decoded.role === 'admin' || decoded.subscription === 'premium')) {
            audience = 'premium';
          }
        } catch {}
      }

      // Premium users see everything; others only 'all'
      const filtered = audience === 'premium'
        ? all
        : all.filter(function(n) { return !n.audience || n.audience === 'all'; });

      res.json({ notifications: filtered.slice(0, 50) });
    } catch (err) {
      console.error('[Results] GET /notifications error:', err.message);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  // GET /api/results/streaks
  router.get('/results/streaks', async (req, res) => {
    try {
      const results = await db.getResults();
      // Normalise dates to strings (PostgreSQL returns Date objects)
      results.forEach(function(r) {
        if (r.date && typeof r.date !== 'string') r.date = new Date(r.date).toISOString().split('T')[0];
      });
      const sorted = [...results].sort((a, b) => new Date(a.date) - new Date(b.date));
      const counted = sorted.filter(r => r.result !== 'void');

      // Current winning streak (from most recent backwards)
      let currentStreak = 0;
      for (let i = counted.length - 1; i >= 0; i--) {
        if (counted[i].result === 'won' || counted[i].result === 'placed') currentStreak++;
        else break;
      }

      // Longest ever streak
      let longestStreak = 0;
      let tempStreak = 0;
      for (const r of counted) {
        if (r.result === 'won' || r.result === 'placed') { tempStreak++; longestStreak = Math.max(longestStreak, tempStreak); }
        else tempStreak = 0;
      }

      // Best week (by P/L)
      const weekMap = {};
      counted.forEach(r => {
        const d = new Date(r.date);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const key = weekStart.toISOString().split('T')[0];
        if (!weekMap[key]) weekMap[key] = { pnl: 0, wins: 0, total: 0 };
        weekMap[key].pnl += r.pnl || 0;
        weekMap[key].total++;
        if (r.result === 'won' || r.result === 'placed') weekMap[key].wins++;
      });
      let bestWeek = { week: null, pnl: 0 };
      for (const [week, data] of Object.entries(weekMap)) {
        if (data.pnl > bestWeek.pnl) bestWeek = { week, pnl: Math.round(data.pnl * 100) / 100, wins: data.wins, total: data.total };
      }

      // Best month (by P/L)
      const monthMap = {};
      counted.forEach(r => {
        const key = r.date.substring(0, 7);
        if (!monthMap[key]) monthMap[key] = { pnl: 0, wins: 0, total: 0 };
        monthMap[key].pnl += r.pnl || 0;
        monthMap[key].total++;
        if (r.result === 'won' || r.result === 'placed') monthMap[key].wins++;
      });
      let bestMonth = { month: null, pnl: 0 };
      for (const [month, data] of Object.entries(monthMap)) {
        if (data.pnl > bestMonth.pnl) bestMonth = { month, pnl: Math.round(data.pnl * 100) / 100, wins: data.wins, total: data.total };
      }

      // Performance stats
      const totalStaked = counted.reduce((sum, r) => sum + (r.stake || 0), 0);
      const totalPnl = counted.reduce((sum, r) => sum + (r.pnl || 0), 0);
      const wins = counted.filter(r => r.result === 'won' || r.result === 'placed').length;
      const roi = totalStaked > 0 ? Math.round((totalPnl / totalStaked) * 10000) / 100 : 0;
      const strikeRate = counted.length > 0 ? Math.round((wins / counted.length) * 10000) / 100 : 0;

      // Perfect weeks (100% strike rate with 3+ tips)
      let perfectWeeks = [];
      for (const [week, data] of Object.entries(weekMap)) {
        if (data.total >= 3 && data.wins === data.total) perfectWeeks.push(week);
      }

      // Badge calculations
      const badges = [
        { id: 'hot_streak', name: 'Hot Streak', description: '3+ consecutive winners', icon: 'flame', earned: currentStreak >= 3, progress: Math.min(currentStreak, 3), target: 3, earnedDate: currentStreak >= 3 ? new Date().toISOString().split('T')[0] : null },
        { id: 'on_fire', name: 'On Fire', description: '5+ consecutive winners', icon: 'fire', earned: currentStreak >= 5, progress: Math.min(currentStreak, 5), target: 5, earnedDate: currentStreak >= 5 ? new Date().toISOString().split('T')[0] : null },
        { id: 'unstoppable', name: 'Unstoppable', description: '8+ consecutive winners', icon: 'lightning', earned: longestStreak >= 8, progress: Math.min(longestStreak, 8), target: 8, earnedDate: longestStreak >= 8 ? new Date().toISOString().split('T')[0] : null },
        { id: 'perfect_week', name: 'Perfect Week', description: '100% strike rate in a week (3+ tips)', icon: 'star', earned: perfectWeeks.length > 0, progress: perfectWeeks.length, target: 1, earnedDate: perfectWeeks.length > 0 ? perfectWeeks[0] : null },
        { id: 'century_club', name: 'Century Club', description: '100+ tips settled', icon: 'trophy', earned: counted.length >= 100, progress: Math.min(counted.length, 100), target: 100, earnedDate: counted.length >= 100 ? counted[99].date : null },
        { id: 'roi_king', name: 'ROI King', description: 'ROI over 30%', icon: 'crown', earned: roi > 30, progress: Math.min(Math.round(roi), 30), target: 30, earnedDate: roi > 30 ? new Date().toISOString().split('T')[0] : null },
      ];

      res.json({
        currentStreak,
        longestStreak,
        bestWeek,
        bestMonth,
        totalTips: counted.length,
        wins,
        roi,
        strikeRate,
        badges
      });
    } catch (err) {
      console.error('[Results] GET /results/streaks error:', err.message);
      res.status(500).json({ error: 'Failed to fetch streaks' });
    }
  });

  return router;
};
