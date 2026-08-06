/**
 * SportMonks Football API v3 — Live Scores, Fixtures, Odds, xG
 *
 * Primary football data source. Provides:
 *  - Live scores (15-second delay)
 *  - Fixtures by date (past, today, future)
 *  - Pre-match & in-play odds from 140+ bookmakers
 *  - Match statistics, xG, lineups, events
 *  - Head-to-head history
 *
 * Falls back to API-Football if SportMonks is unavailable.
 */

'use strict';

var https = require('https');
var BASE_URL = 'api.sportmonks.com';
var API_PATH = '/v3/football';

function SportMonks() {
  this.apiKey = process.env.SPORTMONKS_API_KEY || '';
  this.name = 'SportMonks';
  this.requestCount = 0;
  this.lastError = null;
  this._oddsCache = {}; // fixtureId -> { at, val } market odds, short-TTL
}

SportMonks.prototype.isAvailable = function() {
  return !!this.apiKey;
};

// Core API request method
SportMonks.prototype._request = function(path, params) {
  var self = this;
  var token = this.apiKey;
  if (!token) return Promise.reject(new Error('No SportMonks API key'));

  var queryParts = ['api_token=' + token];
  if (params) {
    Object.keys(params).forEach(function(k) {
      if (params[k] !== undefined && params[k] !== null) {
        queryParts.push(k + '=' + encodeURIComponent(params[k]));
      }
    });
  }
  var fullPath = API_PATH + path + '?' + queryParts.join('&');

  return new Promise(function(resolve, reject) {
    var options = {
      hostname: BASE_URL,
      path: fullPath,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    };
    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        self.requestCount++;
        try {
          var data = JSON.parse(body);
          if (data.message && !data.data) {
            self.lastError = data.message;
            reject(new Error(data.message));
          } else {
            resolve(data);
          }
        } catch(e) {
          reject(new Error('Failed to parse SportMonks response'));
        }
      });
    });
    req.on('error', function(e) { self.lastError = e.message; reject(e); });
    req.setTimeout(12000, function() { req.destroy(); reject(new Error('SportMonks timeout')); });
    req.end();
  });
};

// =========================================================================
// LIVESCORES — currently in-play matches (15-second updates)
// =========================================================================
SportMonks.prototype.getLivescores = function() {
  return this._request('/livescores', {
    include: 'participants;scores;events;state;league;venue',
  }).then(function(data) {
    return (data.data || []).map(normaliseFixture);
  });
};

// =========================================================================
// FIXTURES BY DATE — past, today, or future
// =========================================================================
SportMonks.prototype.getFixturesByDate = function(dateStr) {
  var self = this;
  return this._request('/fixtures/date/' + dateStr, {
    include: 'participants;scores;state;league;venue',
    per_page: 50,
  }).then(function(data) {
    var fixtures = (data.data || []).map(normaliseFixture);
    self._lastFixtures = fixtures; // Cache for logo fallback in match intelligence
    return fixtures;
  });
};

// =========================================================================
// FIXTURES BY LEAGUE + DATE — filtered to specific leagues
// =========================================================================
SportMonks.prototype.getFixturesByLeagueDate = function(leagueId, dateStr) {
  return this._request('/fixtures/date/' + dateStr, {
    include: 'participants;scores;state;league;venue',
    filters: 'fixtureLeagues:' + leagueId,
    per_page: 50,
  }).then(function(data) {
    return (data.data || []).map(normaliseFixture);
  });
};

// =========================================================================
// SINGLE FIXTURE — full detail with stats, lineups, odds, xG
// =========================================================================
SportMonks.prototype.getFixture = function(fixtureId) {
  return this._request('/fixtures/' + fixtureId, {
    include: 'participants;scores;statistics;events;lineups;state;league;venue',
  }).then(function(data) {
    if (!data.data) return null;
    return normaliseFixture(data.data);
  });
};

