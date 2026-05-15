/**
 * World Cup Data Service
 *
 * Syncs fixtures, groups, and results from API-Football.
 * Feature-flagged: only loaded when ENABLE_WORLD_CUP=true.
 * Removable: delete this file + worldCup.js route + drop world_cup_* tables.
 */

module.exports = function(deps) {
  var db = deps.db;
  var FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
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
        var groupMatch = (league.round || '').match(/Group\s+([A-H])/i);
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
           ON CONFLICT (id) DO UPDATE SET home_goals = $8, away_goals = $9, result = $10, status = $11
           WHERE world_cup_fixtures.external_fixture_id = $12`,
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

  return {
    syncFixtures: syncFixtures,
    scorePredictions: scorePredictions,
  };
};
