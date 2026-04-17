module.exports = function(deps) {
  const router = require('express').Router();
  const { db, authenticate, requireAdmin, scoringModel, emailService, racingSource, footballSource } = deps;

  // ---------------------------------------------------------------------------
  // ADMIN: List all users
  // ---------------------------------------------------------------------------
  router.get('/admin/users', authenticate, requireAdmin, async (req, res) => {
    const users = await db.getUsers();
    res.json(users.map(u => ({
      id: u.id, email: u.email, name: u.name, role: u.role,
      subscription: u.subscription, subscriptionExpiry: u.subscriptionExpiry, joined: u.joined,
      lastLogin: u.lastLogin || null,
      loginHistory: u.loginHistory || [],
      flagged: u.flagged || false,
      lockUntil: u.lockUntil || null,
      failedAttempts: u.failedAttempts || 0,
      sessionId: u.sessionId || null,
    })));
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Force logout a user
  // ---------------------------------------------------------------------------
  router.post('/admin/users/:id/force-logout', authenticate, requireAdmin, async (req, res) => {
    const users = await db.getUsers();
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.sessionId = require('crypto').randomUUID();
    await db.updateUser(user.id, user);
    res.json({ message: `Session invalidated for ${user.email}` });
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Lock account
  // ---------------------------------------------------------------------------
  router.post('/admin/users/:id/lock', authenticate, requireAdmin, async (req, res) => {
    const users = await db.getUsers();
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.lockUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await db.updateUser(user.id, user);
    res.json({ message: `Account locked for ${user.email}` });
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Unlock account
  // ---------------------------------------------------------------------------
  router.post('/admin/users/:id/unlock', authenticate, requireAdmin, async (req, res) => {
    const users = await db.getUsers();
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.lockUntil = null;
    user.failedAttempts = 0;
    user.flagged = false;
    await db.updateUser(user.id, user);
    res.json({ message: `Account unlocked for ${user.email}` });
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Change user subscription
  // ---------------------------------------------------------------------------
  router.put('/admin/users/:id/subscription', authenticate, requireAdmin, async (req, res) => {
    const users = await db.getUsers();
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { subscription, subscriptionExpiry } = req.body;
    const wasFree = user.subscription !== 'premium';
    if (subscription) {
      user.subscription = subscription;
      user.role = subscription === 'premium' ? 'premium' : (user.role === 'admin' ? 'admin' : 'free');
    }
    if (subscriptionExpiry !== undefined) user.subscriptionExpiry = subscriptionExpiry;

    // Initialise default email preferences if missing
    if (!user.emailPrefs) {
      user.emailPrefs = { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true };
    }

    await db.updateUser(user.id, user);

    // Send premium welcome email if upgrading from free to premium
    if (wasFree && subscription === 'premium') {
      const chargeDate = subscriptionExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      emailService.sendPremiumWelcome({ name: user.name, email: user.email, chargeDate }).catch(function(err) {
        console.error('[Email] Premium welcome email failed:', err.message);
      });
    }

    res.json({ message: `Subscription updated for ${user.email}: ${user.subscription}` });
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Create tip
  // ---------------------------------------------------------------------------
  router.post('/admin/tips', authenticate, requireAdmin, async (req, res) => {
    const tips = await db.getTips();
    const newTip = {
      id: `tip_${Date.now()}`,
      ...req.body,
      date: req.body.date || new Date().toISOString().split('T')[0],
      status: 'active',
      result: null,
    };
    // Calculate scoring if odds provided
    if (newTip.odds && !newTip.modelProbability) {
      newTip.impliedProbability = scoringModel.impliedProbability(newTip.odds);
    }
    tips.push(newTip);
    await db.saveTips(tips);
    res.json(newTip);
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Update tip
  // ---------------------------------------------------------------------------
  router.put('/admin/tips/:id', authenticate, requireAdmin, async (req, res) => {
    const tips = await db.getTips();
    const idx = tips.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Tip not found' });
    tips[idx] = { ...tips[idx], ...req.body };
    await db.saveTips(tips);
    res.json(tips[idx]);
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Delete tip
  // ---------------------------------------------------------------------------
  router.delete('/admin/tips/:id', authenticate, requireAdmin, async (req, res) => {
    let tips = await db.getTips();
    const before = tips.length;
    tips = tips.filter(t => t.id !== req.params.id);
    if (tips.length === before) return res.status(404).json({ error: 'Tip not found' });
    await db.saveTips(tips);
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Mark single result
  // ---------------------------------------------------------------------------
  router.post('/admin/results', authenticate, requireAdmin, async (req, res) => {
    const results = await db.getResults();
    const tips = await db.getTips();
    const { tipId, result } = req.body;

    const tip = tips.find(t => t.id === tipId);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });

    // Calculate P/L
    let pnl = 0;
    const stake = parseFloat(tip.staking) || 1;
    if (result === 'won') pnl = (tip.odds - 1) * stake;
    else if (result === 'placed') pnl = ((tip.odds - 1) / 4) * stake;
    else if (result === 'lost') pnl = -stake;
    // void = 0

    const newResult = {
      id: `res_${Date.now()}`,
      tipId: tip.id,
      sport: tip.sport,
      event: tip.event,
      selection: tip.selection,
      market: tip.market,
      odds: tip.odds,
      stake,
      result,
      pnl: Math.round(pnl * 100) / 100,
      date: tip.date,
      isPremium: tip.isPremium,
    };

    results.push(newResult);
    await db.saveResults(results);

    // Update tip status
    const tipIdx = tips.findIndex(t => t.id === tipId);
    tips[tipIdx].status = 'settled';
    tips[tipIdx].result = result;
    await db.saveTips(tips);

    res.json(newResult);
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Bulk result marking (NEW)
  // ---------------------------------------------------------------------------
  router.post('/admin/results/bulk', authenticate, requireAdmin, async (req, res) => {
    const { results: incoming } = req.body;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({ error: 'results array is required and must not be empty' });
    }

    const allResults = await db.getResults();
    const tips = await db.getTips();
    const settled = [];
    const errors = [];

    for (const { tipId, result } of incoming) {
      const tip = tips.find(t => t.id === tipId);
      if (!tip) {
        errors.push({ tipId, error: 'Tip not found' });
        continue;
      }
      if (tip.status === 'settled') {
        errors.push({ tipId, error: 'Tip already settled' });
        continue;
      }

      let pnl = 0;
      const stake = parseFloat(tip.staking) || 1;
      if (result === 'won') pnl = (tip.odds - 1) * stake;
      else if (result === 'placed') pnl = ((tip.odds - 1) / 4) * stake;
      else if (result === 'lost') pnl = -stake;

      const newResult = {
        id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tipId: tip.id,
        sport: tip.sport,
        event: tip.event,
        selection: tip.selection,
        market: tip.market,
        odds: tip.odds,
        stake,
        result,
        pnl: Math.round(pnl * 100) / 100,
        date: tip.date,
        isPremium: tip.isPremium,
      };

      allResults.push(newResult);
      tip.status = 'settled';
      tip.result = result;
      settled.push(newResult);
    }

    await db.saveResults(allResults);
    await db.saveTips(tips);

    res.json({ settled, errors, settledCount: settled.length, errorCount: errors.length });
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Auto-result marking (racing + football)
  // ---------------------------------------------------------------------------
  router.post('/admin/auto-results', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    try {
      const tips = await db.getTips();
      const results = await db.getResults();
      let updated = 0;

      // Auto-mark racing results if Racing API connected
      if (racingSource && process.env.RACING_API_KEY) {
        const today = new Date().toISOString().split('T')[0];
        const raceResults = await racingSource.fetchResults(today);
        if (raceResults.results) {
          tips.forEach(function(tip) {
            if (tip.sport !== 'racing' || tip.status !== 'active' || tip.result) return;
            const match = (raceResults.results || []).find(function(r) {
              return r.runners && r.runners.some(function(runner) {
                return runner.horse && runner.horse.toLowerCase() === tip.selection.toLowerCase() && runner.position === 1;
              });
            });
            if (match) {
              tip.status = 'settled';
              tip.result = 'won';
              results.push({
                id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                tipId: tip.id, sport: tip.sport, event: tip.event, selection: tip.selection,
                market: tip.market, odds: tip.odds, stake: parseFloat(tip.staking) || 2,
                result: 'won', pnl: ((tip.odds - 1) * (parseFloat(tip.staking) || 2)),
                date: today, isPremium: tip.isPremium, tipsterProfile: tip.tipsterProfile || 'The Edge'
              });
              updated++;
            }
          });
        }
      }

      // Auto-mark football results if API-Football connected
      if (footballSource && process.env.API_FOOTBALL_KEY) {
        const todayFb = new Date().toISOString().split('T')[0];
        const fbRaw = await footballSource.fetchFixturesByDate(todayFb);
        const fbResults = footballSource.normalise(fbRaw).filter(function(f) { return f.status === 'FT'; });

        tips.forEach(function(tip) {
          if (tip.sport !== 'football' || tip.status !== 'active' || tip.result) return;
          const match = fbResults.find(function(f) {
            const eventLower = (tip.event || '').toLowerCase();
            return eventLower.indexOf(f.homeTeam.toLowerCase()) !== -1 || eventLower.indexOf(f.awayTeam.toLowerCase()) !== -1;
          });
          if (match) {
            const homeGoals = match.homeGoals || 0;
            const awayGoals = match.awayGoals || 0;
            const totalGoals = homeGoals + awayGoals;
            let won = false;

            const market = (tip.market || '').toLowerCase();
            const selection = (tip.selection || '').toLowerCase();

            if (market.indexOf('result') !== -1) {
              if (selection.indexOf('home') !== -1 || selection.indexOf(match.homeTeam.toLowerCase()) !== -1) won = homeGoals > awayGoals;
              else if (selection.indexOf('away') !== -1 || selection.indexOf(match.awayTeam.toLowerCase()) !== -1) won = awayGoals > homeGoals;
              else if (selection.indexOf('draw') !== -1) won = homeGoals === awayGoals;
            } else if (market.indexOf('btts') !== -1 || market.indexOf('both teams') !== -1) {
              won = selection.indexOf('yes') !== -1 ? (homeGoals > 0 && awayGoals > 0) : !(homeGoals > 0 && awayGoals > 0);
            } else if (market.indexOf('over') !== -1) {
              if (selection.indexOf('2.5') !== -1) won = totalGoals > 2;
              else if (selection.indexOf('1.5') !== -1) won = totalGoals > 1;
              else if (selection.indexOf('3.5') !== -1) won = totalGoals > 3;
            } else if (market.indexOf('under') !== -1) {
              if (selection.indexOf('2.5') !== -1) won = totalGoals < 3;
              else if (selection.indexOf('1.5') !== -1) won = totalGoals < 2;
            }

            tip.status = 'settled';
            tip.result = won ? 'won' : 'lost';
            const stake = parseFloat(tip.staking) || 2;
            results.push({
              id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              tipId: tip.id, sport: tip.sport, event: tip.event, selection: tip.selection,
              market: tip.market, odds: tip.odds, stake: stake,
              result: won ? 'won' : 'lost', pnl: won ? ((tip.odds - 1) * stake) : -stake,
              date: todayFb, isPremium: tip.isPremium, tipsterProfile: tip.tipsterProfile || 'The Edge'
            });
            updated++;
          }
        });
      }

      if (updated > 0) {
        await db.saveTips(tips);
        await db.saveResults(results);
      }

      res.json({ success: true, updated, message: `${updated} tip(s) auto-settled` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Stats dashboard (NEW)
  // ---------------------------------------------------------------------------
  router.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
    const users = await db.getUsers();
    const tips = await db.getTips();
    const results = await db.getResults();

    const totalUsers = users.length;
    const premiumUsers = users.filter(u => u.subscription === 'premium').length;
    const freeUsers = totalUsers - premiumUsers;
    const conversionRate = totalUsers > 0 ? Math.round((premiumUsers / totalUsers) * 10000) / 100 : 0;

    const today = new Date().toISOString().split('T')[0];
    const tipsToday = tips.filter(t => t.date === today).length;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const resultsThisWeek = results.filter(r => r.date >= weekAgo).length;

    const totalPnL = results.reduce((sum, r) => sum + (r.pnl || 0), 0);

    res.json({
      totalUsers,
      premiumUsers,
      freeUsers,
      conversionRate,
      tipsToday,
      resultsThisWeek,
      totalPnL: Math.round(totalPnL * 100) / 100,
    });
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Audit log (NEW)
  // ---------------------------------------------------------------------------
  router.get('/admin/audit-log', authenticate, requireAdmin, async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const log = await db.getAuditLog(page, limit);
    res.json(log);
  });

  // ---------------------------------------------------------------------------
  // EMAIL: Diagnostic
  // ---------------------------------------------------------------------------
  router.get('/email/diagnostic', async (req, res) => {
    res.json({
      transport: emailService.transport ? emailService.transport.name : 'none',
      fromAddress: emailService.fromAddress,
      env: {
        RESEND_API_KEY: process.env.RESEND_API_KEY ? 'SET' : 'NOT SET',
        SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ? 'SET' : 'NOT SET',
        SMTP_HOST: process.env.SMTP_HOST ? 'SET' : 'NOT SET',
        SMTP_USER: process.env.SMTP_USER ? 'SET' : 'NOT SET',
        EMAIL_FROM: process.env.EMAIL_FROM || '(default)'
      }
    });
  });

  // ---------------------------------------------------------------------------
  // EMAIL: Test send
  // ---------------------------------------------------------------------------
  router.post('/email/test', async (req, res) => {
    try {
      const to = req.body.to;
      if (!to) return res.status(400).json({ error: 'Missing "to" field' });
      const result = await emailService._sendEmail({
        to,
        subject: 'Elite Edge Test Email',
        html: '<h2>Email System Test</h2><p>If you are reading this, your email transport is working correctly.</p><p>Transport: <strong>' + emailService.transport.name + '</strong></p><p>Sent: ' + new Date().toISOString() + '</p>',
        text: 'Email System Test. Transport: ' + emailService.transport.name,
        emailType: 'test'
      });
      res.json({ success: true, transport: emailService.transport.name, result });
    } catch (err) {
      console.error('[Email Test] Failed:', err.message);
      res.status(500).json({ error: err.message, transport: emailService.transport ? emailService.transport.name : 'none' });
    }
  });

  // ---------------------------------------------------------------------------
  // EMAIL: Compose bulletin
  // ---------------------------------------------------------------------------
  router.post('/email/compose', authenticate, requireAdmin, async (req, res) => {
    const { subject, summary, tipIds, targetAudience } = req.body;
    const allTips = await db.getTips();
    const selectedTips = tipIds ? allTips.filter(t => tipIds.includes(t.id)) : allTips.filter(t => t.status === 'active');
    const bulletin = emailService.composeBulletin({ subject, summary, tips: selectedTips, targetAudience });
    res.json(bulletin);
  });

  // ---------------------------------------------------------------------------
  // EMAIL: Send bulletin
  // ---------------------------------------------------------------------------
  router.post('/email/send', authenticate, requireAdmin, async (req, res) => {
    try {
      const { subject, summary, tipIds, targetAudience } = req.body;
      const allTips = await db.getTips();
      const selectedTips = tipIds ? allTips.filter(t => tipIds.includes(t.id)) : allTips.filter(t => t.status === 'active');
      const bulletin = emailService.composeBulletin({ subject, summary, tips: selectedTips, targetAudience });
      const users = await db.getUsers();
      const result = await emailService.sendBulletin(bulletin, users);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // EMAIL: Schedule bulletin
  // ---------------------------------------------------------------------------
  router.post('/email/schedule', authenticate, requireAdmin, async (req, res) => {
    const { subject, summary, tipIds, targetAudience, sendAt } = req.body;
    const allTips = await db.getTips();
    const selectedTips = tipIds ? allTips.filter(t => tipIds.includes(t.id)) : allTips.filter(t => t.status === 'active');
    const bulletin = emailService.composeBulletin({ subject, summary, tips: selectedTips, targetAudience });
    const users = await db.getUsers();
    const scheduled = emailService.scheduleBulletin(bulletin, users, sendAt);
    res.json(scheduled);
  });

  // ---------------------------------------------------------------------------
  // EMAIL: Sent emails
  // ---------------------------------------------------------------------------
  router.get('/email/sent', authenticate, requireAdmin, async (req, res) => {
    res.json(emailService.getSentEmails());
  });

  // ---------------------------------------------------------------------------
  // SCORING: Calculate
  // ---------------------------------------------------------------------------
  router.post('/scoring/calculate', authenticate, requireAdmin, async (req, res) => {
    const { sport, factors, odds } = req.body;
    if (sport === 'racing') {
      res.json(scoringModel.scoreRacing(factors, odds));
    } else if (sport === 'football') {
      res.json(scoringModel.scoreFootball(factors, odds));
    } else {
      res.status(400).json({ error: 'Sport must be racing or football' });
    }
  });

  // ---------------------------------------------------------------------------
  // CHAT: Public chatbot
  // ---------------------------------------------------------------------------
  const chatLogs = [];

  router.post('/chat', async (req, res) => {
    const { message } = req.body;
    const lower = (message || '').toLowerCase();

    let response = '';
    let suggestions = [];

    if (lower.includes('best tip') || lower.includes('today') || lower.includes('pick')) {
      const tips = (await db.getTips()).filter(t => t.status === 'active');
      const best = tips.sort((a, b) => b.confidence - a.confidence)[0];
      if (best) {
        response = `Our top pick today is ${best.selection} in ${best.event} at odds of ${best.odds}. Confidence: ${best.confidence}/10 with a ${(best.edge * 100).toFixed(1)}% edge. ${best.isPremium ? 'This is a Premium tip — upgrade to see full analysis.' : ''}`;
      } else {
        response = 'No active tips at the moment. Check back soon — our analysts publish daily selections.';
      }
      suggestions = ['Show all racing tips', 'Show football tips', 'How is ROI calculated?'];
    } else if (lower.includes('racing') || lower.includes('horse')) {
      const tips = (await db.getTips()).filter(t => t.sport === 'racing' && t.status === 'active');
      response = `We have ${tips.length} racing tips today across ${[...new Set(tips.map(t => t.meeting))].join(', ')}. ${tips.filter(t => !t.isPremium).length} are free and ${tips.filter(t => t.isPremium).length} are Premium.`;
      suggestions = ['Show football tips', "Today's best tips?", 'How do I upgrade?'];
    } else if (lower.includes('football') || lower.includes('soccer')) {
      const tips = (await db.getTips()).filter(t => t.sport === 'football' && t.status === 'active');
      response = `We have ${tips.length} football tips today covering ${[...new Set(tips.map(t => t.league))].join(', ')}. Markets include ${[...new Set(tips.map(t => t.market))].join(', ')}.`;
      suggestions = ['Show racing tips', "Today's best tips?", 'How do I upgrade?'];
    } else if (lower.includes('upgrade') || lower.includes('premium') || lower.includes('subscribe') || lower.includes('price')) {
      response = 'Your first month of Premium is completely FREE! After that it\u2019s just \u00a319.99/month (or \u00a3119.99/year to save \u00a360). Your subscription auto-renews monthly but you can cancel anytime before your free trial ends. Click the Upgrade button to start your free month.';
      suggestions = ['What do I get with Premium?', "Today's best tips?", 'Show my results'];
    } else if (lower.includes('roi') || lower.includes('profit') || lower.includes('performance') || lower.includes('results') || lower.includes('record')) {
      const results = await db.getResults();
      const perf = scoringModel.calculatePerformance(results);
      response = `Our overall record: ${perf.totalTips} tips with a ${perf.strikeRate}% strike rate and ${perf.roi > 0 ? '+' : ''}${perf.roi}% ROI. Running bank: ${perf.runningBank} units (started at 100). Our model consistently finds value — check the Results page for full breakdown.`;
      suggestions = ['Show racing results', 'Show football results', "Today's best tips?"];
    } else if (lower.includes('why') && (lower.includes('rated') || lower.includes('confidence') || lower.includes('score'))) {
      response = 'Our confidence scores (1-10) are calculated using a multi-factor weighted model. For racing, we analyse form, going, class, trainer/jockey stats, course record, draw, weight, speed ratings, and market support. For football, we use xG, form, H2H, injuries, home/away splits, motivation, shots, and schedule congestion. The edge % shows how much our probability exceeds the bookmaker\'s implied probability.';
      suggestions = ['How is ROI calculated?', "Today's best tips?", 'How do I upgrade?'];
    } else if (lower.includes('help') || lower.includes('support') || lower.includes('contact')) {
      response = 'Need help? You can submit a support ticket via the Contact page, or email us at support@eliteedgesports.co.uk. We typically respond within 2 hours during business hours.';
      suggestions = ["Today's best tips?", 'How do I upgrade?', 'How is ROI calculated?'];
    } else if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
      response = 'Hello! Welcome to Elite Edge Sports Tips. I can help you find today\'s best tips, explain our scoring model, or guide you through our Premium features. What would you like to know?';
      suggestions = ["Today's best tips?", 'How do I upgrade?', 'Show racing tips'];
    } else {
      response = "I can help with tips, results, scoring explanations, and subscription queries. Try asking about today's best tips, how our model works, or Premium features.";
      suggestions = ["Today's best tips?", 'How is ROI calculated?', 'How do I upgrade?', 'Show racing tips'];
    }

    // Log for admin review
    chatLogs.push({
      message, response,
      timestamp: new Date().toISOString(),
      userId: null,
    });

    res.json({ response, suggestions });
  });

  // ---------------------------------------------------------------------------
  // CHAT: Admin logs
  // ---------------------------------------------------------------------------
  router.get('/chat/logs', authenticate, requireAdmin, async (req, res) => {
    res.json(chatLogs);
  });

  return router;
};
