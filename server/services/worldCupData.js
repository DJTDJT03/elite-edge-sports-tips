/**
 * World Cup Data Service
 *
 * Syncs fixtures, groups, and results from API-Football.
 * Feature-flagged: only loaded when ENABLE_WORLD_CUP=true.
 * Removable: delete this file + worldCup.js route + drop world_cup_* tables.
 */

module.exports = function(deps) {
  var db = deps.db;
  var FOOTBALL_API_KEY = process.env.API_FOOTBALL_KEY || process.env.FOOTBALL_API_KEY;
  var WORLD_CUP_LEAGUE_ID = process.env.WORLD_CUP_LEAGUE_ID || '1'; // API-Football league ID for FIFA World Cup
  var WORLD_CUP_SEASON = process.env.WORLD_CUP_SEASON || '2026';

  async function apiFetch(endpoint) {
    if (!FOOTBALL_API_KEY) {
      console.warn('[WorldCup] No FOOTBALL_API_KEY set — cannot sync');
      return null;
    }
    try {
      var https = require('https');
      return new Promise(function(resolve, reject) {
        var options = {
          hostname: 'v3.football.api-sports.io',
          path: endpoint,
          method: 'GET',
          headers: {
            'x-apisports-key': FOOTBALL_API_KEY,
          },
        };
        var req = https.request(options, function(res) {
          var body = '';
          res.on('data', function(chunk) { body += chunk; });
          res.on('end', function() {
            try {
              var data = JSON.parse(body);
              resolve(data);
            } catch(e) {
              reject(new Error('Failed to parse API response'));
            }
          });
        });
        req.on('error', reject);
        req.setTimeout(15000, function() { req.destroy(); reject(new Error('API timeout')); });
        req.end();
      });
    } catch(err) {
      console.error('[WorldCup] API fetch error:', err.message);
      return null;
    }
  }

  async function syncFixtures() {
    if (!db.isAvailable || !db.isAvailable()) return { error: 'Database not available' };

    var synced = { fixtures: 0, groups: 0 };

    // 1. Ensure tournament record exists
    var { rows: tournaments } = await db.query(
      'SELECT * FROM world_cup_tournaments WHERE year = $1',
      [parseInt(WORLD_CUP_SEASON)]
    );
    var tournamentId;
    if (tournaments.length === 0) {
      var { rows: newT } = await db.query(
        "INSERT INTO world_cup_tournaments (name, year, status) VALUES ($1, $2, 'upcoming') RETURNING id",
        ['FIFA World Cup ' + WORLD_CUP_SEASON, parseInt(WORLD_CUP_SEASON)]
      );
      tournamentId = newT[0].id;
    } else {
      tournamentId = tournaments[0].id;
    }

    // 2. Fetch fixtures from API-Football
    var fixturesData = await apiFetch('/fixtures?league=' + WORLD_CUP_LEAGUE_ID + '&season=' + WORLD_CUP_SEASON);
    if (fixturesData && fixturesData.response) {
      for (var i = 0; i < fixturesData.response.length; i++) {
        var match = fixturesData.response[i];
        var fixture = match.fixture;
        var teams = match.teams;
        var goals = match.goals;
        var league = match.league;

        // Map API status to our status
        var status = 'scheduled';
        if (['1H', '2H', 'HT', 'ET', 'P', 'BT'].indexOf(fixture.status && fixture.status.short) !== -1) status = 'live';
        else if (['FT', 'AET', 'PEN'].indexOf(fixture.status && fixture.status.short) !== -1) status = 'finished';
        else if (['PST', 'CANC', 'ABD'].indexOf(fixture.status && fixture.status.short) !== -1) status = 'postponed';

        // Determine stage
        var stage = (league.round || '').toLowerCase();
        if (stage.indexOf('group') !== -1) stage = 'group';
        else if (stage.indexOf('16') !== -1) stage = 'round-of-16';
        else if (stage.indexOf('quarter') !== -1) stage = 'quarter-final';
        else if (stage.indexOf('semi') !== -1) stage = 'semi-final';
        else if (stage.indexOf('3rd') !== -1 || stage.indexOf('third') !== -1) stage = 'third-place';
        else if (stage.indexOf('final') !== -1) stage = 'final';

        // Extract group letter
        var groupLetter = null;
        var groupMatch = (league.round || '').match(/Group\s+([A-L])/i);
        if (groupMatch) groupLetter = groupMatch[1].toUpperCase();

        // Determine result
        var result = null;
        if (status === 'finished' && goals.home !== null && goals.away !== null) {
          if (goals.home > goals.away) result = 'home';
          else if (goals.away > goals.home) result = 'away';
          else result = 'draw';
        }

        await db.query(
          `INSERT INTO world_cup_fixtures (tournament_id, stage, group_letter, home_team, away_team, kickoff, venue, home_goals, away_goals, result, status, external_fixture_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (external_fixture_id) DO UPDATE SET home_goals = $8, away_goals = $9, result = $10, status = $11, stage = $2, kickoff = $6`,
          [
            tournamentId, stage, groupLetter,
            teams.home.name, teams.away.name,
            fixture.date, fixture.venue ? fixture.venue.name : null,
            goals.home, goals.away, result, status,
            fixture.id,
          ]
        );
        synced.fixtures++;
      }
    }

    // 3. Fetch standings/groups
    var standingsData = await apiFetch('/standings?league=' + WORLD_CUP_LEAGUE_ID + '&season=' + WORLD_CUP_SEASON);
    if (standingsData && standingsData.response && standingsData.response.length > 0) {
      var standings = standingsData.response[0].league.standings;
      // standings is an array of groups, each group is an array of team standings
      for (var g = 0; g < standings.length; g++) {
        var group = standings[g];
        if (!group || group.length === 0) continue;
        var letter = (group[0].group || '').replace(/Group\s*/i, '').charAt(0).toUpperCase();
        if (!letter) continue;

        var groupStandings = group.map(function(t) {
          return {
            team: t.team.name,
            logo: t.team.logo,
            played: t.all.played,
            won: t.all.win,
            drawn: t.all.draw,
            lost: t.all.lose,
            goalsFor: t.all.goals.for,
            goalsAgainst: t.all.goals.against,
            goalDifference: t.goalsDiff,
            points: t.points,
            rank: t.rank,
          };
        });

        await db.query(
          `INSERT INTO world_cup_groups (tournament_id, group_letter, standings)
           VALUES ($1, $2, $3)
           ON CONFLICT (tournament_id, group_letter) DO UPDATE SET standings = $3`,
          [tournamentId, letter, JSON.stringify(groupStandings)]
        );
        synced.groups++;
      }
    }

    console.log('[WorldCup] Sync complete — ' + synced.fixtures + ' fixtures, ' + synced.groups + ' groups');
    return synced;
  }

  // Score predictions after a fixture finishes
  async function scorePredictions(fixtureId) {
    if (!db.isAvailable || !db.isAvailable()) return;

    var { rows: fixtures } = await db.query(
      'SELECT * FROM world_cup_fixtures WHERE id = $1 AND status = $2',
      [fixtureId, 'finished']
    );
    if (fixtures.length === 0) return;
    var f = fixtures[0];

    var { rows: predictions } = await db.query(
      'SELECT * FROM world_cup_predictions WHERE fixture_id = $1 AND scored = false',
      [fixtureId]
    );

    for (var i = 0; i < predictions.length; i++) {
      var p = predictions[i];
      var points = 0;

      // Exact score = 3 points
      if (p.predicted_home === f.home_goals && p.predicted_away === f.away_goals) {
        points = 3;
      }
      // Correct result = 1 point
      else {
        var predictedResult = p.predicted_home > p.predicted_away ? 'home' :
                              p.predicted_away > p.predicted_home ? 'away' : 'draw';
        if (predictedResult === f.result) points = 1;
      }

      await db.query(
        'UPDATE world_cup_predictions SET points = $1, scored = true WHERE id = $2',
        [points, p.id]
      );
    }
  }

  // =========================================================================
  // WORLD CUP PREVIEWS — Deep AI analysis 48 hours before kickoff
  // =========================================================================

  async function generatePreviews() {
    if (!db.isAvailable || !db.isAvailable()) return { generated: 0 };
    var perplexityClient = deps.perplexityClient;
    var prompts = require('./perplexity/prompts');
    if (!perplexityClient || !prompts.buildWorldCupPreviewPrompt) {
      console.log('[WorldCup] Perplexity client not available — skipping previews');
      return { generated: 0 };
    }

    // Find fixtures within the next 48 hours that don't have previews yet
    var { rows: upcoming } = await db.query(
      `SELECT f.* FROM world_cup_fixtures f
       LEFT JOIN world_cup_previews p ON f.id = p.fixture_id
       WHERE f.status = 'scheduled'
         AND f.kickoff IS NOT NULL
         AND f.kickoff > NOW()
         AND f.kickoff <= NOW() + INTERVAL '48 hours'
         AND p.id IS NULL
       ORDER BY f.kickoff ASC
       LIMIT 6`
    );

    if (upcoming.length === 0) {
      console.log('[WorldCup] No fixtures need previews right now');
      return { generated: 0 };
    }

    var generated = 0;
    for (var i = 0; i < upcoming.length; i++) {
      var fixture = upcoming[i];
      try {
        var prompt = prompts.buildWorldCupPreviewPrompt(fixture);

        // Call Perplexity Sonar directly
        var enrichResult = null;
        if (perplexityClient.enrichTip) {
          // Use enrichTip with a fake scored object
          enrichResult = await perplexityClient.enrichTip({
            scored: { fixture: { homeTeam: fixture.home_team, awayTeam: fixture.away_team, league: 'FIFA World Cup 2026', kickoff: fixture.kickoff, venue: fixture.venue }, selectedMarket: 'Match Result', selectedSelection: 'TBC' },
            sport: 'football',
            tipId: 'wc_preview_' + fixture.id,
            analyst: 'worldcup',
            _customPrompt: prompt,
          });
        }

        var signals = {};
        var citations = [];
        var predicted = null;
        var verdict = null;
        var verdictMarket = null;
        var verdictSelection = null;
        var verdictOdds = null;
        var confidence = 7;

        if (enrichResult && enrichResult.signals) {
          signals = enrichResult.signals;
          citations = enrichResult.citations || [];
          if (signals.predicted_scoreline && signals.predicted_scoreline.value) {
            predicted = signals.predicted_scoreline.value;
          }
          if (signals.elite_edge_verdict && signals.elite_edge_verdict.value) {
            verdict = signals.elite_edge_verdict.value;
            // Try to parse market/selection from verdict
            var v = verdict.toLowerCase();
            if (v.indexOf('over') !== -1 && v.indexOf('2.5') !== -1) { verdictMarket = 'Over 2.5 Goals'; verdictSelection = 'Over 2.5'; }
            else if (v.indexOf('btts') !== -1 || v.indexOf('both teams') !== -1) { verdictMarket = 'Both Teams to Score'; verdictSelection = 'BTTS - Yes'; }
            else if (v.indexOf('under') !== -1 && v.indexOf('2.5') !== -1) { verdictMarket = 'Under 2.5 Goals'; verdictSelection = 'Under 2.5'; }
            else if (v.indexOf(fixture.home_team.toLowerCase()) !== -1 && v.indexOf('win') !== -1) { verdictMarket = 'Match Result'; verdictSelection = fixture.home_team + ' Win'; }
            else if (v.indexOf(fixture.away_team.toLowerCase()) !== -1 && v.indexOf('win') !== -1) { verdictMarket = 'Match Result'; verdictSelection = fixture.away_team + ' Win'; }
            else if (v.indexOf('draw') !== -1) { verdictMarket = 'Match Result'; verdictSelection = 'Draw'; }
            // Extract odds if mentioned
            var oddsMatch = verdict.match(/(\d+\/\d+|\d+\.\d+)/);
            if (oddsMatch) verdictOdds = oddsMatch[1];
          }
        }

        await db.query(
          `INSERT INTO world_cup_previews (fixture_id, stage, home_team, away_team, kickoff, venue, signals, citations, predicted_scoreline, verdict, verdict_market, verdict_selection, verdict_odds, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (fixture_id) DO UPDATE SET signals = $7, citations = $8, predicted_scoreline = $9, verdict = $10, verdict_market = $11, verdict_selection = $12, verdict_odds = $13, confidence = $14, generated_at = NOW()`,
          [fixture.id, fixture.stage, fixture.home_team, fixture.away_team, fixture.kickoff, fixture.venue,
           JSON.stringify(signals), JSON.stringify(citations), predicted, verdict, verdictMarket, verdictSelection, verdictOdds, confidence]
        );
        generated++;
        console.log('[WorldCup] Preview generated: ' + fixture.home_team + ' vs ' + fixture.away_team);
      } catch(err) {
        console.error('[WorldCup] Preview failed for fixture ' + fixture.id + ':', err.message);
      }
    }

    console.log('[WorldCup] Generated ' + generated + ' previews');
    return { generated: generated };
  }

  // Seed tournament + groups with real WC 2026 data (runs on startup, idempotent)
  async function seedTournament() {
    if (!db.isAvailable || !db.isAvailable()) return;
    try {
      // Check if tournament already exists
      var { rows } = await db.query('SELECT id FROM world_cup_tournaments WHERE year = 2026');
      var tournamentId;
      if (rows.length > 0) {
        tournamentId = rows[0].id;
        // Ensure dates are set
        await db.query(
          "UPDATE world_cup_tournaments SET start_date = '2026-06-11', end_date = '2026-07-19', status = 'upcoming', name = 'FIFA World Cup 2026' WHERE id = $1 AND start_date IS NULL",
          [tournamentId]
        );
      } else {
        var { rows: newT } = await db.query(
          "INSERT INTO world_cup_tournaments (name, year, start_date, end_date, status, config) VALUES ('FIFA World Cup 2026', 2026, '2026-06-11', '2026-07-19', 'upcoming', $1) RETURNING id",
          [JSON.stringify({ hosts: ['USA', 'Canada', 'Mexico'], teams: 48, groups: 12, format: '12 groups of 4, top 2 + 8 best 3rd qualify for round of 32' })]
        );
        tournamentId = newT[0].id;
      }

      // Real WC 2026 groups (drawn Dec 13, 2025)
      var groups = {
        A: ['Mexico', 'South Africa', 'South Korea', 'Czech Republic'],
        B: ['Canada', 'Switzerland', 'Qatar', 'Bosnia & Herzegovina'],
        C: ['Brazil', 'Morocco', 'Haiti', 'Scotland'],
        D: ['USA', 'Paraguay', 'Australia', 'Turkey'],
        E: ['Germany', 'Curacao', 'Ivory Coast', 'Ecuador'],
        F: ['Netherlands', 'Japan', 'Sweden', 'Tunisia'],
        G: ['Belgium', 'Egypt', 'Iran', 'New Zealand'],
        H: ['Spain', 'Cape Verde', 'Saudi Arabia', 'Uruguay'],
        I: ['France', 'Senegal', 'Norway', 'Iraq'],
        J: ['Argentina', 'Algeria', 'Austria', 'Jordan'],
        K: ['Portugal', 'DR Congo', 'Uzbekistan', 'Colombia'],
        L: ['England', 'Croatia', 'Ghana', 'Panama'],
      };

      // Opening fixtures (Day 1-3 — one per host)
      var openingFixtures = [
        { stage: 'group', group: 'A', home: 'Mexico', away: 'South Africa', kickoff: '2026-06-11T20:00:00Z', venue: 'Estadio Azteca, Mexico City' },
        { stage: 'group', group: 'B', home: 'Canada', away: 'Bosnia & Herzegovina', kickoff: '2026-06-12T17:00:00Z', venue: 'BMO Field, Toronto' },
        { stage: 'group', group: 'D', home: 'USA', away: 'Paraguay', kickoff: '2026-06-12T21:00:00Z', venue: 'SoFi Stadium, Los Angeles' },
        { stage: 'group', group: 'C', home: 'Brazil', away: 'Morocco', kickoff: '2026-06-13T18:00:00Z', venue: 'MetLife Stadium, New Jersey' },
        { stage: 'group', group: 'L', home: 'England', away: 'Croatia', kickoff: '2026-06-13T21:00:00Z', venue: 'Lincoln Financial Field, Philadelphia' },
        { stage: 'group', group: 'F', home: 'Netherlands', away: 'Japan', kickoff: '2026-06-13T00:00:00Z', venue: 'AT&T Stadium, Dallas' },
        { stage: 'group', group: 'J', home: 'Argentina', away: 'Algeria', kickoff: '2026-06-14T18:00:00Z', venue: 'Hard Rock Stadium, Miami' },
        { stage: 'group', group: 'I', home: 'France', away: 'Senegal', kickoff: '2026-06-14T21:00:00Z', venue: 'Lumen Field, Seattle' },
        { stage: 'group', group: 'H', home: 'Spain', away: 'Cape Verde', kickoff: '2026-06-14T00:00:00Z', venue: 'Mercedes-Benz Stadium, Atlanta' },
        { stage: 'group', group: 'K', home: 'Portugal', away: 'DR Congo', kickoff: '2026-06-15T18:00:00Z', venue: 'Gillette Stadium, Boston' },
        { stage: 'group', group: 'G', home: 'Belgium', away: 'Egypt', kickoff: '2026-06-15T21:00:00Z', venue: 'NRG Stadium, Houston' },
        { stage: 'group', group: 'E', home: 'Germany', away: 'Curacao', kickoff: '2026-06-15T00:00:00Z', venue: 'BC Place, Vancouver' },
      ];

      // Seed groups
      for (var letter in groups) {
        var standings = groups[letter].map(function(team, i) {
          return { team: team, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, rank: i + 1 };
        });
        await db.query(
          'INSERT INTO world_cup_groups (tournament_id, group_letter, standings) VALUES ($1, $2, $3) ON CONFLICT (tournament_id, group_letter) DO NOTHING',
          [tournamentId, letter, JSON.stringify(standings)]
        );
      }

      // Seed opening fixtures
      for (var i = 0; i < openingFixtures.length; i++) {
        var f = openingFixtures[i];
        await db.query(
          `INSERT INTO world_cup_fixtures (tournament_id, stage, group_letter, home_team, away_team, kickoff, venue, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
           ON CONFLICT DO NOTHING`,
          [tournamentId, f.stage, f.group, f.home, f.away, f.kickoff, f.venue]
        );
      }

      // Seed remaining group stage fixtures (each team plays 3 matches)
      for (var letter in groups) {
        var t = groups[letter];
        var matchups = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]]; // round robin
        for (var m = 0; m < matchups.length; m++) {
          var home = t[matchups[m][0]];
          var away = t[matchups[m][1]];
          // Skip if already seeded as opening fixture
          var alreadySeeded = openingFixtures.some(function(of) { return of.home === home && of.away === away; });
          if (alreadySeeded) continue;
          await db.query(
            `INSERT INTO world_cup_fixtures (tournament_id, stage, group_letter, home_team, away_team, status)
             VALUES ($1, 'group', $2, $3, $4, 'scheduled')
             ON CONFLICT DO NOTHING`,
            [tournamentId, letter, home, away]
          );
        }
      }

      console.log('[WorldCup] Tournament seeded — 12 groups, 48 teams, group stage fixtures');
    } catch(err) {
      console.error('[WorldCup] Seed error:', err.message);
    }
  }

  // Auto-seed on startup
  seedTournament();

  return {
    syncFixtures: syncFixtures,
    scorePredictions: scorePredictions,
    seedTournament: seedTournament,
    generatePreviews: generatePreviews,
  };
};
