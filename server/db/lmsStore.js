/**
 * Elite Edge Sports Tips — Last Man Standing data store
 *
 * Pluggable, feature-flagged (ENABLE_LMS). Owns its own tables and never
 * touches core entities. Built on top of the exported db.query/isAvailable
 * helpers so core db.js is untouched.
 *
 * Tables (created in server/index.js startup block behind ENABLE_LMS):
 *   lms_competitions, lms_entries, lms_picks, lms_purchases
 *
 * LMS requires PostgreSQL (like World Cup Mode). When no pool is configured
 * every read returns empty and writes throw a clear error — routes surface 503.
 */

const db = require('../db');

function available() {
  return db.isAvailable && db.isAvailable();
}
function requireDb() {
  if (!available()) throw new Error('LMS requires a database (DATABASE_URL not set)');
}

// ---------------------------------------------------------------------------
// Row mappers (snake_case row -> camelCase app object)
// ---------------------------------------------------------------------------
function mapCompetition(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    phase: r.phase,                       // 'world_cup' | 'pl_rollover'
    status: r.status,                     // 'open' | 'active' | 'completed'
    access: r.access,                     // 'subscriber' | 'everyone'
    currentRound: r.current_round || 1,
    prizePot: parseFloat(r.prize_pot) || 0,
    basePrize: parseFloat(r.base_prize) || 0,
    config: r.config || {},
    createdAt: r.created_at,
  };
}
function mapEntry(r) {
  if (!r) return null;
  return {
    id: r.id,
    competitionId: r.competition_id,
    userId: r.user_id,
    status: r.status,                     // 'alive' | 'out' | 'winner'
    extraTeams: r.extra_teams || 0,       // purchased team-reuse allowances
    reusesUsed: r.reuses_used || 0,
    eliminatedRound: r.eliminated_round,
    joinedAt: r.joined_at,
  };
}
function mapPick(r) {
  if (!r) return null;
  return {
    id: r.id,
    competitionId: r.competition_id,
    entryId: r.entry_id,
    userId: r.user_id,
    round: r.round,
    team: r.team,
    isReuse: r.is_reuse || false,
    result: r.result,                     // 'pending' | 'won' | 'lost' | 'void'
    fixtureId: r.fixture_id,
    settledAt: r.settled_at,
    createdAt: r.created_at,
  };
}
function mapPurchase(r) {
  if (!r) return null;
  return {
    id: r.id,
    competitionId: r.competition_id,
    userId: r.user_id,
    amount: parseFloat(r.amount) || 0,
    stripeSessionId: r.stripe_session_id,
    status: r.status,                     // 'pending' | 'paid'
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------
async function getCompetitions(filter) {
  if (!available()) return [];
  var sql = 'SELECT * FROM lms_competitions';
  var params = [];
  if (filter && filter.status) { sql += ' WHERE status = $1'; params.push(filter.status); }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await db.query(sql, params);
  return rows.map(mapCompetition);
}
async function getCompetitionById(id) {
  if (!available()) return null;
  const { rows } = await db.query('SELECT * FROM lms_competitions WHERE id = $1', [id]);
  return rows.length ? mapCompetition(rows[0]) : null;
}
async function createCompetition(data) {
  requireDb();
  const { rows } = await db.query(
    `INSERT INTO lms_competitions (name, phase, status, access, current_round, prize_pot, base_prize, config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [data.name, data.phase, data.status || 'open', data.access || 'subscriber',
     data.currentRound || 1, data.prizePot || 0, data.basePrize || 0,
     JSON.stringify(data.config || {})]
  );
  return mapCompetition(rows[0]);
}
async function updateCompetition(id, fields) {
  requireDb();
  var map = { name: 'name', phase: 'phase', status: 'status', access: 'access',
    currentRound: 'current_round', prizePot: 'prize_pot', basePrize: 'base_prize', config: 'config' };
  var sets = [], vals = [], i = 1;
  for (var k in fields) {
    if (!map[k] || fields[k] === undefined) continue;
    sets.push(map[k] + ' = $' + i);
    vals.push(k === 'config' ? JSON.stringify(fields[k]) : fields[k]);
    i++;
  }
  if (!sets.length) return getCompetitionById(id);
  vals.push(id);
  const { rows } = await db.query('UPDATE lms_competitions SET ' + sets.join(', ') + ' WHERE id = $' + i + ' RETURNING *', vals);
  return rows.length ? mapCompetition(rows[0]) : null;
}
async function addToPot(id, amount) {
  requireDb();
  const { rows } = await db.query(
    'UPDATE lms_competitions SET prize_pot = prize_pot + $1 WHERE id = $2 RETURNING *', [amount, id]);
  return rows.length ? mapCompetition(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------
async function getEntry(competitionId, userId) {
  if (!available()) return null;
  const { rows } = await db.query(
    'SELECT * FROM lms_entries WHERE competition_id = $1 AND user_id = $2', [competitionId, userId]);
  return rows.length ? mapEntry(rows[0]) : null;
}
async function getEntryById(id) {
  if (!available()) return null;
  const { rows } = await db.query('SELECT * FROM lms_entries WHERE id = $1', [id]);
  return rows.length ? mapEntry(rows[0]) : null;
}
async function getEntriesForCompetition(competitionId, status) {
  if (!available()) return [];
  var sql = 'SELECT * FROM lms_entries WHERE competition_id = $1';
  var params = [competitionId];
  if (status) { sql += ' AND status = $2'; params.push(status); }
  sql += ' ORDER BY joined_at ASC';
  const { rows } = await db.query(sql, params);
  return rows.map(mapEntry);
}
async function createEntry(data) {
  requireDb();
  const { rows } = await db.query(
    `INSERT INTO lms_entries (competition_id, user_id, status, extra_teams, reuses_used)
     VALUES ($1,$2,'alive',0,0)
     ON CONFLICT (competition_id, user_id) DO NOTHING RETURNING *`,
    [data.competitionId, data.userId]
  );
  if (rows.length) return mapEntry(rows[0]);
  return getEntry(data.competitionId, data.userId); // already existed
}
async function updateEntry(id, fields) {
  requireDb();
  var map = { status: 'status', extraTeams: 'extra_teams', reusesUsed: 'reuses_used', eliminatedRound: 'eliminated_round' };
  var sets = [], vals = [], i = 1;
  for (var k in fields) {
    if (!map[k] || fields[k] === undefined) continue;
    sets.push(map[k] + ' = $' + i); vals.push(fields[k]); i++;
  }
  if (!sets.length) return getEntryById(id);
  vals.push(id);
  const { rows } = await db.query('UPDATE lms_entries SET ' + sets.join(', ') + ' WHERE id = $' + i + ' RETURNING *', vals);
  return rows.length ? mapEntry(rows[0]) : null;
}
async function incrementExtraTeams(id, by) {
  requireDb();
  const { rows } = await db.query(
    'UPDATE lms_entries SET extra_teams = extra_teams + $1 WHERE id = $2 RETURNING *', [by || 1, id]);
  return rows.length ? mapEntry(rows[0]) : null;
}
async function countAlive(competitionId) {
  if (!available()) return 0;
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM lms_entries WHERE competition_id = $1 AND status = 'alive'", [competitionId]);
  return rows[0] ? rows[0].n : 0;
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------
async function getPick(entryId, round) {
  if (!available()) return null;
  const { rows } = await db.query(
    'SELECT * FROM lms_picks WHERE entry_id = $1 AND round = $2', [entryId, round]);
  return rows.length ? mapPick(rows[0]) : null;
}
async function getPicksForEntry(entryId) {
  if (!available()) return [];
  const { rows } = await db.query('SELECT * FROM lms_picks WHERE entry_id = $1 ORDER BY round ASC', [entryId]);
  return rows.map(mapPick);
}
async function getPicksForRound(competitionId, round) {
  if (!available()) return [];
  const { rows } = await db.query(
    'SELECT * FROM lms_picks WHERE competition_id = $1 AND round = $2', [competitionId, round]);
  return rows.map(mapPick);
}
async function getUsedTeams(entryId) {
  if (!available()) return [];
  const { rows } = await db.query(
    "SELECT team FROM lms_picks WHERE entry_id = $1 AND result <> 'void'", [entryId]);
  return rows.map(function (r) { return r.team; });
}
async function createPick(data) {
  requireDb();
  const { rows } = await db.query(
    `INSERT INTO lms_picks (competition_id, entry_id, user_id, round, team, is_reuse, result)
     VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
    [data.competitionId, data.entryId, data.userId, data.round, data.team, !!data.isReuse]
  );
  return mapPick(rows[0]);
}
async function updatePick(id, fields) {
  requireDb();
  var map = { team: 'team', isReuse: 'is_reuse', result: 'result', fixtureId: 'fixture_id', settledAt: 'settled_at' };
  var sets = [], vals = [], i = 1;
  for (var k in fields) {
    if (!map[k] || fields[k] === undefined) continue;
    sets.push(map[k] + ' = $' + i); vals.push(fields[k]); i++;
  }
  if (!sets.length) return null;
  vals.push(id);
  const { rows } = await db.query('UPDATE lms_picks SET ' + sets.join(', ') + ' WHERE id = $' + i + ' RETURNING *', vals);
  return rows.length ? mapPick(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Purchases (£10 extra team)
// ---------------------------------------------------------------------------
async function createPurchase(data) {
  requireDb();
  const { rows } = await db.query(
    `INSERT INTO lms_purchases (competition_id, user_id, amount, stripe_session_id, status)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [data.competitionId, data.userId, data.amount, data.stripeSessionId || null, data.status || 'pending']
  );
  return mapPurchase(rows[0]);
}
async function getPurchaseBySession(sessionId) {
  if (!available()) return null;
  const { rows } = await db.query('SELECT * FROM lms_purchases WHERE stripe_session_id = $1', [sessionId]);
  return rows.length ? mapPurchase(rows[0]) : null;
}
async function updatePurchase(id, fields) {
  requireDb();
  var map = { status: 'status', stripeSessionId: 'stripe_session_id' };
  var sets = [], vals = [], i = 1;
  for (var k in fields) {
    if (!map[k] || fields[k] === undefined) continue;
    sets.push(map[k] + ' = $' + i); vals.push(fields[k]); i++;
  }
  if (!sets.length) return null;
  vals.push(id);
  const { rows } = await db.query('UPDATE lms_purchases SET ' + sets.join(', ') + ' WHERE id = $' + i + ' RETURNING *', vals);
  return rows.length ? mapPurchase(rows[0]) : null;
}
async function countPaidPurchases(competitionId, userId) {
  if (!available()) return 0;
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM lms_purchases WHERE competition_id = $1 AND user_id = $2 AND status = 'paid'",
    [competitionId, userId]);
  return rows[0] ? rows[0].n : 0;
}

// ---------------------------------------------------------------------------
// Settlement source — World Cup fixtures (read-only, from WC Mode tables)
//
// Group matchdays aren't numbered in world_cup_fixtures, so the service maps
// an LMS round to a fixture by kickoff order (matchday 1 = a team's earliest
// group game, etc.; knockout round N = the team's Nth knockout fixture). This
// returns every fixture a team is involved in, oldest first, for that mapping.
// ---------------------------------------------------------------------------
async function getWcFixturesForTeam(team) {
  if (!available()) return [];
  const { rows } = await db.query(
    `SELECT id, stage, group_letter, home_team, away_team, home_goals, away_goals,
            result, status, kickoff
     FROM world_cup_fixtures
     WHERE home_team = $1 OR away_team = $1
     ORDER BY kickoff ASC`,
    [team]
  );
  return rows;
}

// Real teams with an upcoming (not-finished) fixture — for the pick dropdown.
// Excludes knockout-bracket PLACEHOLDERS ("1st Group A", "2nd Group B",
// "3rd Group A/B/C/D/F", "Winner ...", etc.) that SportMonks uses for fixtures
// whose teams aren't decided yet. Naturally round-by-round: eliminated teams
// drop off, and qualified teams appear under their real names in the knockouts.
async function getWcTeams() {
  if (!available()) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT t AS team FROM (
       SELECT home_team AS t FROM world_cup_fixtures WHERE status <> 'finished' AND kickoff >= NOW() - INTERVAL '6 hours'
       UNION SELECT away_team AS t FROM world_cup_fixtures WHERE status <> 'finished' AND kickoff >= NOW() - INTERVAL '6 hours'
     ) x
     WHERE t IS NOT NULL
       AND t NOT ILIKE '%group%'
       AND t NOT ILIKE '%winner%'
       AND t NOT ILIKE '%runner%'
       AND t NOT ILIKE '%loser%'
       AND t NOT ILIKE '%/%'
       AND t !~ '^[0-9]'
     ORDER BY team ASC`
  );
  return rows.map(function (r) { return r.team; });
}

// Upcoming WC fixtures (not yet finished) within the next `days` days, oldest
// first — so players can see what's coming well in advance and plan their pick.
async function getUpcomingWcFixtures(days) {
  if (!available()) return [];
  var window = days || 7;
  const { rows } = await db.query(
    `SELECT id, stage, group_letter, home_team, away_team, kickoff, status
     FROM world_cup_fixtures
     WHERE status <> 'finished'
       AND kickoff IS NOT NULL
       AND kickoff >= NOW() - INTERVAL '6 hours'
       AND kickoff <= NOW() + ($1 || ' days')::interval
       AND home_team NOT ILIKE '%group%' AND home_team !~ '^[0-9]'
       AND away_team NOT ILIKE '%group%' AND away_team !~ '^[0-9]'
     ORDER BY kickoff ASC`,
    [String(window)]
  );
  return rows;
}

// Fixtures for a specific LMS round — the actual matchups players pick from.
// Group rounds (1-3): matchday N, derived per group by kickoff order (each
// group has 6 fixtures across 3 matchdays, 2 per matchday). Knockout rounds
// (4-8): by stage. Placeholders excluded. Consistent with settlement.
async function getWcRoundFixtures(round) {
  if (!available()) return [];
  if (round <= 3) {
    const { rows } = await db.query(
      `SELECT id, home_team, away_team, kickoff, group_letter, status FROM (
         SELECT id, home_team, away_team, kickoff, group_letter, status,
           CEIL(ROW_NUMBER() OVER (PARTITION BY group_letter ORDER BY kickoff)::numeric / 2) AS md
         FROM world_cup_fixtures
         WHERE stage = 'group' AND group_letter IS NOT NULL
           AND home_team NOT ILIKE '%group%' AND home_team !~ '^[0-9]'
           AND away_team NOT ILIKE '%group%' AND away_team !~ '^[0-9]'
       ) x WHERE md = $1 ORDER BY kickoff ASC`,
      [round]
    );
    return rows;
  }
  var stageMap = { 4: 'round-of-32', 5: 'round-of-16', 6: 'quarter-final', 7: 'semi-final', 8: 'final' };
  var stage = stageMap[round];
  if (!stage) return [];
  const { rows } = await db.query(
    `SELECT id, home_team, away_team, kickoff, group_letter, status FROM world_cup_fixtures
     WHERE stage = $1
       AND home_team NOT ILIKE '%group%' AND home_team !~ '^[0-9]'
       AND away_team NOT ILIKE '%group%' AND away_team !~ '^[0-9]'
     ORDER BY kickoff ASC`,
    [stage]
  );
  return rows;
}

// A team's next/current fixture for a given LMS round (for displaying who they play)
async function getWcFixtureByKickoffIndex(team, isGroup, index) {
  var all = await getWcFixturesForTeam(team);
  var filtered = all.filter(function (f) {
    return isGroup ? f.stage === 'group' : f.stage !== 'group';
  });
  return filtered[index] || null;
}

module.exports = {
  available,
  // competitions
  getCompetitions, getCompetitionById, createCompetition, updateCompetition, addToPot,
  // entries
  getEntry, getEntryById, getEntriesForCompetition, createEntry, updateEntry, incrementExtraTeams, countAlive,
  // picks
  getPick, getPicksForEntry, getPicksForRound, getUsedTeams, createPick, updatePick,
  // purchases
  createPurchase, getPurchaseBySession, updatePurchase, countPaidPurchases,
  // settlement source
  getWcFixturesForTeam, getWcTeams, getWcFixtureByKickoffIndex, getUpcomingWcFixtures, getWcRoundFixtures,
  // mappers (exposed for tests)
  _map: { mapCompetition, mapEntry, mapPick, mapPurchase },
};
