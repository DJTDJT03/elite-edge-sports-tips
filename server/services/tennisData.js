/**
 * Elite Edge Sports Tips — Tennis Data Service
 *
 * Fetches ATP/WTA fixtures, results, rankings, H2H, and player stats
 * from API-Tennis (api-tennis.com).
 * Requires TENNIS_API_KEY env var (separate from API-Football).
 * Base URL: https://api.api-tennis.com/tennis/
 *
 * Event type keys: 265 = ATP Singles, 266 = WTA Singles
 */

'use strict';

var https = require('https');

var BASE_URL = 'https://api.api-tennis.com/tennis/';
var ATP_SINGLES = '265';
var WTA_SINGLES = '266';

class TennisData {
  constructor() {
    this.apiKey = process.env.TENNIS_API_KEY || '';
    this.isAvailable = !!this.apiKey;
    if (this.isAvailable) {
      console.log('[Tennis] Service initialized (ATP + WTA)');
    } else {
      console.log('[Tennis] No TENNIS_API_KEY — tennis data disabled');
    }
  }

  _apiGet(params) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!self.apiKey) return reject(new Error('No TENNIS_API_KEY'));
      var url = BASE_URL + '?APIkey=' + self.apiKey + '&' + params;
      var urlObj = new URL(url);

      var opts = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        timeout: 12000,
      };

      var req = https.request(opts, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var parsed = JSON.parse(data);
            if (parsed.success === 0) {
              console.error('[Tennis] API error:', parsed.error || 'unknown');
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error('Tennis API: invalid JSON'));
          }
        });
      });
      req.on('timeout', function() { req.destroy(); reject(new Error('Tennis API timeout')); });
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Get today's fixtures (ATP + WTA singles).
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Array>}
   */
  async getFixtures(date) {
    if (!this.isAvailable) return [];
    var dateStr = date || new Date().toISOString().split('T')[0];
    var allMatches = [];

    try {
      // Fetch ATP and WTA in parallel
      var results = await Promise.allSettled([
        this._apiGet('method=get_fixtures&date_start=' + dateStr + '&date_stop=' + dateStr + '&event_type_key=' + ATP_SINGLES),
        this._apiGet('method=get_fixtures&date_start=' + dateStr + '&date_stop=' + dateStr + '&event_type_key=' + WTA_SINGLES),
      ]);

      for (var i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled' && results[i].value.result) {
          var matches = results[i].value.result;
          if (Array.isArray(matches)) {
            matches.forEach(function(m) { allMatches.push(_normaliseMatch(m)); });
          }
        }
      }
    } catch (err) {
      console.error('[Tennis] getFixtures error:', err.message);
    }
    return allMatches;
  }

  /**
   * Get ATP or WTA rankings.
   * @param {string} type - 'ATP' or 'WTA'
   * @returns {Promise<Array>}
   */
  async getRankings(type) {
    if (!this.isAvailable) return [];
    try {
      var result = await this._apiGet('method=get_standings&event_type=' + (type || 'ATP'));
      if (!result.result || !Array.isArray(result.result)) return [];
      return result.result.map(function(r) {
        return {
          rank: parseInt(r.place) || 999,
          player: r.player || '',
          playerKey: r.player_key || '',
          points: parseInt(r.points) || 0,
          country: r.country || '',
        };
      });
    } catch (err) {
      console.error('[Tennis] getRankings error:', err.message);
      return [];
    }
  }

  /**
   * Get H2H between two players.
   * @param {string} playerKey1
   * @param {string} playerKey2
   * @returns {Promise<object>}
   */
  async getH2H(playerKey1, playerKey2) {
    if (!this.isAvailable || !playerKey1 || !playerKey2) return { matches: [], p1Wins: 0, p2Wins: 0 };
    try {
      var result = await this._apiGet('method=get_H2H&first_player_key=' + playerKey1 + '&second_player_key=' + playerKey2);
      if (!result.result) return { matches: [], p1Wins: 0, p2Wins: 0 };

      var h2hMatches = result.result.H2H || [];
      var p1Wins = 0;
      var p2Wins = 0;
      h2hMatches.forEach(function(m) {
        if (m.event_winner === 'First Player') p1Wins++;
        else if (m.event_winner === 'Second Player') p2Wins++;
      });

      return { matches: h2hMatches, p1Wins: p1Wins, p2Wins: p2Wins, total: h2hMatches.length };
    } catch (err) {
      console.error('[Tennis] getH2H error:', err.message);
      return { matches: [], p1Wins: 0, p2Wins: 0 };
    }
  }

  /**
   * Get player stats (surface records, season win/loss).
   * @param {string} playerKey
   * @returns {Promise<object|null>}
   */
  async getPlayerStats(playerKey) {
    if (!this.isAvailable || !playerKey) return null;
    try {
      var result = await this._apiGet('method=get_players&player_key=' + playerKey);
      if (!result.result || !Array.isArray(result.result) || result.result.length === 0) return null;
      var p = result.result[0];
      return {
        name: p.player_name || '',
        country: p.player_country || '',
        key: playerKey,
        stats: p.stats || [],
      };
    } catch (err) {
      console.error('[Tennis] getPlayerStats error:', err.message);
      return null;
    }
  }

  /**
   * Get finished matches for settlement.
   * @param {string} date
   * @returns {Promise<Array>}
   */
  async getResults(date) {
    var fixtures = await this.getFixtures(date);
    return fixtures.filter(function(m) { return m.status === 'Finished'; });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _normaliseMatch(m) {
  var surface = 'Unknown';
  var tournamentName = m.tournament_name || '';
  // Infer surface from tournament name (common patterns)
  var tLower = tournamentName.toLowerCase();
  if (tLower.indexOf('wimbledon') !== -1 || tLower.indexOf('grass') !== -1) surface = 'Grass';
  else if (tLower.indexOf('roland garros') !== -1 || tLower.indexOf('french') !== -1 || tLower.indexOf('clay') !== -1) surface = 'Clay';
  else if (tLower.indexOf('us open') !== -1 || tLower.indexOf('australian') !== -1 || tLower.indexOf('hard') !== -1) surface = 'Hard';
  else if (tLower.indexOf('indoor') !== -1) surface = 'Hard (Indoor)';

  var isATP = (m.event_type_type || '').toLowerCase().indexOf('atp') !== -1 ||
              (m.event_type_type || '').toLowerCase().indexOf('itf men') !== -1;
  var tour = isATP ? 'ATP' : 'WTA';

  return {
    id: m.event_key || '',
    player1: m.event_first_player || '',
    player1Key: m.first_player_key || '',
    player2: m.event_second_player || '',
    player2Key: m.second_player_key || '',
    tournament: tournamentName,
    tour: tour,
    surface: surface,
    date: m.event_date || '',
    time: m.event_time || '',
    status: m.event_status || '',
    finalResult: m.event_final_result || '',
    winner: m.event_winner || '',
    scores: m.scores || [],
    isLive: m.event_live === '1',
  };
}

module.exports = new TennisData();
