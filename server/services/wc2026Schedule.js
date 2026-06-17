/**
 * FIFA World Cup 2026 — canonical Last Man Standing schedule.
 *
 * Source of truth for LMS rounds/fixtures (supplied by Darren). The live
 * SportMonks feed is provisional pre-draw, so we drive the LMS fixtures from
 * THIS schedule and only use the feed for actual match results.
 *
 * LMS rounds: 1-3 = group matchdays, 4=R32, 5=R16, 6=QF, 7=SF, 8=Final.
 * Update the arrays below if the official schedule changes.
 */

var MATCHDAY_1 = [
  { date: '2026-06-11', home: 'Mexico', away: 'South Africa' },
  { date: '2026-06-12', home: 'South Korea', away: 'Czech Republic' },
  { date: '2026-06-12', home: 'Canada', away: 'Bosnia & Herzegovina' },
  { date: '2026-06-13', home: 'USA', away: 'Paraguay' },
  { date: '2026-06-13', home: 'Qatar', away: 'Switzerland' },
  { date: '2026-06-13', home: 'Brazil', away: 'Morocco' },
  { date: '2026-06-14', home: 'Haiti', away: 'Scotland' },
  { date: '2026-06-14', home: 'Australia', away: 'Turkey' },
  { date: '2026-06-14', home: 'Germany', away: 'Curacao' },
  { date: '2026-06-14', home: 'Netherlands', away: 'Japan' },
  { date: '2026-06-15', home: 'Ivory Coast', away: 'Ecuador' },
  { date: '2026-06-15', home: 'Sweden', away: 'Tunisia' },
  { date: '2026-06-15', home: 'Spain', away: 'Cape Verde' },
  { date: '2026-06-15', home: 'Belgium', away: 'Egypt' },
  { date: '2026-06-15', home: 'Saudi Arabia', away: 'Uruguay' },
  { date: '2026-06-16', home: 'France', away: 'Senegal' },
  { date: '2026-06-16', home: 'Iraq', away: 'Norway' },
  { date: '2026-06-16', home: 'New Zealand', away: 'Iran' },
  { date: '2026-06-16', home: 'Argentina', away: 'Algeria' },
  { date: '2026-06-17', home: 'Austria', away: 'Jordan' },
  { date: '2026-06-17', home: 'Portugal', away: 'DR Congo' },
  { date: '2026-06-17', home: 'Uzbekistan', away: 'Colombia' },
  { date: '2026-06-17', home: 'England', away: 'Croatia' },
  { date: '2026-06-17', home: 'Ghana', away: 'Panama' },
];

var MATCHDAY_2 = [
  { date: '2026-06-18', home: 'Czech Republic', away: 'South Africa' },
  { date: '2026-06-18', home: 'Switzerland', away: 'Bosnia & Herzegovina' },
  { date: '2026-06-18', home: 'Canada', away: 'Qatar' },
  { date: '2026-06-18', home: 'Mexico', away: 'South Korea' },
  { date: '2026-06-19', home: 'Paraguay', away: 'Turkey' },
  { date: '2026-06-19', home: 'USA', away: 'Australia' },
  { date: '2026-06-19', home: 'Morocco', away: 'Haiti' },
  { date: '2026-06-19', home: 'Brazil', away: 'Scotland' },
  { date: '2026-06-20', home: 'Ecuador', away: 'Japan' },
  { date: '2026-06-20', home: 'Ivory Coast', away: 'Netherlands' },
  { date: '2026-06-20', home: 'Egypt', away: 'New Zealand' },
  { date: '2026-06-20', home: 'Belgium', away: 'Iran' },
  { date: '2026-06-21', home: 'Spain', away: 'Saudi Arabia' },
  { date: '2026-06-21', home: 'Uruguay', away: 'Cape Verde' },
  { date: '2026-06-21', home: 'Norway', away: 'Senegal' },
  { date: '2026-06-21', home: 'France', away: 'Iraq' },
  { date: '2026-06-22', home: 'Argentina', away: 'Austria' },
  { date: '2026-06-22', home: 'Algeria', away: 'Jordan' },
  { date: '2026-06-22', home: 'Portugal', away: 'Ghana' },
  { date: '2026-06-22', home: 'DR Congo', away: 'Panama' },
  { date: '2026-06-23', home: 'England', away: 'Ghana' },
  { date: '2026-06-23', home: 'Croatia', away: 'Panama' },
  { date: '2026-06-23', home: 'Colombia', away: 'Austria' },
  { date: '2026-06-23', home: 'Uzbekistan', away: 'Jordan' },
];

