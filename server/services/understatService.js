// ---------------------------------------------------------------------------
// xG & Advanced Stats Service
// Uses API-Football standings + team statistics for goals/form data
// Provides xG-equivalent metrics per team per league
// ---------------------------------------------------------------------------

const https = require('https');

class UnderstatService {
  constructor() {
    this._cache = new Map();
    this._cacheTTL = 60 * 60 * 1000; // 1 hour
    this.apiKey = process.env.API_FOOTBALL_KEY || '';
    console.log('[xG Stats] Service initialized' + (this.apiKey ? ' (via API-Football)' : ' (no API key)'));
  }

  async getLeagueXG(league, season) {
    if (!this.apiKey) return null;

    var leagueMap = {
      'EPL': 39, 'La_Liga': 140, 'Bundesliga': 78,
      'Serie_A': 135, 'Ligue_1': 61, 'Championship': 40,
      'Scottish_Premiership': 179
    };
    var leagueId = leagueMap[league];
    if (!leagueId) return null;

    var cacheKey = 'xg_' + league + '_' + season;
    var cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this._cacheTTL) return cached.data;

    try {
      var standingsData = await this._apiGet('/standings?league=' + leagueId + '&season=' + season);
      if (!standingsData || !standingsData.response || !standingsData.response[0]) return null;

      var standings = standingsData.response[0].league.standings[0];
      var result = {};

      for (var i = 0; i < standings.length; i++) {
        var team = standings[i];
        var gamesPlayed = team.all.played || 1;
        var goalsFor = team.all.goals.for || 0;
        var goalsAgainst = team.all.goals.against || 0;
        var goalsPerMatch = goalsFor / gamesPlayed;
        var concededPerMatch = goalsAgainst / gamesPlayed;

        result[team.team.name] = {
          team: team.team.name,
          teamId: team.team.id,
          rank: team.rank,
          gamesPlayed: gamesPlayed,
          points: team.points,
          form: team.form,
          xGPerMatch: Math.round(goalsPerMatch * 100) / 100,
          xGAPerMatch: Math.round(concededPerMatch * 100) / 100,
          xG: Math.round(goalsFor * 100) / 100,
          xGA: Math.round(goalsAgainst * 100) / 100,
          actualGoals: goalsFor,
          actualConceded: goalsAgainst,
          goalDifference: team.goalsDiff || 0,
          wins: team.all.win,
          draws: team.all.draw,
          losses: team.all.lose,
          homeRecord: team.home ? (team.home.win + 'W ' + team.home.draw + 'D ' + team.home.lose + 'L') : '',
          awayRecord: team.away ? (team.away.win + 'W ' + team.away.draw + 'D ' + team.away.lose + 'L') : '',
          overperformance: 0,
        };
      }

      this._cache.set(cacheKey, { data: result, time: Date.now() });
      return result;
    } catch (e) {
      console.error('[xG Stats] Error fetching ' + league + ':', e.message);
      return null;
    }
  }

  async getTeamXG(teamName, league, season) {
    var data = await this.getLeagueXG(league, season || '2025');
    if (!data) return null;
    var search = (teamName || '').toLowerCase();
    for (var name in data) {
      if (name.toLowerCase().indexOf(search) !== -1 || search.indexOf(name.toLowerCase()) !== -1) {
        return data[name];
      }
    }
    return null;
  }

  async getMatchXG(homeTeam, awayTeam, league, season) {
    var data = await this.getLeagueXG(league, season || '2025');
    if (!data) return null;
    var home = null, away = null;
    var homeLower = (homeTeam || '').toLowerCase();
    var awayLower = (awayTeam || '').toLowerCase();
    for (var name in data) {
      var nameLower = name.toLowerCase();
      if (nameLower.indexOf(homeLower) !== -1 || homeLower.indexOf(nameLower) !== -1) home = data[name];
      if (nameLower.indexOf(awayLower) !== -1 || awayLower.indexOf(nameLower) !== -1) away = data[name];
    }
    if (!home && !away) return null;
    return {
      homeXG: home ? home.xGPerMatch : null,
      awayXG: away ? away.xGPerMatch : null,
      homeXGA: home ? home.xGAPerMatch : null,
      awayXGA: away ? away.xGAPerMatch : null,
    };
  }

  _apiGet(path) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var options = {
        hostname: 'v3.football.api-sports.io',
        path: path,
        method: 'GET',
        headers: { 'x-apisports-key': self.apiKey }
      };
      var req = https.request(options, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Invalid JSON')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, function() { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }
}

module.exports = new UnderstatService();
