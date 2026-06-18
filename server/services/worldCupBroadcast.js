/**
 * World Cup content broadcaster.
 *
 * During the tournament this sends out Elite Edge's *view* on the day's games
 * (engagement content, NOT formal tips) to the Telegram channel, subscribers
 * (email), push and in-app notifications. The "view" is market-driven: it
 * prefers a stored consensus preview, then the live bookmaker-odds favourite.
 *
 * Pluggable: own module, never touches the core tipping engine.
 */
module.exports = function (deps) {
  var db = deps.db;
  var sportMonks = deps.sportMonks;
  var telegramBot = deps.telegramBot;
  var pushService = deps.pushService;
  var emailService = deps.emailService;

  // Country name -> ISO2 (subset; mirrors the frontend map). Used for flag emoji.
  var ISO = {
    'mexico': 'MX', 'south africa': 'ZA', 'south korea': 'KR', 'korea republic': 'KR', 'czech republic': 'CZ',
    'canada': 'CA', 'switzerland': 'CH', 'qatar': 'QA', 'bosnia & herzegovina': 'BA', 'bosnia and herzegovina': 'BA',
    'brazil': 'BR', 'morocco': 'MA', 'haiti': 'HT', 'usa': 'US', 'united states': 'US', 'paraguay': 'PY',
    'australia': 'AU', 'turkey': 'TR', 'germany': 'DE', 'curacao': 'CW', 'ivory coast': 'CI', 'ecuador': 'EC',
    'netherlands': 'NL', 'japan': 'JP', 'sweden': 'SE', 'tunisia': 'TN', 'belgium': 'BE', 'egypt': 'EG',
    'iran': 'IR', 'new zealand': 'NZ', 'spain': 'ES', 'cape verde': 'CV', 'cape verde islands': 'CV',
    'saudi arabia': 'SA', 'uruguay': 'UY', 'france': 'FR', 'senegal': 'SN', 'norway': 'NO', 'iraq': 'IQ',
    'argentina': 'AR', 'algeria': 'DZ', 'austria': 'AT', 'jordan': 'JO', 'portugal': 'PT', 'dr congo': 'CD',
    'd.r. congo': 'CD', 'uzbekistan': 'UZ', 'colombia': 'CO', 'croatia': 'HR', 'ghana': 'GH', 'panama': 'PA',
  };
  function flag(team) {
    var key = String(team || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    if (key === 'england') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    if (key === 'scotland') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
    if (key === 'wales') return '🏴󠁧󠁢󠁷󠁬󠁳󠁿';
    var code = ISO[key];
    if (!code) return '⚽';
    return String.fromCodePoint(0x1F1E6 + (code.charCodeAt(0) - 65)) + String.fromCodePoint(0x1F1E6 + (code.charCodeAt(1) - 65));
  }

  // Build the day's views. Returns [{home, away, kickoff, view, note, conf}].
  async function buildPicks() {
    if (!db.query) return [];
    var res = await db.query(
      "SELECT id, external_fixture_id, home_team, away_team, kickoff, stage FROM world_cup_fixtures " +
      "WHERE status = 'scheduled' AND kickoff IS NOT NULL " +
      "AND kickoff >= NOW() - INTERVAL '2 hours' AND kickoff <= NOW() + INTERVAL '30 hours' " +
      "AND home_team !~ '^[0-9]' AND home_team NOT ILIKE '%group%' AND home_team NOT ILIKE '%winner%' " +
      "AND home_team NOT ILIKE '%runner%' AND home_team NOT ILIKE '%/%' " +
      "ORDER BY kickoff ASC"
    );
    var fixtures = res.rows || [];
    var picks = [];
    for (var i = 0; i < fixtures.length; i++) {
      var f = fixtures[i];
      var view = null, note = '', conf = null, oddsDecimal = null;
      // 1) Stored consensus preview verdict (the "high powered engine")
      try {
        var pv = await db.query(
          "SELECT verdict_selection, predicted_scoreline, confidence FROM world_cup_previews WHERE fixture_id = $1 AND verdict_selection IS NOT NULL LIMIT 1",
          [f.id]
        );
        if (pv.rows.length && pv.rows[0].verdict_selection) {
          // SINGLE SOURCE OF TRUTH: the consensus engine's stored verdict — the
          // exact same selection the app shows for this game. Trust its call
          // (incl. a genuine draw). No market fallback — Telegram must never
          // show a different pick from the app.
          view = pv.rows[0].verdict_selection;
          conf = pv.rows[0].confidence || null;
          // A market-consistent insight. The predicted exact score (always a low
          // modal score like 1-1) only makes sense beside a match-result call —
          // showing it next to "Over 2.5" reads as a contradiction.
          note = viewNote(view, pv.rows[0].predicted_scoreline, f.home_team);
        }
      } catch (e) {}
      // No consensus verdict for this game yet → skip it (never invent a pick
      // from the market — that's what caused Telegram to diverge from the app).
      if (!view) continue;
      picks.push({ home: f.home_team, away: f.away_team, kickoff: f.kickoff, view: view, note: note, conf: conf, oddsDecimal: oddsDecimal });
    }
    return picks;
  }

  function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // Decimal odds -> tidy fractional (e.g. 1.09 -> "1/11", 1.91 -> "10/11").
  function fracOdds(d) {
    if (!d || d <= 1) return '';
    var dec = d - 1, best = null;
    for (var den = 1; den <= 20; den++) {
      var num = Math.round(dec * den);
      if (num < 1) continue;
      var err = Math.abs(dec - num / den);
      if (best === null || err < best.err) best = { num: num, den: den, err: err };
    }
    if (!best) return d.toFixed(2);
    var a = best.num, b = best.den;
    var g = (function gcd(x, y) { return y ? gcd(y, x % y) : x; })(a, b);
    return (a / g) + '/' + (b / g);
  }
  // A short, human label for our confidence so it's never mistaken for odds.
  function confWord(c) { return c >= 8 ? 'high confidence' : c >= 6 ? 'solid' : 'lean'; }

  // A market-CONSISTENT one-line insight for the view. Only a match-result call
  // gets the predicted scoreline (anything else contradicts a low modal score).
  function viewNote(view, scoreline, homeTeam) {
    var v = String(view || '').toLowerCase();
    if (v.indexOf('over') !== -1) return 'goals expected — both carry a scoring threat';
    if (v.indexOf('under') !== -1) return 'a tight, low-scoring game on the cards';
    if (v.indexOf('btts') !== -1 && v.indexOf('no') !== -1) return 'one side looks likely to keep it tight at the back';
    if (v.indexOf('btts') !== -1 || v.indexOf('both teams') !== -1) return 'both teams have the firepower to score';
    // Double Chance contains the word "draw" — must be checked BEFORE the draw case.
    if (v.indexOf('double chance') !== -1) return 'the safe play — covers the win or the draw';
    if (v === 'draw' || v.indexOf('draw') !== -1) return 'finely balanced — honours look even';
    // Match result (a side to win): show the predicted scoreline ONLY if it's
    // consistent with the pick (the picked side actually winning that scoreline).
    // A "Türkiye Win — predicted 1-1" reads as a contradiction, so suppress it.
    if (scoreline) {
      var pr = String(scoreline).split('-');
      var h = parseInt(pr[0], 10), a = parseInt(pr[1], 10);
      if (!isNaN(h) && !isNaN(a)) {
        var pickedHome = homeTeam && v.indexOf(String(homeTeam).toLowerCase()) !== -1;
        var consistent = pickedHome ? h > a : a > h;
        if (consistent) return 'predicted ' + scoreline;
      }
    }
    return '';
  }

  function buildTelegram(picks, dateLabel) {
    var t = '⚽ <b>Elite Edge — World Cup View</b>\n' + dateLabel + '\n\n';
    picks.forEach(function (p) {
      var time = new Date(p.kickoff).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
      var price = p.oddsDecimal ? ' (' + fracOdds(p.oddsDecimal) + ')' : '';
      t += flag(p.home) + ' <b>' + _esc(p.home) + '</b> v <b>' + _esc(p.away) + '</b> ' + flag(p.away) + '  <i>' + time + '</i>\n';
      t += '→ Our view: <b>' + _esc(p.view) + '</b>' + price + (p.note ? ' · ' + _esc(p.note) : '') + (p.conf ? ' — ' + confWord(p.conf) : '') + '\n\n';
    });
    t += 'Full match intelligence → eliteedgesports.co.uk\n<i>18+ | Opinion &amp; analysis, not betting advice | BeGambleAware.org</i>';
    return t;
  }

  // Plain-text caption for Instagram (no HTML; emoji + hashtags allowed).
  function buildInstagramCaption(picks, dateLabel) {
    var c = '⚽ ELITE EDGE — WORLD CUP VIEW\n' + dateLabel + '\n\n';
    picks.forEach(function (p) {
      c += p.home + ' v ' + p.away + '\n→ Our view: ' + p.view + (p.note ? ' · ' + p.note : '') + (p.conf ? ' (' + confWord(p.conf) + ')' : '') + '\n\n';
    });
    c += 'Full match intelligence at eliteedgesports.co.uk\n18+ | Opinion & analysis, not betting advice | BeGambleAware.org\n\n';
    c += '#WorldCup2026 #Football #EliteEdge #FootballTips #BettingTips';
    return c;
  }

  function buildEmailHtml(picks, dateLabel) {
    var rows = picks.map(function (p) {
      var time = new Date(p.kickoff).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
      var price = p.oddsDecimal ? ' (' + fracOdds(p.oddsDecimal) + ')' : '';
      return '<tr><td style="padding:10px 0;border-bottom:1px solid #1e2433;">' +
        '<div style="font-size:15px;font-weight:700;color:#fff;">' + _esc(p.home) + ' v ' + _esc(p.away) + ' <span style="color:#64748b;font-weight:400;font-size:12px;">' + time + '</span></div>' +
        '<div style="font-size:14px;color:#d4a843;margin-top:3px;">Our view: <strong>' + _esc(p.view) + '</strong>' + price + (p.note ? ' · ' + _esc(p.note) : '') + (p.conf ? ' — ' + confWord(p.conf) : '') + '</div>' +
        '</td></tr>';
    }).join('');
    return '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;padding:28px;border-radius:12px;">' +
      '<h2 style="color:#d4a843;margin:0 0 4px;">⚽ World Cup — Our View</h2>' +
      '<p style="color:#8b8d93;margin:0 0 20px;">' + dateLabel + '</p>' +
      '<table style="width:100%;border-collapse:collapse;">' + rows + '</table>' +
      '<div style="text-align:center;margin:24px 0 8px;"><a href="https://eliteedgesports.co.uk/#/world-cup" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;">Full Match Intelligence →</a></div>' +
      '<p style="font-size:11px;color:#64748b;margin-top:24px;">18+ | Opinion & statistical analysis, not betting advice | BeGambleAware.org. <a href="https://eliteedgesports.co.uk/#/account" style="color:#64748b;">Manage email preferences</a>.</p>' +
      '</div>';
  }

  // Send the day's views across all channels. opts.channels can limit.
  async function broadcast(opts) {
    opts = opts || {};
    // Ensure the consensus engine has run on the day's games first, so the
    // broadcast uses the SAME verdicts the app shows (single source of truth).
    if (deps.worldCupData && deps.worldCupData.generatePreviews) {
      try { await deps.worldCupData.generatePreviews(); } catch (e) { console.warn('[WC Broadcast] preview gen failed:', e.message); }
    }
    var picks = await buildPicks();
    if (!picks.length) return { sent: false, reason: 'No World Cup games with a consensus verdict yet. Run "Run consensus picks" first, then resend.' };

    var now = new Date();
    var dateLabel = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
    var result = { sent: true, picks: picks.length, telegram: false, emails: 0, push: false, instagram: false };

    // Telegram channel
    if (telegramBot && telegramBot.isAvailable()) {
      try { await telegramBot.sendMessage(buildTelegram(picks, dateLabel), 'HTML'); result.telegram = true; } catch (e) { console.warn('[WC Broadcast] telegram failed:', e.message); }
    }
    // Instagram (official Graph API) — same verdicts, consistent with the app.
    if (!opts.telegramOnly && !opts.skipInstagram && deps.instagramPublisher && deps.instagramPublisher.isAvailable()) {
      try {
        var ig = await deps.instagramPublisher.publish(buildInstagramCaption(picks, dateLabel));
        result.instagram = !!(ig && ig.ok);
        if (ig && !ig.ok) console.warn('[WC Broadcast] instagram failed:', ig.error);
      } catch (e) { console.warn('[WC Broadcast] instagram error:', e.message); }
    }
    // Telegram-only resend: stop here, don't re-spam email/push/notifications.
    if (opts.telegramOnly) {
      console.log('[WC Broadcast] Telegram-only resend — ' + picks.length + ' games, telegram:' + result.telegram);
      return result;
    }
    // Push + in-app notification
    if (pushService && pushService.isAvailable) {
      pushService.broadcast(db, { title: '⚽ World Cup — Our View', body: 'Our view on today\'s ' + picks.length + ' game' + (picks.length === 1 ? '' : 's') + ' is live.', url: '/#/world-cup', tag: 'wc-view' }).then(function () { result.push = true; }).catch(function () {});
    }
    try { await db.createNotification({ id: 'wc_view_' + now.getTime(), type: 'worldcup', message: 'World Cup — our view on today\'s ' + picks.length + ' game(s). Tap for full match intelligence.', timestamp: now.toISOString(), audience: 'all' }); } catch (e) {}

    // Email subscribers who haven't opted out of marketing/bulletin emails
    if (!opts.skipEmail && emailService && (emailService._sendEmail || emailService.sendGeneric)) {
      try {
        var users = await db.getUsers();
        var html = buildEmailHtml(picks, dateLabel);
        var subject = '⚽ World Cup — Our View on Today\'s Games';
        for (var i = 0; i < users.length; i++) {
          var u = users[i];
          if (!u.email) continue;
          var prefs = u.emailPrefs || {};
          if (prefs.marketing === false && prefs.dailyBulletin === false) continue; // respect opt-outs
          var send = emailService._sendEmail
            ? emailService._sendEmail({ to: u.email, subject: subject, html: html, emailType: 'wc_view' })
            : emailService.sendGeneric({ to: u.email, subject: subject, html: html });
          send.then(function () {}).catch(function () {});
          result.emails++;
        }
      } catch (e) { console.warn('[WC Broadcast] email failed:', e.message); }
    }

    console.log('[WC Broadcast] Sent view on ' + picks.length + ' games — telegram:' + result.telegram + ', emails:' + result.emails);
    return result;
  }

  return { buildPicks: buildPicks, broadcast: broadcast };
};