// =========================================================================
// HEAD TO HEAD — historical matches between two teams
// =========================================================================
SportMonks.prototype.getH2H = function(teamId1, teamId2) {
  return this._request('/fixtures/head-to-head/' + teamId1 + '/' + teamId2, {
    include: 'participants;scores;state',
    per_page: 10,
  }).then(function(data) {
    return (data.data || []).map(normaliseFixture);
  });
};

// =========================================================================
// ODDS — pre-match odds for a fixture
// =========================================================================
SportMonks.prototype.getOdds = function(fixtureId) {
  return this._request('/odds/pre-match/fixtures/' + fixtureId, {
    include: 'market;bookmaker',
  }).then(function(data) {
    return data.data || [];
  });
};

// Clean, bookmaker-averaged market odds for a fixture: 1X2 + Over/Under 2.5/3.5
// + BTTS. Returns decimal odds (null where unavailable). Market = sharpest signal.
SportMonks.prototype.getMarketOdds = function(fixtureId) {
  return this.getOdds(fixtureId).then(function(oddsArr) {
    var acc = { home: [], draw: [], away: [], over25: [], under25: [], over35: [], bttsYes: [] };
    (oddsArr || []).forEach(function(o) {
      var label = (o.label || o.name || '').toLowerCase();
      var val = parseFloat(o.value);
      if (!val || val <= 1) return;
      var mid = o.market_id;
      var total = (o.total != null ? String(o.total) : '');
      if (mid === 1) {
        if (label === 'home' || label === '1') acc.home.push(val);
        else if (label === 'draw' || label === 'x') acc.draw.push(val);
        else if (label === 'away' || label === '2') acc.away.push(val);
      } else if (mid === 12 || mid === 18) {
        if (label.indexOf('over') !== -1) {
          if (total === '2.5' || label.indexOf('2.5') !== -1) acc.over25.push(val);
          if (total === '3.5' || label.indexOf('3.5') !== -1) acc.over35.push(val);
        } else if (label.indexOf('under') !== -1) {
          if (total === '2.5' || label.indexOf('2.5') !== -1) acc.under25.push(val);
        }
      } else if (mid === 3) {
        if (label === 'yes' || label.indexOf('yes') !== -1) acc.bttsYes.push(val);
      }
    });
    var avg = function(a) { return a.length ? a.reduce(function(s, x) { return s + x; }, 0) / a.length : null; };
    return {
      home: avg(acc.home), draw: avg(acc.draw), away: avg(acc.away),
      over25: avg(acc.over25), under25: avg(acc.under25), over35: avg(acc.over35),
      bttsYes: avg(acc.bttsYes),
      books: acc.home.length || acc.away.length,
    };
  }).catch(function() { return null; });
};

// Cached wrapper around getMarketOdds — pre-match prices move slowly, so a 5-min
// cache per fixture lets us enrich a whole fixture list cheaply (and repeatedly)
// without hammering the odds endpoint. Returns null (and caches the miss) when a
// fixture has no odds yet, so we don't re-request empty markets every poll.
SportMonks.prototype.getMarketOddsCached = function(fixtureId) {
  var self = this;
  var now = Date.now();
  var hit = this._oddsCache[fixtureId];
  if (hit && (now - hit.at) < 300000) return Promise.resolve(hit.val);
  return this.getMarketOdds(fixtureId).then(function(od) {
    self._oddsCache[fixtureId] = { at: now, val: od || null };
    return od || null;
  }).catch(function() {
    self._oddsCache[fixtureId] = { at: now, val: null };
    return null;
  });
};

