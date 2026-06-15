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
        if (pv.rows.length && pv.rows[0].verdict_selection && !/^\s*draw\s*$/i.test(pv.rows[0].verdict_selection)) {
          view = pv.rows[0].verdict_selection;
          conf = pv.rows[0].confidence || null;
          if (pv.rows[0].predicted_scoreline) note = 'Predicted ' + pv.rows[0].predicted_scoreline;
        }
      } catch (e) {}
      // 2) Live bookmaker odds — favourite to win + goals lean
      if (!view && sportMonks && sportMonks.getMarketOdds && f.external_fixture_id) {
        try {
          var mo = await sportMonks.getMarketOdds(f.external_fixture_id);
          if (mo && mo.home && mo.away) {
            var favHome = mo.home <= mo.away;
            var favOdds = favHome ? mo.home : mo.away;
            oddsDecimal = favOdds;
            view = (favHome ? f.home_team : f.away_team) + ' to win';
            conf = favOdds <= 1.20 ? 9 : favOdds <= 1.50 ? 8 : favOdds <= 2.20 ? 7 : 6;
            if (mo.over35 && mo.over35 <= 2.05) note = 'Over 3.5 goals lean';
            else if (mo.over25 && mo.over25 <= 1.80) note = 'Over 2.5 goals lean';
          }
        } catch (e) {}
      }
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
    var picks = await buildPicks();
    if (!picks.length) return { sent: false, reason: 'No World Cup fixtures with a view in the next 30h.' };

    var now = new Date();
    var dateLabel = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
    var result = { sent: true, picks: picks.length, telegram: false, emails: 0, push: false };

    // Telegram channel
    if (telegramBot && telegramBot.isAvailable()) {
      try { await telegramBot.sendMessage(buildTelegram(picks, dateLabel), 'HTML'); result.telegram = true; } catch (e) { console.warn('[WC Broadcast] telegram failed:', e.message); }
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