var MATCHDAY_3 = [
  { home: 'Czech Republic', away: 'Mexico' },
  { home: 'South Africa', away: 'South Korea' },
  { home: 'Switzerland', away: 'Canada' },
  { home: 'Bosnia & Herzegovina', away: 'Qatar' },
  { home: 'Brazil', away: 'Scotland' },
  { home: 'Morocco', away: 'Haiti' },
  { home: 'USA', away: 'Turkey' },
  { home: 'Paraguay', away: 'Australia' },
  { home: 'Netherlands', away: 'Tunisia' },
  { home: 'Ivory Coast', away: 'Japan' },
  { home: 'Sweden', away: 'Ecuador' },
  { home: 'Belgium', away: 'Iran' },
  { home: 'New Zealand', away: 'Egypt' },
  { home: 'Spain', away: 'Saudi Arabia' },
  { home: 'Uruguay', away: 'Cape Verde' },
  { home: 'France', away: 'Norway' },
  { home: 'Senegal', away: 'Iraq' },
  { home: 'Argentina', away: 'Austria' },
  { home: 'Algeria', away: 'Jordan' },
  { home: 'Portugal', away: 'Ghana' },
  { home: 'DR Congo', away: 'Panama' },
  { home: 'England', away: 'Panama' },
  { home: 'Croatia', away: 'Ghana' },
];

// Knockout bracket — placeholders ("2A", "Winner 73") until teams are decided.
var KNOCKOUT = [
  { round: 'R32', matchId: 73, home: '2A', away: '2B' },
  { round: 'R32', matchId: 74, home: '1E', away: 'Best Third Place' },
  { round: 'R32', matchId: 75, home: '1F', away: '2C' },
  { round: 'R32', matchId: 76, home: '1C', away: '2F' },
  { round: 'R32', matchId: 77, home: '1I', away: 'Best Third Place' },
  { round: 'R32', matchId: 78, home: '2E', away: '2I' },
  { round: 'R32', matchId: 79, home: '1A', away: 'Best Third Place' },
  { round: 'R32', matchId: 80, home: '1L', away: 'Best Third Place' },
  { round: 'R32', matchId: 81, home: '1D', away: 'Best Third Place' },
  { round: 'R32', matchId: 82, home: '1G', away: 'Best Third Place' },
  { round: 'R32', matchId: 83, home: '2K', away: '2L' },
  { round: 'R32', matchId: 84, home: '1H', away: '2J' },
  { round: 'R32', matchId: 85, home: '1B', away: 'Best Third Place' },
  { round: 'R32', matchId: 86, home: '1J', away: '2H' },
  { round: 'R32', matchId: 87, home: '1K', away: 'Best Third Place' },
  { round: 'R32', matchId: 88, home: '2D', away: '2G' },
  { round: 'R16', matchId: 89, home: 'Winner 73', away: 'Winner 75' },
  { round: 'R16', matchId: 90, home: 'Winner 74', away: 'Winner 77' },
  { round: 'R16', matchId: 91, home: 'Winner 76', away: 'Winner 78' },
  { round: 'R16', matchId: 92, home: 'Winner 79', away: 'Winner 80' },
  { round: 'R16', matchId: 93, home: 'Winner 83', away: 'Winner 84' },
  { round: 'R16', matchId: 94, home: 'Winner 81', away: 'Winner 82' },
  { round: 'R16', matchId: 95, home: 'Winner 86', away: 'Winner 88' },
  { round: 'R16', matchId: 96, home: 'Winner 85', away: 'Winner 87' },
  { round: 'QF', matchId: 97, home: 'Winner 89', away: 'Winner 90' },
  { round: 'QF', matchId: 98, home: 'Winner 93', away: 'Winner 94' },
  { round: 'QF', matchId: 99, home: 'Winner 91', away: 'Winner 92' },
  { round: 'QF', matchId: 100, home: 'Winner 95', away: 'Winner 96' },
  { round: 'SF', matchId: 101, home: 'Winner 97', away: 'Winner 98' },
  { round: 'SF', matchId: 102, home: 'Winner 99', away: 'Winner 100' },
  { round: 'FINAL', matchId: 104, home: 'Winner 101', away: 'Winner 102' },
];