// Enrich a fixture list (from getFixturesByDate, which omits odds) with real
// SportMonks market odds, joined by the fixture's own id — an EXACT join, no
// fuzzy name matching. Only fixtures missing odds and not finished are fetched;
// runs in small concurrent batches with a hard cap so a busy day can't fan out
// into hundreds of calls. Mutates fixtures in place and returns them.
SportMonks.prototype.enrichFixturesWithOdds = function(fixtures, opts) {
  opts = opts || {};
  var self = this;
  var cap = opts.cap || 60;      // never price more than this many fixtures/call
  var conc = opts.concurrency || 6;
  var FIN = { FT: 1, AET: 1, PEN: 1, CANC: 1, POSTP: 1, ABAN: 1 };
  var targets = (fixtures || []).filter(function(f) {
    return f && f.id && !f.homeOdds && !FIN[f.status];
  }).slice(0, cap);
  if (!targets.length) return Promise.resolve(fixtures);
  var i = 0;
  var worker = function() {
    if (i >= targets.length) return Promise.resolve();
    var f = targets[i++];
    return self.getMarketOddsCached(f.id).then(function(od) {
      if (od) {
        if (od.home) f.homeOdds = od.home;
        if (od.draw) f.drawOdds = od.draw;
        if (od.away) f.awayOdds = od.away;
        if (od.over25) f.overOdds = od.over25;
        if (od.under25) f.underOdds = od.under25;
        if (od.bttsYes) f.bttsOdds = od.bttsYes;
      }
      return worker();
    }).catch(function() { return worker(); });
  };
  var runners = [];
  for (var w = 0; w < conc; w++) runners.push(worker());
  return Promise.all(runners).then(function() { return fixtures; });
};

// =========================================================================
// LEAGUES — list available leagues
// =========================================================================
SportMonks.prototype.getLeagues = function() {
  return this._request('/leagues', {
    include: 'currentSeason',
    per_page: 50,
  }).then(function(data) {
    return data.data || [];
  });
};

// =========================================================================
// STANDINGS — league standings
// =========================================================================
SportMonks.prototype.getStandings = function(seasonId) {
  return this._request('/standings/seasons/' + seasonId, {
    include: 'participant;details.type',
  }).then(function(data) {
    return data.data || [];
  });
};

// =========================================================================
// PREDICTIONS — pre-match probabilities (All-In plan)
// =========================================================================
SportMonks.prototype.getPredictions = function(fixtureId) {
  return this._request('/predictions/probabilities/fixtures/' + fixtureId, {})
    .then(function(data) { return data.data || []; })
    .catch(function() { return []; });
};

// =========================================================================
// RAW FIXTURE — full fixture with chosen includes (for diagnostics + rich data)
// Returns the raw SportMonks object (not normalised) so callers can read xG,
// lineups, statistics, predictions etc. directly.
// =========================================================================
SportMonks.prototype.getFixtureRaw = function(fixtureId, includes) {
  return this._request('/fixtures/' + fixtureId, {
    include: includes || 'participants;scores;statistics.type;events;lineups;state;league;venue;predictions.type',
  }).then(function(data) { return data.data || null; });
};

// =========================================================================
// RICH FIXTURE DATA — one call that returns the All-In match detail we display:
// probable/confirmed lineups WITH player ratings, formations, the full team
// stat sheet, and the per-minute Pressure Index momentum. Every field is
// defensively parsed and returns null when absent (e.g. stats/pressure are
// empty pre-match). Include names confirmed live (18 Jun 2026) — see
// project_worldcup_data memory. xG is intentionally NOT requested: the WC feed
// does not populate it.
// =========================================================================
SportMonks.prototype.getFixtureRichData = function(fixtureId, homeTeamId, awayTeamId) {
  return this._request('/fixtures/' + fixtureId, {
    include: 'participants;statistics.type;lineups.details.type;formations;pressure;state',
  }).then(function(data) {
    var raw = data.data;
    if (!raw) return null;
    var hId = homeTeamId, aId = awayTeamId;
    if (!hId || !aId) {
      (raw.participants || []).forEach(function(p) {
        if (p.meta && p.meta.location === 'home') hId = p.id;
        else if (p.meta && p.meta.location === 'away') aId = p.id;
      });
    }
    return {
      lineups: parseLineups(raw, hId, aId),
      formations: parseFormations(raw, hId, aId),
      teamStats: parseTeamStats(raw, hId, aId),
      pressure: parsePressure(raw, hId, aId),
    };
  });
};

