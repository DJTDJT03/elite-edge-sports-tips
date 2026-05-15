/**
 * Elite Edge Sports Tips — World Cup Mode
 *
 * Fully isolated module. All routes under /api/world-cup/*.
 * Feature-flagged via ENABLE_WORLD_CUP env var.
 * Removable: delete this file + drop world_cup_* tables.
 */

module.exports = function(deps) {
  var router = require('express').Router();
  var db = deps.db;
  var authenticate = deps.authenticate;
  var requireAdmin = deps.requireAdmin;

  // Age gate middleware — blocks under-18 and self-excluded users
  function ageGate(req, res, next) {
    // If user is authenticated, check age/exclusion status
    if (req.user) {
      if (req.user.selfExcluded || req.user.coolOffUntil) {
        return res.status(403).json({ error: 'World Cup Mode is unavailable during self-exclusion.' });
      }
    }
    next();
  }

  // Helper: query world cup tables
  async function wcQuery(sql, params) {
    if (!db.isAvailable || !db.isAvailable()) return { rows: [] };
    return db.query(sql, params || []);
  }

  // =========================================================================
  // PUBLIC — no auth required
  // =========================================================================

  // GET /api/world-cup/tournament — current tournament info
  router.get('/tournament', async function(req, res) {
    try {
      var { rows } = await wcQuery('SELECT * FROM world_cup_tournaments ORDER BY year DESC LIMIT 1');
      if (rows.length === 0) return res.json({ tournament: null });
      var t = rows[0];
      res.json({
        tournament: {
          id: t.id, name: t.name, year: t.year,
          startDate: t.start_date, endDate: t.end_date,
          status: t.status, config: t.config || {},
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch tournament' });
    }
  });

  // GET /api/world-cup/groups — all group standings
  router.get('/groups', async function(req, res) {
    try {
      var { rows } = await wcQuery(
        'SELECT g.*, t.name as tournament_name FROM world_cup_groups g JOIN world_cup_tournaments t ON g.tournament_id = t.id ORDER BY g.group_letter'
      );
      res.json({
        groups: rows.map(function(r) {
          return { letter: r.group_letter, standings: r.standings || [], tournamentId: r.tournament_id };
        })
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch groups' });
    }
  });

  // GET /api/world-cup/groups/:letter — single group
  router.get('/groups/:letter', async function(req, res) {
    try {
      var { rows } = await wcQuery(
        'SELECT * FROM world_cup_groups WHERE UPPER(group_letter) = $1 ORDER BY tournament_id DESC LIMIT 1',
        [req.params.letter.toUpperCase()]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
      res.json({ group: { letter: rows[0].group_letter, standings: rows[0].standings || [] } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch group' });
    }
  });

  // GET /api/world-cup/fixtures — all fixtures (filter by stage, date, team)
  router.get('/fixtures', async function(req, res) {
    try {
      var sql = 'SELECT * FROM world_cup_fixtures WHERE 1=1';
      var params = [];
      var idx = 1;
      if (req.query.stage) { sql += ' AND stage = $' + idx; params.push(req.query.stage); idx++; }
      if (req.query.date) { sql += ' AND kickoff::date = $' + idx; params.push(req.query.date); idx++; }
      if (req.query.team) { sql += ' AND (LOWER(home_team) LIKE $' + idx + ' OR LOWER(away_team) LIKE $' + idx + ')'; params.push('%' + req.query.team.toLowerCase() + '%'); idx++; }
      if (req.query.status) { sql += ' AND status = $' + idx; params.push(req.query.status); idx++; }
      sql += ' ORDER BY kickoff ASC';
      var { rows } = await wcQuery(sql, params);
      res.json({
        fixtures: rows.map(function(f) {
          return {
            id: f.id, stage: f.stage, groupLetter: f.group_letter,
            homeTeam: f.home_team, awayTeam: f.away_team,
            kickoff: f.kickoff, venue: f.venue,
            homeGoals: f.home_goals, awayGoals: f.away_goals,
            result: f.result, status: f.status, stats: f.stats || {},
            externalFixtureId: f.external_fixture_id,
          };
        })
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch fixtures' });
    }
  });

  // GET /api/world-cup/fixtures/:id — single fixture detail
  router.get('/fixtures/:id', async function(req, res) {
    try {
      var { rows } = await wcQuery('SELECT * FROM world_cup_fixtures WHERE id = $1', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Fixture not found' });
      var f = rows[0];
      res.json({
        fixture: {
          id: f.id, stage: f.stage, groupLetter: f.group_letter,
          homeTeam: f.home_team, awayTeam: f.away_team,
          kickoff: f.kickoff, venue: f.venue,
          homeGoals: f.home_goals, awayGoals: f.away_goals,
          result: f.result, status: f.status, stats: f.stats || {},
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch fixture' });
    }
  });

  // GET /api/world-cup/bracket — knockout bracket
  router.get('/bracket', async function(req, res) {
    try {
      var { rows } = await wcQuery(
        "SELECT * FROM world_cup_fixtures WHERE stage != 'group' ORDER BY kickoff ASC"
      );
      var bracket = {};
      rows.forEach(function(f) {
        if (!bracket[f.stage]) bracket[f.stage] = [];
        bracket[f.stage].push({
          id: f.id, homeTeam: f.home_team, awayTeam: f.away_team,
          homeGoals: f.home_goals, awayGoals: f.away_goals,
          kickoff: f.kickoff, status: f.status, result: f.result,
        });
      });
      res.json({ bracket: bracket });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch bracket' });
    }
  });

  // =========================================================================
  // PREDICTIONS — authenticated
  // =========================================================================

  // POST /api/world-cup/predictions — submit a prediction
  router.post('/predictions', authenticate, ageGate, async function(req, res) {
    try {
      var { fixtureId, predictedHome, predictedAway, firstGoalscorer, predictedCards, predictedCorners } = req.body;
      if (!fixtureId || predictedHome === undefined || predictedAway === undefined) {
        return res.status(400).json({ error: 'fixtureId, predictedHome, predictedAway required' });
      }

      // Check fixture exists and hasn't started
      var { rows: fx } = await wcQuery('SELECT * FROM world_cup_fixtures WHERE id = $1', [fixtureId]);
      if (fx.length === 0) return res.status(404).json({ error: 'Fixture not found' });
      if (fx[0].status !== 'scheduled') return res.status(400).json({ error: 'Match has already started' });

      // Credit check for non-premium users
      var user = req.user;
      if (user.subscription !== 'vip' && user.subscription !== 'premium' && user.role !== 'admin') {
        if (!user.credits || user.credits < 1) {
          return res.status(402).json({ error: 'Insufficient credits. Predictions cost 1 credit.', creditsRequired: true });
        }
        await db.deductCredits(user.id, 1, 'wc_prediction', 'World Cup prediction: fixture ' + fixtureId);
      }

      var { rows } = await wcQuery(
        `INSERT INTO world_cup_predictions (user_id, fixture_id, predicted_home, predicted_away, first_goalscorer, predicted_cards, predicted_corners)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, fixture_id) DO UPDATE SET predicted_home = $3, predicted_away = $4, first_goalscorer = $5, predicted_cards = $6, predicted_corners = $7
         RETURNING *`,
        [user.id, fixtureId, predictedHome, predictedAway, firstGoalscorer || null, predictedCards || null, predictedCorners || null]
      );

      res.json({ prediction: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit prediction' });
    }
  });

  // GET /api/world-cup/predictions/mine — user's predictions
  router.get('/predictions/mine', authenticate, async function(req, res) {
    try {
      var { rows } = await wcQuery(
        `SELECT p.*, f.home_team, f.away_team, f.kickoff, f.home_goals, f.away_goals, f.status as match_status, f.stage
         FROM world_cup_predictions p
         JOIN world_cup_fixtures f ON p.fixture_id = f.id
         WHERE p.user_id = $1 ORDER BY f.kickoff DESC`,
        [req.user.id]
      );
      res.json({ predictions: rows });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch predictions' });
    }
  });

  // GET /api/world-cup/predictions/leaderboard
  router.get('/predictions/leaderboard', async function(req, res) {
    try {
      var { rows } = await wcQuery(`
        SELECT p.user_id, u.name,
          COUNT(*) as total_predictions,
          SUM(p.points) as total_points,
          COUNT(*) FILTER (WHERE p.points = 3) as exact_scores,
          COUNT(*) FILTER (WHERE p.points = 1) as correct_results
        FROM world_cup_predictions p
        JOIN users u ON p.user_id = u.id
        WHERE p.scored = true
        GROUP BY p.user_id, u.name
        ORDER BY total_points DESC
        LIMIT 50
      `);
      res.json({
        leaderboard: rows.map(function(r, i) {
          var nameParts = (r.name || 'User').split(' ');
          return {
            rank: i + 1,
            name: nameParts[0] + (nameParts.length > 1 ? ' ' + nameParts[1].charAt(0) + '.' : ''),
            totalPoints: parseInt(r.total_points) || 0,
            totalPredictions: parseInt(r.total_predictions) || 0,
            exactScores: parseInt(r.exact_scores) || 0,
            correctResults: parseInt(r.correct_results) || 0,
          };
        })
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  });

  // =========================================================================
  // NATION WARS — pick your country
  // =========================================================================

  // POST /api/world-cup/nation — pledge allegiance
  router.post('/nation', authenticate, async function(req, res) {
    try {
      var { country } = req.body;
      if (!country) return res.status(400).json({ error: 'Country required' });
      await wcQuery(
        `INSERT INTO world_cup_nations (user_id, country) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET country = $2`,
        [req.user.id, country]
      );
      res.json({ ok: true, country: country });
    } catch (err) {
      res.status(500).json({ error: 'Failed to set nation' });
    }
  });

  // GET /api/world-cup/nation/rankings — nation fan rankings
  router.get('/nation/rankings', async function(req, res) {
    try {
      var { rows } = await wcQuery(`
        SELECT n.country, COUNT(*) as fans,
          COALESCE(SUM(p.points), 0) as total_points
        FROM world_cup_nations n
        LEFT JOIN world_cup_predictions p ON n.user_id = p.user_id AND p.scored = true
        GROUP BY n.country
        ORDER BY total_points DESC, fans DESC
      `);
      res.json({ rankings: rows });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch nation rankings' });
    }
  });

  // =========================================================================
  // ADMIN — tournament management
  // =========================================================================

  // POST /api/world-cup/admin/tournament — create/update tournament
  router.post('/admin/tournament', authenticate, requireAdmin, async function(req, res) {
    try {
      var { name, year, startDate, endDate, status, config } = req.body;
      var { rows } = await wcQuery(
        `INSERT INTO world_cup_tournaments (name, year, start_date, end_date, status, config)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (year) DO UPDATE SET name = $1, start_date = $3, end_date = $4, status = $5, config = $6
         RETURNING *`,
        [name, year, startDate, endDate, status || 'upcoming', JSON.stringify(config || {})]
      );
      res.json({ tournament: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save tournament: ' + err.message });
    }
  });

  // POST /api/world-cup/admin/sync — force fixture sync from API-Football
  router.post('/admin/sync', authenticate, requireAdmin, async function(req, res) {
    try {
      var worldCupData = deps.worldCupData;
      if (!worldCupData) return res.status(503).json({ error: 'World Cup data service not available' });
      var result = await worldCupData.syncFixtures();
      res.json({ ok: true, synced: result });
    } catch (err) {
      res.status(500).json({ error: 'Sync failed: ' + err.message });
    }
  });

  return router;
};
