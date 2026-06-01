/**
 * Marketing Engine Routes — Standalone Event Branch
 *
 * All routes under /api/marketing/*.
 * Feature-flagged via ENABLE_MARKETING env var.
 * Fully isolated — reads from core APIs, writes to own tables only.
 */

module.exports = function(deps) {
  var router = require('express').Router();
  var authenticate = deps.authenticate;
  var MarketingEngine = require('../services/marketingEngine');
  var engine = new MarketingEngine(deps);

  // Store engine on deps so settlement can call postResultContent
  deps.marketingEngine = engine;

  // GET /api/marketing/status — engine status
  router.get('/status', function(req, res) {
    res.json({
      enabled: true,
      event: engine.event ? { id: engine.event.id, name: engine.event.name, start: engine.event.startDate, end: engine.event.endDate } : null,
    });
  });

  // POST /api/marketing/generate — trigger daily content pack generation
  router.post('/generate', authenticate, async function(req, res) {
    try {
      var user = req.user;
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      var result = await engine.generateDailyPack();
      res.json({ ok: true, ...result });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/marketing/generate/:fixtureId — generate content for a specific fixture
  router.post('/generate/:fixtureId', authenticate, async function(req, res) {
    try {
      var user = req.user;
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

      var sportMonks = deps.sportMonks;
      if (!sportMonks || !sportMonks.isAvailable()) return res.status(503).json({ error: 'SportMonks not available' });

      var fixture = await sportMonks.getFixture(req.params.fixtureId);
      if (!fixture) return res.status(404).json({ error: 'Fixture not found' });

      var content = await engine.generateContentPack(fixture);
      res.json({ ok: true, content: content });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/marketing/today — get today's generated content for review
  router.get('/today', authenticate, async function(req, res) {
    try {
      var content = await engine.getTodayContent();
      res.json({ content: content, count: content.length });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/marketing/post/:fixtureId — approve and post content to Telegram
  router.post('/post/:fixtureId', authenticate, async function(req, res) {
    try {
      var user = req.user;
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

      var pack = await engine._getContentPack(req.params.fixtureId);
      if (!pack) return res.status(404).json({ error: 'No content pack found for this fixture' });

      var platform = req.body.platform || 'telegram';
      var channel = req.body.channel || 'public';

      if (platform === 'telegram' && deps.telegramBot && deps.telegramBot.isAvailable()) {
        var text = pack.platforms && pack.platforms.telegram ? pack.platforms.telegram[channel] : null;
        if (!text) return res.status(400).json({ error: 'No Telegram ' + channel + ' content in this pack' });
        await deps.telegramBot.sendMessage(text);
        await engine._logPost({ id: req.params.fixtureId }, 'manual_' + channel, { platform: 'telegram', channel: channel, text: text });
        res.json({ ok: true, posted: 'telegram_' + channel });
      } else {
        res.status(400).json({ error: 'Platform not supported or not configured' });
      }
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/marketing/classify — classify today's fixtures by tier
  router.get('/classify', async function(req, res) {
    try {
      var sportMonks = deps.sportMonks;
      if (!sportMonks || !sportMonks.isAvailable()) return res.json({ fixtures: [] });

      var date = req.query.date || new Date().toISOString().split('T')[0];
      var fixtures = await sportMonks.getFixturesByDate(date);

      var classified = fixtures.map(function(f) {
        var c = engine.classifyFixture(f);
        return { id: f.id, homeTeam: f.homeTeam, awayTeam: f.awayTeam, league: f.league, kickoff: f.kickoff, tier: c.tier, tierReason: c.reason };
      });

      // Sort hero first
      classified.sort(function(a, b) {
        var order = { hero: 0, hub: 1, hygiene: 2 };
        return (order[a.tier] || 2) - (order[b.tier] || 2);
      });

      res.json({
        date: date,
        total: classified.length,
        hero: classified.filter(function(f) { return f.tier === 'hero'; }).length,
        hub: classified.filter(function(f) { return f.tier === 'hub'; }).length,
        hygiene: classified.filter(function(f) { return f.tier === 'hygiene'; }).length,
        fixtures: classified,
      });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