// Lineups with per-player rating + key stats. SportMonks: type_id 11 = starting
// XI, 12 = bench; only starters carry a details[] of player match stats.
function parseLineups(raw, homeId, awayId) {
  if (!raw.lineups || !raw.lineups.length) return null;
  var home = [], away = [];
  raw.lineups.forEach(function(l) {
    var rating = null;
    if (Array.isArray(l.details)) {
      l.details.forEach(function(d) {
        var dn = d.type && d.type.developer_name;
        if (dn === 'RATING' && d.data && d.data.value != null) rating = d.data.value;
      });
    }
    var entry = {
      name: l.player_name || '',
      number: l.jersey_number != null ? l.jersey_number : null,
      starter: l.type_id === 11,
      rating: rating != null ? Number(rating) : null,
    };
    if (l.team_id === homeId) home.push(entry);
    else if (l.team_id === awayId) away.push(entry);
  });
  // Starters first (by shirt number), then bench.
  var order = function(a, b) {
    if (a.starter !== b.starter) return a.starter ? -1 : 1;
    return (a.number || 99) - (b.number || 99);
  };
  home.sort(order); away.sort(order);
  if (!home.length && !away.length) return null;
  return { home: home, away: away };
}

function parseFormations(raw, homeId, awayId) {
  if (!raw.formations || !raw.formations.length) return null;
  var out = { home: null, away: null };
  raw.formations.forEach(function(f) {
    if (f.participant_id === homeId || f.location === 'home') out.home = f.formation || out.home;
    else if (f.participant_id === awayId || f.location === 'away') out.away = f.formation || out.away;
  });
  return (out.home || out.away) ? out : null;
}

// Curated team stat sheet (only the rows worth showing), in display order.
// Returns null pre-match when statistics are empty.
var TEAM_STAT_ROWS = [
  { key: 'BALL_POSSESSION', label: 'Possession', suffix: '%' },
  { key: 'SHOTS_TOTAL', label: 'Shots' },
  { key: 'SHOTS_ON_TARGET', label: 'Shots on Target' },
  { key: 'BIG_CHANCES_CREATED', label: 'Big Chances' },
  { key: 'DANGEROUS_ATTACKS', label: 'Dangerous Attacks' },
  { key: 'CORNERS', label: 'Corners' },
  { key: 'KEY_PASSES', label: 'Key Passes' },
  { key: 'SUCCESSFUL_PASSES_PERCENTAGE', label: 'Pass Accuracy', suffix: '%' },
  { key: 'FOULS', label: 'Fouls' },
  { key: 'YELLOWCARDS', label: 'Yellow Cards' },
  { key: 'REDCARDS', label: 'Red Cards' },
];
function parseTeamStats(raw, homeId, awayId) {
  if (!raw.statistics || !raw.statistics.length) return null;
  var map = { home: {}, away: {} };
  raw.statistics.forEach(function(s) {
    var dn = (s.type && s.type.developer_name) || s.type_id;
    var val = s.data && s.data.value !== undefined ? s.data.value : s.value;
    var loc = s.location || (s.participant_id === homeId ? 'home' : s.participant_id === awayId ? 'away' : null);
    if (loc === 'home') map.home[dn] = val;
    else if (loc === 'away') map.away[dn] = val;
  });
  var rows = TEAM_STAT_ROWS.map(function(r) {
    // Need BOTH sides present + numeric to show a fair comparison — a one-sided
    // value would render as "53% vs 0%", which reads as a real zero, not "no data".
    var h = Number(map.home[r.key]), a = Number(map.away[r.key]);
    if (map.home[r.key] == null || map.away[r.key] == null || isNaN(h) || isNaN(a)) return null;
    return { label: r.label, home: h, away: a, suffix: r.suffix || '' };
  }).filter(Boolean);
  return rows.length ? rows : null;
}

