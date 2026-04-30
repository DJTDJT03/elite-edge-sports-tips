/**
 * Elite Edge Sports Tips — Rugby League Data Service
 *
 * Fetches Super League + NRL fixtures, results, standings, and team stats
 * from API-Sports Rugby API.
 * Uses the same API key as API-Football (API_FOOTBALL_KEY).
 * Base URL: v3.rugby.api-sports.io
 *
 * Free tier: 100 requests/day — we use ~15-20 per day.
 */

'use strict';

var https = require('https');

var BASE_HOST = 'v3.rugby.api-sports.io';

// Supported leagues
var LEAGUES = [
  { id: 44, name: 'Super League', country: 'England', season: 2025 },
  { id: 78, name: 'NRL', country: 'Australia', season: 2025 },
];
var LEAGUE_IDS = LEAGUES.map(function(l) { return l.id; });

class RugbyData {
  constructor() {
    this.apiKey = process.env.API_FOOTBALL_KEY || '';
    this.isAvailable = !!this.apiKey;
    if (this.isAvailable) {
      console.log('[Rugby] Service initialized (Super League + NRL)');
    } else {
      console.log('[Rugby] No API key — rugby data disabled');
    }
  }

  _apiGet(path) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!self.apiKey) return reject(new Error('No API key'));
      var opts = {
        hostname: BASE_HOST,
        path: path,
        method: 'GET',
        headers: { 'x-apisports-key': self.apiKey },
        timeout: 12000,
      };
      var req = https.request(opts, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var parsed = JSON.parse(data);
            if (parsed.errors && Object.keys(parsed.errors).length > 0) {
              console.error('[Rugby] API error:', JSON.stringify(parsed.errors));
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error('Rugby API: invalid JSON'));
          }
        });
      });
      req.on('timeout', function() { req.destroy(); reject(new Error('Rugby API timeout')); });
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Get games for a specific date across supported leagues.
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Array>}
   */
  async getGames(date) {
    if (!this.isAvailable) return [];
    var dateStr = date || new Date().toISOString().split('T')[0];
    var allGames = [];
    try {
      for (var li = 0; li < LEAGUES.length; li++) {
        var league = LEAGUES[li];
        try {
          var result = await this._apiGet('/games?date=' + dateStr + '&league=' + league.id + '&season=' + league.season);
          if (result.response && Array.isArray(result.response)) {
            result.response.forEach(function(g) {
              allGames.push(_normaliseGame(g, league));
            });
          }
        } catch (e) { /* individual league optional */ }
      }
    } catch (err) {
      console.error('[Rugby] getGames error:', err.message);
    }
    return allGames;
  }

  /**
   * Get standings for a league.
   * @param {number} leagueId
   * @returns {Promise<Array>}
   */
  async getStandings(leagueId) {
    if (!this.isAvailable) return [];
    try {
      var league = LEAGUES.find(function(l) { return l.id === leagueId; }) || LEAGUES[0];
      var result = await this._apiGet('/standings?league=' + leagueId + '&season=' + league.season);
      if (!result.response || !Array.isArray(result.response)) return [];
      var all = [];
      result.response.forEach(function(group) {
        if (Array.isArray(group)) {
          group.forEach(function(s) { all.push(_normaliseStanding(s)); });
        } else {
          all.push(_normaliseStanding(group));
        }
      });
      return all;
    } catch (err) {
      console.error('[Rugby] getStandings error:', err.message);
      return [];
    }
  }

  /**
   * Get team stats.
   * @param {number} teamId
   * @param {number} leagueId
   * @returns {Promise<object|null>}
   */
  async getTeamStats(teamId, leagueId) {
    if (!this.isAvailable || !teamId) return null;
    try {
      var league = LEAGUES.find(function(l) { return l.id === leagueId; }) || LEAGUES[0];
      var result = await this._apiGet('/teams/statistics?team=' + teamId + '&league=' + leagueId + '&season=' + league.season);
      if (!result.response) return null;
      var s = result.response;
      return {
        teamId: teamId,
        games: s.games ? (s.games.played || { total: 0 }) : { total: 0 },
        wins: s.games ? (s.games.wins || { total: 0 }) : { total: 0 },
        losses: s.games ? (s.games.loses || { total: 0 }) : { total: 0 },
        draws: s.games ? (s.games.draws || { total: 0 }) : { total: 0 },
        pointsFor: s.points ? s.points.for : 0,
        pointsAgainst: s.points ? s.points.against : 0,
        form: s.form || '',
      };
    } catch (err) {
      console.error('[Rugby] getTeamStats error:', err.message);
      return null;
    }
  }

  /**
   * Get H2H between two teams.
   * @param {number} teamId1
   * @param {number} teamId2
   * @returns {Promise<Array>}
   */
  async getH2H(teamId1, teamId2) {
    if (!this.isAvailable || !teamId1 || !teamId2) return [];
    try {
      var result = await this._apiGet('/games/h2h?h2h=' + teamId1 + '-' + teamId2);
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
      console.error('[Rugby] getH2H error:', err.message);
      return [];
    }
  }

  /**
   * Get finished games for settlement.
   * @param {string} date
   * @returns {Promise<Array>}
   */
  async getResults(date) {
    var games = await this.getGames(date);
    return games.filter(function(g) { return g.status === 'FT'; });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _normaliseGame(g, league) {
  var status = 'NS';
  if (g.status && g.status.long) {
    var long = g.status.long.toLowerCase();
    if (long === 'match finished' || long === 'finished' || long === 'after extra time') status = 'FT';
    else if (long === 'not started') status = 'NS';
    else if (long.indexOf('half') !== -1 || long === 'in play') status = 'LIVE';
    else status = g.status.short || 'NS';
  }
  return {
    id: g.id,
    leagueId: league.id,
    league: league.name,
    country: league.country,
    homeTeam: g.teams && g.teams.home ? g.teams.home.name : '',
    homeTeamId: g.teams && g.teams.home ? g.teams.home.id : null,
    awayTeam: g.teams && g.teams.away ? g.teams.away.name : '',
    awayTeamId: g.teams && g.teams.away ? g.teams.away.id : null,
    homeScore: g.scores && g.scores.home ? (g.scores.home.total || 0) : 0,
    awayScore: g.scores && g.scores.away ? (g.scores.away.total || 0) : 0,
    status: status,
    date: g.date ? g.date.split('T')[0] : '',
    time: g.time || '',
    venue: g.venue || '',
  };
}

function _normaliseStanding(s) {
  var team = s.team || {};
  return {
    teamId: team.id,
    team: team.name || '',
    position: s.position || 0,
    wins: s.games ? (s.games.win || 0) : 0,
    losses: s.games ? (s.games.lose || 0) : 0,
    draws: s.games ? (s.games.draw || 0) : 0,
    played: s.games ? (s.games.played || 0) : 0,
    points: s.points || 0,
    pointsFor: s.goals ? (s.goals.for || 0) : 0,
    pointsAgainst: s.goals ? (s.goals.against || 0) : 0,
    form: s.form || '',
  };
}

module.exports = new RugbyData();
