module.exports = function(deps) {
  const router = require('express').Router();
  const { db, authenticate, requireAdmin, scoringModel, emailService, racingSource, footballSource } = deps;

  // ---------------------------------------------------------------------------
  // ADMIN: List all users
  // ---------------------------------------------------------------------------
  router.get('/admin/users', authenticate, requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
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
    try {
      const users = await db.getUsers();
      // Type-safe id match (DB id may be number while the URL param is a string).
      const user = users.find(u => String(u.id) === String(req.params.id));
      if (!user) return res.status(404).json({ error: 'User not found for id ' + req.params.id });
      const { subscription, subscriptionExpiry } = req.body;
      const PAID = ['starter', 'premium', 'vip'];
      const wasFree = !PAID.includes(user.subscription);

      // Build a MINIMAL update — only the fields we're changing. Passing the whole
      // user object risked a bad field silently failing the UPDATE.
      const fields = {};
      var grantedCredits = null;
      if (subscription) {
        fields.subscription = subscription;
        fields.role = (subscription === 'premium' || subscription === 'vip') ? 'premium' : (user.role === 'admin' ? 'admin' : 'free');
        if (PAID.includes(subscription)) {
          fields.trialActive = false;
          fields.subscriptionExpiry = subscriptionExpiry || user.subscriptionExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          grantedCredits = subscription === 'vip' ? 999999 : subscription === 'premium' ? 250 : 50;
          fields.credits = grantedCredits;
        }
      }
      if (subscriptionExpiry !== undefined) fields.subscriptionExpiry = subscriptionExpiry;

      const updated = await db.updateUser(user.id, fields);

      // Defend against DUPLICATE account rows for the same email: apply the same
      // change to every row with this email so the list can't show a stale twin.
      var emailRows = [];
      if (db.query && subscription) {
        try {
          await db.query(
            'UPDATE users SET subscription = $1, role = $2, updated_at = NOW() WHERE LOWER(email) = LOWER($3)',
            [fields.subscription, fields.role, user.email]
          );
          if (fields.subscriptionExpiry !== undefined) {
            await db.query('UPDATE users SET subscription_expiry = $1 WHERE LOWER(email) = LOWER($2)', [fields.subscriptionExpiry, user.email]);
          }
          if (fields.credits !== undefined) {
            await db.query('UPDATE users SET credits = $1, trial_active = FALSE WHERE LOWER(email) = LOWER($2)', [fields.credits, user.email]);
          }
          var rr = await db.query('SELECT id, subscription, created_at FROM users WHERE LOWER(email) = LOWER($1) ORDER BY created_at', [user.email]);
          emailRows = rr.rows || [];
        } catch (e) { console.warn('[Admin] email-wide update/diag failed:', e.message); }
      }

      if (grantedCredits !== null && db.recordCreditTransaction) {
        db.recordCreditTransaction({ userId: user.id, amount: grantedCredits, balanceAfter: grantedCredits, type: 'subscription_grant', description: 'Admin set ' + subscription + ' — ' + grantedCredits + ' monthly credits' }).catch(function(){});
      }
      if (wasFree && subscription === 'premium') {
        const chargeDate = subscriptionExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        emailService.sendPremiumWelcome({ name: user.name, email: user.email, chargeDate }).catch(function(err) {
          console.error('[Email] Premium welcome email failed:', err.message);
        });
      }

      // Read back the persisted value so we report the TRUTH, not what we hoped.
      const persisted = (updated && updated.subscription) || (await db.getUserById(user.id) || {}).subscription;
      const rowsNote = emailRows.length ? ' | ' + emailRows.length + ' row(s) for this email: [' + emailRows.map(r => r.subscription).join(', ') + ']' : '';
      console.log('[Admin] Set ' + user.email + ' -> requested ' + subscription + ', persisted ' + persisted + rowsNote);
      res.json({ message: `${user.email} is now: ${persisted}${rowsNote}`, persisted: persisted, requested: subscription, emailRows: emailRows.length });
    } catch (err) {
      console.error('[Admin] Subscription update failed:', err.message);
      res.status(500).json({ error: 'Update failed: ' + err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Reconcile a user against Stripe — fixes "paid but still on free".
  // Reads the live subscription from Stripe (source of truth) and provisions
  // the correct tier, expiry, credits and Stripe IDs.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // ADMIN: Broadcast the "Add to Home Screen" (install as app) announcement.
  // Short push + in-app nudge for everyone, plus a step-by-step email (iOS+Android).
  // ---------------------------------------------------------------------------
  router.post('/admin/announce-pwa', authenticate, requireAdmin, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const result = { notification: false, push: false, emails: 0, telegram: false };

      // Telegram channel post
      if (deps.telegramBot && deps.telegramBot.isAvailable && deps.telegramBot.isAvailable()) {
        var tg = '📲 <b>Get Elite Edge on your phone — like an app</b>\n\n' +
          'One tap to open. No app store, no download.\n\n' +
          '🍏 <b>iPhone (Safari):</b> tap <b>Share</b> → <b>Add to Home Screen</b> → Add\n' +
          '🤖 <b>Android (Chrome):</b> tap the <b>⋮</b> menu → <b>Add to Home screen</b> → Add\n\n' +
          'eliteedgesports.co.uk\n<i>18+ | BeGambleAware.org</i>';
        try { await deps.telegramBot.sendMessage(tg, 'HTML'); result.telegram = true; } catch (e) { console.warn('[Admin] PWA telegram failed:', e.message); }
      }

      // In-app notification (the bell) — everyone
      try {
        await db.createNotification({
          id: 'pwa_' + Date.now(), type: 'announcement', timestamp: now, audience: 'all',
          message: '📲 Add Elite Edge to your home screen for one-tap access — no app store needed. Open your browser menu and choose "Add to Home Screen". Full step-by-step just emailed to you.',
        });
        result.notification = true;
      } catch (e) {}

      // Push notification — opted-in users
      if (deps.pushService && deps.pushService.isAvailable) {
        deps.pushService.broadcast(db, {
          title: '📲 Install Elite Edge as an app',
          body: 'Add us to your home screen for instant one-tap access — check your inbox for the 10-second how-to.',
          url: '/#/dashboard', tag: 'pwa-install',
        }).then(function () { result.push = true; }).catch(function () {});
      }

      // Email with full instructions — subscribers who haven't opted out
      if (emailService && (emailService._sendEmail || emailService.sendGeneric)) {
        const subject = '📲 Add Elite Edge to your home screen (takes 10 seconds)';
        const html = '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">' +
          '<h2 style="color:#0a0e1a;">Get Elite Edge on your home screen 📲</h2>' +
          '<p>Add Elite Edge to your phone like an app — one tap to open, no app store, no download. Here\'s how, takes 10 seconds:</p>' +
          '<div style="background:#f4f4f4;border-radius:10px;padding:16px;margin:16px 0;">' +
            '<h3 style="margin:0 0 8px;color:#0a5;">iPhone &amp; iPad (Safari)</h3>' +
            '<ol style="margin:0;padding-left:20px;line-height:1.7;">' +
              '<li>Open <strong>eliteedgesports.co.uk</strong> in <strong>Safari</strong>.</li>' +
              '<li>Tap the <strong>Share</strong> button (the square with an arrow pointing up).</li>' +
              '<li>Scroll down and tap <strong>"Add to Home Screen"</strong>.</li>' +
              '<li>Tap <strong>Add</strong> — the Elite Edge icon appears on your home screen.</li>' +
            '</ol>' +
          '</div>' +
          '<div style="background:#f4f4f4;border-radius:10px;padding:16px;margin:16px 0;">' +
            '<h3 style="margin:0 0 8px;color:#0a5;">Android (Chrome)</h3>' +
            '<ol style="margin:0;padding-left:20px;line-height:1.7;">' +
              '<li>Open <strong>eliteedgesports.co.uk</strong> in <strong>Chrome</strong>.</li>' +
              '<li>Tap the <strong>⋮</strong> menu (top-right).</li>' +
              '<li>Tap <strong>"Add to Home screen"</strong> (or <strong>"Install app"</strong>).</li>' +
              '<li>Tap <strong>Add</strong> / <strong>Install</strong> — done.</li>' +
            '</ol>' +
          '</div>' +
          '<p style="text-align:center;margin:22px 0;"><a href="https://eliteedgesports.co.uk/" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;">Open Elite Edge →</a></p>' +
          '<p style="font-size:12px;color:#777;">You\'ll get faster access to tips, World Cup, Last Man Standing and live results. 18+ | BeGambleAware.org. <a href="https://eliteedgesports.co.uk/#/account" style="color:#777;">Email preferences</a>.</p>' +
        '</div>';
        const users = await db.getUsers();
        for (let i = 0; i < users.length; i++) {
          const u = users[i];
          if (!u.email) continue;
          const p = u.emailPrefs || {};
          if (p.marketing === false && p.dailyBulletin === false) continue;
          const send = emailService._sendEmail
            ? emailService._sendEmail({ to: u.email, subject: subject, html: html, emailType: 'pwa_install' })
            : emailService.sendGeneric({ to: u.email, subject: subject, html: html });
          send.then(function () {}).catch(function () {});
          result.emails++;
        }
      }
      console.log('[Admin] PWA install announcement — notification:' + result.notification + ', emails:' + result.emails);
      res.json(result);
    } catch (err) {
      console.error('[Admin] announce-pwa failed:', err.message);
      res.status(500).json({ error: 'Announcement failed: ' + err.message });
    }
  });

  router.post('/admin/users/:id/reconcile-stripe', authenticate, requireAdmin, async (req, res) => {
    try {
      const stripeService = deps.stripeService;
      if (!stripeService || !stripeService.isAvailable) {
        return res.status(503).json({ error: 'Stripe not configured' });
      }
      const users = await db.getUsers();
      const user = users.find(u => String(u.id) === String(req.params.id));
      if (!user) return res.status(404).json({ error: 'User not found' });

      const found = await stripeService.findSubscriptionByEmail(user.email);
      if (!found || !found.ok) {
        const d = (found && found.diag) || { customers: 0, subs: [] };
        const detail = ' (Stripe: ' + d.customers + ' customer(s) for this email; subscription statuses: [' + (d.subs.join(', ') || 'none') + '])';
        return res.json({ reconciled: false, message: 'No active subscription found for ' + user.email + detail + '. If the payment used a different email, change their account email to match, or use the Plan button to set the tier manually.' });
      }

      const credits = found.tier === 'vip' ? 999999 : found.tier === 'premium' ? 250 : 50;
      const expiry = found.currentPeriodEnd ? new Date(found.currentPeriodEnd * 1000).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await db.updateUser(user.id, {
        subscription: found.tier,
        role: (found.tier === 'premium' || found.tier === 'vip') ? 'premium' : (user.role === 'admin' ? 'admin' : 'free'),
        subscriptionExpiry: expiry,
        trialActive: false,
        credits: credits,
        stripeCustomerId: found.customerId,
        stripeSubscriptionId: found.subscriptionId,
      });
      if (db.recordCreditTransaction) {
        db.recordCreditTransaction({ userId: user.id, amount: credits, balanceAfter: credits, type: 'subscription_grant', description: 'Stripe reconcile — ' + found.tier + ' (' + credits + ' credits)' }).catch(function(){});
      }
      console.log('[Admin] Reconciled ' + user.email + ' to ' + found.tier + ' from Stripe (' + found.status + ')');
      res.json({ reconciled: true, tier: found.tier, status: found.status, message: user.email + ' set to ' + found.tier + ' (Stripe status: ' + found.status + ').' });
    } catch (err) {
      console.error('[Admin] Stripe reconcile failed:', err.message);
      res.status(500).json({ error: 'Reconcile failed: ' + err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Create tip
  // ---------------------------------------------------------------------------
  // Allowed fields for tip creation/update — prevents injection of arbitrary fields
  var TIP_FIELDS = ['sport','event','meeting','raceTime','raceClass','distance','going',
    'league','kickoff','venue','market','selection','odds','confidence','modelProbability',
    'impliedProbability','edge','valueRating','isPremium','staking','riskLevel','analysis',
    'isNap','isOutsider','openingOdds','bookmakerOdds','recentForm','tipster','tipsterProfile','date'];

  function pickFields(body, allowed) {
    var result = {};
    for (var i = 0; i < allowed.length; i++) {
      if (body[allowed[i]] !== undefined) result[allowed[i]] = body[allowed[i]];
    }
    return result;
  }

  router.post('/admin/tips', authenticate, requireAdmin, async (req, res) => {
    var fields = pickFields(req.body, TIP_FIELDS);
    var newTip = Object.assign({
      id: 'tip_' + Date.now(),
      date: new Date().toISOString().split('T')[0],
      status: 'active',
      result: null,
    }, fields);
    if (newTip.odds && !newTip.modelProbability) {
      newTip.impliedProbability = scoringModel.impliedProbability(newTip.odds);
    }
    await db.createTip(newTip);
    res.json(newTip);
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Update tip
  // ---------------------------------------------------------------------------
  router.put('/admin/tips/:id', authenticate, requireAdmin, async (req, res) => {
    var existing = await db.getTipById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Tip not found' });
    var fields = pickFields(req.body, TIP_FIELDS);
    var updated = await db.updateTip(req.params.id, fields);
    res.json(updated);
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
    const { tipId, result, actualOutcome } = req.body;

    const tip = tips.find(t => t.id === tipId);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });

    // Calculate P/L
    let pnl = 0;
    const stake = parseFloat(tip.staking) || 1;
    if (result === 'won') pnl = (tip.odds - 1) * stake;
    else if (result === 'placed') pnl = ((tip.odds - 1) / 4) * stake;
    else if (result === 'lost') pnl = -stake;
    // void = 0

    // Store actual outcome on the tip
    if (actualOutcome) {
      await db.updateTip(tip.id, { actualOutcome });
    }

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
      actualOutcome: actualOutcome || null,
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
  // ADMIN: Add manual result (no tip required) + optional Telegram post
  // ---------------------------------------------------------------------------
  router.post('/admin/manual-result', authenticate, requireAdmin, async (req, res) => {
    try {
      var { selection, sport, event, market, odds, stake, result, date, tipsterProfile, confidence, postToTelegram } = req.body;
      if (!selection || !odds || !result) return res.status(400).json({ error: 'selection, odds, and result are required' });

      var numOdds = parseFloat(odds) || 2;
      var numStake = parseFloat(stake) || 2;
      var pnl = 0;
      if (result === 'won') pnl = (numOdds - 1) * numStake;
      else if (result === 'placed') pnl = ((numOdds - 1) / 4) * numStake;
      else if (result === 'lost') pnl = -numStake;

      var rid = 'manual_' + Date.now();
      await db.query(
        "INSERT INTO results (id, tip_id, sport, event, selection, market, odds, stake, result, pnl, date, is_premium, tipster_profile, confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [rid, null, sport || 'football', event || selection, selection, market || 'Match Result', numOdds, numStake, result, Math.round(pnl * 100) / 100, date ? new Date(date) : new Date(), true, tipsterProfile || 'The Edge', confidence || 7]
      );

      // Post to Telegram if requested and result is a win
      if (postToTelegram && (result === 'won' || result === 'placed')) {
        try {
          var tgBot = require('../services/telegramBot');
          if (tgBot && tgBot.isAvailable()) {
            await tgBot.sendResult({ selection: selection, odds: numOdds, result: result, pnl: Math.round(pnl * 100) / 100, event: event || selection });
          }
        } catch(tgErr) {}
      }

      res.json({ id: rid, selection: selection, odds: numOdds, result: result, pnl: Math.round(pnl * 100) / 100, posted: postToTelegram ? true : false });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
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
    // Paying = any subscribed tier. The old metric only counted 'premium', which
    // undercounted Starter and VIP — fixed here so conversion reflects real revenue.
    const starterUsers = users.filter(u => u.subscription === 'starter').length;
    const premiumUsers = users.filter(u => u.subscription === 'premium').length;
    const vipUsers = users.filter(u => u.subscription === 'vip').length;
    const trialingUsers = users.filter(u => u.trialActive === true).length;
    const payingUsers = starterUsers + premiumUsers + vipUsers;
    const freeUsers = totalUsers - payingUsers;
    const conversionRate = totalUsers > 0 ? Math.round((payingUsers / totalUsers) * 10000) / 100 : 0;

    // Win-back metrics
    const churnedUsers = users.filter(u => u.churnedAt).length;       // currently in win-back sequence
    const reactivatedUsers = users.filter(u => u.winbackReactivation === true).length;
    const everChurned = churnedUsers + reactivatedUsers;              // total who ever cancelled (still-gone + recovered)
    const winbackRate = everChurned > 0 ? Math.round((reactivatedUsers / everChurned) * 10000) / 100 : 0;

    const today = new Date().toISOString().split('T')[0];
    const tipsToday = tips.filter(t => t.date === today).length;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const resultsThisWeek = results.filter(r => r.date >= weekAgo).length;

    const totalPnL = results.reduce((sum, r) => sum + (r.pnl || 0), 0);

    res.json({
      totalUsers,
      payingUsers,
      starterUsers,
      premiumUsers,
      vipUsers,
      trialingUsers,
      freeUsers,
      conversionRate,
      // Win-back
      churnedUsers,
      reactivatedUsers,
      winbackRate,
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
  router.get('/email/diagnostic', authenticate, requireAdmin, async (req, res) => {
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
  router.post('/email/test', authenticate, requireAdmin, async (req, res) => {
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

  // Custom email — send any subject/html to any address
  router.post('/email/custom', authenticate, requireAdmin, async (req, res) => {
    try {
      const { to, subject, html } = req.body;
      if (!to || !subject || !html) return res.status(400).json({ error: 'Missing to, subject, or html' });
      const result = await emailService._sendEmail({ to, subject, html, emailType: 'custom' });
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
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
      response = 'Your 14-day Premium trial is completely FREE! After that it\u2019s just \u00a319.99/month (or \u00a3119.99/year to save \u00a360). Your subscription auto-renews monthly but you can cancel anytime before your free trial ends. Click the Upgrade button to start your free month.';
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

  // ---------------------------------------------------------------------------
  // ADMIN: Selection Performance Analytics
  // ---------------------------------------------------------------------------
  router.get('/admin/selection-analytics', authenticate, requireAdmin, async (req, res) => {
    try {
      const results = await db.getResults();
      const tips = await db.getTips();

      // Build a lookup from tipId to tip for joining extra fields
      var tipMap = {};
      tips.forEach(function(t) { tipMap[t.id] = t; });

      // Normalise date helper
      function normD(d) {
        if (!d) return '';
        if (typeof d === 'string') return d.split('T')[0];
        try { return new Date(d).toISOString().split('T')[0]; } catch(e) { return ''; }
      }

      // Enrich each result with tip-level fields
      var enriched = results.map(function(r) {
        var tip = tipMap[r.tipId] || {};
        return {
          id: r.id,
          tipId: r.tipId,
          sport: (r.sport || tip.sport || '').toLowerCase(),
          event: r.event || tip.event || '',
          selection: r.selection || tip.selection || '',
          market: r.market || tip.market || '',
          odds: parseFloat(r.odds) || parseFloat(tip.odds) || 0,
          stake: parseFloat(r.stake) || parseFloat(tip.staking) || 1,
          result: (r.result || '').toLowerCase(),
          pnl: parseFloat(r.pnl) || 0,
          date: normD(r.date || tip.date),
          confidence: parseInt(tip.confidence, 10) || 0,
          tipster: tip.tipsterProfile || tip.tipster || 'Unknown',
          isPremium: r.isPremium || tip.isPremium || false,
        };
      });

      // ---- By Sport ----
      var sportGroups = {};
      enriched.forEach(function(r) {
        var key = r.sport === 'racing' ? 'Racing' : (r.sport === 'football' ? 'Football' : (r.sport || 'Other'));
        if (!sportGroups[key]) sportGroups[key] = { tips: 0, won: 0, lost: 0, placed: 0, pnl: 0, staked: 0 };
        var g = sportGroups[key];
        g.tips++;
        if (r.result === 'won') g.won++;
        else if (r.result === 'lost') g.lost++;
        else if (r.result === 'placed') g.placed++;
        g.pnl += r.pnl;
        g.staked += r.stake;
      });
      var bySport = Object.keys(sportGroups).map(function(k) {
        var g = sportGroups[k];
        var sr = g.tips > 0 ? Math.round((g.won / g.tips) * 10000) / 100 : 0;
        var roi = g.staked > 0 ? Math.round((g.pnl / g.staked) * 10000) / 100 : 0;
        return [k, g.tips, g.won, g.lost, g.placed, sr, roi, Math.round(g.pnl * 100) / 100];
      });

      // ---- By Market Type ----
      var marketGroups = {};
      enriched.forEach(function(r) {
        var m = r.market || 'Unknown';
        if (!marketGroups[m]) marketGroups[m] = { tips: 0, won: 0, lost: 0, pnl: 0, staked: 0 };
        var g = marketGroups[m];
        g.tips++;
        if (r.result === 'won') g.won++;
        else if (r.result === 'lost') g.lost++;
        g.pnl += r.pnl;
        g.staked += r.stake;
      });
      var byMarket = Object.keys(marketGroups).map(function(k) {
        var g = marketGroups[k];
        var sr = g.tips > 0 ? Math.round((g.won / g.tips) * 10000) / 100 : 0;
        var roi = g.staked > 0 ? Math.round((g.pnl / g.staked) * 10000) / 100 : 0;
        return [k, g.tips, g.won, g.lost, sr, roi, Math.round(g.pnl * 100) / 100];
      });

      // ---- By Odds Range ----
      var oddsRanges = [
        { label: '1.0 - 2.0 (Short)', min: 1.0, max: 2.0 },
        { label: '2.0 - 4.0 (Medium)', min: 2.0, max: 4.0 },
        { label: '4.0 - 8.0 (Bigger)', min: 4.0, max: 8.0 },
        { label: '8.0+ (Outsiders)', min: 8.0, max: 9999 },
      ];
      var oddsGroups = {};
      oddsRanges.forEach(function(rng) { oddsGroups[rng.label] = { tips: 0, won: 0, lost: 0, pnl: 0, staked: 0 }; });
      enriched.forEach(function(r) {
        for (var i = 0; i < oddsRanges.length; i++) {
          if (r.odds >= oddsRanges[i].min && r.odds < oddsRanges[i].max) {
            var g = oddsGroups[oddsRanges[i].label];
            g.tips++;
            if (r.result === 'won') g.won++;
            else if (r.result === 'lost') g.lost++;
            g.pnl += r.pnl;
            g.staked += r.stake;
            break;
          }
        }
      });
      var byOddsRange = oddsRanges.map(function(rng) {
        var g = oddsGroups[rng.label];
        var sr = g.tips > 0 ? Math.round((g.won / g.tips) * 10000) / 100 : 0;
        var roi = g.staked > 0 ? Math.round((g.pnl / g.staked) * 10000) / 100 : 0;
        return [rng.label, g.tips, g.won, g.lost, sr, roi, Math.round(g.pnl * 100) / 100];
      });

      // ---- By Tipster/Analyst ----
      var tipsterGroups = {};
      enriched.forEach(function(r) {
        var t = r.tipster || 'Unknown';
        if (!tipsterGroups[t]) tipsterGroups[t] = { tips: 0, won: 0, lost: 0, pnl: 0, staked: 0, bestPnl: 0, bestSelection: '' };
        var g = tipsterGroups[t];
        g.tips++;
        if (r.result === 'won') g.won++;
        else if (r.result === 'lost') g.lost++;
        g.pnl += r.pnl;
        g.staked += r.stake;
        if (r.pnl > g.bestPnl) { g.bestPnl = r.pnl; g.bestSelection = r.selection + ' @ ' + r.odds; }
      });
      var byTipster = Object.keys(tipsterGroups).map(function(k) {
        var g = tipsterGroups[k];
        var sr = g.tips > 0 ? Math.round((g.won / g.tips) * 10000) / 100 : 0;
        var roi = g.staked > 0 ? Math.round((g.pnl / g.staked) * 10000) / 100 : 0;
        return [k, g.tips, g.won, g.lost, sr, roi, Math.round(g.pnl * 100) / 100, g.bestSelection || '-'];
      });

      // ---- By Confidence Level ----
      var confGroups = {};
      enriched.forEach(function(r) {
        if (r.confidence < 6) return; // skip low/unset confidence
        var key = r.confidence + '/10';
        if (!confGroups[key]) confGroups[key] = { tips: 0, won: 0, lost: 0, pnl: 0, staked: 0, conf: r.confidence };
        var g = confGroups[key];
        g.tips++;
        if (r.result === 'won') g.won++;
        else if (r.result === 'lost') g.lost++;
        g.pnl += r.pnl;
        g.staked += r.stake;
      });
      var byConfidence = Object.keys(confGroups).sort(function(a, b) { return confGroups[a].conf - confGroups[b].conf; }).map(function(k) {
        var g = confGroups[k];
        var sr = g.tips > 0 ? Math.round((g.won / g.tips) * 10000) / 100 : 0;
        var roi = g.staked > 0 ? Math.round((g.pnl / g.staked) * 10000) / 100 : 0;
        return [k, g.tips, g.won, g.lost, sr, roi, Math.round(g.pnl * 100) / 100];
      });

      // ---- By Day of Week ----
      var dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var dayGroups = {};
      dayNames.forEach(function(d) { dayGroups[d] = { tips: 0, won: 0, lost: 0, pnl: 0 }; });
      enriched.forEach(function(r) {
        if (!r.date) return;
        try {
          var d = new Date(r.date + 'T12:00:00Z');
          var dayName = dayNames[d.getUTCDay()];
          var g = dayGroups[dayName];
          g.tips++;
          if (r.result === 'won') g.won++;
          else if (r.result === 'lost') g.lost++;
          g.pnl += r.pnl;
        } catch(e) {}
      });
      var byDay = dayNames.filter(function(d) { return dayGroups[d].tips > 0; }).map(function(d) {
        var g = dayGroups[d];
        var sr = g.tips > 0 ? Math.round((g.won / g.tips) * 10000) / 100 : 0;
        return [d, g.tips, g.won, g.lost, sr, Math.round(g.pnl * 100) / 100];
      });

      // ---- By Month ----
      var monthGroups = {};
      enriched.forEach(function(r) {
        if (!r.date) return;
        var month = r.date.substring(0, 7); // YYYY-MM
        if (!monthGroups[month]) monthGroups[month] = { tips: 0, won: 0, lost: 0, pnl: 0, staked: 0 };
        var g = monthGroups[month];
        g.tips++;
        if (r.result === 'won') g.won++;
        else if (r.result === 'lost') g.lost++;
        g.pnl += r.pnl;
        g.staked += r.stake;
      });
      var byMonth = Object.keys(monthGroups).sort().map(function(k) {
        var g = monthGroups[k];
        var sr = g.tips > 0 ? Math.round((g.won / g.tips) * 10000) / 100 : 0;
        var roi = g.staked > 0 ? Math.round((g.pnl / g.staked) * 10000) / 100 : 0;
        return [k, g.tips, g.won, g.lost, sr, roi, Math.round(g.pnl * 100) / 100];
      });

      // ---- Top 5 Most Profitable ----
      var topWinners = enriched.filter(function(r) { return r.pnl > 0; })
        .sort(function(a, b) { return b.pnl - a.pnl; })
        .slice(0, 5)
        .map(function(r) { return { selection: r.selection, odds: r.odds, pnl: r.pnl }; });

      // ---- Top 5 Biggest Losses ----
      var topLosses = enriched.filter(function(r) { return r.pnl < 0; })
        .sort(function(a, b) { return a.pnl - b.pnl; })
        .slice(0, 5)
        .map(function(r) { return { selection: r.selection, odds: r.odds, pnl: r.pnl }; });

      // ---- Last 10 Results ----
      var sorted = enriched.slice().sort(function(a, b) {
        if (a.date > b.date) return -1;
        if (a.date < b.date) return 1;
        return 0;
      });
      var lastTen = sorted.slice(0, 10).map(function(r) {
        return { selection: r.selection, result: r.result, pnl: r.pnl };
      });

      // ---- Longest Winning Streak ----
      var longestStreak = 0;
      var currentStreak = 0;
      sorted.reverse().forEach(function(r) {
        if (r.result === 'won') { currentStreak++; if (currentStreak > longestStreak) longestStreak = currentStreak; }
        else { currentStreak = 0; }
      });

      // ---- Average Odds of Winners vs Losers ----
      var winners = enriched.filter(function(r) { return r.result === 'won'; });
      var losers = enriched.filter(function(r) { return r.result === 'lost'; });
      var avgWinnerOdds = winners.length > 0 ? winners.reduce(function(s, r) { return s + r.odds; }, 0) / winners.length : 0;
      var avgLoserOdds = losers.length > 0 ? losers.reduce(function(s, r) { return s + r.odds; }, 0) / losers.length : 0;

      res.json({
        bySport: bySport,
        byMarket: byMarket,
        byOddsRange: byOddsRange,
        byTipster: byTipster,
        byConfidence: byConfidence,
        byDay: byDay,
        byMonth: byMonth,
        topWinners: topWinners,
        topLosses: topLosses,
        lastTen: lastTen,
        longestStreak: longestStreak,
        avgWinnerOdds: Math.round(avgWinnerOdds * 100) / 100,
        avgLoserOdds: Math.round(avgLoserOdds * 100) / 100,
        totalResults: enriched.length,
      });
    } catch (err) {
      console.error('[Analytics] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Sonar kill-switch — disable enrichment immediately
  // ---------------------------------------------------------------------------
  router.post('/admin/sonar/disable', authenticate, requireAdmin, async (req, res) => {
    try {
      await db.createSonarAdminEvent({
        action: 'disabled', userId: req.user.id, userEmail: req.user.email,
        reason: req.body.reason || 'admin action',
      });
      if (deps.perplexityClient && deps.perplexityClient.setState) {
        deps.perplexityClient.setState('open');
      }
      await db.createAuditEntry({
        userId: req.user.id, userEmail: req.user.email,
        action: 'sonar_disabled', entity: 'system', entityId: 'perplexity',
        details: { reason: req.body.reason || 'admin action' }, ip: req.ip,
      });
      console.log('[Sonar] Admin disabled enrichment:', req.user.email);
      res.json({ status: 'disabled', message: 'Sonar enrichment disabled. Tips will publish template-only.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Sonar re-enable — resume enrichment
  // ---------------------------------------------------------------------------
  router.post('/admin/sonar/enable', authenticate, requireAdmin, async (req, res) => {
    try {
      await db.createSonarAdminEvent({
        action: 'enabled', userId: req.user.id, userEmail: req.user.email,
        reason: req.body.reason || 'admin action',
      });
      if (deps.perplexityClient && deps.perplexityClient.setState) {
        deps.perplexityClient.setState('closed');
      }
      await db.createAuditEntry({
        userId: req.user.id, userEmail: req.user.email,
        action: 'sonar_enabled', entity: 'system', entityId: 'perplexity',
        details: { reason: req.body.reason || 'admin action' }, ip: req.ip,
      });
      console.log('[Sonar] Admin re-enabled enrichment:', req.user.email);
      res.json({ status: 'enabled', message: 'Sonar enrichment re-enabled.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN: Sonar status — current state + spend summary
  // ---------------------------------------------------------------------------
  router.get('/admin/sonar/status', authenticate, requireAdmin, async (req, res) => {
    try {
      var state = deps.perplexityClient ? deps.perplexityClient.getState() : 'not_initialised';
      var dailySpend = await db.getDailySpend();
      var weekSummary = await db.getSpendSummary(7);
      var enrichmentStats = await db.getEnrichmentQualityStats(7);
      res.json({
        state: state,
        enabled: process.env.PERPLEXITY_ENABLED !== 'false',
        dryRun: process.env.PERPLEXITY_DRY_RUN === 'true',
        dailySpendUsd: dailySpend,
        dailyCapUsd: 0.50,
        weekSummary: weekSummary,
        enrichmentQuality: enrichmentStats,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