// Per-minute Pressure Index → momentum share + a downsampled timeline for a
// sparkline. pressure is 0-100 per team per minute.
function parsePressure(raw, homeId, awayId) {
  if (!raw.pressure || !raw.pressure.length) return null;
  var byMin = {};
  var homeSum = 0, awaySum = 0, homeN = 0, awayN = 0;
  raw.pressure.forEach(function(p) {
    var min = p.minute;
    if (min == null) return;
    if (!byMin[min]) byMin[min] = { minute: min, home: null, away: null };
    if (p.participant_id === homeId) { byMin[min].home = p.pressure; homeSum += p.pressure || 0; homeN++; }
    else if (p.participant_id === awayId) { byMin[min].away = p.pressure; awaySum += p.pressure || 0; awayN++; }
  });
  var minutes = Object.keys(byMin).map(Number).sort(function(a, b) { return a - b; });
  if (!minutes.length) return null;
  // Downsample into ~24 buckets so the timeline payload stays small.
  var bucketSize = Math.max(1, Math.ceil(minutes.length / 24));
  var timeline = [];
  for (var i = 0; i < minutes.length; i += bucketSize) {
    var slice = minutes.slice(i, i + bucketSize);
    var hAcc = 0, aAcc = 0, hC = 0, aC = 0;
    slice.forEach(function(mn) {
      var rec = byMin[mn];
      if (rec.home != null) { hAcc += rec.home; hC++; }
      if (rec.away != null) { aAcc += rec.away; aC++; }
    });
    timeline.push({
      minute: slice[slice.length - 1],
      home: hC ? Math.round(hAcc / hC) : 0,
      away: aC ? Math.round(aAcc / aC) : 0,
    });
  }
  var homeAvg = homeN ? homeSum / homeN : 0;
  var awayAvg = awayN ? awaySum / awayN : 0;
  var total = homeAvg + awayAvg;
  if (!total) return null; // all-zero pressure → no momentum to show, hide the section
  var homeShare = Math.round((homeAvg / total) * 100);
  return {
    homeShare: homeShare,
    awayShare: 100 - homeShare, // derived so the two always sum to 100
    timeline: timeline,
  };
}

// =========================================================================
// PROBE INCLUDE — test whether a single SportMonks include is supported on
// this plan and return what (if anything) it yields for a fixture. Used by the
// fixture-data diagnostic to confirm the exact include name + key shapes for
// rich All-In data (Pressure Index, live xG, per-player stats) before wiring
// UI against it. Never throws — reports the error string instead.
// =========================================================================
SportMonks.prototype.probeInclude = function(fixtureId, include) {
  return this._request('/fixtures/' + fixtureId, { include: include })
    .then(function(data) {
      var fx = data.data || {};
      // The include name maps to a top-level key on the fixture (last segment,
      // camelCase). Report the raw value so we can read its real shape.
      var key = include.split('.')[0];
      var val = fx[key];
      return {
        include: include,
        ok: true,
        present: val !== undefined && val !== null,
        count: Array.isArray(val) ? val.length : (val ? 1 : 0),
        sample: Array.isArray(val) ? val.slice(0, 2) : val,
      };
    })
    .catch(function(e) {
      return { include: include, ok: false, error: e.message };
    });
};

// =========================================================================
// TEAM RECENT FIXTURES — a team's matches in a date range (for form + stats)
// =========================================================================
SportMonks.prototype.getTeamRecentFixtures = function(teamId, fromDate, toDate) {
  return this._request('/fixtures/between/' + fromDate + '/' + toDate + '/' + teamId, {
    include: 'participants;scores;state;league',
    per_page: 50,
  }).then(function(data) {
    return (data.data || []).map(normaliseFixture);
  });
};

