/**
 * Elite Edge Sports Tips — Drip Campaign Service
 *
 * 14-day automated email sequence for new free users to encourage
 * premium conversion. Sends scheduled emails based on days since signup.
 *
 * Called every 15 minutes by the scheduler.
 */

class DripCampaign {
  constructor() {
    // Drip sequence: day number -> email content
    this.sequence = [
      { day: 1, subject: 'Welcome to Elite Edge — Here\'s How It Works', type: 'welcome' },
      { day: 3, subject: 'Here\'s What Premium Members Got Yesterday', type: 'fomo' },
      { day: 5, subject: 'Your Free Tip — Full Analysis Inside', type: 'free_tip' },
      { day: 7, subject: 'Halfway Through Your Journey — See Our Track Record', type: 'social_proof' },
      { day: 10, subject: 'Why 68% of Our Picks Win — The Data Behind Elite Edge', type: 'data' },
      { day: 14, subject: 'Last Chance: Start Your Free Premium Trial', type: 'final_push' },
    ];
  }

  // ---------------------------------------------------------------------------
  // Main entry point — called every 15 minutes by scheduler
  // ---------------------------------------------------------------------------
  async checkAndSend(users, db, emailService, aiReports) {
    if (!users || !Array.isArray(users)) return;

    var now = new Date();
    var sentCount = 0;

    for (var i = 0; i < users.length; i++) {
      var user = users[i];

      // Only target free users who are not on a trial
      if (user.subscription !== 'free') continue;
      if (user.trialActive) continue;
      if (user.role === 'admin') continue;
      if (user.emailPrefs && user.emailPrefs.marketing === false) continue;

      // Calculate days since joined
      var joinDate = user.joined ? new Date(user.joined) : null;
      if (!joinDate || isNaN(joinDate.getTime())) continue;

      var daysSinceJoined = Math.floor((now.getTime() - joinDate.getTime()) / (24 * 60 * 60 * 1000));
      var dripsSent = user.dripsSent || [];

      // Check each drip in the sequence
      for (var s = 0; s < this.sequence.length; s++) {
        var drip = this.sequence[s];

        // Is this drip due?
        if (daysSinceJoined < drip.day) continue;

        // Already sent?
        if (dripsSent.indexOf(drip.type) !== -1) continue;

        // Generate and send
        try {
          var emailContent = await this.generateDripEmail(drip.type, user, db);
          if (!emailContent) continue;

          await emailService._sendEmail({
            to: user.email,
            subject: drip.subject,
            html: emailContent.html,
            text: emailContent.text,
            emailType: 'drip_' + drip.type,
          });

          // Mark as sent
          dripsSent.push(drip.type);
          await db.updateUser(user.id, { dripsSent: dripsSent });

          sentCount++;
          console.log('[Drip] Sent "' + drip.type + '" email to ' + user.email + ' (day ' + drip.day + ')');
        } catch (err) {
          console.error('[Drip] Failed to send "' + drip.type + '" to ' + user.email + ':', err.message);
        }
      }
    }

    if (sentCount > 0) {
      console.log('[Drip] Total drip emails sent this cycle: ' + sentCount);
    }
  }

