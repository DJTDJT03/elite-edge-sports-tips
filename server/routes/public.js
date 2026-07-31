module.exports = function(deps) {
  const router = require('express').Router();
  const path = require('path');
  const { db, racingSource, footballSource, oddsSource, racingOddsSource, movementTracker, dataIngestion, aiReports, newsService, quantModel } = deps;

  // Cache today's racecards for the Ask Elite Edge assistant (10 min)
  var _raceCardCache = { ts: 0, cards: [] };
  async function getTodaysRaceCards() {
    if (Date.now() - _raceCardCache.ts < 600000 && _raceCardCache.cards.length) return _raceCardCache.cards;
    if (!racingSource || !process.env.RACING_API_KEY) return [];
    try {
      var raw = await racingSource.fetch();
      var norm = racingSource.normalise(raw) || [];
      var today = new Date().toISOString().split('T')[0];
      norm = norm.filter(function (r) {
        // The Racing API standard/free racecards are already GB & IRE only, so be
        // lenient on region (accept GB/UK/IRE variants OR blank) and only drop a
        // card if it's explicitly a different date.
        var reg = String(r.region || '').toUpperCase().trim();
        if (reg && ['GB', 'UK', 'GBR', 'IRE', 'IRL', 'IE'].indexOf(reg) === -1) return false;
        if (r.date) { var d = r.date.toString().split('T')[0].substring(0, 10); if (d && d !== today) return false; }
        return true;
      });
      norm.forEach(function (race) {
        if (race.runners && race.runners.length) {
          var declared = race.runners.filter(function (rn) { return !rn.isNonRunner; });
          if (declared.length) race.runners = declared;
        }
      });
      _raceCardCache = { ts: Date.now(), cards: norm };
      return norm;
    } catch (e) { return _raceCardCache.cards || []; }
  }

  // GET /api/status — API connection status overview
  router.get('/api/status', async (req, res) => {
    try {
      var movementStatus = movementTracker ? {
        eventsTracked: Object.keys(movementTracker.snapshots).length,
        activeAlerts: movementTracker.activeAlerts.length,
        steamers: movementTracker.marketMovers.steamers.length,
        drifters: movementTracker.marketMovers.drifters.length,
      } : { eventsTracked: 0, activeAlerts: 0 };

      res.json({
        racing: { connected: !!(racingSource && process.env.RACING_API_KEY && process.env.RACING_API_SECRET), hasKey: !!process.env.RACING_API_KEY, hasSecret: !!process.env.RACING_API_SECRET },
        football: { connected: !!(footballSource && process.env.API_FOOTBALL_KEY) },
        odds: {
          connected: !!(oddsSource && process.env.ODDS_API_KEY),
          footballOdds: true,
          racingOdds: true,
          bestPriceFinder: true,
          valueBetScanner: true,
        },
        racingOdds: { connected: !!(racingOddsSource && process.env.ODDS_API_KEY) },
        movementTracker: movementStatus,
        sportMonks: { connected: !!(deps.sportMonks && deps.sportMonks.isAvailable()) },
        ingestion: dataIngestion.getStatus ? dataIngestion.getStatus() : {},
        features: {
          worldCup: process.env.ENABLE_WORLD_CUP === 'true',
          lms: process.env.ENABLE_LMS === 'true',
        }
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/blog/weekly-reviews — Auto-generated weekly performance reviews
  router.get('/api/blog/weekly-reviews', async (req, res) => {
    try {
      var reviews = await db.getBlogReviews() || [];
      res.json(reviews);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/ai/daily-briefing — AI-generated morning briefing
  router.get('/api/ai/daily-briefing', async (req, res) => {
    try {
      if (!aiReports || !aiReports.isAvailable()) {
        return res.status(503).json({ error: 'AI reports not available. ANTHROPIC_API_KEY not configured.' });
      }

      var today = new Date().toISOString().split('T')[0];

      // Gather today's tips
      var allTips = [];
      try {
        allTips = await db.getTips() || [];
      } catch (e) { /* fallback to empty */ }

      var todayTips = allTips.filter(function(t) {
        return t.status === 'active' && (!t.date || t.date === today);
      });
      var racingTips = todayTips.filter(function(t) { return t.sport === 'racing'; });
      var footballTips = todayTips.filter(function(t) { return t.sport === 'football'; });
      var napSelection = todayTips.find(function(t) { return t.isNap; });
      var premiumTips = todayTips.filter(function(t) { return t.tier === 'premium'; });

      var briefingData = {
        date: today,
        racingTips: racingTips.map(function(t) { return { selection: t.selection, meeting: t.meeting || t.event, odds: t.odds }; }),
        footballTips: footballTips.map(function(t) { return { selection: t.selection, event: t.event, odds: t.odds }; }),
        totalTips: todayTips.length,
        premiumTips: premiumTips.length,
        napSelection: napSelection ? { selection: napSelection.selection, meeting: napSelection.meeting || napSelection.event } : null,
        keyRaces: [],
      };

      var result = await aiReports.generateDailySummary(briefingData);
      if (!result) {
        return res.status(500).json({ error: 'Failed to generate daily briefing. Please try again.' });
      }

      res.json({ date: today, aiBriefing: result, totalTips: todayTips.length, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[AI Daily Briefing] Error:', err.message);
      res.status(500).json({ error: 'Failed to generate daily briefing: ' + err.message });
    }
  });

  // GET /api/live-now — powers the live scoreboard strip + homepage live section.
  // Today's World Cup matches (in-play/finished/upcoming) + the latest settled
  // results landing. DB-only, fast, refreshed client-side every ~60s.
  router.get('/api/live-now', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=30');
      var out = { live: [], results: [] };
      if (db && db.query && process.env.ENABLE_WORLD_CUP === 'true') {
        try {
          var wc = await db.query(
            "SELECT home_team, away_team, kickoff, status, home_goals, away_goals FROM world_cup_fixtures " +
            "WHERE kickoff >= NOW() - INTERVAL '3 hours' AND kickoff <= NOW() + INTERVAL '14 hours' " +
            "AND home_team !~ '^[0-9]' AND home_team NOT ILIKE '%winner%' ORDER BY kickoff ASC LIMIT 14"
          );
          (wc.rows || []).forEach(function (r) {
            out.live.push({ comp: 'World Cup', home: r.home_team, away: r.away_team, hg: r.home_goals, ag: r.away_goals, status: r.status, kickoff: r.kickoff });
          });
        } catch (e) { /* non-fatal */ }
      }
      try {
        var results = (await db.getResults()) || [];
        out.results = results
          .filter(function (r) { return r.result === 'won' || r.result === 'lost' || r.result === 'placed' || r.result === 'void'; })
          .sort(function (a, b) { return String(b.settledAt || b.date || '').localeCompare(String(a.settledAt || a.date || '')); })
          .slice(0, 10)
          .map(function (r) { return { selection: r.selection, event: r.event, odds: r.odds, result: r.result, pnl: r.pnl, sport: r.sport }; });
      } catch (e) { /* non-fatal */ }
      res.json(out);
    } catch (e) { res.json({ live: [], results: [] }); }
  });

  // GET /api/football-news — free RSS football headlines (BBC/Sky/Guardian).
  // No API key needed; aggregated headline + source + link back to the article.
  var footballNews = require('../services/footballNews');
  router.get('/api/football-news', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      var limit = Math.min(parseInt(req.query.limit, 10) || 20, 40);
      var news = await footballNews.getNews();
      res.json({ news: news.slice(0, limit), count: news.length });
    } catch (err) {
      res.json({ news: [], count: 0 });
    }
  });

  // GET /api/news/latest — latest UK sports headlines
  router.get('/api/news/latest', async (req, res) => {
    try {
      if (!newsService || !newsService.isAvailable()) {
        return res.status(503).json({ error: 'News service not available. NEWS_API_KEY not configured.' });
      }
      var articles = await newsService.fetchSportsNews();
      res.json({ articles: articles, count: articles.length });
    } catch (err) {
      console.error('[News API] /latest error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/news/team/:teamName — news for specific team
  router.get('/api/news/team/:teamName', async (req, res) => {
    try {
      if (!newsService || !newsService.isAvailable()) {
        return res.status(503).json({ error: 'News service not available. NEWS_API_KEY not configured.' });
      }
      var teamName = decodeURIComponent(req.params.teamName);
      var articles = await newsService.fetchTeamNews(teamName);
      res.json({ team: teamName, articles: articles, count: articles.length });
    } catch (err) {
      console.error('[News API] /team error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/news/relevant — news relevant to today's tipped selections
  router.get('/api/news/relevant', async (req, res) => {
    try {
      if (!newsService || !newsService.isAvailable()) {
        return res.status(503).json({ error: 'News service not available. NEWS_API_KEY not configured.' });
      }

      var allTips = [];
      try {
        allTips = await db.getTips() || [];
      } catch (e) { /* fallback to empty */ }

      var today = new Date().toISOString().split('T')[0];
      var todayTips = allTips.filter(function(t) {
        return t.status === 'active' && (!t.date || t.date === today);
      });

      var results = await newsService.scanForRelevantNews(todayTips);
      res.json({
        date: today,
        tipsScanned: todayTips.length,
        news: results,
        count: results.length,
      });
    } catch (err) {
      console.error('[News API] /relevant error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/accas/save — save a user-built acca for tracking + social
  router.post('/api/accas/save', async (req, res) => {
    try {
      var body = req.body || {};
      if (!body.selections || !Array.isArray(body.selections) || body.selections.length < 2) {
        return res.status(400).json({ error: 'At least 2 selections required' });
      }
      // Get user if logged in
      var userName = 'Anonymous';
      var userId = null;
      var authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          var jwt = require('jsonwebtoken');
          var decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || '');
          userId = decoded.id;
          userName = decoded.name || 'User';
        } catch (e) {}
      }

      await db.query(
        'INSERT INTO user_accas (user_id, user_name, selections, combined_odds, stake, potential_return, shared) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [userId, userName, JSON.stringify(body.selections), body.combinedOdds || 0, body.stake || 0, body.potentialReturn || 0, body.share || false]
      );
      res.json({ saved: true, message: 'Acca saved!' });
    } catch (err) {
      console.error('[Accas] Save error:', err.message);
      res.status(500).json({ error: 'Failed to save acca' });
    }
  });

  // GET /api/accas/shared — get recently shared accas for social feed
  router.get('/api/accas/shared', async (req, res) => {
    try {
      if (!db.isAvailable()) return res.json([]);
      var result = await db.query(
        'SELECT * FROM user_accas WHERE shared = true ORDER BY created_at DESC LIMIT 20'
      );
      res.json(result.rows.map(function(r) {
        return {
          id: r.id, userName: r.user_name, selections: r.selections,
          combinedOdds: parseFloat(r.combined_odds) || 0,
          stake: parseFloat(r.stake) || 0,
          potentialReturn: parseFloat(r.potential_return) || 0,
          status: r.status, result: r.result,
          pnl: parseFloat(r.pnl) || 0,
          createdAt: r.created_at,
        };
      }));
    } catch (err) {
      res.json([]);
    }
  });

  // Light per-IP rate limit for the AI assistant (cost control) — 20 / 10 min.
  var _aiChatHits = new Map();
  var _chatModelDown = false; // sticky: if the preferred chat model errors, use fallback
  function aiChatRateLimited(ip) {
    var now = Date.now();
    var arr = (_aiChatHits.get(ip) || []).filter(function (t) { return now - t < 600000; });
    arr.push(now);
    _aiChatHits.set(ip, arr);
    if (_aiChatHits.size > 5000) _aiChatHits.clear();
    return arr.length > 20;
  }

  // Global daily backstop: the AI assistant is unauthenticated and each call costs
  // real money (Perplexity + Anthropic). A per-IP limit alone can be defeated by a
  // botnet / IP rotation, so cap total calls per day across ALL callers. Tune via
  // AI_CHAT_DAILY_CAP (default 3000/day ~ generous for real users, cheap ceiling on abuse).
  var _aiChatDay = '';
  var _aiChatDayCount = 0;
  var AI_CHAT_DAILY_CAP = parseInt(process.env.AI_CHAT_DAILY_CAP || '3000', 10);
  function aiChatGlobalCapReached() {
    var today = new Date().toISOString().split('T')[0];
    if (today !== _aiChatDay) { _aiChatDay = today; _aiChatDayCount = 0; }
    _aiChatDayCount++;
    return _aiChatDayCount > AI_CHAT_DAILY_CAP;
  }

  // Direct Perplexity Sonar call for live, cited web grounding (so answers about
  // things outside our own data are CURRENT, not from the model's training cutoff).
  function askPerplexitySonar(question) {
    return new Promise(function (resolve) {
      var key = process.env.PERPLEXITY_API_KEY;
      if (!key) return resolve(null);
      var https = require('https');
      var payload = JSON.stringify({
        model: 'sonar',
        max_tokens: 500,
        messages: [
          { role: 'system', content: 'You are a sports research assistant. Give CURRENT, factual info as of today: latest team/player news, injuries/fitness, expected line-ups, the current market favourite and rough odds where relevant. UK focus, concise. No betting guarantees.' },
          { role: 'user', content: question },
        ],
      });
      var opts = { method: 'POST', hostname: 'api.perplexity.ai', path: '/chat/completions', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 13000 };
      var req2 = https.request(opts, function (r) {
        var data = '';
        r.on('data', function (c) { data += c; });
        r.on('end', function () {
          try {
            var j = JSON.parse(data);
            var text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
            var cites = (j.citations || []).map(function (c) { return typeof c === 'string' ? c : (c && c.url) || ''; }).filter(Boolean).slice(0, 5);
            resolve(text ? { text: text, citations: cites } : null);
          } catch (e) { resolve(null); }
        });
      });
      req2.on('timeout', function () { req2.destroy(); resolve(null); });
      req2.on('error', function () { resolve(null); });
      req2.write(payload); req2.end();
    });
  }

  // Pull two team names out of a "X v Y" style question and return them ONLY if
  // our quant model genuinely knows both (so we never attach meaningless numbers).
  function extractKnownMatch(msg) {
    try {
      if (!quantModel || !quantModel.knows) return null;
      var m = String(msg).match(/(.{2,40}?)\s+(?:v|vs|versus|against)\s+(.{2,40})/i);
      if (!m) return null;
      var leftTokens = m[1].trim().split(/\s+/).slice(-3);
      var rightRaw = m[2].trim().replace(/[?.!,].*$/, '').replace(/\b(today|tonight|tomorrow|this|now|game|match|fixture|prediction|tip|result|score|win|wins)\b.*$/i, '').trim();
      var rightTokens = rightRaw.split(/\s+/).slice(0, 3);
      for (var li = 0; li < leftTokens.length; li++) {
        var a = leftTokens.slice(li).join(' ');
        if (!quantModel.knows(a)) continue;
        for (var ri = rightTokens.length; ri >= 1; ri--) {
          var b = rightTokens.slice(0, ri).join(' ');
          if (quantModel.knows(b)) return { home: a, away: b };
        }
      }
      return null;
    } catch (e) { return null; }
  }

  // GET /api/assistant/popular — most-asked questions (adaptive suggested prompts).
  router.get('/api/assistant/popular', async (req, res) => {
    try {
      if (!db || !db.query) return res.json({ questions: [] });
      res.set('Cache-Control', 'public, max-age=600');
      var r = await db.query(
        "SELECT question, COUNT(*)::int AS n FROM assistant_queries " +
        "WHERE created_at > NOW() - INTERVAL '14 days' AND length(question) BETWEEN 8 AND 80 " +
        "GROUP BY question ORDER BY n DESC, MAX(created_at) DESC LIMIT 6"
      );
      var qs = (r.rows || []).filter(function (x) { return x.n >= 2; }).map(function (x) { return x.question; });
      res.json({ questions: qs });
    } catch (e) { res.json({ questions: [] }); }
  });

  // GET /api/admin/racing-diagnostic — verify the racecard feed (admin only).
  router.get('/api/admin/racing-diagnostic', deps.authenticate, deps.requireAdmin, async (req, res) => {
    try {
      var out = { hasKey: !!process.env.RACING_API_KEY, hasSecret: !!process.env.RACING_API_SECRET, rawApiCount: 0, normalisedCount: 0, todayUkIreCount: 0, sampleFromApi: [], sampleTodayUkIre: [], error: null };
      if (!out.hasKey || !out.hasSecret) { out.error = 'Missing RACING_API_KEY and/or RACING_API_SECRET — both are required.'; return res.json(out); }
      // Step 1: raw API fetch (tells us if auth/plan works at all)
      var raw = await racingSource.fetch();
      out.rawApiCount = (raw && raw.racecards && raw.racecards.length) || 0;
      out.endpointUsed = (raw && raw._endpoint) || 'unknown';
      // Exact field names the API returns per runner (definitive — shows if Pro
      // fields like spotlight/rpr/ts are actually present and under what names).
      try {
        var rr = raw.racecards.find(function (x) { return x.runners && x.runners.length; });
        out.rawRunnerKeys = rr ? Object.keys(rr.runners[0]).sort() : [];
      } catch (e) { out.rawRunnerKeys = []; }
      // Step 2: normalise (our parser)
      var norm = racingSource.normalise(raw) || [];
      out.normalisedCount = norm.length;
      out.sampleFromApi = norm.slice(0, 6).map(function (r) { return { region: r.region || '?', date: (r.date || '').toString().slice(0, 10), course: r.meeting || r.course || '?', time: r.time || '?' }; });
      // Step 3: what the assistant actually gets (today + GB/IRE filter)
      var cards = await getTodaysRaceCards();
      out.todayUkIreCount = cards.length;
      out.sampleTodayUkIre = cards.slice(0, 8).map(function (c) { return (c.time || '') + ' ' + (c.meeting || ''); });
      // Step 4: how many runners ACROSS ALL races carry the Pro fields (Spotlight/
      // RPR/TS). Scanning all of them avoids being fooled by a single unrated horse.
      var totalRunners = 0, withRpr = 0, withTs = 0, withSpot = 0, withOr = 0, exampleSpot = null;
      norm.forEach(function (r) {
        (r.runners || []).forEach(function (rn) {
          totalRunners++;
          if (rn.rpr != null && rn.rpr !== '') withRpr++;
          if (rn.ts != null && rn.ts !== '') withTs++;
          if (rn.officialRating != null && rn.officialRating !== '' && rn.officialRating !== '-') withOr++;
          if (rn.spotlight) { withSpot++; if (!exampleSpot) exampleSpot = String(rn.spotlight).replace(/\s+/g, ' ').slice(0, 160); }
        });
      });
      out.richFields = {
        totalRunners: totalRunners, withOR: withOr, withRPR: withRpr, withTS: withTs, withSpotlight: withSpot,
        hasRPR: withRpr > 0, hasTS: withTs > 0, hasSpotlight: withSpot > 0,
        spotlightSample: exampleSpot,
      };
      // RAW values from the API for a RATED race (handicap, not a 2yo maiden) — shows
      // exactly which Pro fields actually carry content vs which are empty.
      try {
        var rated = raw.racecards.find(function (x) {
          return x.runners && x.runners.some(function (rn) { return parseInt(rn.ofr, 10) > 0; });
        }) || raw.racecards.find(function (x) { return x.runners && x.runners.length; });
        out.rawSample = rated ? rated.runners.slice(0, 3).map(function (rn) {
          return {
            horse: rn.horse, ofr: rn.ofr, rpr: rn.rpr, ts: rn.ts,
            perf_rating: rn.performance_rating, speed_rating: rn.speed_rating,
            trainer_rtf: rn.trainer_rtf, trainer_14d: rn.trainer_14_days,
            comment: rn.comment ? String(rn.comment).slice(0, 50) : rn.comment,
            spotlight: rn.spotlight ? String(rn.spotlight).slice(0, 50) : rn.spotlight,
          };
        }) : [];
        out.rawSampleRace = rated ? ((rated.course || '') + ' ' + (rated.off_time || rated.time || '') + ' ' + (rated.race_name || '')) : null;
      } catch (e) { out.rawSample = []; }
      if (out.rawApiCount === 0) out.error = 'The Racing API returned 0 races — credentials are likely wrong/expired, or the plan does not cover /racecards/standard or /racecards/free. Check logs for "[racing-cards]".';
      else if (out.todayUkIreCount === 0) out.error = 'API returned ' + out.rawApiCount + ' races but 0 survived the today+GB/IRE filter — likely a region-code or date-format mismatch (see sampleFromApi). This is a fixable filter bug, not a credentials problem.';
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/assistant-queries — demand intel (admin only).
  router.get('/api/admin/assistant-queries', deps.authenticate, deps.requireAdmin, async (req, res) => {
    try {
      var recent = await db.query("SELECT question, created_at FROM assistant_queries ORDER BY created_at DESC LIMIT 100");
      var top = await db.query(
        "SELECT question, COUNT(*)::int AS n, MAX(created_at) AS last FROM assistant_queries " +
        "WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY question ORDER BY n DESC, last DESC LIMIT 40"
      );
      var totalRow = await db.query("SELECT COUNT(*)::int AS n FROM assistant_queries WHERE created_at > NOW() - INTERVAL '7 days'");
      res.json({ recent: recent.rows || [], top: top.rows || [], last7days: (totalRow.rows[0] && totalRow.rows[0].n) || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/chat/ai — AI-powered chatbot using Claude with live data context
  router.post('/api/chat/ai', async (req, res) => {
    try {
      var message = (req.body && req.body.message) || '';
      if (!message.trim()) {
        return res.status(400).json({ reply: 'Please send a message.' });
      }
      // Trusted client IP (req.ip via `trust proxy`) — not the spoofable header.
      var ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
      if (aiChatRateLimited(ip)) {
        return res.json({ reply: "You're firing questions in fast! Give it a minute and ask again." });
      }
      if (aiChatGlobalCapReached()) {
        return res.json({ reply: "The Edge assistant is taking a breather for today — it's been busy! Try again tomorrow, or explore today's tips and analysis in the meantime." });
      }

      if (!aiReports || !aiReports.isAvailable() || !aiReports.client) {
        return res.status(503).json({ reply: 'AI chat is temporarily unavailable. Please try again later.' });
      }

      // Kick off live web grounding IN PARALLEL (skip pure service/account questions).
      var msgL0 = message.toLowerCase();
      var serviceQ = /(price|pricing|cost|subscri|how do i|how does|what sports|sign ?up|free trial|account|log ?in|cancel|refund|\bcredit|install|app\b)/.test(msgL0);
      // RACING questions must be answered ONLY from our verified Racing API card —
      // never from a web search (which hallucinates runners that aren't even in the
      // race). So we do NOT web-ground racing questions.
      var racingQ = /\brace\b|racing|racecard|\brunner|\bhorses?\b|\bnags?\b|\bnap\b|each.?way|favourite|favorite|\bgoing\b|\bdraw\b|\b\d{1,2}[.:]\d{2}\b|kempton|ascot|newmarket|york|goodwood|doncaster|sandown|haydock|aintree|cheltenham|epsom|newbury|chester|ayr|chepstow|leopardstown|curragh|punchestown/.test(msgL0);
      // Did they ask about a SPECIFIC race (a course or a time)? A general "best
      // horses today" question is NOT specific — we can still answer it from our
      // per-race picks, so it must not trigger the hard "no card" refusal.
      var specificRaceAsked = /\b\d{1,2}[.:]\d{2}\b|kempton|ascot|newmarket|york|goodwood|doncaster|sandown|haydock|aintree|cheltenham|epsom|newbury|chester|ayr|chepstow|leopardstown|curragh|punchestown|wolverhampton|lingfield|southwell|newcastle|nottingham|leicester|bath|brighton|carlisle|catterick|fakenham|ffos|hamilton|hexham|musselburgh|perth|redcar|ripon|salisbury|stratford|thirsk|uttoxeter|wetherby|windsor|worcester|yarmouth/.test(msgL0);
      var haveRaceCardDetail = false;
      var webPromise = (!serviceQ && !racingQ && message.trim().length > 6) ? askPerplexitySonar(message) : Promise.resolve(null);
      var webCitations = [];

      // Fetch live context for the chatbot
      var today = new Date().toISOString().split('T')[0];
      var liveContext = '';
      try {
        var tips = await db.getTips();
        var todayTips = tips.filter(function(t) {
          var d = t.date;
          if (d && typeof d !== 'string') try { d = new Date(d).toISOString().split('T')[0]; } catch(e) { return false; }
          return d === today && t.status === 'active';
        });
        if (todayTips.length > 0) {
          liveContext += '\n\nTODAY\'S LIVE TIPS (' + today + '):\n';
          todayTips.forEach(function(t) {
            liveContext += '- ' + (t.sport || '').toUpperCase() + ': ' + (t.selection || '') + ' in ' + (t.event || '') + ' @ ' + (t.odds || '') + ' (Confidence: ' + (t.confidence || '') + '/10, Edge: ' + ((t.edge || 0) * 100).toFixed(1) + '%)';
            if (t.analysis && t.analysis.summary) liveContext += ' — ' + t.analysis.summary.substring(0, 100);
            liveContext += '\n';
          });
        }

        var results = await db.getResults();
        var recentResults = results.slice(-5);
        if (recentResults.length > 0) {
          liveContext += '\nRECENT RESULTS (last 5):\n';
          recentResults.forEach(function(r) {
            liveContext += '- ' + (r.selection || '') + ' @ ' + (r.odds || '') + ' = ' + (r.result || '') + ' (' + (r.pnl >= 0 ? '+' : '') + (r.pnl || 0).toFixed(2) + 'u)\n';
          });
        }

        // Our Pick on EVERY race today (race_predictions) — lets the assistant
        // answer "who wins the 2.45 at Kempton" even when not a published tip
        try {
          if (db.getRacePredictions) {
            var racePreds = await db.getRacePredictions({ date: today });
            if (racePreds && racePreds.length) {
              liveContext += '\nTODAY\'S RACE PREDICTIONS — Our Pick on every race:\n';
              racePreds.slice(0, 80).forEach(function(r) {
                liveContext += '- ' + (r.race_time || '') + ' ' + (r.meeting || '') + (r.race_name ? ' (' + r.race_name + ')' : '') +
                  ' — Our Pick: ' + (r.selection || '') + (r.odds ? ' @ ' + r.odds : '') + ' (confidence ' + (r.confidence || '?') + '/10)\n';
              });
            }
          }
        } catch (e) {}

        // Our Take on EVERY football match today (match_predictions) — answers
        // "who wins" / "how many goals" for any fixture, not just published tips
        try {
          if (db.getMatchPredictions) {
            var matchPreds = await db.getMatchPredictions({ date: today });
            if (matchPreds && matchPreds.length) {
              liveContext += '\nTODAY\'S MATCH PREDICTIONS — Our Take on every game:\n';
              matchPreds.slice(0, 60).forEach(function(m) {
                liveContext += '- ' + (m.home_team || '') + ' v ' + (m.away_team || '') + (m.league ? ' (' + m.league + ')' : '') +
                  ' — Our Take: ' + (m.pick || '') + (m.market ? ' [' + m.market + ']' : '') + ' (confidence ' + (m.confidence || '?') + '/10)' +
                  (m.reason ? ' — ' + String(m.reason).substring(0, 140) : '') + '\n';
              });
            }
          }
        } catch (e) {}

        // World Cup — upcoming fixtures (we have the full schedule synced) with
        // our predicted scoreline/pick joined in where a preview has generated
        try {
          if (process.env.ENABLE_WORLD_CUP === 'true' && db.query) {
            var wcf = await db.query(
              "SELECT f.home_team, f.away_team, f.kickoff, f.stage, f.group_letter, p.predicted_scoreline, p.verdict_selection, p.verdict, p.confidence " +
              "FROM world_cup_fixtures f LEFT JOIN world_cup_previews p ON f.id = p.fixture_id " +
              "WHERE f.status = 'scheduled' AND f.kickoff >= NOW() - INTERVAL '6 hours' ORDER BY f.kickoff ASC LIMIT 24"
            );
            if (wcf.rows && wcf.rows.length) {
              liveContext += '\nWORLD CUP 2026 — UPCOMING FIXTURES (full schedule is synced; the first kickoff is the opener):\n';
              wcf.rows.forEach(function(p) {
                var ko = p.kickoff ? new Date(p.kickoff).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'TBC';
                liveContext += '- ' + p.home_team + ' v ' + p.away_team + (p.group_letter ? ' (Group ' + p.group_letter + ')' : '') + ' — ' + ko;
                if (p.predicted_scoreline || p.verdict_selection) {
                  liveContext += ' | Our prediction: ' + (p.predicted_scoreline || '') + (p.verdict_selection ? ', ' + p.verdict_selection : '') + (p.confidence ? ' (conf ' + p.confidence + '/10)' : '');
                } else {
                  liveContext += ' | detailed prediction generates closer to kickoff';
                }
                liveContext += '\n';
              });
            }
          }
        } catch (e) {}
        // LIVE RACECARDS — lets the assistant analyse ANY race on demand (our
        // edge over generic chatbots, which can't see today's runners/odds)
        try {
          var msgLower = message.toLowerCase();
          var racingIntent = /\brace|racing|runner|\bhorses?\b|\bnags?\b|winner|nap|each.?way|favourite|favorite|top ?3|top three|tip|fancy|selection|best bet|\b\d{1,2}[.:]\d{2}\b/.test(msgLower);
          var cards = (racingSource && process.env.RACING_API_KEY && racingIntent) ? await getTodaysRaceCards() : [];
          if (!cards.length && racingSource && process.env.RACING_API_KEY) {
            // course name in the message? fetch anyway
            var quick = await getTodaysRaceCards();
            if (quick.some(function (c) { return c.meeting && msgLower.indexOf(c.meeting.toLowerCase()) !== -1; })) cards = quick;
          }
          if (cards.length) {
            liveContext += "\nTODAY'S LIVE RACECARDS (UK & Ireland) — use these to answer any race question:\n";
            cards.forEach(function (r) {
              liveContext += '- ' + (r.time || '') + ' ' + (r.meeting || '') + (r.raceName ? ' — ' + r.raceName : '') + ' (' + ((r.runners && r.runners.length) || 0) + ' runners)\n';
            });
            // Detailed runners for the race(s) the question is about. Match the
            // course even when the user types a short name ("Kempton" vs "Kempton
            // Park (AW)"), and match the time in both 12h and 24h form ("2:45" → 14:45).
            var courses = cards.map(function (c) { return c.meeting; }).filter(Boolean);
            var courseWords = function (m) { return m.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z ]/g, '').split(/\s+/).filter(function (w) { return w.length > 3; }); };
            var mentionedCourse = courses.find(function (c) {
              if (msgLower.indexOf(c.toLowerCase()) !== -1) return true;
              return courseWords(c).some(function (w) { return msgLower.indexOf(w) !== -1; });
            });
            var tMatch = msgLower.match(/(\d{1,2})[.:](\d{2})/);
            // Match on hour+minute with 12h/24h ambiguity handled BOTH ways: the
            // user may type "17:00" while the card stores "5:00" (or vice-versa).
            var timeMatches = function (rtime) {
              if (!tMatch) return false;
              var rm = String(rtime || '').match(/(\d{1,2})[.:](\d{2})/);
              if (!rm) return false;
              var rh = parseInt(rm[1], 10), uh = parseInt(tMatch[1], 10);
              if (rm[2] !== tMatch[2]) return false;            // minutes must match
              return rh === uh || (rh % 12) === (uh % 12);      // 5 ≡ 17, 17 ≡ 5
            };
            var detail = cards.filter(function (r) {
              var cOk = mentionedCourse ? (r.meeting === mentionedCourse) : false;
              var tOk = timeMatches(r.time);
              if (mentionedCourse && tMatch) return cOk && tOk;
              return cOk || tOk;
            }).slice(0, 3);
            if (detail.length) haveRaceCardDetail = true;
            // GENERAL "best today / NAP" question with no specific race: load the
            // full card for the races our highest-confidence Race Predictions are
            // in, so we can name the best of the day WITH real card reasoning.
            if (!detail.length && !specificRaceAsked && typeof racePreds !== 'undefined' && racePreds && racePreds.length) {
              var _norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
              var _topPreds = racePreds.slice().sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); }).slice(0, 5);
              detail = cards.filter(function (r) {
                return _topPreds.some(function (p) {
                  var sameMeeting = p.meeting && r.meeting && _norm(r.meeting).indexOf(_norm(String(p.meeting).split(' ')[0])) !== -1;
                  var sameTime = p.race_time && r.time && String(p.race_time).replace('.', ':') === String(r.time).replace('.', ':');
                  return sameMeeting && sameTime;
                });
              }).slice(0, 5);
            }
            detail.forEach(function (r) {
              liveContext += '\nRUNNERS — ' + (r.time || '') + ' ' + (r.meeting || '') + (r.raceName ? ' ' + r.raceName : '') + (r.raceClass ? ' (Class ' + r.raceClass + ')' : '') + (r.going ? ' [going: ' + r.going + ']' : '') + (r.distance ? ', ' + r.distance : '') + ':\n';
              (r.runners || []).slice(0, 20).forEach(function (rn) {
                var t14 = rn.trainer14 && rn.trainer14.percent != null ? ' | trnr14d ' + rn.trainer14.percent + '%' : '';
                var j14 = rn.jockey14 && rn.jockey14.percent != null ? ' | jky14d ' + rn.jockey14.percent + '%' : '';
                liveContext += '  - ' + (rn.horseName || '') + (rn.draw ? ' (draw ' + rn.draw + ')' : '') + ' @ ' + (rn.odds || 'SP') +
                  ((rn.officialRating && rn.officialRating !== '-') ? ' | OR ' + rn.officialRating : '') + ' | Power ' + (rn.rpr || '-') + ' | Speed ' + (rn.ts || '-') +
                  ' | form ' + (rn.form || '-') + (rn.lastRun != null ? ' | ' + rn.lastRun + 'd off' : '') + (rn.headgear ? ' | ' + rn.headgear : '') +
                  ' | ' + (rn.jockey || '-') + ' / ' + (rn.trainer || '-') + t14 + j14 +
                  (rn.spotlight ? '\n      Analysis: ' + String(rn.spotlight).replace(/\s+/g, ' ').slice(0, 260) : '') + '\n';
              });
            });
          }
        } catch (e) {}
      } catch (ctxErr) {
        // Non-fatal — chatbot works without live context
      }

      // RACING INTEGRITY GUARD. Two cases:
      // 1) A SPECIFIC race (course/time) we couldn't load → never invent runners.
      // 2) A GENERAL racing question ("best horses today") → DO answer, but only
      //    from our own verified data above (Race Predictions / loaded cards),
      //    never from web horse names.
      if (racingQ && !haveRaceCardDetail && specificRaceAsked) {
        liveContext += "\n\nRACING DATA STATUS: We do NOT have a verified racecard for the SPECIFIC race asked about right now. You MUST NOT name any horses, give a selection, or list a top-3 for that race — there is no card to read and guessing/using web info for runners is forbidden. Reply briefly that you can't pull that exact card at the moment and point them to the Racing page / to try again shortly. Do not invent runners under any circumstances.\n";
      } else if (racingQ && !haveRaceCardDetail) {
        liveContext += "\n\nRACING ANSWER GUIDANCE: This is a GENERAL racing question. Answer it from OUR OWN data above — 'TODAY'S RACE PREDICTIONS (Our Pick on every race)' and 'TODAY'S LIVE RACECARDS' — naming our standout picks with the reasoning we provide. If we have no race predictions or cards loaded for today, say so plainly and point them to the Racing page. NEVER name horses from web intel/third-party sites — only our verified card/prediction data.\n";
      }

      // ELITE EDGE QUANT MODEL — attach OUR engine's live probabilities for the
      // match in question (only when the model genuinely knows both teams), so the
      // answer is verified by our own Elo + Dixon-Coles engine, not just reasoning.
      try {
        var mt = extractKnownMatch(message);
        if (mt && quantModel && quantModel.predictAsync) {
          var qp = await quantModel.predictAsync(mt.home, mt.away, { neutral: true });
          if (qp && qp.winProb) {
            liveContext += '\n\nELITE EDGE QUANT MODEL (our in-house Elo + Dixon-Coles engine) — ' + mt.home + ' v ' + mt.away + ':\n' +
              '- ' + mt.home + ' win ' + qp.winProb.home + '%, Draw ' + qp.winProb.draw + '%, ' + mt.away + ' win ' + qp.winProb.away + '%\n' +
              '- Over 2.5 ' + qp.over25 + '% | BTTS ' + qp.btts + '% | most likely ' + (qp.topScorelines && qp.topScorelines[0] ? qp.topScorelines[0].score : '?') + '\n' +
              '- Model lean: ' + (qp.pick ? qp.pick.selection + ' (' + qp.pick.prob + '%, conf ' + qp.pick.confidence + '/10)' : 'n/a') + '\n' +
              'Treat these as OUR engine\'s verified numbers. If they DISAGREE with a published Our Take/pick above, say so honestly (e.g. "our published take is X, though the live model now leans Y").\n';
          }
        }
      } catch (e) { /* quant optional */ }

      // Fold in the parallel live web search (current facts/news with sources).
      try {
        var web = await webPromise;
        if (web && web.text) {
          liveContext += '\n\nLIVE WEB INTEL (current, from a real-time web search — use this for up-to-date facts, team/runner news, fitness, line-ups, current market favourite/odds. PREFER OUR OWN data above for the actual pick):\n' + web.text.substring(0, 1600) + '\n';
          webCitations = web.citations || [];
        }
      } catch (e) { /* web grounding optional */ }

      var systemPrompt = 'You are the Elite Edge assistant — the helpful AI chatbot for Elite Edge Sports Tips, the UK\'s most advanced multi-sport betting analysis platform.\n\n' +
        'ABOUT THE SERVICE:\n' +
        '- We cover 6 sports: Horse Racing, Football (18 leagues), NBA Basketball, Tennis (ATP + WTA), Rugby League (Super League + NRL), and NFL\n' +
        '- Up to 9 AI-powered tips daily across all sports\n' +
        '- Powered by 14 live data APIs + dual AI (Claude + Perplexity)\n' +
        '- Every tip includes full analysis: form, going/surface, H2H, statistical model probability, and risk assessment\n' +
        '- CLV tracking proves genuine edge over bookmakers\n' +
        '- Premium: £19.99/month or £199.99/year | VIP: £39.99/month or £399.99/year\n' +
        '- 14-day free trial available for new users\n' +
        '- Features: Value Bet Scanner, Smart Acca Generator (2-8 fold, multi-sport), Steamer Alerts, AI Race Replays, Going Forecast\n\n' +
        'HOW YOU TALK (this matters as much as what you say):\n' +
        '- You are a sharp, friendly UK tipster — plain English, British spelling, confident but never arrogant or over the top.\n' +
        '- Answer the actual question FIRST, in a sentence or two, then a brief why. Get to the point.\n' +
        '- Sound like a real person who knows their sport, not a chatbot. Banned: "I appreciate the question", "Here\'s what I can help with", "I need to be straight with you", "dual AI system", corporate waffle, and long bulleted sales pitches. No rule-of-three lists. No emoji spam.\n' +
        '- Do NOT pitch the free trial, pricing, or features unless they specifically ask about access or signing up.\n\n' +
        'ANSWERING QUESTIONS — always from OUR data below, never invent a pick or score:\n' +
        '- RACING INTEGRITY (CRITICAL): you may ONLY name a horse that explicitly appears below in a "RUNNERS —" list OR in "TODAY\'S RACE PREDICTIONS (Our Pick on every race)". NEVER name a runner from memory, training data, or web info — those will be wrong/non-existent horses and that is unacceptable. Only when BOTH are absent for the race asked about (or a RACING DATA STATUS note says we lack the card) do you decline — say plainly you can\'t pull that live card right now. Better to say "I can\'t confirm the card" than to give a single wrong runner.\n' +
        '- "Who/what wins the [time] at [course]?" → this is a PRE-RACE PREDICTION for an UPCOMING race. NEVER report a past/historical result as the answer (e.g. do not say "X won" — the race has not run). Predict it ONLY from the provided RUNNERS list / RACE PREDICTIONS. This is our edge over ChatGPT — we can see the actual declared field.\n' +
        '- JUSTIFY every selection with concrete card data — that reasoning is the whole point. For each pick cite the specifics that make it: official rating (OR), RPR, Topspeed (TS), recent form figures, days since last run, headgear, draw, going suitability, trainer & jockey 14-day strike rates, and the Racing Post "Spotlight" note where it adds something. Don\'t just name a horse — explain WHY from these numbers.\n' +
        '- Lead with the verdict, then a top-3. e.g. "**1.** Horse @ price — OR 98, RPR top of field, 2 wins from last 3, strong draw, trainer 24% last 14d." Be decisive like a tipster. If odds aren\'t in the card show "SP".\n' +
        '- For race RESULTS (a race that has already run / "who won"), THEN you may use the result from web intel.\n' +
        '- "Who wins / how many goals in [match]?" → find it in MATCH PREDICTIONS or WORLD CUP fixtures, give Our Take / predicted scoreline + confidence + why.\n' +
        '- World Cup: we HAVE the full fixture schedule synced (see below) — so you always know who plays who and when, including the opener. If our detailed prediction for that game has not generated yet, tell them the fixture and that the full breakdown lands closer to kickoff — do not claim we lack the fixtures.\n' +
        '- LIVE WEB INTEL (if present below) is current real-time info — use it for facts, news, fitness, line-ups, going changes, non-runners and the current market. Weave it in naturally; never say "according to my search". The actual pick comes from OUR card/engine. CRUCIAL: when asked who wins an UPCOMING race, do NOT let web intel make you report a finished result — predict from the card instead.\n' +
        '- If something genuinely is not in our data AND there is no web intel, say so plainly in one line and point them to the right page.\n' +
        '- ANSWER GENERAL QUESTIONS DIRECTLY (this is what users want): for "best horses today", "your NAP", "best bets", "who do you fancy" — GIVE THE ACTUAL ANSWER right here in the chat. Name our standout pick(s) from RACE PREDICTIONS / MATCH PREDICTIONS / RUNNERS above, with confidence and the reasoning we have. For a NAP, name the single highest-confidence racing pick. Lead with a clear top-3 (or top selections), each with a one-line why. Do NOT fob them off to the Racing page — answer it like a sharp tipster would. You MAY add ONE short line at the end like "full card with complete breakdowns is on the Racing/Tips page" — but only AFTER you have given a genuine, useful answer first. Never reply with only a deferral.\n\n' +
        'FORMAT — make answers feel ELITE and easy to read:\n' +
        '- Open with a one-line verdict in **bold** (the answer to their actual question).\n' +
        '- For a specific race: give the verdict, then a short top-3 as a list — "**1.** Horse @ odds — one-line why (form/going/draw/rating)", then a line on the key danger or pace/going angle.\n' +
        '- For a match: bold verdict (Our Take + predicted scoreline + confidence), then 2-3 short lines of reasoning (form, key men, team news from web intel).\n' +
        '- Use **bold** for selections and short bullet lists; keep paragraphs to 1-2 sentences. Detailed and confident, but never padded waffle.\n' +
        '- Never guarantee outcomes — these are statistical predictions for entertainment. 18+. If someone sounds like they are chasing losses, a quick word on gambling responsibly.' +
        liveContext;

      // Prefer Sonnet for richer answers, but fall back to the known-working Haiku
      // if that model isn't enabled on the key (so chat can never hard-fail on it).
      var preferred = process.env.AI_CHAT_MODEL || 'claude-sonnet-4-20250514';
      var fallback = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';
      var response;
      try {
        response = await aiReports.client.messages.create({
          model: (_chatModelDown && preferred !== fallback) ? fallback : preferred,
          max_tokens: 1400, system: systemPrompt, messages: [{ role: 'user', content: message }],
        });
      } catch (modelErr) {
        console.warn('[AI Chat] model "' + preferred + '" failed (' + modelErr.message + ') — falling back to ' + fallback);
        _chatModelDown = true; // remember so we go straight to the fallback next time
        response = await aiReports.client.messages.create({
          model: fallback, max_tokens: 1200, system: systemPrompt, messages: [{ role: 'user', content: message }],
        });
      }

      var reply = response.content[0].text;
      res.json({ reply: reply, sources: webCitations });

      // Log the question (demand intel + adaptive prompts) — fire-and-forget.
      try {
        if (db.query) {
          var ipHash = require('crypto').createHash('sha256').update(ip || '').digest('hex').slice(0, 16);
          db.query("INSERT INTO assistant_queries (question, answered, ip_hash) VALUES ($1, TRUE, $2)", [message.slice(0, 300), ipHash]).catch(function () {});
        }
      } catch (e) { /* non-fatal */ }
    } catch (err) {
      console.error('[AI Chat] Error:', err.message);
      res.json({ reply: 'Sorry, I couldn\'t process that right now. Please try again or contact support.' });
    }
  });

  // SPA fallback — serve index.html for client-side routing
  router.get('*', (req, res) => {
    if (req.path.startsWith('/admin')) return res.sendFile(path.join(__dirname, '..', '..', 'admin', 'index.html'));
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });

  return router;
};
