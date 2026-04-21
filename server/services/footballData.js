// ---------------------------------------------------------------------------
// Football-Data.org Integration
// Free API with historical results, league tables, and fixtures for 20+ leagues.
// No API key needed for basic access (10 requests/min).
// ---------------------------------------------------------------------------

const https = require('https');

class FootballDataService {
  constructor() {
    this.baseUrl = 'api.football-data.org';
    this.apiKey = process.env.FOOTBALL_DATA_KEY || ''; // Optional — free tier works without
    this._cache = new Map();
    this._cacheTTL = 30 * 60 * 1000; // 30 minutes
    this._lastRequestTime = 0;
    console.log('[FootballData] Service initialized' + (this.apiKey ? ' (with API key)' : ' (free tier)'));
  }

  /**
   * Internal HTTP getter with rate limiting (1 req/sec)
   * Headers: X-Auth-Token if API key is available
   */
  async _apiGet(path) {
    // Rate limit: ensure at least 1 second between requests
    var now = Date.now();
    var timeSinceLastRequest = now - this._lastRequestTime;
    if (timeSinceLastRequest < 1000) {
      await new Promise(function(resolve) { setTimeout(resolve, 1000 - timeSinceLastRequest); });
    }
    this._lastRequestTime = Date.now();

    var self = this;
    return new Promise(function(resolve, reject) {
      var headers = {
        'Accept': 'application/json',
        'User-Agent': 'EliteEdgeSportsTips/1.0',
      };
      if (self.apiKey) {
        headers['X-Auth-Token'] = self.apiKey;
      }

      var options = {
        hostname: self.baseUrl,
        path: path,
        method: 'GET',
        headers: headers,
      };

      var req = https.request(options, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            if (res.statusCode === 429) {
              console.warn('[FootballData] Rate limited — try again later');
              resolve(null);
              return;
            }
            if (res.statusCode !== 200) {
              console.warn('[FootballData] HTTP ' + res.statusCode + ' for ' + path);
              resolve(null);
              return;
            }
            var parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            console.error('[FootballData] JSON parse error:', e.message);
            resolve(null);
          }
        });
      });

      req.on('error', function(err) {
        console.error('[FootballData] Request error:', err.message);
        resolve(null);
      });

      req.setTimeout(15000, function() {
        req.destroy();
        console.error('[FootballData] Request timeout for ' + path);
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * Get league standings/table
   * League codes: PL, ELC (Championship), CL, FL1 (League One), FL2 (League Two),
   *               SPL (Scottish Prem), SA, BL1, PD, FL1
   * Returns: team positions, points, wins, draws, losses, GF, GA, GD, form
   */
  async getStandings(leagueCode) {
    var cacheKey = 'standings_' + leagueCode;
    var cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this._cacheTTL) {
      return cached.data;
    }

    try {
      var raw = await this._apiGet('/v4/competitions/' + leagueCode + '/standings');
      if (!raw || !raw.standings) return null;

      var result = {
        competition: raw.competition ? raw.competition.name : leagueCode,
        season: raw.season ? raw.season.startDate + ' to ' + raw.season.endDate : '',
        standings: [],
      };

      // Process standings — typically the first entry is the total table
      var totalStanding = raw.standings.find(function(s) { return s.type === 'TOTAL'; }) || raw.standings[0];
      if (totalStanding && totalStanding.table) {
        result.standings = totalStanding.table.map(function(entry) {
          return {
            position: entry.position,
            team: entry.team ? entry.team.name : 'Unknown',
            teamId: entry.team ? entry.team.id : null,
            teamCrest: entry.team ? entry.team.crest : null,
            playedGames: entry.playedGames,
            won: entry.won,
            draw: entry.draw,
            lost: entry.lost,
            points: entry.points,
            goalsFor: entry.goalsFor,
            goalsAgainst: entry.goalsAgainst,
            goalDifference: entry.goalDifference,
            form: entry.form || null,
          };
        });
      }

      this._cache.set(cacheKey, { data: result, time: Date.now() });
      return result;
    } catch (e) {
      console.error('[FootballData] Error fetching standings for ' + leagueCode + ':', e.message);
      return null;
    }
  }

  /**
   * Get last N matches for a team
   * Returns: fixtures with scores, dates, competition
   */
  async getTeamMatches(teamId, limit) {
    limit = limit || 10;
    var cacheKey = 'team_matches_' + teamId + '_' + limit;
    var cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this._cacheTTL) {
      return cached.data;
    }

    try {
      var raw = await this._apiGet('/v4/teams/' + teamId + '/matches?status=FINISHED&limit=' + limit);
      if (!raw || !raw.matches) return null;

      var result = raw.matches.map(function(m) {
        return {
          id: m.id,
          date: m.utcDate,
          competition: m.competition ? m.competition.name : '',
          homeTeam: m.homeTeam ? m.homeTeam.name : '',
          awayTeam: m.awayTeam ? m.awayTeam.name : '',
          homeScore: m.score && m.score.fullTime ? m.score.fullTime.home : null,
          awayScore: m.score && m.score.fullTime ? m.score.fullTime.away : null,
          winner: m.score ? m.score.winner : null,
        };
      });

      this._cache.set(cacheKey, { data: result, time: Date.now() });
      return result;
    } catch (e) {
      console.error('[FootballData] Error fetching team matches for ' + teamId + ':', e.message);
      return null;
    }
  }

  /**
   * Get head-to-head for a specific match
   * Returns: last 10 meetings with scores
   */
  async getHeadToHead(matchId) {
    var cacheKey = 'h2h_' + matchId;
    var cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this._cacheTTL) {
      return cached.data;
    }

    try {
      var raw = await this._apiGet('/v4/matches/' + matchId + '/head2head?limit=10');
      if (!raw || !raw.matches) return null;

      var result = {
        aggregates: raw.aggregates || null,
        matches: raw.matches.map(function(m) {
          return {
            id: m.id,
            date: m.utcDate,
            competition: m.competition ? m.competition.name : '',
            homeTeam: m.homeTeam ? m.homeTeam.name : '',
            awayTeam: m.awayTeam ? m.awayTeam.name : '',
            homeScore: m.score && m.score.fullTime ? m.score.fullTime.home : null,
            awayScore: m.score && m.score.fullTime ? m.score.fullTime.away : null,
            winner: m.score ? m.score.winner : null,
          };
        }),
      };

      this._cache.set(cacheKey, { data: result, time: Date.now() });
      return result;
    } catch (e) {
      console.error('[FootballData] Error fetching H2H for match ' + matchId + ':', e.message);
      return null;
    }
  }

  /**
   * Get top scorers for a league
   * Returns: player name, team, goals, assists, penalties
   */
  async getTopScorers(leagueCode) {
    var cacheKey = 'scorers_' + leagueCode;
    var cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this._cacheTTL) {
      return cached.data;
    }

    try {
      var raw = await this._apiGet('/v4/competitions/' + leagueCode + '/scorers?limit=10');
      if (!raw || !raw.scorers) return null;

      var result = {
        competition: raw.competition ? raw.competition.name : leagueCode,
        scorers: raw.scorers.map(function(s) {
          return {
            player: s.player ? s.player.name : 'Unknown',
            playerId: s.player ? s.player.id : null,
            nationality: s.player ? s.player.nationality : '',
            team: s.team ? s.team.name : 'Unknown',
            goals: s.goals || 0,
            assists: s.assists || 0,
            penalties: s.penalties || 0,
            playedMatches: s.playedMatches || 0,
          };
        }),
      };

      this._cache.set(cacheKey, { data: result, time: Date.now() });
      return result;
    } catch (e) {
      console.error('[FootballData] Error fetching top scorers for ' + leagueCode + ':', e.message);
      return null;
    }
  }
}

module.exports = new FootballDataService();