// =========================================================================
// TEAM DETAIL — rich club data (All-In plan). Tries a full include set and
// falls back to the bare team if SportMonks rejects an include, so we always
// return at least name/logo/founded.
// =========================================================================
SportMonks.prototype.getTeam = function(teamId) {
  var self = this;
  return this._request('/teams/' + teamId, { include: 'country;venue;activeseasons' })
    .then(function(d) { return d.data || null; })
    .catch(function() {
      return self._request('/teams/' + teamId, {}).then(function(d) { return d.data || null; }).catch(function() { return null; });
    });
};

// Current squad with player detail. Best-effort — returns [] on failure.
SportMonks.prototype.getTeamSquad = function(teamId) {
  return this._request('/squads/teams/' + teamId, { include: 'player;position' })
    .then(function(d) { return d.data || []; })
    .catch(function() {
      return this._request ? Promise.resolve([]) : [];
    }.bind(this))
    .catch(function() { return []; });
};

// Season statistics for a team (goals, form, etc.). Best-effort.
SportMonks.prototype.getTeamStats = function(teamId) {
  return this._request('/teams/' + teamId, { include: 'statistics.details.type' })
    .then(function(d) { return (d.data && d.data.statistics) || []; })
    .catch(function() { return []; });
};

// Search teams by name → returns matches (id, name, image_path, country).
SportMonks.prototype.searchTeams = function(name) {
  return this._request('/teams/search/' + encodeURIComponent(name), { include: 'country' })
    .then(function(d) { return d.data || []; })
    .catch(function() { return []; });
};

// =========================================================================
// LEAGUE SEARCH — find a league by name (e.g. "FIFA World Cup")
// =========================================================================
SportMonks.prototype.searchLeagues = function(name) {
  return this._request('/leagues/search/' + encodeURIComponent(name), {
    include: 'currentSeason',
  }).then(function(data) {
    return data.data || [];
  });
};

// =========================================================================
// FIXTURES BETWEEN DATES — full schedule for a date range, optional league
// filter. Returns RAW fixtures (incl. round/stage/group) so callers can read
// tournament structure. Follows pagination.
// =========================================================================
SportMonks.prototype.getFixturesBetween = function(startDate, endDate, leagueId) {
  var self = this;
  var all = [];
  function fetchPage(page) {
    var params = {
      include: 'participants;scores;state;league;venue;round;stage;group',
      per_page: 50,
      page: page,
    };
    if (leagueId) params.filters = 'fixtureLeagues:' + leagueId;
    return self._request('/fixtures/between/' + startDate + '/' + endDate, params).then(function(data) {
      var rows = data.data || [];
      all = all.concat(rows);
      var pg = data.pagination || {};
      if (pg.has_more && page < 25) return fetchPage(page + 1);
      return all;
    });
  }
  return fetchPage(1);
};

// =========================================================================
// TOP LEAGUE IDS (SportMonks v3)
// =========================================================================
SportMonks.TOP_LEAGUES = [
  8,    // Premier League
  564,  // Championship
  72,   // Bundesliga
  301,  // Ligue 1
  384,  // Serie A
  564,  // La Liga
  462,  // Eredivisie
  501,  // Primeira Liga
  271,  // Premiership (Scotland)
  513,  // Super Lig (Turkey)
  208,  // Belgian Pro League
  600,  // MLS
  732,  // Champions League
  733,  // Europa League
  1325, // Conference League
  1326, // FA Cup
  1327, // League Cup
];

