/**
 * Elite Edge Sports Tips — Basketball Data Service
 *
 * Fetches NBA fixtures, results, standings, and team stats from API-Sports Basketball API.
 * Uses the same API key as API-Football (API_FOOTBALL_KEY).
 * Base URL: v1.basketball.api-sports.io
 *
 * Free tier: 100 requests/day — we use ~15-20 per day.
 */

'use strict';

var https = require('https');

var BASE_HOST = 'v1.basketball.api-sports.io';

// NBA league ID on API-Sports (standard NBA regular season + playoffs)
var NBA_LEAGUE_ID = 12;
// Current season
var NBA_SEASON = '2025-2026';

// Top leagues we cover (can expand later)
var SUPPORTED_LEAGUES = [
  { id: 12, name: 'NBA', country: 'USA' },
];

class BasketballData {
  constructor() {
    this.apiKey = process.env.API_FOOTBALL_KEY || '';
    this.isAvailable = !!this.apiKey;
    if (this.isAvailable) {
      console.log('[Basketball] Service initialized');
    } else {
      console.log('[Basketball] No API key — basketball data disabled');
    }
  }

  /**
   * Generic API-Sports Basketball GET request.
   */
  _apiGet(path) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!self.apiKey) return reject(new Error('No API key'));
      var opts = {
        hostname: BASE_HOST,
        path: path,
        method: 'GET',
        headers: {
          'x-apisports-key': self.apiKey,
        },
        timeout: 12000,
      };
      var req = https.request(opts, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var parsed = JSON.parse(data);
            if (parsed.errors && Object.keys(parsed.errors).length > 0) {
              console.error('[Basketball] API error:', JSON.stringify(parsed.errors));
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error('Basketball API: invalid JSON'));
          }
        });
      });
      req.on('timeout', function() { req.destroy(); reject(new Error('Basketball API timeout')); });
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Get today's NBA games.
   * @param {string} date - YYYY-MM-DD format
   * @returns {Promise<Array>} Normalised game objects
   */
  async getGames(date) {
    if (!this.isAvailable) return [];
    try {
      var dateStr = date || new Date().toISOString().split('T')[0];
      var result = await this._apiGet('/games?date=' + dateStr + '&league=' + NBA_LEAGUE_ID + '&season=' + NBA_SEASON);
      if (!result.response || !Array.isArray(result.response)) return [];
      return result.response.map(function(g) {
        return {
          id: g.id,
          leagueId: g.league ? g.league.id : NBA_LEAGUE_ID,
          league: g.league ? g.league.name : 'NBA',
          homeTeam: g.teams && g.teams.home ? g.teams.home.name : '',
          homeTeamId: g.teams && g.teams.home ? g.teams.home.id : null,
          awayTeam: g.teams && g.teams.away ? g.teams.away.name : '',
          awayTeamId: g.teams && g.teams.away ? g.teams.away.id : null,
          homeScore: g.scores && g.scores.home ? g.scores.home.total : null,
          awayScore: g.scores && g.scores.away ? g.scores.away.total : null,
          status: _normaliseStatus(g.status),
          statusRaw: g.status ? g.status.long : '',
          date: dateStr,
          time: g.time || '',
          venue: g.arena ? g.arena.name : '',
          city: g.arena ? g.arena.city : '',
        };
      });
    } catch (err) {
      console.error('[Basketball] getGames error:', err.message);
      return [];
    }
  }

  /**
   * Get NBA standings.
   * @returns {Promise<Array>} Standings sorted by wins
   */
  async getStandings() {
    if (!this.isAvailable) return [];
    try {
      var result = await this._apiGet('/standings?league=' + NBA_LEAGUE_ID + '&season=' + NBA_SEASON);
      if (!result.response || !Array.isArray(result.response)) return [];
      // API returns array of arrays (grouped by conference)
      var all = [];
      result.response.forEach(function(group) {
        if (Array.isArray(group)) {
          group.forEach(function(s) { all.push(_normaliseStanding(s)); });
        } else {
          all.push(_normaliseStanding(group));
        }
      });
      return all.sort(function(a, b) { return b.winPct - a.winPct; });
    } catch (err) {
      console.error('[Basketball] getStandings error:', err.message);
      return [];
    }
  }

  /**
   * Get team statistics for a specific team in the current season.
   * @param {number} teamId
   * @returns {Promise<object|null>}
   */
  async getTeamStats(teamId) {
    if (!this.isAvailable || !teamId) return null;
    try {
      var result = await this._apiGet('/statistics?team=' + teamId + '&league=' + NBA_LEAGUE_ID + '&season=' + NBA_SEASON);
      if (!result.response) return null;
      var s = result.response;
      return {
        teamId: teamId,
        games: s.games ? s.games.played : 0,
        wins: s.games ? s.games.wins : 0,
        losses: s.games ? s.games.loses : 0,
        pointsFor: s.points ? s.points.for : { average: 0, total: 0 },
        pointsAgainst: s.points ? s.points.against : { average: 0, total: 0 },
        form: s.form || '',
      };
    } catch (err) {
      console.error('[Basketball] getTeamStats error:', err.message);
      return null;
    }
  }

  /**
   * Get H2H results between two teams.
   * @param {number} teamId1
   * @param {number} teamId2
   * @returns {Promise<Array>}
   */
  async getH2H(teamId1, teamId2) {
    if (!this.isAvailable || !teamId1 || !teamId2) return [];
    try {
      var result = await this._apiGet('/games?h2h=' + teamId1 + '-' + teamId2 + '&league=' + NBA_LEAGUE_ID + '&season=' + NBA_SEASON);
      if (!result.response) return [];
      return result.response.map(function(g) {
        return {
          homeTeam: g.teams && g.teams.home ? g.teams.home.name : '',
          awayTeam: g.teams && g.teams.away ? g.teams.away.name : '',
          homeScore: g.scores && g.scores.home ? g.scores.home.total : 0,
          awayScore: g.scores && g.scores.away ? g.scores.away.total : 0,
          date: g.date ? g.date.split('T')[0] : '',
        };
      });
    } catch (err) {
      console.error('[Basketball] getH2H error:', err.message);
      return [];
    }
  }

  /**
   * Get finished games for a date (for auto-settlement).
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Array>} Finished games with scores
   */
  async getResults(date) {
    var games = await this.getGames(date);
    return games.filter(function(g) { return g.status === 'FT'; });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _normaliseStatus(status) {
  if (!status) return 'NS';
  var long = (status.long || '').toLowerCase();
  if (long === 'game finished' || long === 'after over time' || long === 'finished') return 'FT';
  if (long === 'not started') return 'NS';
  if (long.indexOf('quarter') !== -1 || long.indexOf('half') !== -1 || long === 'in play') return 'LIVE';
  return status.short || 'NS';
}

function _normaliseStanding(s) {
  var team = s.team || {};
  var games = s.games || {};
  var wins = games.win || { total: 0 };
  var losses = games.lose || { total: 0 };
  var totalGames = (wins.total || 0) + (losses.total || 0);
  return {
    teamId: team.id,
    team: team.name || '',
    conference: s.group ? s.group.name : '',
    wins: wins.total || 0,
    losses: losses.total || 0,
    winPct: totalGames > 0 ? ((wins.total || 0) / totalGames) : 0,
    position: s.position || 0,
    streak: s.streak || 0,
    form: s.form || '',
    pointsFor: s.points ? s.points.for : 0,
    pointsAgainst: s.points ? s.points.against : 0,
  };
}

module.exports = new BasketballData();
