/**
 * World Cup Data Service
 *
 * Syncs fixtures, groups, and results from API-Football.
 * Feature-flagged: only loaded when ENABLE_WORLD_CUP=true.
 * Removable: delete this file + worldCup.js route + drop world_cup_* tables.
 */

module.exports = function(deps) {
  var db = deps.db;
  var sportMonks = deps.sportMonks;
  var SportMonks = require('./sportMonks'); // for the static normaliseFixture
  var FOOTBALL_API_KEY = process.env.API_FOOTBALL_KEY || process.env.FOOTBALL_API_KEY;
  var WORLD_CUP_LEAGUE_ID = process.env.WORLD_CUP_LEAGUE_ID || '1'; // API-Football league ID for FIFA World Cup
  var WORLD_CUP_SEASON = process.env.WORLD_CUP_SEASON || '2026';

  // SportMonks World Cup config — explicit IDs win; otherwise auto-discovered.
  var SM_WC_LEAGUE_ID = process.env.SPORTMONKS_WC_LEAGUE_ID || null;
  var SM_WC_SEASON_ID = process.env.SPORTMONKS_WC_SEASON_ID || null;
  var SM_WC_START = process.env.SPORTMONKS_WC_START || (WORLD_CUP_SEASON + '-06-01');
  var SM_WC_END = process.env.SPORTMONKS_WC_END || (WORLD_CUP_SEASON + '-07-31');
  var _smWcCache = null; // { leagueId, seasonId, leagueName }

  function smAvailable() { return sportMonks && sportMonks.isAvailable && sportMonks.isAvailable(); }

  // Resolve the SportMonks World Cup league + season — from env, or by searching
  // SportMonks for the FIFA World Cup league and taking its current season.
  async function resolveSportMonksWc() {
    if (_smWcCache) return _smWcCache;
    if (SM_WC_LEAGUE_ID) {
      _smWcCache = { leagueId: SM_WC_LEAGUE_ID, seasonId: SM_WC_SEASON_ID, leagueName: 'World Cup (env)' };
      return _smWcCache;
    }
    if (!smAvailable() || !sportMonks.searchLeagues) return null;
    var leagues = await sportMonks.searchLeagues('World Cup');
    // Prefer the men's FIFA World Cup — exclude Women's, U-age, Qualifiers, Club WC
    var pick = (leagues || []).find(function(l) {
      var n = (l.name || '').toLowerCase();
      return n.indexOf('world cup') !== -1 && n.indexOf('women') === -1 && n.indexOf('u-') === -1 &&
             n.indexOf('u2') === -1 && n.indexOf('qualif') === -1 && n.indexOf('club') === -1;
    }) || (leagues || [])[0];
    if (!pick) return null;
    var season = pick.currentSeason || (pick.currentseason) || null;
    _smWcCache = { leagueId: pick.id, seasonId: season ? season.id : SM_WC_SEASON_ID, leagueName: pick.name };
    return _smWcCache;
  }

  // Map a SportMonks raw fixture's round/stage/group into our stage + group letter
  function smStageAndGroup(f) {
    var stageName = (f.stage && f.stage.name) || '';
    var roundName = (f.round && f.round.name) || '';
    var groupName = (f.group && f.group.name) || '';
    var hay = (stageName + ' ' + roundName + ' ' + groupName).toLowerCase();

    var stage = 'group';
    if (hay.indexOf('group') !== -1) stage = 'group';
    else if (hay.indexOf('32') !== -1) stage = 'round-of-32';
    else if (hay.indexOf('16') !== -1) stage = 'round-of-16';
    else if (hay.indexOf('quarter') !== -1) stage = 'quarter-final';
    else if (hay.indexOf('semi') !== -1) stage = 'semi-final';
    else if (hay.indexOf('3rd') !== -1 || hay.indexOf('third') !== -1) stage = 'third-place';
    else if (hay.indexOf('final') !== -1) stage = 'final';

    var groupLetter = null;
    var gm = (groupName + ' ' + roundName + ' ' + stageName).match(/group\s+([a-l])/i);
    if (gm) groupLetter = gm[1].toUpperCase();
    return { stage: stage, groupLetter: groupLetter };
  }

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

  // Ensure the tournament row exists; return its id.
  async function ensureTournament() {
    var { rows: tournaments } = await db.query(
      'SELECT * FROM world_cup_tournaments WHERE year = $1',
      [parseInt(WORLD_CUP_SEASON)]
    );
    if (tournaments.length === 0) {
      var { rows: newT } = await db.query(
        "INSERT INTO world_cup_tournaments (name, year, status) VALUES ($1, $2, 'upcoming') RETURNING id",
        ['FIFA World Cup ' + WORLD_CUP_SEASON, parseInt(WORLD_CUP_SEASON)]
      );
      return newT[0].id;
    }
    return tournaments[0].id;
  }

  // Canonical 12 groups of 4 (real WC2026 draw). Single source for group letters.
  var WC_GROUPS = {
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

  function letterForTeams(schedule, home, away) {
    for (var L in WC_GROUPS) {
      var teams = WC_GROUPS[L];
      var hasHome = teams.some(function (t) { return schedule.teamsMatch(t, home); });
      var hasAway = teams.some(function (t) { return schedule.teamsMatch(t, away); });
      if (hasHome && hasAway) return L;
    }
    return null;
  }

  // Drive the group-stage fixtures from the canonical schedule (matchups + dates +
  // group + matchday). Idempotent: matches existing rows by team pairing (either
  // orientation) and updates them, preserving any goals/result/status from the
  // feed; inserts the rest. The feed is only ever authoritative for results.
  async function seedGroupFixturesFromSchedule() {
    if (!db.isAvailable || !db.isAvailable()) return 0;
    var schedule = require('./wc2026Schedule');
    var tournamentId = await ensureTournament();
    var matchdays = [schedule.matchday1, schedule.matchday2, schedule.matchday3];

    // Ensure all 12 groups exist with their 4 teams (self-heals the Groups tab).
    // Only inserts when missing — never overwrites computed standings.
    for (var L in WC_GROUPS) {
      var blank = WC_GROUPS[L].map(function (team, i) {
        return { team: team, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, rank: i + 1 };
      });
      await db.query(
        "INSERT INTO world_cup_groups (tournament_id, group_letter, standings) VALUES ($1,$2,$3) " +
        "ON CONFLICT (tournament_id, group_letter) DO NOTHING",
        [tournamentId, L, JSON.stringify(blank)]
      );
    }

    // Load existing group fixtures once and match in JS (alias-tolerant).
    var existingRes = await db.query("SELECT id, home_team, away_team FROM world_cup_fixtures WHERE stage='group'");
    var existing = existingRes.rows || [];
    var seeded = 0;
    for (var md = 0; md < matchdays.length; md++) {
      var round = String(md + 1);
      var list = matchdays[md] || [];
      for (var i = 0; i < list.length; i++) {
        var fx = list[i];
        var letter = letterForTeams(schedule, fx.home, fx.away);
        var kickoff = fx.date ? (fx.date + 'T18:00:00Z') : null;
        var match = existing.find(function (r) {
          return (schedule.teamsMatch(r.home_team, fx.home) && schedule.teamsMatch(r.away_team, fx.away)) ||
                 (schedule.teamsMatch(r.home_team, fx.away) && schedule.teamsMatch(r.away_team, fx.home));
        });
        if (match) {
          await db.query(
            "UPDATE world_cup_fixtures SET stage='group', group_letter=COALESCE($1, group_letter), " +
            "kickoff=COALESCE(kickoff, $2), round_name=$3 WHERE id=$4",
            [letter, kickoff, round, match.id]
          );
        } else {
          await db.query(
            "INSERT INTO world_cup_fixtures (tournament_id, stage, group_letter, home_team, away_team, kickoff, status, round_name) " +
            "VALUES ($1,'group',$2,$3,$4,$5,'scheduled',$6)",
            [tournamentId, letter, fx.home, fx.away, kickoff, round]
          );
          existing.push({ id: -1, home_team: fx.home, away_team: fx.away });
          seeded++;
        }
      }
    }
    if (seeded) console.log('[WorldCup] Seeded ' + seeded + ' group fixtures from canonical schedule');
    return seeded;
  }

  // Update the Quant Model's Elo ratings from finished WC results, once each
  // (tracked via elo_applied) so ratings learn from the tournament. Neutral venue.
  async function updateQuantRatings() {
    if (!deps.quantModel || !db.query) return 0;
    try {
      await db.query("ALTER TABLE world_cup_fixtures ADD COLUMN IF NOT EXISTS elo_applied BOOLEAN DEFAULT FALSE");
      var res = await db.query("SELECT id, home_team, away_team, home_goals, away_goals FROM world_cup_fixtures WHERE status='finished' AND home_goals IS NOT NULL AND away_goals IS NOT NULL AND elo_applied IS NOT TRUE ORDER BY kickoff ASC");
      var n = 0;
      for (var i = 0; i < (res.rows || []).length; i++) {
        var f = res.rows[i];
        await deps.quantModel.updateFromResult(f.home_team, f.away_team, f.home_goals, f.away_goals, { neutral: true });
        await db.query("UPDATE world_cup_fixtures SET elo_applied = TRUE WHERE id = $1", [f.id]);
        n++;
      }
      if (n) console.log('[QuantModel] Elo updated from ' + n + ' finished WC result(s)');
      return n;
    } catch (e) { console.warn('[QuantModel] rating update failed:', e.message); return 0; }
  }

  // Public entry point — prefer SportMonks (the upgraded source), fall back to
  // API-Football if SportMonks isn't available or returns nothing.
  async function syncFixtures() {
    if (!db.isAvailable || !db.isAvailable()) return { error: 'Database not available' };
    var result;
    if (smAvailable()) {
      try {
        var smResult = await syncFromSportMonks();
        if (smResult && !smResult.error && smResult.fixtures > 0) {
          result = Object.assign({ source: 'sportmonks' }, smResult);
        } else {
          console.warn('[WorldCup] SportMonks returned ' + ((smResult && smResult.fixtures) || 0) + ' fixtures — falling back to API-Football');
        }
      } catch (e) {
        console.error('[WorldCup] SportMonks sync failed, falling back to API-Football:', e.message);
      }
    }
    if (!result) {
      var afResult = await syncFromApiFootball();
      result = Object.assign({ source: 'api-football' }, afResult);
    }
    // Make sure the full canonical group schedule is present (self-heals if a
    // prior run or a thin feed left it incomplete). The feed only updates results.
    try { result.seededFromSchedule = await seedGroupFixturesFromSchedule(); } catch (e) { console.warn('[WorldCup] schedule seed failed:', e.message); }
    // Remove ONLY genuine duplicate group fixtures (same matchup seeded by more
    // than one source). Keeps the richest copy — a finished result first, then a
    // round_name, then a kickoff, then lowest id. NEVER removes a unique fixture.
    try {
      var del = await db.query(
        "DELETE FROM world_cup_fixtures WHERE id IN (" +
          "SELECT id FROM (SELECT id, ROW_NUMBER() OVER (" +
            "PARTITION BY tournament_id, LEAST(LOWER(home_team),LOWER(away_team)), GREATEST(LOWER(home_team),LOWER(away_team)) " +
            "ORDER BY (status='finished') DESC, (round_name IS NOT NULL) DESC, (kickoff IS NOT NULL) DESC, id ASC) AS rn " +
          "FROM world_cup_fixtures WHERE stage='group') t WHERE t.rn > 1)"
      );
      if (del.rowCount) { console.log('[WorldCup] Removed ' + del.rowCount + ' duplicate group fixtures'); result.removedDuplicates = del.rowCount; }
    } catch (e) { console.warn('[WorldCup] dup cleanup failed:', e.message); }
    // Recompute group tables from the results we hold (provider standings are
    // unreliable for the provisional 2026 data).
    try { result.computedGroups = await computeGroupStandings(); } catch (e) { console.warn('[WorldCup] computeGroupStandings failed:', e.message); }
    try { result.eloUpdated = await updateQuantRatings(); } catch (e) { console.warn('[WorldCup] updateQuantRatings failed:', e.message); }
    return result;
  }

  // Recompute every group's table (P/W/D/L/GD/PTS) from our finished group
  // fixtures, matched to each group's teams by name. Self-reliant + accurate.
  async function computeGroupStandings() {
    if (!db.isAvailable || !db.isAvailable()) return 0;
    var schedule = require('./wc2026Schedule');
    var groupsRes = await db.query('SELECT id, group_letter, standings FROM world_cup_groups ORDER BY group_letter');
    var groups = groupsRes.rows || [];
    if (!groups.length) return 0;
    var fxRes = await db.query(
      "SELECT DISTINCT ON (LEAST(home_team, away_team), GREATEST(home_team, away_team)) home_team, away_team, home_goals, away_goals " +
      "FROM world_cup_fixtures WHERE stage = 'group' AND status = 'finished' AND home_goals IS NOT NULL AND away_goals IS NOT NULL " +
      "ORDER BY LEAST(home_team, away_team), GREATEST(home_team, away_team)"
    );
    var fixtures = fxRes.rows || [];
    var updated = 0;
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      var existing = g.standings || [];
      if (!existing.length) continue;
      var byTeam = {};
      existing.forEach(function (t) { byTeam[t.team] = { team: t.team, logo: t.logo || null, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 }; });
      var teamNames = Object.keys(byTeam);
      fixtures.forEach(function (f) {
        var h = teamNames.find(function (t) { return schedule.teamsMatch(t, f.home_team); });
        var a = teamNames.find(function (t) { return schedule.teamsMatch(t, f.away_team); });
        if (!h || !a) return;
        var th = byTeam[h], ta = byTeam[a], hg = f.home_goals, ag = f.away_goals;
        th.played++; ta.played++; th.goalsFor += hg; th.goalsAgainst += ag; ta.goalsFor += ag; ta.goalsAgainst += hg;
        if (hg > ag) { th.won++; ta.lost++; th.points += 3; }
        else if (hg < ag) { ta.won++; th.lost++; ta.points += 3; }
        else { th.drawn++; ta.drawn++; th.points++; ta.points++; }
      });
      var standings = teamNames.map(function (t) { var x = byTeam[t]; x.goalDifference = x.goalsFor - x.goalsAgainst; return x; });
      standings.sort(function (a, b) { return b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor; });
      standings.forEach(function (s, i) { s.rank = i + 1; });
      await db.query('UPDATE world_cup_groups SET standings = $1 WHERE id = $2', [JSON.stringify(standings), g.id]);
      updated++;
    }
    return updated;
  }

  // -------------------------------------------------------------------------
  // SportMonks World Cup sync
  // -------------------------------------------------------------------------
  async function syncFromSportMonks() {
    if (!smAvailable()) return { error: 'SportMonks not available' };
    var wc = await resolveSportMonksWc();
    if (!wc || !wc.leagueId) return { error: 'Could not resolve SportMonks World Cup league' };

    var tournamentId = await ensureTournament();
    var synced = { fixtures: 0, groups: 0, league: wc.leagueName, leagueId: wc.leagueId, seasonId: wc.seasonId };

    var raw = await sportMonks.getFixturesBetween(SM_WC_START, SM_WC_END, wc.leagueId);
    for (var i = 0; i < (raw || []).length; i++) {
      var rf = raw[i];
      var nf = SportMonks.normaliseFixture(rf) || {};
      if (!nf.homeTeam || !nf.awayTeam) continue;

      var sg = smStageAndGroup(rf);
      var roundName = (rf.round && (rf.round.name || rf.round.id)) ? String(rf.round.name || rf.round.id) : null;

      // Map normalised status -> our status
      var st = 'scheduled';
      if (['FT', 'AET', 'PEN'].indexOf(nf.status) !== -1) st = 'finished';
      else if (['LIVE', 'HT', '1H', '2H', 'ET'].indexOf(nf.status) !== -1) st = 'live';

      var result = null;
      if (st === 'finished' && nf.homeGoals !== null && nf.awayGoals !== null) {
        if (nf.homeGoals > nf.awayGoals) result = 'home';
        else if (nf.awayGoals > nf.homeGoals) result = 'away';
        else result = 'draw';
      }

      // Explicit upsert — the production table may lack a UNIQUE constraint on
      // external_fixture_id, so we don't rely on ON CONFLICT.
      var existing = await db.query('SELECT id FROM world_cup_fixtures WHERE external_fixture_id = $1', [rf.id]);
      if (existing.rows.length) {
        await db.query(
          `UPDATE world_cup_fixtures SET tournament_id=$1, stage=$2, group_letter=$3, home_team=$4, away_team=$5,
           kickoff=$6, venue=$7, home_goals=$8, away_goals=$9, result=$10, status=$11, round_name=$13 WHERE external_fixture_id=$12`,
          [tournamentId, sg.stage, sg.groupLetter, nf.homeTeam, nf.awayTeam, nf.kickoff,
           nf.venue || null, nf.homeGoals, nf.awayGoals, result, st, rf.id, roundName]
        );
      } else {
        await db.query(
          `INSERT INTO world_cup_fixtures (tournament_id, stage, group_letter, home_team, away_team, kickoff, venue, home_goals, away_goals, result, status, external_fixture_id, round_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [tournamentId, sg.stage, sg.groupLetter, nf.homeTeam, nf.awayTeam, nf.kickoff,
           nf.venue || null, nf.homeGoals, nf.awayGoals, result, st, rf.id, roundName]
        );
      }
      synced.fixtures++;
    }

    // Standings (best effort — structure varies, never fail the whole sync)
    if (wc.seasonId && sportMonks.getStandings) {
      try {
        var standings = await sportMonks.getStandings(wc.seasonId);
        var byGroup = {};
        (standings || []).forEach(function(s) {
          var gName = (s.group && s.group.name) || (s.details && s.details.group) || '';
          var gm = String(gName).match(/group\s+([a-l])/i);
          if (!gm) return;
          var letter = gm[1].toUpperCase();
          (byGroup[letter] = byGroup[letter] || []).push({
            team: (s.participant && s.participant.name) || s.name || '',
            played: s.games_played || 0, points: s.points || 0,
            position: s.position || s.rank || 0,
          });
        });
        for (var letter in byGroup) {
          await db.query(
            `INSERT INTO world_cup_groups (tournament_id, group_letter, standings)
             VALUES ($1,$2,$3) ON CONFLICT (tournament_id, group_letter) DO UPDATE SET standings=$3`,
            [tournamentId, letter, JSON.stringify(byGroup[letter])]
          );
          synced.groups++;
        }
      } catch (e) {
        console.warn('[WorldCup] SportMonks standings skipped:', e.message);
      }
    }

    console.log('[WorldCup] SportMonks sync complete — ' + synced.fixtures + ' fixtures, ' + synced.groups + ' groups (league ' + wc.leagueId + ')');
    return synced;
  }

  // -------------------------------------------------------------------------
  // API-Football World Cup sync (fallback / original source)
  // -------------------------------------------------------------------------
  async function syncFromApiFootball() {
    var synced = { fixtures: 0, groups: 0 };

    var tournamentId = await ensureTournament();

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

  // Compute a team's recent form summary from SportMonks fixtures
  function _wcForm(fixtures, teamId) {
    var finished = (fixtures || []).filter(function(f) {
      return ['FT', 'AET', 'PEN'].indexOf(f.status) !== -1 && f.homeGoals != null && f.awayGoals != null;
    }).sort(function(a, b) { return new Date(b.kickoff) - new Date(a.kickoff); });
    var seq = [], scored = 0, conceded = 0, n = 0;
    finished.forEach(function(f) {
      var isHome = f.homeTeamId === teamId;
      var gf = isHome ? f.homeGoals : f.awayGoals, ga = isHome ? f.awayGoals : f.homeGoals;
      if (n < 6) { scored += gf; conceded += ga; n++; seq.push(gf > ga ? 'W' : gf < ga ? 'L' : 'D'); }
    });
    if (!n) return null;
    return { formStr: seq.join(''), scored: (scored / n).toFixed(1), conceded: (conceded / n).toFixed(1) };
  }

  // Gather the SportMonks All-In model data for a fixture (by SportMonks id)
  async function gatherWcModel(externalId) {
    if (!externalId || !smAvailable()) return null;
    var model = { winProb: null, score: null, btts: null, lineups: false, homeForm: null, awayForm: null };
    try {
      var raw = await sportMonks.getFixtureRaw(externalId);
      if (!raw) return null;
      var parts = raw.participants || [];
      var home = parts.find(function(p) { return p.meta && p.meta.location === 'home'; }) || parts[0] || {};
      var away = parts.find(function(p) { return p.meta && p.meta.location === 'away'; }) || parts[1] || {};
      (raw.predictions || []).forEach(function(p) {
        var pv = p.predictions || {};
        if (p.type_id === 237 && pv.home != null) model.winProb = { home: Math.round(pv.home), draw: Math.round(pv.draw), away: Math.round(pv.away) };
        else if (p.type_id === 231 && pv.yes != null) model.btts = Math.round(pv.yes);
        else if (p.type_id === 240 && pv.scores) {
          var b = null, bp = 0;
          Object.keys(pv.scores).forEach(function(k) { if (k.indexOf('Other') === -1 && pv.scores[k] > bp) { bp = pv.scores[k]; b = k; } });
          model.score = b;
        }
      });
      if (raw.lineups && raw.lineups.length) model.lineups = true;
      if (sportMonks.getTeamRecentFixtures && home.id && away.id) {
        var from = new Date(); from.setDate(from.getDate() - 200);
        var fromS = from.toISOString().split('T')[0], toS = new Date().toISOString().split('T')[0];
        var rec = await Promise.all([
          sportMonks.getTeamRecentFixtures(home.id, fromS, toS).catch(function() { return []; }),
          sportMonks.getTeamRecentFixtures(away.id, fromS, toS).catch(function() { return []; }),
        ]);
        model.homeForm = _wcForm(rec[0], home.id);
        model.awayForm = _wcForm(rec[1], away.id);
      }
    } catch (e) { console.log('[WorldCup] model gather failed:', e.message); }
    return model;
  }

  // Build a prompt addendum so Perplexity reasons WITH the hard model data
  function wcModelAddendum(model, fixture) {
    if (!model) return '';
    var s = '\n\nHARD MODEL DATA (SportMonks All-In) — weigh this alongside your live intelligence, do not just echo it:\n';
    if (model.winProb) s += '- Win probability: ' + fixture.home_team + ' ' + model.winProb.home + '%, Draw ' + model.winProb.draw + '%, ' + fixture.away_team + ' ' + model.winProb.away + '%\n';
    if (model.score) s += '- Model most-likely scoreline: ' + model.score + '\n';
    if (model.btts != null) s += '- BTTS probability: ' + model.btts + '%\n';
    if (model.homeForm) s += '- ' + fixture.home_team + ' recent form: ' + model.homeForm.formStr + ' (avg ' + model.homeForm.scored + ' scored / ' + model.homeForm.conceded + ' conceded)\n';
    if (model.awayForm) s += '- ' + fixture.away_team + ' recent form: ' + model.awayForm.formStr + ' (avg ' + model.awayForm.scored + ' scored / ' + model.awayForm.conceded + ' conceded)\n';
    if (model.lineups) s += '- Probable lineups are confirmed/available.\n';
    s += 'Find where the genuine edge is versus this model and the market.\n';
    return s;
  }

  // Map the SportMonks model into a `scored` object for the consensus engine.
  // Factors are normalised 0-1; odds derived from win probabilities.
  function buildWcScored(fixture, model) {
    // Prefer the Elite Edge Quant Model (Elo + Dixon-Coles) — a real, independent
    // probability set — over the unreliable provisional SportMonks model. This is
    // what stops the consensus drawing clear favourites (it now sees Spain ~85%).
    var quant = null;
    try { if (deps.quantModel) quant = deps.quantModel.predict(fixture.home_team, fixture.away_team, { neutral: true }); } catch (e) {}

    var wp = (quant && quant.winProb) ? quant.winProb : (model && model.winProb);
    var homeP = wp ? wp.home : 40, drawP = wp ? wp.draw : 27, awayP = wp ? wp.away : 33;
    var homeAway = (homeP + awayP) > 0 ? homeP / (homeP + awayP) : 0.55;
    var countW = function(f) { return f && f.formStr ? (f.formStr.split('W').length - 1) : 0; };
    var hw = countW(model && model.homeForm), aw = countW(model && model.awayForm);
    var form = Math.max(0, Math.min(1, 0.5 + (hw - aw) * 0.08));
    var totalGoals = quant ? quant.expectedGoals.total : 2.5;
    if (!quant && model && model.score) { var pr = String(model.score).split('-'); if (pr.length === 2) totalGoals = (parseInt(pr[0]) || 0) + (parseInt(pr[1]) || 0); }
    var xG = Math.max(0, Math.min(1, totalGoals / 4));
    var bttsPct = quant ? quant.btts : (model && model.btts != null ? model.btts : 50);
    // Real P(Over 2.5) from the quant model so the consensus judges goals on a
    // calibrated probability rather than an inflated proxy (which made it lazily
    // default to Over 2.5 on almost every game).
    var overProb = (quant && quant.over25 != null) ? Math.max(0, Math.min(1, quant.over25 / 100)) : null;
    return {
      fixture: { homeTeam: fixture.home_team, awayTeam: fixture.away_team, league: 'FIFA World Cup 2026', kickoff: fixture.kickoff },
      factors: { homeAway: homeAway, form: form, xG: xG, shots: 0.5, injuries: 0.5, motivation: 0.5, scheduleCongestion: 0.5, btts: bttsPct / 100, overProb: overProb },
      homeOdds: 100 / Math.max(1, homeP), drawOdds: 100 / Math.max(1, drawP), awayOdds: 100 / Math.max(1, awayP),
      overOdds: (quant ? quant.over25 : (model && model.btts)) > 55 ? 1.8 : 2.05,
      bttsOdds: bttsPct ? Math.max(1.4, 100 / bttsPct) : 1.8,
      quantModel: quant || null,
    };
  }

  async function generatePreviews(opts) {
    opts = opts || {};
    var force = !!opts.force; // regenerate even fixtures that already have a preview
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
         AND f.kickoff <= NOW() + INTERVAL '5 days'
         ${force ? '' : 'AND p.id IS NULL'}
       ORDER BY f.kickoff ASC
       LIMIT ${force ? 20 : 6}`
    );

    if (upcoming.length === 0) {
      console.log('[WorldCup] No fixtures need previews right now');
      return { generated: 0 };
    }

    var generated = 0;
    for (var i = 0; i < upcoming.length; i++) {
      var fixture = upcoming[i];
      try {
        // Gather SportMonks model data and fold it into the analysis prompt
        var wcModel = await gatherWcModel(fixture.external_fixture_id);
        var prompt = prompts.buildWorldCupPreviewPrompt(fixture) + wcModelAddendum(wcModel, fixture);

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
        }

        // Fold the SportMonks model into the stored signals + ground confidence in it
        if (wcModel) {
          signals.sportmonks_model = {
            value: 'Win%: H ' + (wcModel.winProb ? wcModel.winProb.home : '-') + ' / D ' + (wcModel.winProb ? wcModel.winProb.draw : '-') + ' / A ' + (wcModel.winProb ? wcModel.winProb.away : '-')
              + (wcModel.score ? ' | Score ' + wcModel.score : '') + (wcModel.btts != null ? ' | BTTS ' + wcModel.btts + '%' : ''),
            winProb: wcModel.winProb, score: wcModel.score, btts: wcModel.btts,
            homeForm: wcModel.homeForm, awayForm: wcModel.awayForm,
          };
          if (!predicted && wcModel.score) predicted = wcModel.score;
          if (wcModel.winProb) {
            var _top = Math.max(wcModel.winProb.home, wcModel.winProb.draw, wcModel.winProb.away);
            confidence = _top >= 55 ? 8 : _top >= 45 ? 7 : 6; // model-grounded, 6/10 floor
          }

          // PHASE 2 (shadow): run the fixture through the real 5-analyst consensus
          // engine. Stored alongside the verdict for verification before we
          // promote it to the headline pick. Non-fatal if it errors.
          if (wcModel.winProb) {
            try {
              var ConsensusEngine = require('./consensusEngine');
              var _ce = new ConsensusEngine(deps);
              var _cres = await _ce.analyse(buildWcScored(fixture, wcModel), null);
              if (_cres) {
                signals.consensus = {
                  value: _cres.agreementLabel + ' — ' + _cres.selection + ' (' + _cres.market + '), ' + _cres.confidence + '/10',
                  market: _cres.market, selection: _cres.selection, confidence: _cres.confidence,
                  agreementLabel: _cres.agreementLabel, agreementLevel: _cres.agreementLevel,
                  debate: _cres.debate, analystName: _cres.analystName,
                  consensusReasoning: _cres.consensusReasoning, modelProbabilities: _cres.modelProbabilities,
                };
                console.log('[WorldCup] Consensus (shadow) for ' + fixture.home_team + ' v ' + fixture.away_team + ': ' + signals.consensus.value);
              }
            } catch (ce) { console.log('[WorldCup] consensus shadow failed:', ce.message); }
          }
        }

        if (enrichResult && enrichResult.signals) {
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

        // PHASE 3: promote the consensus to the headline pick. The engine
        // self-verifies (3-analyst debate + GPT arbiter + AutoTune), so the
        // consensus selection/confidence lead; Perplexity's research becomes
        // the supporting narrative.
        if (signals.consensus && signals.consensus.selection) {
          var _c = signals.consensus;
          var _perplexityNarrative = verdict; // keep Perplexity's specific intel
          verdictMarket = _c.market;
          verdictSelection = _c.selection;
          confidence = _c.confidence;
          // Use the reasoning that actually backs the winning pick (not always
          // the Tactician's) so the explanation matches the selection.
          var _lead = _c.consensusReasoning || ((_c.debate && _c.debate[0]) ? _c.debate[0].reasoning : '');
          verdict = _c.agreementLabel + ' analyst consensus: ' + _c.selection + ' (' + _c.market + '). ' + _lead
            + (_perplexityNarrative ? ' Live intelligence: ' + _perplexityNarrative : '');
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
      // Skip seeding if fixtures already exist (prevents duplicates on every deploy)
      var { rows: fxCheck } = await db.query('SELECT COUNT(*) as cnt FROM world_cup_fixtures');
      var fxCount = parseInt(fxCheck[0].cnt);
      if (fxCount >= 60 && fxCount <= 100) {
        return; // Already seeded correctly, skip
      }

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

      // Clean up duplicates (from previous deploys that didn't have unique constraints)
      try {
        var { rows: dupeCheck } = await db.query('SELECT COUNT(*) as cnt FROM world_cup_fixtures');
        if (parseInt(dupeCheck[0].cnt) > 100) {
          console.log('[WorldCup] Cleaning ' + dupeCheck[0].cnt + ' duplicate fixtures...');
          await db.query(`
            DELETE FROM world_cup_fixtures WHERE id NOT IN (
              SELECT MIN(id) FROM world_cup_fixtures GROUP BY tournament_id, home_team, away_team
            )
          `);
          var { rows: afterClean } = await db.query('SELECT COUNT(*) as cnt FROM world_cup_fixtures');
          console.log('[WorldCup] Cleaned — ' + afterClean[0].cnt + ' fixtures remaining');
        }
      } catch(e) { console.log('[WorldCup] Dedup skipped:', e.message); }

      console.log('[WorldCup] Tournament seeded — 12 groups, 48 teams, group stage fixtures');
    } catch(err) {
      console.error('[WorldCup] Seed error:', err.message);
    }
  }

  // Auto-seed on startup, then ensure the full canonical group schedule is present
  // (restores fixtures + groups immediately rather than waiting for the next sync).
  seedTournament();
  seedGroupFixturesFromSchedule()
    .then(function (n) { if (n) console.log('[WorldCup] Startup schedule seed added ' + n + ' fixtures'); })
    .catch(function (e) { console.warn('[WorldCup] startup schedule seed failed:', e.message); });

  // Diagnostic — confirm SportMonks World Cup data is reachable and what IDs
  // resolve, plus a sample of fixtures. Used by the admin diagnostic endpoint.
  async function diagnose() {
    var out = {
      sportMonksAvailable: smAvailable(),
      apiFootballConfigured: !!FOOTBALL_API_KEY,
      window: { start: SM_WC_START, end: SM_WC_END },
      envOverride: { leagueId: SM_WC_LEAGUE_ID, seasonId: SM_WC_SEASON_ID },
    };
    if (!smAvailable()) { out.note = 'SportMonks API key not set'; return out; }
    try {
      var leagues = await sportMonks.searchLeagues('World Cup');
      out.leagueSearch = (leagues || []).map(function(l) {
        return { id: l.id, name: l.name, currentSeasonId: l.currentSeason ? l.currentSeason.id : null };
      });
      var wc = await resolveSportMonksWc();
      out.resolved = wc;
      if (wc && wc.leagueId) {
        var raw = await sportMonks.getFixturesBetween(SM_WC_START, SM_WC_END, wc.leagueId);
        out.fixturesFound = (raw || []).length;
        out.sample = (raw || []).slice(0, 5).map(function(rf) {
          var nf = SportMonks.normaliseFixture(rf) || {};
          var sg = smStageAndGroup(rf);
          return { home: nf.homeTeam, away: nf.awayTeam, kickoff: nf.kickoff, stage: sg.stage, group: sg.groupLetter, status: nf.status };
        });
      }
    } catch (e) {
      out.error = e.message;
    }
    return out;
  }

  return {
    syncFixtures: syncFixtures,
    computeGroupStandings: computeGroupStandings,
    syncFromSportMonks: syncFromSportMonks,
    syncFromApiFootball: syncFromApiFootball,
    diagnose: diagnose,
    scorePredictions: scorePredictions,
    seedTournament: seedTournament,
    seedGroupFixturesFromSchedule: seedGroupFixturesFromSchedule,
    updateQuantRatings: updateQuantRatings,
    generatePreviews: generatePreviews,
  };
};
