/**
 * Elite Edge Sports Tips — Data Ingestion Architecture
 *
 * Abstract data layer with modular source connectors for football and racing data.
 * Each module is designed to be swapped independently — implement the interface
 * methods and register the source to switch providers without touching business logic.
 *
 * Architecture:
 *   DataIngestionManager
 *     ├── FootballFixturesSource (API-Football, football-data.org)
 *     ├── FootballOddsSource (the-odds-api.com, betfair exchange)
 *     ├── RacingCardsSource (racing-api.com, theracingapi.com)
 *     ├── RacingOddsSource (oddschecker API, betfair SP)
 *     ├── FormEnrichmentSource (form stats, historical data)
 *     ├── InjuryNewsSource (news APIs, official club feeds)
 *     ├── OddsMovementTracker (real-time odds monitoring)
 *     └── HistoricalResultsSource (results database)
 */

class DataSource {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.lastRefresh = null;
    this.refreshInterval = config.refreshInterval || 300000; // 5 min default
    this.isActive = false;
    this.errorCount = 0;
    this.maxRetries = config.maxRetries || 3;
  }

  /** Override in subclass: fetch and return normalised data */
  async fetch() {
    throw new Error(`${this.name}.fetch() not implemented`);
  }

  /** Override in subclass: transform raw API data to internal schema */
  normalise(rawData) {
    throw new Error(`${this.name}.normalise() not implemented`);
  }

  /** Override in subclass: validate data integrity */
  validate(data) {
    return data && (Array.isArray(data) ? data.length > 0 : true);
  }

  async safeFetch() {
    try {
      const raw = await this.fetch();
      const normalised = this.normalise(raw);
      if (this.validate(normalised)) {
        this.lastRefresh = new Date();
        this.errorCount = 0;
        this.isActive = true;
        return { success: true, data: normalised, source: this.name };
      }
      return { success: false, error: 'Validation failed', source: this.name };
    } catch (err) {
      this.errorCount++;
      this.isActive = this.errorCount < this.maxRetries;
      return { success: false, error: err.message, source: this.name };
    }
  }
}

// ---------------------------------------------------------------------------
// FOOTBALL DATA SOURCES
// ---------------------------------------------------------------------------

/**
 * Football Fixtures Source
 * Primary: API-Football (api-football.com) — 600+ leagues, live scores
 * Fallback: football-data.org — free tier, major leagues
 *
 * To activate:
 *   1. Sign up at https://www.api-football.com/ and get API key
 *   2. Set env: FOOTBALL_API_KEY=your_key
 *   3. The fetch() method below will use real endpoints
 */
class FootballFixturesSource extends DataSource {
  constructor() {
    super('football-fixtures', {
      refreshInterval: 600000, // 10 minutes
      apiUrl: 'https://v3.football.api-sports.io',
      apiKey: process.env.API_FOOTBALL_KEY || '',
    });
    // Top leagues (API-Football IDs):
    // Premier League=39, Championship=40, FA Cup=45, EFL Cup=48
    // Champions League=2, Europa League=3, Conference League=848
    // La Liga=140, Serie A=135, Bundesliga=78, Ligue 1=61
    // Eredivisie=88, Liga Portugal=94, Scottish Prem=179
    this.leagueIds = [39, 40, 45, 48, 2, 3, 848, 140, 135, 78, 61, 88, 94, 179];
  }

  async fetch() {
    if (!this.config.apiKey) {
      console.log('[football-fixtures] No API key — set API_FOOTBALL_KEY env var.');
      return { response: [] };
    }
    try {
      const today = new Date().toISOString().split('T')[0];
      // API-Football: /fixtures?date=X returns all fixtures for the date (no league filter needed)
      const data = await this._apiGet('/fixtures?date=' + today);
      const all = data.response || [];
      // Filter client-side to our target leagues
      const filtered = all.filter(f => this.leagueIds.indexOf(f.league.id) !== -1);
      console.log('[football-fixtures] Fetched ' + all.length + ' total fixtures, ' + filtered.length + ' in top leagues for ' + today);
      return { response: filtered };
    } catch (err) {
      console.error('[football-fixtures] Error: ' + err.message);
      return { response: [] };
    }
  }

  async fetchFixturesByDate(date) {
    if (!this.config.apiKey) return { response: [] };
    try {
      const data = await this._apiGet('/fixtures?date=' + date);
      const all = data.response || [];
      const filtered = all.filter(f => this.leagueIds.indexOf(f.league.id) !== -1);
      return { response: filtered };
    } catch (err) {
      console.error('[football-fixtures] fetchByDate Error: ' + err.message);
      return { response: [] };
    }
  }

  async fetchLiveScores() {
    if (!this.config.apiKey) return { response: [] };
    return this._apiGet('/fixtures?live=all');
  }

  async fetchFixtureStats(fixtureId) {
    if (!this.config.apiKey) return { response: [] };
    return this._apiGet('/fixtures/statistics?fixture=' + fixtureId);
  }

  async fetchTeamForm(teamId) {
    if (!this.config.apiKey) return { response: [] };
    return this._apiGet('/teams/statistics?team=' + teamId + '&season=2025&league=39');
  }

  async fetchInjuries(fixtureId) {
    if (!this.config.apiKey) return { response: [] };
    return this._apiGet('/injuries?fixture=' + fixtureId);
  }

  async fetchPredictions(fixtureId) {
    if (!this.config.apiKey) return { response: [] };
    try {
      var data = await this._apiGet('/predictions?fixture=' + fixtureId);
      return data;
    } catch (err) {
      console.error('[football-fixtures] fetchPredictions Error: ' + err.message);
      return { response: [] };
    }
  }

  async fetchTeamStats(teamId, leagueId, season) {
    if (!this.config.apiKey) return { response: [] };
    try {
      var s = season || '2025';
      var data = await this._apiGet('/teams/statistics?team=' + teamId + '&league=' + leagueId + '&season=' + s);
      return data;
    } catch (err) {
      console.error('[football-fixtures] fetchTeamStats Error: ' + err.message);
      return { response: [] };
    }
  }

  async fetchOddsLive(fixtureId) {
    if (!this.config.apiKey) return { response: [] };
    try {
      var data = await this._apiGet('/odds/live?fixture=' + fixtureId);
      return data;
    } catch (err) {
      console.error('[football-fixtures] fetchOddsLive Error: ' + err.message);
      return { response: [] };
    }
  }

  async fetchLineups(fixtureId) {
    if (!this.config.apiKey) return { response: [] };
    try {
      var data = await this._apiGet('/fixtures/lineups?fixture=' + fixtureId);
      return data;
    } catch (err) {
      console.error('[football-fixtures] fetchLineups Error: ' + err.message);
      return { response: [] };
    }
  }

  async fetchH2H(team1Id, team2Id) {
    if (!this.config.apiKey) return { response: [] };
    return this._apiGet('/fixtures/headtohead?h2h=' + team1Id + '-' + team2Id + '&last=10');
  }