var KO_ROUND_BY_LMS = { 4: 'R32', 5: 'R16', 6: 'QF', 7: 'SF', 8: 'FINAL' };

// Is this a placeholder slot rather than a real nation?
function isPlaceholder(name) {
  return /^(\d|winner|loser|best third|runner)/i.test(String(name || '').trim());
}

// Normalise a team name for matching against the results feed (handles common
// World Cup naming differences).
// Every known naming variant maps to ONE canonical token (after norm() lowercases
// + strips accents/punctuation). Both sides of a match get normalised, so e.g.
// "Türkiye" and "Turkey" both become "turkiye"; "Cape Verde Islands", "Cape Verde"
// and "Cabo Verde" all become "cape verde".
var ALIASES = {
  'south korea': 'korea republic', 'korea rep': 'korea republic', 'korea republic': 'korea republic', 'republic of korea': 'korea republic',
  'usa': 'united states', 'us': 'united states', 'united states of america': 'united states', 'united states': 'united states',
  'ivory coast': 'cote divoire', 'cote d ivoire': 'cote divoire', 'cote divoire': 'cote divoire',
  'dr congo': 'congo dr', 'congo dr': 'congo dr', 'drc': 'congo dr', 'democratic republic of congo': 'congo dr', 'democratic republic of the congo': 'congo dr',
  'cape verde': 'cape verde', 'cape verde islands': 'cape verde', 'cabo verde': 'cape verde',
  'turkey': 'turkiye', 'turkiye': 'turkiye',
  'bosnia': 'bosnia', 'bosnia herzegovina': 'bosnia', 'bosnia and herzegovina': 'bosnia',
  'czechia': 'czech republic', 'czech republic': 'czech republic',
  'china pr': 'china', 'china': 'china',
  'ir iran': 'iran', 'iran': 'iran',
};
function norm(name) {
  var s = String(name || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return ALIASES[s] || s;
}
function teamsMatch(a, b) {
  var na = norm(a), nb = norm(b);
  if (na === nb) return true;
  if (!na || !nb) return false;
  if (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return true;
  // Spacing-insensitive fallback (e.g. "cote d ivoire" vs "cote divoire")
  var sa = na.replace(/ /g, ''), sb = nb.replace(/ /g, '');
  return sa === sb || sa.indexOf(sb) !== -1 || sb.indexOf(sa) !== -1;
}

// Fixtures for an LMS round (1-3 group, 4-8 knockout)
function roundFixtures(round) {
  if (round === 1) return MATCHDAY_1;
  if (round === 2) return MATCHDAY_2;
  if (round === 3) return MATCHDAY_3;
  var ko = KO_ROUND_BY_LMS[round];
  return ko ? KNOCKOUT.filter(function (f) { return f.round === ko; }) : [];
}

// Real (non-placeholder) teams playing in a round
function realTeamsForRound(round) {
  var set = {};
  roundFixtures(round).forEach(function (f) {
    if (!isPlaceholder(f.home)) set[f.home] = true;
    if (!isPlaceholder(f.away)) set[f.away] = true;
  });
  return Object.keys(set).sort();
}

// All real nations across the group stage (for the full pick pool)
function allGroupTeams() {
  var set = {};
  [].concat(MATCHDAY_1, MATCHDAY_2, MATCHDAY_3).forEach(function (f) {
    set[f.home] = true; set[f.away] = true;
  });
  return Object.keys(set).sort();
}

// The fixture a given team plays in a round (or null)
function fixtureForTeam(round, team) {
  return roundFixtures(round).find(function (f) {
    return teamsMatch(f.home, team) || teamsMatch(f.away, team);
  }) || null;
}

module.exports = {
  matchday1: MATCHDAY_1, matchday2: MATCHDAY_2, matchday3: MATCHDAY_3, knockout: KNOCKOUT,
  roundFixtures: roundFixtures,
  realTeamsForRound: realTeamsForRound,
  allGroupTeams: allGroupTeams,
  fixtureForTeam: fixtureForTeam,
  isPlaceholder: isPlaceholder,
  norm: norm,
  teamsMatch: teamsMatch,
};
