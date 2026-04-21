// ---------------------------------------------------------------------------
// Understat xG Integration
// Free xG data from understat.com for top 6 European leagues
// (EPL, La Liga, Bundesliga, Serie A, Ligue 1, RFPL)
// ---------------------------------------------------------------------------

const https = require('https');

class UnderstatService {
  constructor() {
    this._cache = new Map();
    this._cacheTTL = 60 * 60 * 1000; // 1 hour (xG data updates after matches)
    console.log('[Understat] xG service initialized');
  }

  /**
   * Fetch a page via HTTPS
   */
  async _fetchPage(url) {
    return new Promise(function(resolve, reject) {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, function(res) {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, function(res2) {
            var data = '';
            res2.on('data', function(chunk) { data += chunk; });
            res2.on('end', function() { resolve(data); });
          }).on('error', reject);
          return;
        }
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() { resolve(data); });
      }).on('error', reject);
    });
  }

  /**
   * Get all team xG data for a league/season
   * League names: 'EPL', 'La_Liga', 'Bundesliga', 'Serie_A', 'Ligue_1'
   * Season: '2025' (for 2025/26 season)
   * Returns: object keyed by team name with xG, xGA, xGD, xG per match, actual goals vs xG diff
   */
  async getLeagueXG(league, season) {
    season = season || '2025';
    var cacheKey = league + '_' + season;
    var cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this._cacheTTL) {
      return cached.data;
    }

    try {
      var html = await this._fetchPage('https://understat.com/league/' + league + '/' + season);
      if (!html || html.length < 1000) {
        console.warn('[Understat] Empty or short response for ' + league + '/' + season);
        return null;
      }

      // Extract teamsData JSON from script tag
      var match = html.match(/var\s+teamsData\s*=\s*JSON\.parse\('(.+?)'\)/);
      if (!match) {
        console.warn('[Understat] Could not find teamsData in page for ' + league + '/' + season);
        return null;
      }

      // Unescape the JSON string (Understat uses hex escapes)
      var jsonStr = match[1].replace(/\\x([0-9A-Fa-f]{2})/g, function(_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      });
      var teams = JSON.parse(jsonStr);

      // Process into useful format
      var result = {};
      for (var teamId in teams) {
        if (!teams.hasOwnProperty(teamId)) continue;
        var t = teams[teamId];
        var matches = t.history || [];
        var totalXG = 0, totalXGA = 0, totalGoals = 0, totalConceded = 0;
        matches.forEach(function(m) {
          totalXG += parseFloat(m.xG) || 0;
          totalXGA += parseFloat(m.xGA) || 0;
          totalGoals += parseInt(m.scored) || 0;
          totalConceded += parseInt(m.missed) || 0;
        });
        var gamesPlayed = matches.length || 1;
        result[t.title] = {
          team: t.title,
          teamId: teamId,
          gamesPlayed: gamesPlayed,
          xG: Math.round(totalXG * 100) / 100,
          xGA: Math.round(totalXGA * 100) / 100,
          xGDiff: Math.round((totalXG - totalXGA) * 100) / 100,
          xGPerMatch: Math.round((totalXG / gamesPlayed) * 100) / 100,
          xGAPerMatch: Math.round((totalXGA / gamesPlayed) * 100) / 100,
          actualGoals: totalGoals,
          actualConceded: totalConceded,
          overperformance: Math.round((totalGoals - totalXG) * 100) / 100,
          defensiveOverperformance: Math.round((totalXGA - totalConceded) * 100) / 100,
        };
      }

      this._cache.set(cacheKey, { data: result, time: Date.now() });
      console.log('[Understat] Loaded xG data for ' + Object.keys(result).length + ' teams in ' + league + '/' + season);
      return result;
    } catch (e) {
      console.error('[Understat] Error fetching ' + league + ':', e.message);
      return null;
    }
  }

  /**
   * Get specific team xG stats
   * Uses cached league data, filters to team
   * Returns: { xG, xGA, xGDiff, actualGoals, xGPerMatch, overperformance }
   */
  async getTeamXG(teamName, league, season) {
    var data = await this.getLeagueXG(league, season);
    if (!data) return null;

    // Find team by partial match (case-insensitive)
    var searchName = (teamName || '').toLowerCase();
    for (var name in data) {
      if (!data.hasOwnProperty(name)) continue;
      if (name.toLowerCase().indexOf(searchName) !== -1 || searchName.indexOf(name.toLowerCase()) !== -1) {
        return data[name];
      }
    }
    return null;
  }

  /**
   * Get xG data for a specific fixture (searches recent match data)
   * Returns: { homeXG, awayXG } or null
   */
  async getMatchXG(homeTeam, awayTeam, league, season) {
    var data = await this.getLeagueXG(league, season);
    if (!data) return null;

    // Find both teams
    var homeData = null, awayData = null;
    var homeName = (homeTeam || '').toLowerCase();
    var awayName = (awayTeam || '').toLowerCase();

    for (var name in data) {
      if (!data.hasOwnProperty(name)) continue;
      var nameLower = name.toLowerCase();
      if (nameLower.indexOf(homeName) !== -1 || homeName.indexOf(nameLower) !== -1) {
        homeData = data[name];
      }
      if (nameLower.indexOf(awayName) !== -1 || awayName.indexOf(nameLower) !== -1) {
        awayData = data[name];
      }
    }

    if (!homeData && !awayData) return null;

    return {
      homeTeam: homeData ? homeData.team : homeTeam,
      awayTeam: awayData ? awayData.team : awayTeam,
      homeXGPerMatch: homeData ? homeData.xGPerMatch : null,
      awayXGPerMatch: awayData ? awayData.xGPerMatch : null,
      homeXGAPerMatch: homeData ? homeData.xGAPerMatch : null,
      awayXGAPerMatch: awayData ? awayData.xGAPerMatch : null,
      homeOverperformance: homeData ? homeData.overperformance : null,
      awayOverperformance: awayData ? awayData.overperformance : null,
    };
  }
}

module.exports = new UnderstatService();
