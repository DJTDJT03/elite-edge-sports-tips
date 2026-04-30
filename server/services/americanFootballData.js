/**
 * Elite Edge Sports Tips — American Football (NFL) Data Service
 *
 * Fetches NFL fixtures, results, standings from API-Sports American Football API.
 * Uses the same API key as API-Football (API_FOOTBALL_KEY).
 * Base URL: v1.american-football.api-sports.io
 *
 * NFL season: Sep–Feb. Preseason Aug. Off-season Mar–Jul.
 * Free tier: 100 requests/day.
 */

'use strict';

var https = require('https');

var BASE_HOST = 'v1.american-football.api-sports.io';
var NFL_LEAGUE_ID = 1;
var NFL_SEASON = 2025;

class AmericanFootballData {
  constructor() {
    this.apiKey = process.env.API_FOOTBALL_KEY || '';
    this.isAvailable = !!this.apiKey;
    if (this.isAvailable) {
      console.log('[NFL] Service initialized');
    } else {
      console.log('[NFL] No API key — NFL data disabled');
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
              console.error('[NFL] API error:', JSON.stringify(parsed.errors));
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error('NFL API: invalid JSON'));
          }
        });
      });
      req.on('timeout', function() { req.destroy(); reject(new Error('NFL API timeout')); });
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Get NFL games for a date.
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Array>}
   */
  async getGames(date) {
    if (!this.isAvailable) return [];
    try {
      var dateStr = date || new Date().toISOString().split('T')[0];
      var result = await this._apiGet('/games?date=' + dateStr + '&league=' + NFL_LEAGUE_ID + '&season=' + NFL_SEASON);
      if (!result.response || !Array.isArray(result.response)) return [];
      return result.response.map(function(g) {
        return {
          id: g.game ? g.game.id : g.id,
          leagueId: NFL_LEAGUE_ID,
          league: 'NFL',
          homeTeam: g.teams && g.teams.home ? g.teams.home.name : '',
          homeTeamId: g.teams && g.teams.home ? g.teams.home.id : null,
          awayTeam: g.teams && g.teams.away ? g.teams.away.name : '',
          awayTeamId: g.teams && g.teams.away ? g.teams.away.id : null,
          homeScore: g.scores && g.scores.home ? g.scores.home.total : null,
          awayScore: g.scores && g.scores.away ? g.scores.away.total : null,
          status: _normaliseStatus(g.game ? g.game.status : g.status),
          date: dateStr,
          time: g.game ? (g.game.time || '') : '',
          venue: g.game ? (g.game.venue || '') : '',
          week: g.game ? g.game.week : null,
        };
      });
    } catch (err) {
      console.error('[NFL] getGames error:', err.message);
      return [];
    }
  }

  /**
   * Get NFL standings.
   * @returns {Promise<Array>}
   */
  async getStandings() {
    if (!this.isAvailable) return [];
    try {
      var result = await this._apiGet('/standings?league=' + NFL_LEAGUE_ID + '&season=' + NFL_SEASON);
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
      console.error('[NFL] getStandings error:', err.message);
      return [];
    }
  }

  /**
   * Get H2H between two teams.
   */
  async getH2H(teamId1, teamId2) {
    if (!this.isAvailable || !teamId1 || !teamId2) return [];
    try {
      var result = await this._apiGet('/games?h2h=' + teamId1 + '-' + teamId2 + '&league=' + NFL_LEAGUE_ID + '&season=' + NFL_SEASON);
      if (!result.response) return [];
      return result.response.map(function(g) {
        return {
          homeTeam: g.teams && g.teams.home ? g.teams.home.name : '',
          awayTeam: g.teams && g.teams.away ? g.teams.away.name : '',
          homeScore: g.scores && g.scores.home ? g.scores.home.total : 0,
          awayScore: g.scores && g.scores.away ? g.scores.away.total : 0,
        };
      });
    } catch (err) {
      console.error('[NFL] getH2H error:', err.message);
      return [];
    }
  }

  /**
   * Get finished games for settlement.
   */
  async getResults(date) {
    var games = await this.getGames(date);
    return games.filter(function(g) { return g.status === 'FT'; });
  }
}

function _normaliseStatus(status) {
  if (!status) return 'NS';
  var s = (typeof status === 'string' ? status : status.long || status.short || '').toLowerCase();
  if (s === 'finished' || s === 'game finished' || s === 'after over time' || s === 'fi') return 'FT';
  if (s === 'not started' || s === 'ns') return 'NS';
  if (s.indexOf('quarter') !== -1 || s.indexOf('half') !== -1 || s === 'in play') return 'LIVE';
  return 'NS';
}

function _normaliseStanding(s) {
  var team = s.team || {};
  return {
    teamId: team.id,
    team: team.name || '',
    division: s.group ? s.group.name : '',
    wins: s.won || 0,
    losses: s.lost || 0,
    ties: s.ties || 0,
    played: (s.won || 0) + (s.lost || 0) + (s.ties || 0),
    winPct: ((s.won || 0) + (s.lost || 0)) > 0 ? (s.won || 0) / ((s.won || 0) + (s.lost || 0)) : 0,
    position: s.position || 0,
    pointsFor: s.points ? (s.points.for || 0) : 0,
    pointsAgainst: s.points ? (s.points.against || 0) : 0,
    streak: s.streak || '',
  };
}

module.exports = new AmericanFootballData();