  _apiGet(path) {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const options = {
        hostname: 'v3.football.api-sports.io',
        path: path,
        method: 'GET',
        headers: { 'x-apisports-key': this.config.apiKey }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Invalid JSON')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }

  normalise(raw) {
    if (!raw.response || !raw.response.length) return [];
    return raw.response.map(f => ({
      id: f.fixture.id,
      league: f.league.name,
      leagueId: f.league.id,
      homeTeam: f.teams.home.name,
      homeTeamId: f.teams.home.id,
      awayTeam: f.teams.away.name,
      awayTeamId: f.teams.away.id,
      kickoff: f.fixture.date,
      venue: f.fixture.venue ? f.fixture.venue.name : '',
      status: f.fixture.status.short,
      statusLong: f.fixture.status.long,
      homeGoals: f.goals.home,
      awayGoals: f.goals.away,
      elapsed: f.fixture.status.elapsed
    }));
  }
}

/**
 * Elite Odds Engine — The Odds API (the-odds-api.com)
 * Unified odds intelligence for BOTH football AND horse racing.
 * 40+ UK bookmakers, real-time prices, multi-market coverage.
 *
 * This is the core odds engine for Elite Edge — every tip gets enriched
 * with best price, market consensus, bookmaker spread, and value detection.
 *
 * To activate:
 *   1. Sign up at https://the-odds-api.com/ and get API key
 *   2. Set env: ODDS_API_KEY=your_key
 *
 * Football markets: h2h, totals (O/U 2.5), btts, spreads
 * Racing markets: win, place, each-way
 */
class FootballOddsSource extends DataSource {
  constructor() {
    super('football-odds', {
      refreshInterval: 120000, // 2 minutes — odds change fast
      apiUrl: 'https://api.the-odds-api.com/v4',
      apiKey: process.env.ODDS_API_KEY || '',
    });
    // Football sport keys — top European leagues
    this.footballKeys = [
      'soccer_epl', 'soccer_uefa_champs_league', 'soccer_spain_la_liga',
      'soccer_italy_serie_a', 'soccer_germany_bundesliga', 'soccer_france_ligue_one',
      'soccer_fa_cup', 'soccer_efl_champ', 'soccer_league_one', 'soccer_league_two',
      'soccer_uefa_europa_league', 'soccer_scotland_premiership'
    ];
    // Racing sport keys — UK & IRE
    this.racingKeys = [
      'horse_racing_uk', 'horse_racing_ire'
    ];
    // All football markets we want
    this.footballMarkets = 'h2h,totals,btts,spreads';
    // Racing markets
    this.racingMarkets = 'h2h'; // win market for racing
    // Backwards compat
    this.sportKeys = this.footballKeys;
  }

  async fetch() {
    if (!this.config.apiKey) {
      console.log('[elite-odds] No API key — set ODDS_API_KEY env var. Sign up: https://the-odds-api.com/');
      return { football: [], racing: [] };
    }
    try {
      var footballOdds = [];
      var racingOdds = [];

      // Fetch football odds — all configured leagues
      for (var i = 0; i < this.footballKeys.length; i++) {
        try {
          var fbData = await this._apiGet('/sports/' + this.footballKeys[i] + '/odds/?regions=uk&markets=' + this.footballMarkets + '&oddsFormat=decimal&apiKey=' + this.config.apiKey);
          if (Array.isArray(fbData)) footballOdds = footballOdds.concat(fbData);
        } catch (e) {
          // Sport may have no upcoming events — not an error
        }
      }

      // Fetch horse racing odds — UK & IRE
      for (var j = 0; j < this.racingKeys.length; j++) {
        try {
          var rcData = await this._apiGet('/sports/' + this.racingKeys[j] + '/odds/?regions=uk&markets=' + this.racingMarkets + '&oddsFormat=decimal&apiKey=' + this.config.apiKey);
          if (Array.isArray(rcData)) racingOdds = racingOdds.concat(rcData);
        } catch (e) {
          // No racing events today — not an error
        }
      }

      console.log('[elite-odds] Fetched ' + footballOdds.length + ' football + ' + racingOdds.length + ' racing events from ' + (this.footballKeys.length + this.racingKeys.length) + ' sport keys');
      return { football: footballOdds, racing: racingOdds };
    } catch (err) {
      console.error('[elite-odds] Error: ' + err.message);
      return { football: [], racing: [] };
    }
  }

  /**
   * Fetch odds for a single sport key with specific markets.
   * Useful for on-demand fetches (e.g. user viewing a specific race).
   */
  async fetchSport(sportKey, markets) {
    if (!this.config.apiKey) return [];
    try {
      var mkts = markets || 'h2h';
      var data = await this._apiGet('/sports/' + sportKey + '/odds/?regions=uk&markets=' + mkts + '&oddsFormat=decimal&apiKey=' + this.config.apiKey);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('[elite-odds] fetchSport(' + sportKey + ') error: ' + err.message);
      return [];
    }
  }

  /**
   * List all available sports with active event counts.
   * Useful for checking which racing/football markets are live.
   */
  async fetchActiveSports() {
    if (!this.config.apiKey) return [];
    try {
      var data = await this._apiGet('/sports/?apiKey=' + this.config.apiKey);
      return Array.isArray(data) ? data.filter(function(s) { return s.active; }) : [];
    } catch (err) {
      console.error('[elite-odds] fetchActiveSports error: ' + err.message);
      return [];
    }
  }

  _apiGet(path) {
    return new Promise((resolve, reject) => {
      var https = require('https');
      var options = {
        hostname: 'api.the-odds-api.com',
        path: '/v4' + path,
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      };
      var req = https.request(options, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var parsed = JSON.parse(data);
            // Log remaining API credits from response headers
            var remaining = res.headers['x-requests-remaining'];
            var used = res.headers['x-requests-used'];
            if (remaining) {
              console.log('[elite-odds] API credits: ' + used + ' used, ' + remaining + ' remaining');
            }
            resolve(parsed);
          }
          catch (e) { reject(new Error('Invalid JSON from The Odds API')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, function() { req.destroy(); reject(new Error('The Odds API timeout')); });
      req.end();
    });
  }

  normalise(raw) {
    // Handle both old format (array) and new format ({ football, racing })
    var events = [];
    if (Array.isArray(raw)) {
      events = raw;
    } else if (raw && raw.football) {
      events = (raw.football || []).concat(raw.racing || []);
    }
    if (!events.length) return [];

    return events.map(function(event) {
      // Extract ALL markets per bookmaker (h2h, totals, btts, spreads)
      var bookmakerOdds = {};
      var allMarkets = {};

      (event.bookmakers || []).forEach(function(bk) {
        bookmakerOdds[bk.key] = {};
        (bk.markets || []).forEach(function(market) {
          if (!allMarkets[market.key]) allMarkets[market.key] = {};
          allMarkets[market.key][bk.key] = {};
          if (market.outcomes) {
            market.outcomes.forEach(function(o) {
              if (market.key === 'h2h') {
                bookmakerOdds[bk.key][o.name] = o.price;
              }
              allMarkets[market.key][bk.key][o.name] = o.price;
            });
          }
        });
      });

      return {
        eventId: event.id,
        sport: event.sport_key,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        kickoff: event.commence_time,
        bookmakerOdds: bookmakerOdds,
        markets: allMarkets
      };
    });
  }

  /**
   * Normalise racing odds into runner-level intelligence.
   * Returns per-runner: best price, worst price, average, bookmaker count, value rating.
   */
  normaliseRacing(rawRacing) {
    if (!Array.isArray(rawRacing)) return [];

    return rawRacing.map(function(event) {
      var runners = {};

      (event.bookmakers || []).forEach(function(bk) {
        var winMarket = (bk.markets || []).find(function(m) { return m.key === 'h2h'; });
        if (winMarket && winMarket.outcomes) {
          winMarket.outcomes.forEach(function(outcome) {
            var name = outcome.name;
            if (!runners[name]) {
              runners[name] = {
                name: name,
                prices: [],
                bookmakers: {},
              };
            }
            runners[name].prices.push(outcome.price);
            runners[name].bookmakers[bk.key] = outcome.price;
          });
        }
      });

      // Calculate intelligence per runner
      var runnerList = Object.values(runners).map(function(r) {
        var prices = r.prices.sort(function(a, b) { return b - a; }); // highest first
        var bestPrice = prices[0] || 0;
        var worstPrice = prices[prices.length - 1] || 0;
        var avgPrice = prices.length > 0 ? prices.reduce(function(s, p) { return s + p; }, 0) / prices.length : 0;
        var bestBookmaker = '';

        // Find which bookmaker has the best price
        for (var bk in r.bookmakers) {
          if (r.bookmakers[bk] === bestPrice) {
            bestBookmaker = bk;
            break;
          }
        }

        // Price spread across bookmakers (wide = market uncertain)
        var priceSpread = bestPrice - worstPrice;
        var spreadPct = worstPrice > 0 ? (priceSpread / worstPrice) * 100 : 0;

        // Market confidence: tight spread + many bookmakers = confident market
        var bookmakerCount = prices.length;
        var marketConfidence = 'low';
        if (bookmakerCount >= 8 && spreadPct < 10) marketConfidence = 'very high';
        else if (bookmakerCount >= 5 && spreadPct < 15) marketConfidence = 'high';
        else if (bookmakerCount >= 3 && spreadPct < 25) marketConfidence = 'medium';

        return {
          name: r.name,
          bestPrice: Math.round(bestPrice * 100) / 100,
          worstPrice: Math.round(worstPrice * 100) / 100,
          averagePrice: Math.round(avgPrice * 100) / 100,
          bestBookmaker: bestBookmaker,
          bookmakerCount: bookmakerCount,
          priceSpread: Math.round(priceSpread * 100) / 100,
          spreadPct: Math.round(spreadPct * 10) / 10,
          marketConfidence: marketConfidence,
          allPrices: r.bookmakers,
        };
      });

      // Sort by average price (shortest first = market favourite)
      runnerList.sort(function(a, b) { return a.averagePrice - b.averagePrice; });

      // Add market rank
      runnerList.forEach(function(r, idx) { r.marketRank = idx + 1; });

      return {
        eventId: event.id,
        sport: event.sport_key,
        eventName: (event.home_team || '') + (event.away_team ? ' v ' + event.away_team : ''),
        commenceTime: event.commence_time,
        runners: runnerList,
        runnerCount: runnerList.length,
        bookmakerCount: (event.bookmakers || []).length,
      };
    });
  }

  /**
   * Find best price for a specific selection across all bookmakers.
   * Works for both football teams and racing runners.
   * @param {string} selectionName — team or horse name
   * @param {Array} normalisedOdds — output from normalise() or normaliseRacing()
   * @returns {Object|null} Best price data
   */
  findBestPrice(selectionName, normalisedOdds) {
    if (!selectionName || !Array.isArray(normalisedOdds)) return null;
    var searchName = selectionName.toLowerCase();

    for (var i = 0; i < normalisedOdds.length; i++) {
      var event = normalisedOdds[i];

      // Racing format (has runners array)
      if (event.runners) {
        var runner = event.runners.find(function(r) {
          return r.name.toLowerCase() === searchName ||
                 r.name.toLowerCase().indexOf(searchName) !== -1 ||
                 searchName.indexOf(r.name.toLowerCase()) !== -1;
        });
        if (runner) {
          return {
            selection: runner.name,
            bestPrice: runner.bestPrice,
            bestBookmaker: runner.bestBookmaker,
            averagePrice: runner.averagePrice,
            worstPrice: runner.worstPrice,
            edgeVsAverage: runner.bestPrice > 0 && runner.averagePrice > 0
              ? Math.round(((runner.bestPrice - runner.averagePrice) / runner.averagePrice) * 10000) / 100
              : 0,
            bookmakerCount: runner.bookmakerCount,
            marketConfidence: runner.marketConfidence,
            allPrices: runner.allPrices,
            event: event.eventName,
          };
        }
      }

      // Football format (has bookmakerOdds)
      if (event.bookmakerOdds) {
        var bestPrice = 0;
        var bestBk = '';
        var prices = [];
        for (var bk in event.bookmakerOdds) {
          for (var outcome in event.bookmakerOdds[bk]) {
            if (outcome.toLowerCase().indexOf(searchName) !== -1 || searchName.indexOf(outcome.toLowerCase()) !== -1) {
              var price = event.bookmakerOdds[bk][outcome];
              prices.push(price);
              if (price > bestPrice) {
                bestPrice = price;
                bestBk = bk;
              }
            }
          }
        }
        if (bestPrice > 0) {
          var avg = prices.reduce(function(s, p) { return s + p; }, 0) / prices.length;
          return {
            selection: selectionName,
            bestPrice: Math.round(bestPrice * 100) / 100,
            bestBookmaker: bestBk,
            averagePrice: Math.round(avg * 100) / 100,
            worstPrice: Math.round(Math.min.apply(null, prices) * 100) / 100,
            edgeVsAverage: avg > 0 ? Math.round(((bestPrice - avg) / avg) * 10000) / 100 : 0,
            bookmakerCount: prices.length,
            allPrices: event.bookmakerOdds,
            event: event.homeTeam + ' v ' + event.awayTeam,
          };
        }
      }
    }
    return null;
  }

  /**
   * Get full market intelligence for a football fixture.
   * Returns consensus odds, best prices, value detection per outcome.
   */
  getFootballIntelligence(homeTeam, awayTeam, normalisedOdds) {
    if (!homeTeam || !normalisedOdds) return null;
    var homeLower = homeTeam.toLowerCase();
    var awayLower = (awayTeam || '').toLowerCase();

    var match = normalisedOdds.find(function(e) {
      var eHome = (e.homeTeam || '').toLowerCase();
      var eAway = (e.awayTeam || '').toLowerCase();
      return (eHome.indexOf(homeLower) !== -1 || homeLower.indexOf(eHome) !== -1) &&
             (!awayLower || eAway.indexOf(awayLower) !== -1 || awayLower.indexOf(eAway) !== -1);
    });
    if (!match || !match.bookmakerOdds) return null;

    var outcomes = {}; // { 'Home': { prices: [], best, worst, avg, bestBk } }

    for (var bk in match.bookmakerOdds) {
      for (var outcomeName in match.bookmakerOdds[bk]) {
        if (!outcomes[outcomeName]) {
          outcomes[outcomeName] = { prices: [], bestPrice: 0, bestBookmaker: '' };
        }
        var price = match.bookmakerOdds[bk][outcomeName];
        outcomes[outcomeName].prices.push(price);
        if (price > outcomes[outcomeName].bestPrice) {
          outcomes[outcomeName].bestPrice = price;
          outcomes[outcomeName].bestBookmaker = bk;
        }
      }
    }

    var intelligence = {};
    for (var name in outcomes) {
      var o = outcomes[name];
      var avg = o.prices.reduce(function(s, p) { return s + p; }, 0) / o.prices.length;
      var worst = Math.min.apply(null, o.prices);
      intelligence[name] = {
        bestPrice: Math.round(o.bestPrice * 100) / 100,
        bestBookmaker: o.bestBookmaker,
        averagePrice: Math.round(avg * 100) / 100,
        worstPrice: Math.round(worst * 100) / 100,
        bookmakerCount: o.prices.length,
        impliedProbability: Math.round((1 / avg) * 10000) / 100,
        edgeAtBestPrice: Math.round(((o.bestPrice - avg) / avg) * 10000) / 100,
      };
    }

    // Overround (total implied probability — how much bookmakers take)
    var totalImplied = 0;
    var avgPrices = {};
    for (var n in intelligence) {
      totalImplied += intelligence[n].impliedProbability;
      avgPrices[n] = intelligence[n].averagePrice;
    }

    return {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: match.kickoff,
      outcomes: intelligence,
      overround: Math.round(totalImplied * 100) / 100,
      fairOverround: 100, // true probability sums to 100%
      bookmakerEdge: Math.round((totalImplied - 100) * 100) / 100,
      bookmakerCount: Object.keys(match.bookmakerOdds).length,
      markets: match.markets || {},
    };
  }
}

// ---------------------------------------------------------------------------
// RACING DATA SOURCES
// ---------------------------------------------------------------------------

/**
 * Racing Cards Source
 * Primary: The Racing API (theracingapi.com) — UK & IRE racecards
 * Fallback: At The Races data feed (attheraces.com)
 *
 * To activate:
 *   1. Subscribe at https://www.theracingapi.com/
 *   2. Set env: RACING_API_KEY=your_key, RACING_API_SECRET=your_secret
 */
class RacingCardsSource extends DataSource {
  constructor() {
    super('racing-cards', {
      refreshInterval: 180000, // 3 minutes — match The Racing API update frequency
      apiUrl: 'https://api.theracingapi.com/v1',
      apiKey: process.env.RACING_API_KEY || '',
      apiSecret: process.env.RACING_API_SECRET || '',
    });
  }

  async fetch() {
    if (!this.config.apiKey || !this.config.apiSecret) {
      console.log(`[${this.name}] No API credentials — set RACING_API_KEY and RACING_API_SECRET`);
      return { racecards: [] };
    }

    try {
      const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64');
      // Tier-aware: try pro → standard → basic → free until one returns data
      const endpoints = ['/racecards/pro', '/racecards/standard', '/racecards/basic', '/racecards/free'];
      for (const endpoint of endpoints) {
        try {
          const racecards = await this._apiGet(endpoint, auth);
          if (racecards && racecards.racecards && racecards.racecards.length > 0) {
            console.log(`[${this.name}] Fetched ${racecards.racecards.length} races via ${endpoint}`);
            // Also fetch big-races (future festival headline races) and merge
            try {
              const bigRaces = await this._apiGet('/racecards/big-races', auth);
              if (bigRaces && bigRaces.racecards) {
                // Merge big-races that aren't already in the main list
                const existingIds = new Set(racecards.racecards.map(r => r.race_id));
                const extras = bigRaces.racecards.filter(r => !existingIds.has(r.race_id));
                if (extras.length > 0) {
                  racecards.racecards = racecards.racecards.concat(extras);
                  console.log(`[${this.name}] Added ${extras.length} big-races from future dates`);
                }
              }
            } catch (e) { /* big-races is optional */ }
            return racecards;
          }
        } catch (e) {
          // Try next endpoint
        }
      }
      console.log(`[${this.name}] All endpoints returned empty`);
      return { racecards: [] };
    } catch (err) {
      console.error(`[${this.name}] API Error: ${err.message}`);
      this.errorCount++;
      return { racecards: [] };
    }
  }

  // Fetch results — Standard plan endpoint: /results/today or /results
  async fetchResults(date) {
    if (!this.config.apiKey || !this.config.apiSecret) return { results: [] };
    try {
      const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64');
      // Standard plan supports /results/today and /results for recent results
      const endpoints = ['/results/today', '/results'];
      for (const endpoint of endpoints) {
        try {
          const results = await this._apiGet(endpoint, auth);
          if (results && results.results && results.results.length > 0) {
            console.log(`[${this.name}] Fetched ${results.results.length} results via ${endpoint}`);
            return results;
          }
        } catch (e) { /* try next */ }
      }
      return { results: [] };
    } catch (err) {
      console.error(`[${this.name}] Results Error: ${err.message}`);
      return { results: [] };
    }
  }

  // Fetch individual horse form
  async fetchHorseForm(horseId) {
    if (!this.config.apiKey || !this.config.apiSecret) return {};
    try {
      const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64');
      return await this._apiGet(`/horses/${horseId}/form`, auth);
    } catch (err) {
      return {};
    }
  }

  // Generic API GET request
  _apiGet(path, auth) {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const options = {
        hostname: 'api.theracingapi.com',
        path: `/v1${path}`,
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Invalid JSON response')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }

  normalise(raw) {
    // Transform Racing API response to our internal format
    if (!raw.racecards) return [];
    return raw.racecards.map(race => {
      return {
        raceId: race.race_id || race.id,
        meeting: race.course || race.meeting,
        time: race.off_time || race.time,
        raceClass: race.race_class || race.class,
        distance: race.distance,
        going: race.going,
        surface: race.surface || 'Turf',
        prizeMoney: race.prize,
        raceName: race.race_name || race.name,
        region: race.region || '',
        raceType: race.type || '',
        sex: race.sex_restriction || '',
        runners: (race.runners || []).map(r => {
          // Extract odds: if array of bookmaker odds, take first decimal; otherwise use raw value
          var oddsArray = Array.isArray(r.odds) ? r.odds : (Array.isArray(r.forecast_price) ? r.forecast_price : null);
          var primaryOdds = null;
          var allOdds = [];
          if (oddsArray && oddsArray.length > 0) {
            allOdds = oddsArray;
            // Use the first bookmaker's decimal price
            primaryOdds = parseFloat(oddsArray[0].decimal) || null;
          } else if (r.odds && !Array.isArray(r.odds)) {
            primaryOdds = parseFloat(r.odds) || null;
          } else if (r.forecast_price && !Array.isArray(r.forecast_price)) {
            primaryOdds = parseFloat(r.forecast_price) || null;
          }
          return {
            horseName: r.horse || r.horse_name || r.horseName,
            horseId: r.horse_id || r.horseId,
            jockey: r.jockey,
            trainer: r.trainer,
            age: r.age,
            weight: r.weight || r.lbs,
            draw: r.draw || r.stall,
            or: r.ofr || r.or || r.official_rating,
            officialRating: r.ofr || r.or || r.official_rating,
            form: r.form,
            odds: primaryOdds,
            allOdds: allOdds,
            sex: r.sex_restriction || '',
            silkUrl: r.silk_url,
            ownerName: r.owner
          };
        })
      };
    });
  }
}

/**
 * Racing Odds Source — powered by The Odds API
 * Fetches real-time horse racing odds from 40+ UK bookmakers.
 * Provides per-runner best price, market consensus, and bookmaker comparison.
 *
 * This replaces Betfair exchange data with multi-bookmaker intelligence:
 * - Best price across all bookmakers (better than any single exchange)
 * - Market consensus (average price = what the market truly thinks)
 * - Price spread (tight = market confident, wide = uncertainty)
 * - Value detection (where best price significantly beats average)
 */
class RacingOddsSource extends DataSource {
  constructor() {
    super('racing-odds', {
      refreshInterval: 60000, // 1 minute — pre-race markets move fast
      apiKey: process.env.ODDS_API_KEY || '',
    });
  }

  async fetch() {
    if (!this.config.apiKey) {
      console.log(`[${this.name}] No API key — set ODDS_API_KEY`);
      return [];
    }
    try {
      // Use the football-odds source to fetch racing (shared API)
      var https = require('https');
      var allRacing = [];
      var sportKeys = ['horse_racing_uk', 'horse_racing_ire'];

      for (var i = 0; i < sportKeys.length; i++) {
        var data = await new Promise((resolve, reject) => {
          var options = {
            hostname: 'api.the-odds-api.com',
            path: '/v4/sports/' + sportKeys[i] + '/odds/?regions=uk&markets=h2h&oddsFormat=decimal&apiKey=' + this.config.apiKey,
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          };
          var req = https.request(options, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
              try { resolve(JSON.parse(body)); }
              catch (e) { resolve([]); }
            });
          });
          req.on('error', function() { resolve([]); });
          req.setTimeout(15000, function() { req.destroy(); resolve([]); });
          req.end();
        });
        if (Array.isArray(data)) allRacing = allRacing.concat(data);
      }

      console.log(`[${this.name}] Fetched odds for ${allRacing.length} races from ${sportKeys.length} regions`);
      return allRacing;
    } catch (err) {
      console.error(`[${this.name}] Error: ${err.message}`);
      return [];
    }
  }

  normalise(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function(event) {
      var runners = {};
      (event.bookmakers || []).forEach(function(bk) {
        var winMarket = (bk.markets || []).find(function(m) { return m.key === 'h2h'; });
        if (winMarket && winMarket.outcomes) {
          winMarket.outcomes.forEach(function(outcome) {
            if (!runners[outcome.name]) {
              runners[outcome.name] = { name: outcome.name, prices: [], bookmakers: {} };
            }
            runners[outcome.name].prices.push(outcome.price);
            runners[outcome.name].bookmakers[bk.key] = outcome.price;
          });
        }
      });

      var runnerList = Object.values(runners).map(function(r) {
        var sorted = r.prices.slice().sort(function(a, b) { return b - a; });
        var best = sorted[0] || 0;
        var worst = sorted[sorted.length - 1] || 0;
        var avg = sorted.length > 0 ? sorted.reduce(function(s, p) { return s + p; }, 0) / sorted.length : 0;
        var bestBk = '';
        for (var bk in r.bookmakers) {
          if (r.bookmakers[bk] === best) { bestBk = bk; break; }
        }
        return {
          name: r.name,
          bestPrice: Math.round(best * 100) / 100,
          worstPrice: Math.round(worst * 100) / 100,
          averagePrice: Math.round(avg * 100) / 100,
          bestBookmaker: bestBk,
          bookmakerCount: sorted.length,
          priceSpread: Math.round((best - worst) * 100) / 100,
          allPrices: r.bookmakers,
        };
      });
      runnerList.sort(function(a, b) { return a.averagePrice - b.averagePrice; });
      runnerList.forEach(function(r, idx) { r.marketRank = idx + 1; });

      return {
        eventId: event.id,
        sport: event.sport_key,
        raceName: event.home_team || event.away_team || '',
        commenceTime: event.commence_time,
        runners: runnerList,
        bookmakerCount: (event.bookmakers || []).length,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// ENRICHMENT SOURCES
// ---------------------------------------------------------------------------

/**
 * Form & Stats Enrichment
 * Enhances base fixture/racecard data with historical form, speed figures, xG, etc.
 * Sources: Racing Post data, Opta/StatsBomb (xG), FBRef
 */
class FormEnrichmentSource extends DataSource {
  constructor() {
    super('form-enrichment', { refreshInterval: 3600000 }); // Hourly
  }

  async fetch() {
    console.log(`[${this.name}] Fetch called — using sample data`);
    return {};
  }

  normalise(raw) { return raw; }
}

/**
 * Injury & News Source
 * Monitors team news, injury updates, weather conditions
 * Sources: Club official feeds, Physioroom, news APIs
 */
class InjuryNewsSource extends DataSource {
  constructor() {
    super('injury-news', { refreshInterval: 1800000 }); // 30 min
  }

  async fetch() {
    console.log(`[${this.name}] Fetch called — using sample data`);
    return [];
  }

  normalise(raw) { return raw; }
}

/**
 * Odds Movement Tracker — Elite Market Intelligence
 * Monitors odds changes across bookmakers to detect steam moves, drifters,
 * and market confidence shifts. Stores time-series snapshots for movement charts.
 *
 * This is where the REAL edge lives for subscribers:
 * - STEAMERS: Selections shortening rapidly = informed money arriving
 * - DRIFTERS: Selections lengthening = market losing confidence
 * - MARKET MOVERS: Biggest price changes across all events today
 *
 * Runs every 2 minutes. Stores up to 50 snapshots per event (covers full race day).
 */
class OddsMovementTracker extends DataSource {
  constructor() {
    super('odds-movement', {
      refreshInterval: 120000, // 2 minutes — balance between freshness and API credits
    });
    // Time-series storage: { eventId: [{ timestamp, runners: { name: avgPrice } }] }
    this.snapshots = {};
    // Max snapshots per event (50 x 2min = ~100 minutes of tracking)
    this.maxSnapshots = 50;
    // Active alerts: selections with significant movement right now
    this.activeAlerts = [];
    // Today's market movers summary
    this.marketMovers = { steamers: [], drifters: [], updatedAt: null };
  }

  async fetch() {
    // This source doesn't fetch its own data — it piggybacks off the odds sources.
    // It gets called by recordSnapshot() when new odds data arrives.
    console.log(`[${this.name}] ${Object.keys(this.snapshots).length} events tracked, ${this.activeAlerts.length} active alerts`);
    return { tracked: Object.keys(this.snapshots).length, alerts: this.activeAlerts.length };
  }

  normalise(raw) { return raw; }

  /**
   * Record an odds snapshot for an event.
   * Call this every time fresh odds data arrives from The Odds API.
   * @param {string} eventId — unique event identifier
   * @param {string} eventName — human readable name
   * @param {string} sport — 'racing' or 'football'
   * @param {string} commenceTime — ISO datetime of the event
   * @param {Array} runners — array of { name, averagePrice, bestPrice }
   */
  recordSnapshot(eventId, eventName, sport, commenceTime, runners) {
    if (!eventId || !runners || !runners.length) return;

    if (!this.snapshots[eventId]) {
      this.snapshots[eventId] = {
        eventName: eventName,
        sport: sport,
        commenceTime: commenceTime,
        history: [],
      };
    }

    var snapshot = {
      timestamp: new Date().toISOString(),
      runners: {},
    };

    runners.forEach(function(r) {
      snapshot.runners[r.name] = {
        avgPrice: r.averagePrice || r.avgPrice || 0,
        bestPrice: r.bestPrice || 0,
      };
    });

    this.snapshots[eventId].history.push(snapshot);

    // Trim to max snapshots
    if (this.snapshots[eventId].history.length > this.maxSnapshots) {
      this.snapshots[eventId].history.shift();
    }

    // Analyse movement for this event
    this._analyseEvent(eventId);
  }

  /**
   * Analyse price movement for a tracked event.
   * Compares current snapshot to opening snapshot and recent trend.
   */
  _analyseEvent(eventId) {
    var event = this.snapshots[eventId];
    if (!event || event.history.length < 2) return;

    var opening = event.history[0];
    var current = event.history[event.history.length - 1];
    var previous = event.history.length >= 3 ? event.history[event.history.length - 3] : opening;

    for (var runnerName in current.runners) {
      var openPrice = (opening.runners[runnerName] || {}).avgPrice || 0;
      var currentPrice = (current.runners[runnerName] || {}).avgPrice || 0;
      var prevPrice = (previous.runners[runnerName] || {}).avgPrice || 0;

      if (openPrice <= 0 || currentPrice <= 0) continue;

      var movement = this.analyseMovement(openPrice, currentPrice);
      var recentMovement = prevPrice > 0 ? this.analyseMovement(prevPrice, currentPrice) : null;

      // Create alert for significant movements
      if (movement.isSteamMove || movement.isDrift) {
        // Check if alert already exists for this runner
        var existingIdx = this.activeAlerts.findIndex(function(a) {
          return a.eventId === eventId && a.runner === runnerName;
        });

        var alert = {
          eventId: eventId,
          eventName: event.eventName,
          sport: event.sport,
          commenceTime: event.commenceTime,
          runner: runnerName,
          openPrice: openPrice,
          currentPrice: currentPrice,
          movement: movement,
          recentTrend: recentMovement,
          detectedAt: new Date().toISOString(),
          snapshotCount: event.history.length,
        };

        if (existingIdx >= 0) {
          this.activeAlerts[existingIdx] = alert;
        } else {
          this.activeAlerts.push(alert);
        }
      }
    }

    // Clean up alerts for past events
    var now = new Date().getTime();
    this.activeAlerts = this.activeAlerts.filter(function(a) {
      var eventTime = new Date(a.commenceTime).getTime();
      return eventTime > now - 3600000; // Keep alerts for 1 hour after event start
    });

    // Update market movers summary
    this._updateMarketMovers();
  }

  /**
   * Build the market movers summary — top steamers and drifters today.
   * This is the headline feature for the subscriber dashboard.
   */
  _updateMarketMovers() {
    var allMovements = [];

    for (var eventId in this.snapshots) {
      var event = this.snapshots[eventId];
      if (event.history.length < 2) continue;

      var opening = event.history[0];
      var current = event.history[event.history.length - 1];

      for (var runner in current.runners) {
        var openP = (opening.runners[runner] || {}).avgPrice || 0;
        var currP = (current.runners[runner] || {}).avgPrice || 0;
        if (openP <= 0 || currP <= 0) continue;

        var pctChange = ((currP - openP) / openP) * 100;
        allMovements.push({
          eventId: eventId,
          eventName: event.eventName,
          sport: event.sport,
          commenceTime: event.commenceTime,
          runner: runner,
          openPrice: Math.round(openP * 100) / 100,
          currentPrice: Math.round(currP * 100) / 100,
          percentChange: Math.round(pctChange * 10) / 10,
          direction: pctChange < -2 ? 'shortening' : pctChange > 2 ? 'drifting' : 'stable',
          isSteamer: pctChange <= -8,
          isDrifter: pctChange >= 12,
        });
      }
    }

    // Sort: biggest shortening first for steamers, biggest drifting first for drifters
    var steamers = allMovements
      .filter(function(m) { return m.percentChange < -5; })
      .sort(function(a, b) { return a.percentChange - b.percentChange; })
      .slice(0, 10);

    var drifters = allMovements
      .filter(function(m) { return m.percentChange > 8; })
      .sort(function(a, b) { return b.percentChange - a.percentChange; })
      .slice(0, 10);

    this.marketMovers = {
      steamers: steamers,
      drifters: drifters,
      totalTracked: allMovements.length,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get movement history for a specific event.
   * Returns time-series data for price chart rendering.
   */
  getEventHistory(eventId) {
    var event = this.snapshots[eventId];
    if (!event) return null;

    return {
      eventId: eventId,
      eventName: event.eventName,
      sport: event.sport,
      commenceTime: event.commenceTime,
      snapshotCount: event.history.length,
      history: event.history,
    };
  }

  /**
   * Get movement for a specific runner across all their entries.
   */
  getRunnerMovement(runnerName) {
    var searchName = (runnerName || '').toLowerCase();
    var results = [];

    for (var eventId in this.snapshots) {
      var event = this.snapshots[eventId];
      if (event.history.length < 2) continue;

      var opening = event.history[0];
      var current = event.history[event.history.length - 1];

      for (var name in current.runners) {
        if (name.toLowerCase().indexOf(searchName) === -1 && searchName.indexOf(name.toLowerCase()) === -1) continue;

        var openP = (opening.runners[name] || {}).avgPrice || 0;
        var currP = (current.runners[name] || {}).avgPrice || 0;
        if (openP <= 0 || currP <= 0) continue;

        results.push({
          eventId: eventId,
          eventName: event.eventName,
          runner: name,
          openPrice: openP,
          currentPrice: currP,
          movement: this.analyseMovement(openP, currP),
          history: event.history.map(function(h) {
            return {
              timestamp: h.timestamp,
              price: (h.runners[name] || {}).avgPrice || null,
            };
          }).filter(function(h) { return h.price !== null; }),
        });
      }
    }
    return results;
  }

  /**
   * Detect significant movement (steam move / drift).
   * @param {number} openOdds — Opening odds
   * @param {number} currentOdds — Current odds
   * @returns {Object} Movement analysis with signal strength
   */
  analyseMovement(openOdds, currentOdds) {
    if (!openOdds || openOdds <= 0) return { direction: 'unknown', percentChange: 0, signal: 'no data' };
    var change = ((currentOdds - openOdds) / openOdds) * 100;
    var absChange = Math.abs(change);

    // Signal strength based on magnitude of move
    var signalStrength = 'neutral';
    if (absChange >= 20) signalStrength = 'extreme';
    else if (absChange >= 12) signalStrength = 'strong';
    else if (absChange >= 6) signalStrength = 'moderate';
    else if (absChange >= 3) signalStrength = 'mild';

    return {
      direction: change < -2 ? 'shortening' : change > 2 ? 'drifting' : 'stable',
      percentChange: Math.round(change * 10) / 10,
      isSteamMove: change <= -8,   // 8%+ shortening = steam move (pro money)
      isDrift: change >= 12,        // 12%+ lengthening = market drift
      isGamble: change <= -15,      // 15%+ shortening = serious gamble
      signalStrength: signalStrength,
      signal: change <= -15 ? 'GAMBLE — heavy money' :
              change <= -8 ? 'STEAMER — strong support' :
              change <= -5 ? 'supported' :
              change >= 15 ? 'DRIFTER — avoid' :
              change >= 8 ? 'drifting — caution' :
              'neutral',
    };
  }

  /**
   * Clean up old event data. Call daily or on server restart.
   */
  cleanup() {
    var cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    var removed = 0;
    for (var eventId in this.snapshots) {
      var event = this.snapshots[eventId];
      var eventTime = new Date(event.commenceTime).getTime();
      if (eventTime < cutoff) {
        delete this.snapshots[eventId];
        removed++;
      }
    }
    if (removed > 0) {
      console.log('[odds-movement] Cleaned up ' + removed + ' old events');
    }
    return removed;
  }
}

/**
 * Historical Results Source
 * Fetches past results for model calibration and performance tracking.
 * Sources: Racing Post results, football-data.org results
 */
class HistoricalResultsSource extends DataSource {
  constructor() {
    super('historical-results', { refreshInterval: 86400000 }); // Daily
  }

  async fetch() {
    console.log(`[${this.name}] Fetch called — using sample data`);
    return [];
  }

  normalise(raw) { return raw; }
}

// ---------------------------------------------------------------------------
// BETFAIR EXCHANGE DATA SOURCE
// ---------------------------------------------------------------------------

/**
 * Betfair Exchange Source
 * Provides real exchange data: traded volume, back/lay prices, price movements.
 * This is where PROFESSIONAL money flows — far more valuable than bookmaker odds.
 *
 * To activate:
 *   1. Create a free Betfair account at https://www.betfair.com/
 *   2. Register for a free developer app key at https://developer.betfair.com/
 *   3. Set env: BETFAIR_APP_KEY, BETFAIR_USERNAME, BETFAIR_PASSWORD
 */
class BetfairExchangeSource extends DataSource {
  constructor() {
    super('betfair-exchange', {
      refreshInterval: 60000, // 1 minute — exchange prices move fast
      apiUrl: 'https://api.betfair.com/exchange/betting/rest/v1.0',
      appKey: process.env.BETFAIR_APP_KEY || '',
      username: process.env.BETFAIR_USERNAME || '',
      password: process.env.BETFAIR_PASSWORD || '',
    });
    this._sessionToken = null;
    this._sessionExpiry = null;
    this._lastRequestTime = 0;
    this._minRequestInterval = 200; // 5 requests/sec max = 200ms between calls
  }

  /** Rate-limit: wait if needed to stay under 5 req/sec */
  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this._lastRequestTime;
    if (elapsed < this._minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this._minRequestInterval - elapsed));
    }
    this._lastRequestTime = Date.now();
  }

  /** Check if Betfair credentials are configured */
  isConfigured() {
    return !!(this.config.appKey && this.config.username && this.config.password);
  }

  /**
   * Login to Betfair SSO — returns session token (SSOID).
   * Caches token for 4 hours to avoid re-login every call.
   */
  async _login() {
    // Return cached token if still valid (4 hour expiry)
    if (this._sessionToken && this._sessionExpiry && Date.now() < this._sessionExpiry) {
      return this._sessionToken;
    }

    if (!this.isConfigured()) {
      throw new Error('Betfair credentials not configured');
    }

    const https = require('https');
    const querystring = require('querystring');

    const postData = querystring.stringify({
      username: this.config.username,
      password: this.config.password,
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'identitysso.betfair.com',
        path: '/api/login',
        method: 'POST',
        headers: {
          'X-Application': this.config.appKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'Accept': 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.token) {
              this._sessionToken = parsed.token;
              this._sessionExpiry = Date.now() + (4 * 60 * 60 * 1000); // 4 hours
              console.log('[betfair-exchange] Login successful — session cached for 4 hours');
              resolve(parsed.token);
            } else {
              reject(new Error('Betfair login failed: ' + (parsed.error || parsed.status || 'Unknown error')));
            }
          } catch (e) {
            reject(new Error('Betfair login: invalid JSON response'));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Betfair login timeout')); });
      req.write(postData);
      req.end();
    });
  }

  /**
   * Make an authenticated POST to the Betfair Exchange API.
   * @param {string} endpoint — e.g. 'listMarketBook'
   * @param {Object} body — JSON body for the request
   * @returns {Promise<Object>} parsed response
   */
  async _apiPost(endpoint, body) {
    await this._rateLimit();
    const sessionToken = await this._login();
    const https = require('https');
    const postData = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.betfair.com',
        path: '/exchange/betting/rest/v1.0/' + endpoint + '/',
        method: 'POST',
        headers: {
          'X-Application': this.config.appKey,
          'X-Authentication': sessionToken,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Accept': 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            // Handle session expiry
            if (parsed.detail && parsed.detail.APINGException &&
                parsed.detail.APINGException.errorCode === 'INVALID_SESSION_INFORMATION') {
              this._sessionToken = null;
              this._sessionExpiry = null;
              reject(new Error('Betfair session expired — will re-login on next call'));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error('Betfair API: invalid JSON response'));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Betfair API timeout')); });
      req.write(postData);
      req.end();
    });
  }

  async fetch() {
    if (!this.isConfigured()) {
      console.log('[betfair-exchange] Not configured — set BETFAIR_APP_KEY, BETFAIR_USERNAME, BETFAIR_PASSWORD');
      return [];
    }
    try {
      await this._login();
      console.log('[betfair-exchange] Connection verified');
      return [];
    } catch (err) {
      console.error('[betfair-exchange] Connection test failed:', err.message);
      return [];
    }
  }

  normalise(raw) { return raw; }

  /**
   * Fetch market book (prices + traded volume) for a specific market.
   * @param {string} marketId — Betfair market ID
   * @returns {Object|null} Market book data
   */
  async fetchMarket(marketId) {
    if (!this.isConfigured()) return null;
    try {
      const result = await this._apiPost('listMarketBook', {
        marketIds: [marketId],
        priceProjection: {
          priceData: ['EX_BEST_OFFERS', 'EX_TRADED'],
        },
      });
      return Array.isArray(result) && result.length > 0 ? result[0] : null;
    } catch (err) {
      console.error('[betfair-exchange] fetchMarket error:', err.message);
      return null;
    }
  }

  /**
   * Find racing WIN markets by meeting name and race time.
   * @param {string} meetingName — e.g. "Ascot", "Cheltenham"
   * @param {string} raceTime — e.g. "14:30" or ISO date string
   * @returns {Array} Matching market catalogues
   */
  async fetchRacingMarkets(meetingName, raceTime) {
    if (!this.isConfigured()) return [];
    try {
      const today = new Date();
      const tomorrow = new Date(today.getTime() + 86400000);
      const result = await this._apiPost('listMarketCatalogue', {
        filter: {
          eventTypeIds: ['7'], // Horse Racing
          marketCountries: ['GB', 'IE'],
          marketTypeCodes: ['WIN'],
          marketStartTime: {
            from: today.toISOString(),
            to: tomorrow.toISOString(),
          },
        },
        marketProjection: ['RUNNER_DESCRIPTION', 'MARKET_START_TIME', 'EVENT'],
        maxResults: 100,
        sort: 'FIRST_TO_START',
      });

      if (!Array.isArray(result)) return [];

      // Filter by course name and optionally by time
      const courseName = (meetingName || '').toLowerCase();
      const targetTime = raceTime || '';

      return result.filter(function(market) {
        var eventName = (market.event && market.event.name ? market.event.name : '').toLowerCase();
        var marketName = (market.marketName || '').toLowerCase();
        var courseMatch = eventName.indexOf(courseName) !== -1 || marketName.indexOf(courseName) !== -1;

        if (!courseMatch) return false;

        // If a specific time was provided, match it
        if (targetTime && market.marketStartTime) {
          var marketTime = new Date(market.marketStartTime);
          var marketTimeStr = marketTime.toTimeString().slice(0, 5); // "HH:MM"
          var normalTarget = targetTime.slice(0, 5); // normalise to "HH:MM"
          // Allow 5-minute window for time matching
          var mMins = marketTime.getHours() * 60 + marketTime.getMinutes();
          var tParts = normalTarget.split(':');
          var tMins = parseInt(tParts[0]) * 60 + parseInt(tParts[1]);
          return Math.abs(mMins - tMins) <= 5;
        }

        return true;
      });
    } catch (err) {
      console.error('[betfair-exchange] fetchRacingMarkets error:', err.message);
      return [];
    }
  }

  /**
   * Find football markets by team names.
   * @param {string} homeTeam — Home team name
   * @param {string} awayTeam — Away team name (optional, for disambiguation)
   * @returns {Array} Matching market catalogues
   */
  async fetchFootballMarkets(homeTeam, awayTeam) {
    if (!this.isConfigured()) return [];
    try {
      var searchQuery = homeTeam || '';
      var result = await this._apiPost('listMarketCatalogue', {
        filter: {
          eventTypeIds: ['1'], // Football
          textQuery: searchQuery,
          marketTypeCodes: ['MATCH_ODDS', 'OVER_UNDER_25', 'BOTH_TEAMS_TO_SCORE'],
        },
        marketProjection: ['RUNNER_DESCRIPTION', 'MARKET_START_TIME', 'EVENT'],
        maxResults: 10,
        sort: 'FIRST_TO_START',
      });

      if (!Array.isArray(result)) return [];

      // Further filter by away team if provided
      if (awayTeam) {
        var awayLower = awayTeam.toLowerCase();
        var filtered = result.filter(function(market) {
          var eventName = (market.event && market.event.name ? market.event.name : '').toLowerCase();
          return eventName.indexOf(awayLower) !== -1;
        });
        if (filtered.length > 0) return filtered;
      }

      return result;
    } catch (err) {
      console.error('[betfair-exchange] fetchFootballMarkets error:', err.message);
      return [];
    }
  }

  /**
   * Get full exchange intelligence for a market.
   * Returns traded volume, back/lay prices, spread, VWAP, and price trend per runner.
   * @param {string} marketId — Betfair market ID
   * @returns {Object|null} Exchange intelligence data
   */
  async getExchangeData(marketId) {
    if (!this.isConfigured()) return null;
    try {
      var marketBook = await this.fetchMarket(marketId);
      if (!marketBook || !marketBook.runners) return null;

      var totalMarketVolume = marketBook.totalMatched || 0;

      // Sort runners by traded volume to determine volume rank
      var runnerVolumes = marketBook.runners.map(function(r) {
        var tradedVol = 0;
        if (r.ex && r.ex.tradedVolume && Array.isArray(r.ex.tradedVolume)) {
          tradedVol = r.ex.tradedVolume.reduce(function(sum, tv) { return sum + (tv.size || 0); }, 0);
        }
        return { selectionId: r.selectionId, volume: tradedVol };
      }).sort(function(a, b) { return b.volume - a.volume; });

      var volumeRanks = {};
      runnerVolumes.forEach(function(rv, idx) {
        volumeRanks[rv.selectionId] = idx + 1;
      });

      var runners = marketBook.runners.map(function(runner) {
        // Best back price (highest price someone will lay at for you to back)
        var backPrice = 0;
        if (runner.ex && runner.ex.availableToBack && runner.ex.availableToBack.length > 0) {
          backPrice = runner.ex.availableToBack[0].price || 0;
        }

        // Best lay price (lowest price someone will back at for you to lay)
        var layPrice = 0;
        if (runner.ex && runner.ex.availableToLay && runner.ex.availableToLay.length > 0) {
          layPrice = runner.ex.availableToLay[0].price || 0;
        }

        // Spread: difference between lay and back (tight = market confident)
        var spread = layPrice > 0 && backPrice > 0 ? layPrice - backPrice : 0;
        var spreadPct = backPrice > 0 ? (spread / backPrice) * 100 : 0;

        // Total traded volume for this runner
        var tradedVolume = 0;
        var tradedPriceVolume = [];
        if (runner.ex && runner.ex.tradedVolume && Array.isArray(runner.ex.tradedVolume)) {
          tradedPriceVolume = runner.ex.tradedVolume;
          tradedVolume = tradedPriceVolume.reduce(function(sum, tv) { return sum + (tv.size || 0); }, 0);
        }

        // Volume-Weighted Average Price (VWAP)
        var vwap = 0;
        if (tradedPriceVolume.length > 0 && tradedVolume > 0) {
          var weightedSum = tradedPriceVolume.reduce(function(sum, tv) {
            return sum + ((tv.price || 0) * (tv.size || 0));
          }, 0);
          vwap = weightedSum / tradedVolume;
        }

        // Price movement: compare current back price to VWAP
        // If current price < VWAP, price has shortened (money coming in)
        // If current price > VWAP, price has drifted (money moving away)
        var priceMovement = 'stable';
        if (vwap > 0 && backPrice > 0) {
          var movementPct = ((backPrice - vwap) / vwap) * 100;
          if (movementPct < -3) priceMovement = 'shortening';
          else if (movementPct > 5) priceMovement = 'drifting';
        }

        return {
          selectionId: runner.selectionId,
          runnerName: runner.runnerName || '',
          status: runner.status,
          backPrice: Math.round(backPrice * 100) / 100,
          layPrice: Math.round(layPrice * 100) / 100,
          spread: Math.round(spread * 1000) / 1000,
          spreadPct: Math.round(spreadPct * 100) / 100,
          tradedVolume: Math.round(tradedVolume),
          vwap: Math.round(vwap * 100) / 100,
          priceMovement: priceMovement,
          volumeRank: volumeRanks[runner.selectionId] || 0,
        };
      });

      return {
        marketId: marketBook.marketId,
        status: marketBook.status,
        totalMatched: Math.round(totalMarketVolume),
        runners: runners,
      };
    } catch (err) {
      console.error('[betfair-exchange] getExchangeData error:', err.message);
      return null;
    }
  }

  /**
   * Match a runner name from Racing API to a Betfair exchange runner.
   * Names may differ slightly between sources.
   * @param {string} horseName — Runner name from our data
   * @param {Array} exchangeRunners — Runners from exchange data
   * @returns {Object|null} Matched exchange runner data
   */
  matchRunner(horseName, exchangeRunners) {
    if (!horseName || !exchangeRunners || !Array.isArray(exchangeRunners)) return null;
    var normalised = horseName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Exact match first
    var exact = exchangeRunners.find(function(r) {
      return (r.runnerName || '').toLowerCase().replace(/[^a-z0-9]/g, '') === normalised;
    });
    if (exact) return exact;

    // Partial match (one name contains the other)
    var partial = exchangeRunners.find(function(r) {
      var rNorm = (r.runnerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return rNorm.indexOf(normalised) !== -1 || normalised.indexOf(rNorm) !== -1;
    });
    return partial || null;
  }
}

// ---------------------------------------------------------------------------
// WEATHER DATA SOURCE (OpenWeather API)
// ---------------------------------------------------------------------------

/**
 * Weather Source — OpenWeather API for UK racecourse weather data.
 * Weather significantly affects horse racing: rain softens going, wind
 * affects sprinters, temperature impacts turf conditions.
 *
 * To activate:
 *   1. Sign up at https://openweathermap.org/api and get API key
 *   2. Set env: OPENWEATHER_API_KEY=your_key
 */
class WeatherSource extends DataSource {
  constructor() {
    super('weather', {
      refreshInterval: 600000, // 10 minutes
      apiUrl: 'https://api.openweathermap.org/data/2.5',
      apiKey: process.env.OPENWEATHER_API_KEY || '',
    });

    // UK racecourse coordinates
    this.courseCoords = {
      'Ascot': {lat: 51.41, lon: -0.68},
      'Aintree': {lat: 53.47, lon: -2.95},
      'Ayr': {lat: 55.47, lon: -4.62},
      'Bath': {lat: 51.40, lon: -2.34},
      'Beverley': {lat: 53.86, lon: -0.40},
      'Brighton': {lat: 50.85, lon: -0.11},
      'Carlisle': {lat: 54.90, lon: -2.93},
      'Catterick': {lat: 54.38, lon: -1.63},
      'Cheltenham': {lat: 51.92, lon: -2.07},
      'Chepstow': {lat: 51.64, lon: -2.68},
      'Chester': {lat: 53.18, lon: -2.90},
      'Doncaster': {lat: 53.51, lon: -1.10},
      'Epsom': {lat: 51.32, lon: -0.25},
      'Goodwood': {lat: 50.91, lon: -0.76},
      'Hamilton': {lat: 55.78, lon: -4.04},
      'Haydock': {lat: 53.47, lon: -2.62},
      'Hexham': {lat: 55.00, lon: -2.08},
      'Huntingdon': {lat: 52.33, lon: -0.19},
      'Kempton': {lat: 51.40, lon: -0.40},
      'Leicester': {lat: 52.62, lon: -1.08},
      'Lingfield': {lat: 51.17, lon: -0.02},
      'Musselburgh': {lat: 55.94, lon: -3.06},
      'Newbury': {lat: 51.40, lon: -1.31},
      'Newcastle': {lat: 55.01, lon: -1.71},
      'Newmarket': {lat: 52.24, lon: 0.37},
      'Nottingham': {lat: 52.93, lon: -1.09},
      'Perth': {lat: 56.41, lon: -3.44},
      'Plumpton': {lat: 50.91, lon: -0.06},
      'Pontefract': {lat: 53.69, lon: -1.31},
      'Redcar': {lat: 54.62, lon: -1.06},
      'Ripon': {lat: 54.14, lon: -1.51},
      'Salisbury': {lat: 51.10, lon: -1.78},
      'Sandown': {lat: 51.38, lon: -0.36},
      'Sedgefield': {lat: 54.65, lon: -1.46},
      'Southwell': {lat: 53.09, lon: -0.89},
      'Stratford': {lat: 52.19, lon: -1.71},
      'Thirsk': {lat: 54.23, lon: -1.34},
      'Uttoxeter': {lat: 52.91, lon: -1.86},
      'Warwick': {lat: 52.28, lon: -1.59},
      'Wetherby': {lat: 53.93, lon: -1.38},
      'Wincanton': {lat: 51.07, lon: -2.42},
      'Windsor': {lat: 51.49, lon: -0.62},
      'Wolverhampton': {lat: 52.60, lon: -2.11},
      'Worcester': {lat: 52.19, lon: -2.22},
      'York': {lat: 53.95, lon: -1.06}
    };
  }

  isConfigured() {
    return !!(this.config.apiKey);
  }

  async fetch() {
    // WeatherSource does not use the generic fetch() pattern.
    // Use fetchWeather(lat, lon) or fetchForCourse(courseName) instead.
    return [];
  }

  normalise(raw) {
    return raw;
  }

  /**
   * Fetch current weather for a lat/lon
   * @returns {{ temp, windSpeed, windDirection, rain, humidity, description }}
   */
  async fetchWeather(lat, lon) {
    if (!this.isConfigured()) return null;
    try {
      var data = await this._apiGet('/weather?lat=' + lat + '&lon=' + lon + '&units=metric&appid=' + this.config.apiKey);
      if (!data || !data.main) return null;
      var windDeg = data.wind && data.wind.deg ? data.wind.deg : 0;
      var directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      var windDirection = directions[Math.round(windDeg / 45) % 8];
      return {
        temp: data.main.temp,
        windSpeed: data.wind ? Math.round((data.wind.speed || 0) * 2.237) : 0, // m/s to mph
        windDirection: windDirection,
        rain: data.rain ? (data.rain['1h'] || data.rain['3h'] || 0) : 0,
        humidity: data.main.humidity || 0,
        description: data.weather && data.weather[0] ? data.weather[0].description : 'unknown',
      };
    } catch (err) {
      console.error('[weather] fetchWeather error:', err.message);
      return null;
    }
  }

  /**
   * Fetch 3-hourly forecast for a lat/lon (next 5 days)
   */
  async fetchForecast(lat, lon) {
    if (!this.isConfigured()) return null;
    try {
      var data = await this._apiGet('/forecast?lat=' + lat + '&lon=' + lon + '&units=metric&appid=' + this.config.apiKey);
      if (!data || !data.list) return null;
      return data.list.map(function(entry) {
        var windDeg = entry.wind && entry.wind.deg ? entry.wind.deg : 0;
        var directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        var windDirection = directions[Math.round(windDeg / 45) % 8];
        return {
          timestamp: entry.dt_txt,
          temp: entry.main ? entry.main.temp : 0,
          windSpeed: entry.wind ? Math.round((entry.wind.speed || 0) * 2.237) : 0,
          windDirection: windDirection,
          rain: entry.rain ? (entry.rain['3h'] || 0) : 0,
          humidity: entry.main ? entry.main.humidity : 0,
          description: entry.weather && entry.weather[0] ? entry.weather[0].description : 'unknown',
        };
      });
    } catch (err) {
      console.error('[weather] fetchForecast error:', err.message);
      return null;
    }
  }

  /**
   * Fetch weather for a named UK racecourse
   * @param {string} courseName — e.g. 'Ascot', 'Newmarket'
   * @returns {Object|null} weather data or null
   */
  async fetchForCourse(courseName) {
    if (!this.isConfigured()) return null;
    // Try exact match first, then partial match
    var coords = this.courseCoords[courseName];
    if (!coords) {
      var lowerName = (courseName || '').toLowerCase();
      var keys = Object.keys(this.courseCoords);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase() === lowerName || lowerName.indexOf(keys[i].toLowerCase()) !== -1) {
          coords = this.courseCoords[keys[i]];
          break;
        }
      }
    }
    if (!coords) return null;
    return this.fetchWeather(coords.lat, coords.lon);
  }

  /**
   * Get coordinates for a course name
   */
  getCourseCoords(courseName) {
    var coords = this.courseCoords[courseName];
    if (coords) return coords;
    var lowerName = (courseName || '').toLowerCase();
    var keys = Object.keys(this.courseCoords);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === lowerName || lowerName.indexOf(keys[i].toLowerCase()) !== -1) {
        return this.courseCoords[keys[i]];
      }
    }
    return null;
  }

  _apiGet(path) {
    return new Promise(function(resolve, reject) {
      var https = require('https');
      var options = {
        hostname: 'api.openweathermap.org',
        path: '/data/2.5' + path,
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      };
      var req = https.request(options, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Invalid JSON from OpenWeather')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, function() { req.destroy(); reject(new Error('OpenWeather timeout')); });
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// INGESTION MANAGER
// ---------------------------------------------------------------------------

class DataIngestionManager {
  constructor() {
    this.sources = new Map();
    this.refreshTimers = new Map();
    this.cache = new Map();

    // Register all sources
    this.register(new FootballFixturesSource());
    this.register(new FootballOddsSource());
    this.register(new RacingCardsSource());
    this.register(new RacingOddsSource());
    this.register(new FormEnrichmentSource());
    this.register(new InjuryNewsSource());
    this.register(new OddsMovementTracker());
    this.register(new HistoricalResultsSource());
    this.register(new BetfairExchangeSource());
    this.register(new WeatherSource());
  }

  register(source) {
    this.sources.set(source.name, source);
    console.log(`[DataIngestion] Registered source: ${source.name}`);
  }

  // Start scheduled refresh jobs for all sources.
  // Call this once on server startup.
  //
  // In production, replace setInterval with node-cron for precise scheduling:
  //   const cron = require('node-cron');
  //   cron.schedule('every-5-min', () => this.refreshSource('football-fixtures'));
  //   cron.schedule('every-2-min', () => this.refreshSource('football-odds'));
  //   cron.schedule('every-15-min', () => this.refreshSource('racing-cards'));
  //   cron.schedule('every-1-min', () => this.refreshSource('racing-odds'));
  //   cron.schedule('hourly', () => this.refreshSource('form-enrichment'));
  //   cron.schedule('every-30-min', () => this.refreshSource('injury-news'));
  //   cron.schedule('daily', () => this.refreshSource('historical-results'));
  startScheduledJobs() {
    for (const [name, source] of this.sources) {
      console.log(`[DataIngestion] Scheduling ${name} every ${source.refreshInterval / 1000}s`);
      // Initial fetch
      this.refreshSource(name);
      // Recurring refresh
      const timer = setInterval(() => this.refreshSource(name), source.refreshInterval);
      this.refreshTimers.set(name, timer);
    }
  }

  stopScheduledJobs() {
    for (const [name, timer] of this.refreshTimers) {
      clearInterval(timer);
      console.log(`[DataIngestion] Stopped ${name}`);
    }
    this.refreshTimers.clear();
  }

  async refreshSource(name) {
    const source = this.sources.get(name);
    if (!source) return { success: false, error: 'Source not found' };
    const result = await source.safeFetch();
    if (result.success) {
      this.cache.set(name, { data: result.data, timestamp: new Date() });
    }
    return result;
  }

  async refreshAll() {
    const results = {};
    for (const name of this.sources.keys()) {
      results[name] = await this.refreshSource(name);
    }
    return results;
  }

  getCached(name) {
    return this.cache.get(name) || null;
  }

  getStatus() {
    const status = {};
    for (const [name, source] of this.sources) {
      status[name] = {
        active: source.isActive,
        lastRefresh: source.lastRefresh,
        errorCount: source.errorCount,
        cached: this.cache.has(name),
      };
    }
    return status;
  }
}

module.exports = new DataIngestionManager();
