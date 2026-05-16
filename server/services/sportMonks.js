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
    include: 'participants;scores;events;state;league;venue;odds',
  }).then(function(data) {
    return (data.data || []).map(normaliseFixture);
  });
};

// =========================================================================
// FIXTURES BY DATE — past, today, or future
// =========================================================================
SportMonks.prototype.getFixturesByDate = function(dateStr) {
  return this._request('/fixtures/date/' + dateStr, {
    include: 'participants;scores;state;league;venue;odds',
    per_page: 50,
  }).then(function(data) {
    return (data.data || []).map(normaliseFixture);
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
    include: 'participant',
  }).then(function(data) {
    return data.data || [];
  });
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
    kickoff: f.starting_at,
    league: league.name || '',
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

module.exports = SportMonks;