  // ---------------------------------------------------------------------------
  // Generate email content by type
  // ---------------------------------------------------------------------------
  async generateDripEmail(type, user, db) {
    var name = user.name || 'there';

    switch (type) {
      case 'welcome':
        return this._generateWelcomeEmail(name);
      case 'fomo':
        return await this._generateFomoEmail(name, db);
      case 'free_tip':
        return await this._generateFreeTipEmail(name, db);
      case 'social_proof':
        return await this._generateSocialProofEmail(name, db);
      case 'data':
        return await this._generateDataEmail(name, db);
      case 'final_push':
        return this._generateFinalPushEmail(name);
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Day 1: Welcome — How the platform works
  // ---------------------------------------------------------------------------
  _generateWelcomeEmail(name) {
    var html = this._wrapHTML(
      '<h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ' + this._esc(name) + ',</h2>' +
      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Thanks for joining <strong style="color:#d4a843;">Elite Edge Sports Tips</strong>. We wanted to give you a quick overview of how everything works.</p>' +

      '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #d4a843;">' +
        '<p style="color:#d4a843;font-size:13px;font-weight:700;margin:0 0 12px;">HOW ELITE EDGE WORKS</p>' +
        '<table cellpadding="0" cellspacing="0">' +
          '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;font-weight:700;vertical-align:top;">1.</td>' +
          '<td style="color:#cbd5e1;font-size:14px;padding:6px 0;"><strong style="color:#fff;">Our model analyses the data</strong><br><span style="color:#94a3b8;font-size:13px;">We process form, odds, conditions, and market movements across multiple bookmakers every morning.</span></td></tr>' +
          '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;font-weight:700;vertical-align:top;">2.</td>' +
          '<td style="color:#cbd5e1;font-size:14px;padding:6px 0;"><strong style="color:#fff;">Tips are published by 9am</strong><br><span style="color:#94a3b8;font-size:13px;">Your daily NAP of the Day and any free selections appear on your dashboard each morning.</span></td></tr>' +
          '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;font-weight:700;vertical-align:top;">3.</td>' +
          '<td style="color:#cbd5e1;font-size:14px;padding:6px 0;"><strong style="color:#fff;">Results update automatically</strong><br><span style="color:#94a3b8;font-size:13px;">Every selection is tracked and settled with full transparency. Check Results any time.</span></td></tr>' +
          '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;font-weight:700;vertical-align:top;">4.</td>' +
          '<td style="color:#cbd5e1;font-size:14px;padding:6px 0;"><strong style="color:#fff;">Track your performance</strong><br><span style="color:#94a3b8;font-size:13px;">Your dashboard shows running P/L, strike rate, and ROI over any period.</span></td></tr>' +
        '</table>' +
      '</div>' +

      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">As a free member, you already have access to:</p>' +
      '<table cellpadding="0" cellspacing="0" style="margin:12px 0;">' +
        '<tr><td style="color:#22c55e;padding:4px 10px 4px 0;font-size:14px;">&#10003;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Daily NAP of the Day</td></tr>' +
        '<tr><td style="color:#22c55e;padding:4px 10px 4px 0;font-size:14px;">&#10003;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Free Weekly Accumulator</td></tr>' +
        '<tr><td style="color:#22c55e;padding:4px 10px 4px 0;font-size:14px;">&#10003;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Full results history</td></tr>' +
        '<tr><td style="color:#22c55e;padding:4px 10px 4px 0;font-size:14px;">&#10003;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Performance dashboard</td></tr>' +
      '</table>' +

      '<div style="text-align:center;margin:24px 0;">' +
        '<a href="https://eliteedgesports.co.uk/#/how-it-works" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">See How It Works</a>' +
      '</div>' +

      '<p style="color:#cbd5e1;font-size:14px;">Best,<br><strong style="color:#d4a843;">The Elite Edge Team</strong></p>'
    );

    var text = 'Hi ' + name + ',\n\n' +
      'Thanks for joining Elite Edge Sports Tips. Here\'s how it works:\n\n' +
      '1. Our model analyses the data every morning\n' +
      '2. Tips are published by 9am\n' +
      '3. Results update automatically\n' +
      '4. Track your performance on the dashboard\n\n' +
      'As a free member you get: Daily NAP, Free Weekly Acca, Full results, Performance dashboard\n\n' +
      'See how it works: https://eliteedgesports.co.uk/#/how-it-works\n\n' +
      'The Elite Edge Team\n\n18+ | Entertainment only | BeGambleAware.org';

    return { html: html, text: text };
  }

  // ---------------------------------------------------------------------------
  // Day 3: FOMO — What premium members got yesterday
  // ---------------------------------------------------------------------------
  async _generateFomoEmail(name, db) {
    // Fetch yesterday's results
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var yesterdayStr = yesterday.toISOString().split('T')[0];

    var allResults = [];
    try { allResults = await db.getResults(); } catch (e) {}
    var yesterdayResults = allResults.filter(function(r) { return r.date === yesterdayStr && r.isPremium; });
    var won = yesterdayResults.filter(function(r) { return r.result === 'won'; });
    var pnl = yesterdayResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);

    var winCount = won.length;
    var totalCount = yesterdayResults.length;

    var resultsTable = '';
    if (yesterdayResults.length > 0) {
      var rows = '';
      for (var i = 0; i < Math.min(yesterdayResults.length, 5); i++) {
        var r = yesterdayResults[i];
        var isWin = r.result === 'won';
        rows += '<tr>' +
          '<td style="color:#ffffff;font-size:13px;padding:8px 0;border-bottom:1px solid #2a2e3d;">' + this._esc(r.selection) + '</td>' +
          '<td style="color:#94a3b8;font-size:13px;padding:8px 0;border-bottom:1px solid #2a2e3d;text-align:center;">' + (r.odds || '-') + '</td>' +
          '<td style="color:' + (isWin ? '#22c55e' : '#ef4444') + ';font-size:13px;font-weight:700;padding:8px 0;border-bottom:1px solid #2a2e3d;text-align:center;">' + (isWin ? 'WON' : 'LOST') + '</td>' +
          '</tr>';
      }
      resultsTable = '<table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;">' +
        '<tr><th style="color:#d4a843;font-size:12px;text-align:left;padding:4px 0;">Selection</th><th style="color:#d4a843;font-size:12px;text-align:center;padding:4px 0;">Odds</th><th style="color:#d4a843;font-size:12px;text-align:center;padding:4px 0;">Result</th></tr>' +
        rows + '</table>';
    }

    var html = this._wrapHTML(
      '<h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ' + this._esc(name) + ',</h2>' +
      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Here\'s what <strong style="color:#d4a843;">Premium members</strong> received yesterday morning at 7:30am:</p>' +

      (totalCount > 0 ?
        '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">' +
          '<p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 12px;">YESTERDAY\'S PREMIUM RESULTS</p>' +
          '<table cellpadding="0" cellspacing="0" width="100%">' +
            '<tr>' +
              '<td style="color:#94a3b8;font-size:13px;padding:4px 0;">Selections:</td><td style="color:#ffffff;font-size:13px;font-weight:700;padding:4px 0;">' + totalCount + '</td>' +
              '<td style="color:#94a3b8;font-size:13px;padding:4px 0;">Won:</td><td style="color:#22c55e;font-size:13px;font-weight:700;padding:4px 0;">' + winCount + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td style="color:#94a3b8;font-size:13px;padding:4px 0;">Strike Rate:</td><td style="color:#ffffff;font-size:13px;font-weight:700;padding:4px 0;">' + (totalCount > 0 ? Math.round((winCount / totalCount) * 100) : 0) + '%</td>' +
              '<td style="color:#94a3b8;font-size:13px;padding:4px 0;">P/L:</td><td style="color:' + (pnl >= 0 ? '#22c55e' : '#ef4444') + ';font-size:13px;font-weight:700;padding:4px 0;">' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + ' units</td>' +
            '</tr>' +
          '</table>' +
          resultsTable +
        '</div>'
        :
        '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">' +
          '<p style="color:#cbd5e1;font-size:14px;margin:0;">Premium members received exclusive early-morning analysis and selections. Our model identified value that free members couldn\'t see.</p>' +
        '</div>'
      ) +

      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;"><strong style="color:#ffffff;">Premium members saw all of this before 9am.</strong> They had time to place at the best odds before the markets moved.</p>' +

      '<div style="text-align:center;margin:24px 0;">' +
        '<a href="https://eliteedgesports.co.uk/#/pricing" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Get Premium Access</a>' +
      '</div>' +

      '<p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>'
    );

    var text = 'Hi ' + name + ',\n\n' +
      'Here\'s what Premium members received yesterday:\n\n' +
      (totalCount > 0 ? 'Selections: ' + totalCount + ' | Won: ' + winCount + ' | P/L: ' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + ' units\n\n' : '') +
      'Premium members saw all of this before 9am.\n\n' +
      'Get Premium Access: https://eliteedgesports.co.uk/#/pricing\n\n' +
      'The Elite Edge Team\n\n18+ | Entertainment only | BeGambleAware.org';

    return { html: html, text: text };
  }

  // ---------------------------------------------------------------------------
  // Day 5: Free Tip — Full analysis of today's best free tip
  // ---------------------------------------------------------------------------
  async _generateFreeTipEmail(name, db) {
    var today = new Date().toISOString().split('T')[0];
    var tips = [];
    try { tips = await db.getTips({ date: today, isPremium: false }); } catch (e) {}

    // Pick the best free tip (highest confidence)
    var freeTips = tips.filter(function(t) { return !t.isPremium && t.status === 'active'; });
    freeTips.sort(function(a, b) { return (b.confidence || 0) - (a.confidence || 0); });
    var bestTip = freeTips.length > 0 ? freeTips[0] : null;

    var tipContent = '';
    if (bestTip) {
      var analysis = bestTip.analysis || {};
      tipContent =
        '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #d4a843;">' +
          '<p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 8px;">TODAY\'S FREE TIP</p>' +
          '<h3 style="color:#ffffff;margin:0 0 4px;font-size:18px;">' + this._esc(bestTip.selection) + ' @ ' + (bestTip.odds || '-') + '</h3>' +
          '<p style="color:#94a3b8;font-size:13px;margin:0 0 12px;">' + this._esc(bestTip.event || '') + ' | ' + this._esc(bestTip.market || '') + ' | Confidence: ' + (bestTip.confidence || '-') + '/10</p>' +
          (analysis.summary ? '<p style="color:#cbd5e1;font-size:13px;line-height:1.5;margin:0;">' + this._esc(analysis.summary) + '</p>' : '') +
        '</div>';
    } else {
      tipContent =
        '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #d4a843;">' +
          '<p style="color:#cbd5e1;font-size:14px;margin:0;">Today\'s selections are being finalised. Check your dashboard for the latest picks.</p>' +
        '</div>';
    }

    var html = this._wrapHTML(
      '<h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ' + this._esc(name) + ',</h2>' +
      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">We\'ve picked out today\'s strongest free selection for you, with the full analysis our model produced:</p>' +
      tipContent +
      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">This is the kind of analysis that goes into <strong>every</strong> selection. Premium members get 2-4 additional picks like this every day, with even deeper breakdowns.</p>' +

      '<div style="text-align:center;margin:24px 0;">' +
        '<a href="https://eliteedgesports.co.uk" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">See Full Analysis</a>' +
      '</div>' +

      '<p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>'
    );

    var text = 'Hi ' + name + ',\n\n' +
      'Here\'s today\'s strongest free selection with full analysis:\n\n' +
      (bestTip ? bestTip.selection + ' @ ' + (bestTip.odds || '-') + '\n' + (bestTip.event || '') + '\n\n' : 'Check your dashboard for today\'s picks.\n\n') +
      'Premium members get 2-4 additional picks like this every day.\n\n' +
      'See full analysis: https://eliteedgesports.co.uk\n\n' +
      'The Elite Edge Team\n\n18+ | Entertainment only | BeGambleAware.org';

    return { html: html, text: text };
  }

  // ---------------------------------------------------------------------------
  // Day 7: Social Proof — Track record and stats
  // ---------------------------------------------------------------------------
  async _generateSocialProofEmail(name, db) {
    var allResults = [];
    try { allResults = await db.getResults(); } catch (e) {}

    var totalTips = allResults.length;
    var won = allResults.filter(function(r) { return r.result === 'won'; }).length;
    var strikeRate = totalTips > 0 ? ((won / totalTips) * 100).toFixed(1) : '0.0';
    var totalPnl = allResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);
    var totalStake = allResults.reduce(function(sum, r) { return sum + (r.stake || 1); }, 0);
    var roi = totalStake > 0 ? ((totalPnl / totalStake) * 100).toFixed(1) : '0.0';

    var html = this._wrapHTML(
      '<h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ' + this._esc(name) + ',</h2>' +
      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">You\'re one week into your Elite Edge journey. Here\'s our overall track record — every result verified and transparent:</p>' +

      '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">' +
        '<p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 12px;">VERIFIED TRACK RECORD</p>' +
        '<table cellpadding="0" cellspacing="0" width="100%">' +
          '<tr>' +
            '<td style="text-align:center;padding:12px;">' +
              '<p style="color:#d4a843;font-size:28px;font-weight:700;margin:0;">' + totalTips + '</p>' +
              '<p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">Total Tips</p>' +
            '</td>' +
            '<td style="text-align:center;padding:12px;">' +
              '<p style="color:#22c55e;font-size:28px;font-weight:700;margin:0;">' + strikeRate + '%</p>' +
              '<p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">Strike Rate</p>' +
            '</td>' +
            '<td style="text-align:center;padding:12px;">' +
              '<p style="color:' + (totalPnl >= 0 ? '#22c55e' : '#ef4444') + ';font-size:28px;font-weight:700;margin:0;">' + (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(1) + '</p>' +
              '<p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">Units P/L</p>' +
            '</td>' +
            '<td style="text-align:center;padding:12px;">' +
              '<p style="color:' + (parseFloat(roi) >= 0 ? '#22c55e' : '#ef4444') + ';font-size:28px;font-weight:700;margin:0;">' + roi + '%</p>' +
              '<p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">ROI</p>' +
            '</td>' +
          '</tr>' +
        '</table>' +
      '</div>' +

      '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #22c55e;">' +
        '<p style="color:#22c55e;font-size:14px;font-weight:700;margin:0 0 8px;">WHAT OUR MEMBERS SAY</p>' +
        '<p style="color:#cbd5e1;font-size:13px;font-style:italic;margin:0 0 8px;">"I\'ve tried dozens of tipsters. Elite Edge is the first that actually shows a consistent profit over months, not just cherry-picked wins."</p>' +
        '<p style="color:#94a3b8;font-size:12px;margin:0;">- Premium Member since 2024</p>' +
      '</div>' +

      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Every single result is logged and verifiable. No hidden losses, no selective reporting.</p>' +

      '<div style="text-align:center;margin:24px 0;">' +
        '<a href="https://eliteedgesports.co.uk/#/results" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">See Full Results</a>' +
      '</div>' +

      '<p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>'
    );

    var text = 'Hi ' + name + ',\n\n' +
      'You\'re one week in. Here\'s our verified track record:\n\n' +
      'Total Tips: ' + totalTips + '\n' +
      'Strike Rate: ' + strikeRate + '%\n' +
      'P/L: ' + (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(1) + ' units\n' +
      'ROI: ' + roi + '%\n\n' +
      'Every result is verified and transparent.\n\n' +
      'See full results: https://eliteedgesports.co.uk/#/results\n\n' +
      'The Elite Edge Team\n\n18+ | Entertainment only | BeGambleAware.org';

    return { html: html, text: text };
  }

  // ---------------------------------------------------------------------------
  // Day 10: Data — The scoring model explained
  // ---------------------------------------------------------------------------
  async _generateDataEmail(name, db) {
    // Fetch results grouped by confidence tier
    var allResults = [];
    try { allResults = await db.getResults(); } catch (e) {}

    var highConf = allResults.filter(function(r) { return r.confidence >= 8; });
    var midConf = allResults.filter(function(r) { return r.confidence >= 6 && r.confidence < 8; });
    var lowConf = allResults.filter(function(r) { return r.confidence && r.confidence < 6; });

    var highWinRate = highConf.length > 0 ? Math.round((highConf.filter(function(r) { return r.result === 'won'; }).length / highConf.length) * 100) : 0;
    var midWinRate = midConf.length > 0 ? Math.round((midConf.filter(function(r) { return r.result === 'won'; }).length / midConf.length) * 100) : 0;
    var lowWinRate = lowConf.length > 0 ? Math.round((lowConf.filter(function(r) { return r.result === 'won'; }).length / lowConf.length) * 100) : 0;

    var html = this._wrapHTML(
      '<h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ' + this._esc(name) + ',</h2>' +
      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">You might be wondering how we consistently identify value. Here\'s a look inside the <strong style="color:#d4a843;">Elite Edge scoring model</strong>.</p>' +

      '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">' +
        '<p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 12px;">HOW THE MODEL WORKS</p>' +
        '<table cellpadding="0" cellspacing="0">' +
          '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:14px;">&#128202;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;"><strong style="color:#fff;">Form Analysis</strong> — Recent performance weighted by recency, class, and conditions</td></tr>' +
          '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:14px;">&#128200;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;"><strong style="color:#fff;">Odds Comparison</strong> — Multi-bookmaker price analysis to find genuine value</td></tr>' +
          '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:14px;">&#127919;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;"><strong style="color:#fff;">Edge Calculation</strong> — Model probability vs implied probability = your edge</td></tr>' +
          '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:14px;">&#9889;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;"><strong style="color:#fff;">Market Movements</strong> — Tracking shortening odds and steamer signals</td></tr>' +
          '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:14px;">&#127777;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;"><strong style="color:#fff;">Conditions</strong> — Ground, weather, distance, and course suitability</td></tr>' +
        '</table>' +
      '</div>' +

      '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">' +
        '<p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 12px;">PERFORMANCE BY CONFIDENCE TIER</p>' +
        '<table width="100%" cellpadding="0" cellspacing="0">' +
          '<tr>' +
            '<td style="color:#94a3b8;font-size:13px;padding:6px 0;">High Confidence (8-10):</td>' +
            '<td style="color:#22c55e;font-size:13px;font-weight:700;padding:6px 0;">' + highWinRate + '% strike rate</td>' +
            '<td style="color:#94a3b8;font-size:12px;padding:6px 0;">(' + highConf.length + ' tips)</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="color:#94a3b8;font-size:13px;padding:6px 0;">Medium Confidence (6-7):</td>' +
            '<td style="color:#ffffff;font-size:13px;font-weight:700;padding:6px 0;">' + midWinRate + '% strike rate</td>' +
            '<td style="color:#94a3b8;font-size:12px;padding:6px 0;">(' + midConf.length + ' tips)</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="color:#94a3b8;font-size:13px;padding:6px 0;">Value Outsiders (5):</td>' +
            '<td style="color:#f59e0b;font-size:13px;font-weight:700;padding:6px 0;">' + lowWinRate + '% strike rate</td>' +
            '<td style="color:#94a3b8;font-size:12px;padding:6px 0;">(' + lowConf.length + ' tips)</td>' +
          '</tr>' +
        '</table>' +
      '</div>' +

      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">The model is transparent. Every tip shows its confidence score, edge calculation, and reasoning. Premium members see the full picture on every selection.</p>' +

      '<div style="text-align:center;margin:24px 0;">' +
        '<a href="https://eliteedgesports.co.uk/#/pricing" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Unlock Full Analysis</a>' +
      '</div>' +

      '<p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>'
    );

    var text = 'Hi ' + name + ',\n\n' +
      'Here\'s how the Elite Edge scoring model works:\n\n' +
      '- Form Analysis: Recent performance weighted by recency, class, conditions\n' +
      '- Odds Comparison: Multi-bookmaker price analysis for value\n' +
      '- Edge Calculation: Model probability vs implied probability\n' +
      '- Market Movements: Tracking shortening odds and steamers\n' +
      '- Conditions: Ground, weather, distance, course suitability\n\n' +
      'Performance by confidence tier:\n' +
      'High (8-10): ' + highWinRate + '% (' + highConf.length + ' tips)\n' +
      'Medium (6-7): ' + midWinRate + '% (' + midConf.length + ' tips)\n' +
      'Outsiders (5): ' + lowWinRate + '% (' + lowConf.length + ' tips)\n\n' +
      'Unlock full analysis: https://eliteedgesports.co.uk/#/pricing\n\n' +
      'The Elite Edge Team\n\n18+ | Entertainment only | BeGambleAware.org';

    return { html: html, text: text };
  }

  // ---------------------------------------------------------------------------
  // Day 14: Final Push — Free trial CTA
  // ---------------------------------------------------------------------------
  _generateFinalPushEmail(name) {
    var html = this._wrapHTML(
      '<h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ' + this._esc(name) + ',</h2>' +
      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">You\'ve been with Elite Edge for two weeks now. You\'ve seen our NAP of the Day, our results, and how we operate.</p>' +
      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">But you\'ve only been seeing a fraction of what we do.</p>' +

      '<div style="background:#1a2e1a;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #22c55e;text-align:center;">' +
        '<p style="color:#22c55e;font-size:18px;font-weight:700;margin:0 0 8px;">YOUR FREE 7-DAY PREMIUM TRIAL IS WAITING</p>' +
        '<p style="color:#cbd5e1;font-size:14px;margin:0;">Card stored securely. Full access. Cancel any time.</p>' +
      '</div>' +

      '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;font-weight:700;color:#ffffff;">What you\'ll unlock:</p>' +
      '<table cellpadding="0" cellspacing="0" style="margin:12px 0;">' +
        '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#127919;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">2-4 additional premium selections every day</td></tr>' +
        '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128202;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Deep statistical analysis and edge calculations</td></tr>' +
        '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128231;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Daily email bulletin before 9am</td></tr>' +
        '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128241;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Instant Telegram alerts</td></tr>' +
        '<tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#127942;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Staking recommendations</td></tr>' +
      '</table>' +

      '<div style="text-align:center;margin:28px 0;">' +
        '<a href="https://eliteedgesports.co.uk/#/pricing" style="display:inline-block;padding:16px 48px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;">Start Your Free Trial Now</a>' +
      '</div>' +

      '<p style="color:#94a3b8;font-size:13px;line-height:1.5;">No commitment. No card details. Just 14 days of full premium access to see if it\'s for you.</p>' +

      '<div style="background:#1e2235;padding:14px;border-radius:8px;margin:20px 0;">' +
        '<p style="color:#94a3b8;font-size:12px;margin:0;">Remember: This is entertainment and statistical analysis only. Bet responsibly. 18+ | BeGambleAware.org</p>' +
      '</div>' +

      '<p style="color:#cbd5e1;font-size:14px;">Best,<br><strong style="color:#d4a843;">The Elite Edge Team</strong></p>'
    );

    var text = 'Hi ' + name + ',\n\n' +
      'You\'ve been with Elite Edge for two weeks. But you\'ve only seen a fraction of what we do.\n\n' +
      'YOUR FREE 7-DAY PREMIUM TRIAL IS WAITING\n' +
      'Card stored securely. Full access. Cancel any time.\n\n' +
      'What you\'ll unlock:\n' +
      '- 2-4 additional premium selections every day\n' +
      '- Deep statistical analysis and edge calculations\n' +
      '- Daily email bulletin before 9am\n' +
      '- Instant Telegram alerts\n' +
      '- Staking recommendations\n\n' +
      'Start your free trial: https://eliteedgesports.co.uk/#/pricing\n\n' +
      'The Elite Edge Team\n\n18+ | Entertainment only | BeGambleAware.org';

    return { html: html, text: text };
  }

  // ---------------------------------------------------------------------------
  // HTML wrapper (matches EmailService dark theme)
  // ---------------------------------------------------------------------------
  _wrapHTML(bodyContent) {
    return '<!DOCTYPE html>' +
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#141828;">' +
        '<tr><td style="padding:24px;text-align:center;border-bottom:2px solid #d4a843;">' +
          '<h1 style="color:#d4a843;margin:0;font-size:24px;">Elite Edge Sports Tips</h1>' +
          '<p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Premium Betting Intelligence</p>' +
        '</td></tr>' +
        '<tr><td style="padding:24px;">' + bodyContent + '</td></tr>' +
        '<tr><td style="padding:20px 24px;text-align:center;background:#0a0e1a;border-top:1px solid #2a2e3d;">' +
          '<p style="color:#64748b;font-size:11px;margin:0 0 8px;">Elite Edge Sports Tips Ltd.</p>' +
          '<p style="color:#64748b;font-size:11px;margin:0 0 8px;">' +
            '<a href="https://eliteedgesports.co.uk/#/unsubscribe" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a>' +
            ' &nbsp;|&nbsp; ' +
            '<a href="https://eliteedgesports.co.uk/#/account" style="color:#94a3b8;text-decoration:underline;">Email Preferences</a>' +
          '</p>' +
          '<p style="color:#64748b;font-size:11px;margin:0 0 4px;">This is entertainment and statistical analysis only. We do not provide financial or betting advice.</p>' +
          '<p style="color:#64748b;font-size:11px;margin:0;">18+ | <a href="https://www.begambleaware.org" style="color:#94a3b8;">BeGambleAware.org</a> | Please gamble responsibly.</p>' +
        '</td></tr>' +
      '</table></body></html>';
  }

  // ---------------------------------------------------------------------------
  // HTML escape helper
  // ---------------------------------------------------------------------------
  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

module.exports = DripCampaign;
