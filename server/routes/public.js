module.exports = function(deps) {
  const router = require('express').Router();
  const path = require('path');
  const { db, racingSource, footballSource, oddsSource, racingOddsSource, movementTracker, dataIngestion, aiReports, newsService } = deps;

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
        racing: { connected: !!(racingSource && process.env.RACING_API_KEY) },
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

  // POST /api/chat/ai — AI-powered chatbot using Claude with live data context
  router.post('/api/chat/ai', async (req, res) => {
    try {
      var message = (req.body && req.body.message) || '';
      if (!message.trim()) {
        return res.status(400).json({ reply: 'Please send a message.' });
      }

      if (!aiReports || !aiReports.isAvailable() || !aiReports.client) {
        return res.status(503).json({ reply: 'AI chat is temporarily unavailable. Please try again later.' });
      }

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

        // World Cup predictions (predicted scorelines + verdicts)
        try {
          if (process.env.ENABLE_WORLD_CUP === 'true' && db.query) {
            var wcp = await db.query("SELECT home_team, away_team, predicted_scoreline, verdict_selection, verdict, confidence FROM world_cup_previews WHERE kickoff >= NOW() - INTERVAL '6 hours' ORDER BY kickoff ASC LIMIT 30");
            if (wcp.rows && wcp.rows.length) {
              liveContext += '\nWORLD CUP PREDICTIONS:\n';
              wcp.rows.forEach(function(p) {
                liveContext += '- ' + p.home_team + ' v ' + p.away_team + ' — Predicted score: ' + (p.predicted_scoreline || '?') +
                  ', Our Pick: ' + (p.verdict_selection || p.verdict || 'TBC') + ' (confidence ' + (p.confidence || '?') + '/10)\n';
              });
            }
          }
        } catch (e) {}
      } catch (ctxErr) {
        // Non-fatal — chatbot works without live context
      }

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
        'ANSWERING MATCH & RACE QUESTIONS (this is your most important job):\n' +
        '- When asked "who wins the [time] at [course]" or about a specific race, find it in TODAY\'S RACE PREDICTIONS and give Our Pick, the confidence, and a brief reason.\n' +
        '- When asked "who wins" or "how many goals" for a football match, find it in TODAY\'S MATCH PREDICTIONS or WORLD CUP PREDICTIONS and give Our Take / predicted scoreline, confidence and the reasoning.\n' +
        '- Always answer from OUR data below — these are the engine\'s own predictions. Never invent a selection or scoreline. If a specific race/match is not in the data, say we have not published a prediction for it yet and point them to the relevant page.\n' +
        '- Give a clear, DETAILED answer for specific questions: state the pick/prediction, the confidence, and the key reasoning behind it — like an expert tipster explaining their call at the track.\n\n' +
        'RULES:\n' +
        '- British English. Confident but never arrogant. Never guarantee outcomes or give financial advice — these are statistical predictions for entertainment.\n' +
        '- For general questions about today\'s tips/results, reference the data below.\n' +
        '- Detailed answers welcome (up to ~300 words) but stay focused and useful — punters want a straight, well-reasoned answer.\n' +
        '- 18+. Always responsible: if someone seems to be chasing losses, gently encourage responsible play.' +
        liveContext;

      var response = await aiReports.client.messages.create({
        model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      });

      var reply = response.content[0].text;
      res.json({ reply: reply });
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
