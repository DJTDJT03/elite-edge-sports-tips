module.exports = function(deps) {
  const router = require('express').Router();
  const { oddsSource, racingOddsSource, movementTracker, oddsHelpers } = deps;
  const { storeOddsSnapshot } = oddsHelpers;

  // GET /api/odds/live — Live football odds from The Odds API
  router.get('/odds/live', async (req, res) => {
    try {
      if (!oddsSource || !process.env.ODDS_API_KEY) {
        return res.json({ live: false, message: 'Odds API not configured. Set ODDS_API_KEY.', odds: [] });
      }
      var raw = await oddsSource.fetch();
      var normalised = oddsSource.normalise(raw);

      // Record snapshots for movement tracking
      if (movementTracker && normalised.length > 0) {
        normalised.forEach(function(event) {
          if (!event.bookmakerOdds) return;
          var runners = [];
          var allOutcomes = {};
          for (var bk in event.bookmakerOdds) {
            for (var outcome in event.bookmakerOdds[bk]) {
              if (!allOutcomes[outcome]) allOutcomes[outcome] = [];
              allOutcomes[outcome].push(event.bookmakerOdds[bk][outcome]);
            }
          }
          for (var name in allOutcomes) {
            var prices = allOutcomes[name];
            var avg = prices.reduce(function(s, p) { return s + p; }, 0) / prices.length;
            var best = Math.max.apply(null, prices);
            runners.push({ name: name, averagePrice: Math.round(avg * 100) / 100, bestPrice: best });
          }
          movementTracker.recordSnapshot(event.eventId, event.homeTeam + ' v ' + event.awayTeam, 'football', event.kickoff, runners);
        });
      }

      // Store snapshot via oddsHelpers
      storeOddsSnapshot(normalised);

      res.json({ live: true, odds: normalised, fetchedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/odds/racing — Live multi-bookmaker prices for UK/IRE races
  router.get('/odds/racing', async (req, res) => {
    try {
      if (!oddsSource || !process.env.ODDS_API_KEY) {
        return res.json({ live: false, message: 'Odds API not configured. Set ODDS_API_KEY.', races: [] });
      }
      var raw = await oddsSource.fetch();
      var racingData = raw.racing || [];
      var normalised = oddsSource.normaliseRacing(racingData);

      // Record snapshots for movement tracking
      if (movementTracker) {
        normalised.forEach(function(race) {
          if (race.runners && race.runners.length > 0) {
            movementTracker.recordSnapshot(race.eventId, race.eventName, 'racing', race.commenceTime, race.runners);
          }
        });
      }

      res.json({
        live: true,
        raceCount: normalised.length,
        races: normalised,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/odds/best-price — Find the best available price for any selection
  router.get('/odds/best-price', async (req, res) => {
    try {
      var selection = req.query.selection;
      var sport = req.query.sport || 'all';
      if (!selection) return res.status(400).json({ error: 'Selection name required. Use ?selection=Horse+Name' });
      if (!oddsSource || !process.env.ODDS_API_KEY) {
        return res.json({ error: 'Odds API not configured' });
      }

      var raw = await oddsSource.fetch();
      var results = [];

      // Search football odds
      if (sport === 'all' || sport === 'football') {
        var footballNorm = oddsSource.normalise(raw.football || raw);
        var fbResult = oddsSource.findBestPrice(selection, footballNorm);
        if (fbResult) results.push(Object.assign({ sport: 'football' }, fbResult));
      }

      // Search racing odds
      if (sport === 'all' || sport === 'racing') {
        var racingNorm = oddsSource.normaliseRacing(raw.racing || []);
        var rcResult = oddsSource.findBestPrice(selection, racingNorm);
        if (rcResult) results.push(Object.assign({ sport: 'racing' }, rcResult));
      }

      if (results.length === 0) {
        return res.json({ found: false, message: 'No prices found for "' + selection + '"', selection: selection });
      }

      // Return the best result
      var best = results.sort(function(a, b) { return (b.bestPrice || 0) - (a.bestPrice || 0); })[0];
      res.json({
        found: true,
        selection: selection,
        bestPrice: best.bestPrice,
        bestBookmaker: best.bestBookmaker,
        averagePrice: best.averagePrice,
        edgeVsAverage: best.edgeVsAverage + '%',
        bookmakerCount: best.bookmakerCount,
        allPrices: best.allPrices,
        sport: best.sport,
        event: best.event,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/odds/market-movers — Steamers and drifters
  router.get('/odds/market-movers', async (req, res) => {
    try {
      if (!movementTracker) {
        return res.json({ message: 'Movement tracker not available', steamers: [], drifters: [] });
      }
      res.json({
        steamers: movementTracker.marketMovers.steamers,
        drifters: movementTracker.marketMovers.drifters,
        totalTracked: movementTracker.marketMovers.totalTracked || 0,
        activeAlerts: movementTracker.activeAlerts.length,
        alerts: movementTracker.activeAlerts.slice(0, 20),
        updatedAt: movementTracker.marketMovers.updatedAt,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/odds/movement/:eventId — Price movement history for an event
  router.get('/odds/movement/:eventId', async (req, res) => {
    try {
      if (!movementTracker) {
        return res.json({ error: 'Movement tracker not available' });
      }
      var history = movementTracker.getEventHistory(req.params.eventId);
      if (!history) {
        return res.json({ found: false, message: 'No movement data for this event' });
      }
      res.json({ found: true, ...history });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/odds/runner-movement — Track a specific horse or team across events
  router.get('/odds/runner-movement', async (req, res) => {
    try {
      var runner = req.query.runner;
      if (!runner) return res.status(400).json({ error: 'Runner name required. Use ?runner=Horse+Name' });
      if (!movementTracker) {
        return res.json({ error: 'Movement tracker not available' });
      }
      var movements = movementTracker.getRunnerMovement(runner);
      res.json({
        runner: runner,
        found: movements.length > 0,
        events: movements,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/odds/football-intelligence — Full analysis for a fixture
  router.get('/odds/football-intelligence', async (req, res) => {
    try {
      var home = req.query.home;
      var away = req.query.away;
      if (!home) return res.status(400).json({ error: 'Home team required. Use ?home=Arsenal&away=Chelsea' });
      if (!oddsSource || !process.env.ODDS_API_KEY) {
        return res.json({ error: 'Odds API not configured' });
      }

      var raw = await oddsSource.fetch();
      var normalised = oddsSource.normalise(raw.football || raw);
      var intelligence = oddsSource.getFootballIntelligence(home, away, normalised);

      if (!intelligence) {
        return res.json({ found: false, message: 'No odds data found for ' + home + (away ? ' v ' + away : '') });
      }

      // Add movement data if available
      if (movementTracker) {
        var eventKey = (intelligence.homeTeam + ' v ' + intelligence.awayTeam).toLowerCase();
        for (var outcomeName in intelligence.outcomes) {
          var runnerMovements = movementTracker.getRunnerMovement(outcomeName);
          if (runnerMovements.length > 0) {
            intelligence.outcomes[outcomeName].movement = runnerMovements[0].movement;
          }
        }
      }

      res.json({ found: true, ...intelligence, fetchedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/odds/value-bets — Selections where best price beats market average
  router.get('/odds/value-bets', async (req, res) => {
    try {
      if (!oddsSource || !process.env.ODDS_API_KEY) {
        return res.json({ error: 'Odds API not configured', valueBets: [] });
      }

      var raw = await oddsSource.fetch();
      var valueBets = [];
      var minEdge = parseFloat(req.query.minEdge) || 5;

      // Scan football odds for value
      var footballNorm = oddsSource.normalise(raw.football || raw);
      footballNorm.forEach(function(event) {
        if (!event.bookmakerOdds) return;
        var allOutcomes = {};
        for (var bk in event.bookmakerOdds) {
          for (var outcome in event.bookmakerOdds[bk]) {
            if (!allOutcomes[outcome]) allOutcomes[outcome] = { prices: [], best: 0, bestBk: '' };
            var price = event.bookmakerOdds[bk][outcome];
            allOutcomes[outcome].prices.push(price);
            if (price > allOutcomes[outcome].best) {
              allOutcomes[outcome].best = price;
              allOutcomes[outcome].bestBk = bk;
            }
          }
        }
        for (var name in allOutcomes) {
          var o = allOutcomes[name];
          if (o.prices.length < 3) continue;
          var avg = o.prices.reduce(function(s, p) { return s + p; }, 0) / o.prices.length;
          var edge = ((o.best - avg) / avg) * 100;
          if (edge >= minEdge) {
            valueBets.push({
              sport: 'football',
              event: event.homeTeam + ' v ' + event.awayTeam,
              kickoff: event.kickoff,
              selection: name,
              bestPrice: Math.round(o.best * 100) / 100,
              bestBookmaker: o.bestBk,
              averagePrice: Math.round(avg * 100) / 100,
              edge: Math.round(edge * 10) / 10,
              bookmakerCount: o.prices.length,
            });
          }
        }
      });

      // Scan racing odds for value
      var racingNorm = oddsSource.normaliseRacing(raw.racing || []);
      racingNorm.forEach(function(race) {
        (race.runners || []).forEach(function(runner) {
          if (runner.bookmakerCount < 3) return;
          var edge = runner.averagePrice > 0 ? ((runner.bestPrice - runner.averagePrice) / runner.averagePrice) * 100 : 0;
          if (edge >= minEdge) {
            valueBets.push({
              sport: 'racing',
              event: race.eventName,
              raceTime: race.commenceTime,
              selection: runner.name,
              bestPrice: runner.bestPrice,
              bestBookmaker: runner.bestBookmaker,
              averagePrice: runner.averagePrice,
              edge: Math.round(edge * 10) / 10,
              bookmakerCount: runner.bookmakerCount,
              marketRank: runner.marketRank,
            });
          }
        });
      });

      // Sort by edge (biggest value first)
      valueBets.sort(function(a, b) { return b.edge - a.edge; });

      res.json({
        valueBets: valueBets.slice(0, 30),
        totalFound: valueBets.length,
        minEdge: minEdge + '%',
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/odds/active-sports — Check which markets are live right now
  router.get('/odds/active-sports', async (req, res) => {
    try {
      if (!oddsSource || !process.env.ODDS_API_KEY) {
        return res.json({ error: 'Odds API not configured', sports: [] });
      }
      var sports = await oddsSource.fetchActiveSports();
      res.json({
        sports: sports,
        totalActive: sports.length,
        hasRacing: sports.some(function(s) { return s.key && s.key.indexOf('horse_racing') !== -1; }),
        hasFootball: sports.some(function(s) { return s.key && s.key.indexOf('soccer') !== -1; }),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