// =========================================================================
// NORMALISE — convert SportMonks format to our internal format
// =========================================================================
function normaliseFixture(f) {
  if (!f) return null;

  // Extract participants (teams)
  var participants = f.participants || [];
  var home = participants.find(function(p) { return p.meta && p.meta.location === 'home'; }) || participants[0] || {};
  var away = participants.find(function(p) { return p.meta && p.meta.location === 'away'; }) || participants[1] || {};

  // Extract scores
  var scores = f.scores || [];
  var homeGoals = null;
  var awayGoals = null;
  scores.forEach(function(s) {
    if (s.description === 'CURRENT') {
      if (s.score && s.score.participant === 'home') homeGoals = s.score.goals;
      if (s.score && s.score.participant === 'away') awayGoals = s.score.goals;
    }
  });
  // Fallback: parse from result_info
  if (homeGoals === null && f.result_info) {
    var scoreMatch = f.result_info.match(/(\d+)-(\d+)/);
    if (scoreMatch) {
      homeGoals = parseInt(scoreMatch[1]);
      awayGoals = parseInt(scoreMatch[2]);
    }
  }

  // Map state to our status format
  // SportMonks state can be: nested object with .state/.developer_name, or just state_id on fixture
  var state = f.state || {};
  var stateId = state.id || f.state_id || null;
  var stateName = (state.state || state.developer_name || state.short_name || '').toUpperCase();

  // SportMonks state IDs: 1=NS, 2=LIVE, 3=HT, 4=ET, 5=PEN, 6=FT, 7=AET, 8=FT_PEN
  // 9=POSTP, 10=SUSP, 11=INT, 12=ABAN, 13=CANC, 14=AWARDED, 15=WO, 22=BREAK, 25=AU
  var status = 'NS';
  var finishedIds = [5, 6, 7, 8, 14, 15]; // PEN, FT, AET, FT_PEN, AWARDED, WO
  var liveIds = [2, 3, 4, 11, 22, 25]; // LIVE, HT, ET, INT, BREAK, AU
  var finishedNames = ['FT', 'AET', 'FT_PEN', 'FINISHED', 'ENDED', 'AWARDED', 'WO', 'PEN'];
  var liveNames = ['LIVE', '1ST_HALF', '2ND_HALF', 'HT', 'ET', 'PEN_LIVE', 'BREAK', 'INPLAY', 'INT'];

  if (finishedNames.indexOf(stateName) !== -1 || (stateId && finishedIds.indexOf(stateId) !== -1)) {
    status = stateName === 'AET' ? 'AET' : (stateName === 'FT_PEN' || stateId === 8) ? 'PEN' : 'FT';
  } else if (liveNames.indexOf(stateName) !== -1 || (stateId && liveIds.indexOf(stateId) !== -1)) {
    status = stateName === 'HT' || stateId === 3 ? 'HT' : stateName === '1ST_HALF' ? '1H' : stateName === '2ND_HALF' ? '2H' : 'LIVE';
  }

  // Extra fallback: if we have scores and result_info, it's probably finished
  if (status === 'NS' && f.result_info && homeGoals !== null) {
    status = 'FT';
  }

  // Extract league info
  var league = f.league || {};

  // Extract venue
  var venue = f.venue || {};

  // Extract elapsed time
  var elapsed = null;
  if (state.clock && state.clock.minute !== undefined) {
    elapsed = state.clock.minute;
  } else if (f.periods) {
    // Calculate from periods
  }

  // Extract statistics if available
  var stats = {};
  if (f.statistics && Array.isArray(f.statistics)) {
    f.statistics.forEach(function(s) {
      var type = (s.type && s.type.developer_name) || s.type_id;
      if (!type) return;
      if (s.location === 'home') stats['home_' + type] = s.data && s.data.value !== undefined ? s.data.value : s.value;
      if (s.location === 'away') stats['away_' + type] = s.data && s.data.value !== undefined ? s.data.value : s.value;
    });
  }

  // Extract events (goals, cards, subs)
  var events = [];
  if (f.events && Array.isArray(f.events)) {
    events = f.events.map(function(e) {
      return {
        minute: e.minute,
        type: e.type ? (e.type.developer_name || e.type.code) : '',
        player: e.player_name || (e.player ? e.player.display_name : ''),
        team: e.participant_id,
        info: e.info || e.addition || '',
      };
    });
  }

  // Extract odds from SportMonks (market_id 1 = Fulltime Result, 12 = Over/Under, 3 = BTTS)
  var homeOdds = null, drawOdds = null, awayOdds = null, overOdds = null, underOdds = null, bttsYesOdds = null;
  var oddsArr = f.odds || [];
  if (Array.isArray(oddsArr)) {
    oddsArr.forEach(function(o) {
      var label = (o.label || o.name || '').toLowerCase();
      var val = parseFloat(o.value) || null;
      var marketId = o.market_id;
      // Fulltime Result (market_id 1): Home, Draw, Away
      if (marketId === 1 || label === 'home' || label === 'draw' || label === 'away' || label === '1' || label === 'x' || label === '2') {
        if (label === 'home' || label === '1') homeOdds = homeOdds || val;
        else if (label === 'draw' || label === 'x') drawOdds = drawOdds || val;
        else if (label === 'away' || label === '2') awayOdds = awayOdds || val;
      }
      // Over/Under 2.5 (market_id 12 or 18)
      if ((marketId === 12 || marketId === 18) && label.indexOf('over') !== -1 && label.indexOf('2.5') !== -1) overOdds = overOdds || val;
      if ((marketId === 12 || marketId === 18) && label.indexOf('under') !== -1 && label.indexOf('2.5') !== -1) underOdds = underOdds || val;
      // BTTS (market_id 3)
      if (marketId === 3 && (label === 'yes' || label.indexOf('yes') !== -1)) bttsYesOdds = bttsYesOdds || val;
    });
  }

  return {
    id: f.id,
    sportmonksId: f.id,
    homeTeam: home.name || home.short_code || '',
    awayTeam: away.name || away.short_code || '',
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeTeamLogo: home.image_path || null,
    awayTeamLogo: away.image_path || null,
    homeGoals: homeGoals,
    awayGoals: awayGoals,
    status: status,
    elapsed: elapsed,
    kickoff: f.starting_at ? (f.starting_at.indexOf('T') === -1 && f.starting_at.indexOf('Z') === -1 ? f.starting_at.replace(' ', 'T') + 'Z' : f.starting_at) : null,
    league: (function() {
      var name = league.name || '';
      var country = league.country ? (league.country.name || '') : '';
      // Disambiguate leagues with same name in different countries (Serie A, Pro League, etc.)
      var ambiguous = ['Serie A', 'Serie B', 'Pro League', 'First Division', 'Super League', 'Primera Division'];
      if (country && ambiguous.some(function(a) { return name === a; })) {
        return name + ' (' + country + ')';
      }
      return name;
    })(),
    leagueId: league.id,
    leagueLogo: league.image_path || null,
    venue: venue.name || '',
    venueCity: venue.city_name || '',
    resultInfo: f.result_info || '',
    homeOdds: homeOdds,
    drawOdds: drawOdds,
    awayOdds: awayOdds,
    overOdds: overOdds,
    underOdds: underOdds,
    bttsOdds: bttsYesOdds,
    stats: stats,
    events: events,
    round: f.round_id,
    seasonId: f.season_id,
    // Raw data for extended use
    _raw: {
      stateId: state.id,
      stateName: stateName,
    },
  };
}

// =========================================================================
// STATUS — diagnostic info
// =========================================================================
SportMonks.prototype.getStatus = function() {
  return {
    available: this.isAvailable(),
    requests: this.requestCount,
    lastError: this.lastError,
  };
};

// Expose the normaliser so feature modules (e.g. World Cup sync) can reuse the
// robust team/score/status parsing without re-implementing it.
SportMonks.normaliseFixture = normaliseFixture;

module.exports = SportMonks;
