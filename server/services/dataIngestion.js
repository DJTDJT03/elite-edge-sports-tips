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
    // League IDs for API-Football: PL=39, CL=2, LaLiga=140, SerieA=135, Bundesliga=78, Ligue1=61, FACup=45
    this.leagueIds = [39, 2, 140, 135, 78, 61, 45];
  }

  async fetch() {
    if (!this.config.apiKey) {
      console.log('[${this.name}] No API key — set API_FOOTBALL_KEY env var. Sign up: https://www.api-football.com/');
      return { response: [] };
    }
    try {
      const today = new Date().toISOString().split('T')[0];
      const data = await this._apiGet('/fixtures?date=' + today + '&league=' + this.leagueIds.join('-') + '&season=2025');
      console.log('[football-fixtures] Fetched ' + (data.response || []).length + ' fixtures for ' + today);
      return data;
    } catch (err) {
      console.error('[football-fixtures] Error: ' + err.message);
      return { response: [] };
    }
  }

  async fetchFixturesByDate(date) {
    if (!this.config.apiKey) return { response: [] };
    return this._apiGet('/fixtures?date=' + date + '&league=' + this.leagueIds.join('-') + '&season=2025');
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
 * Football Odds Source
 * Primary: The Odds API (the-odds-api.com) — 40+ bookmakers
 * Fallback: Betfair Exchange API (developer.betfair.com)
 *
 * To activate:
 *   1. Sign up at https://the-odds-api.com/ and get API key
 *   2. Set env: ODDS_API_KEY=your_key
 */
class FootballOddsSource extends DataSource {
  constructor() {
    super('football-odds', {
      refreshInterval: 120000, // 2 minutes — odds change fast
      apiUrl: 'https://api.the-odds-api.com/v4',
      apiKey: process.env.ODDS_API_KEY || '',
    });
    // The Odds API sport keys for our leagues
    this.sportKeys = ['soccer_epl', 'soccer_uefa_champs_league', 'soccer_spain_la_liga', 'soccer_italy_serie_a', 'soccer_germany_bundesliga', 'soccer_france_ligue_one', 'soccer_fa_cup'];
  }

  async fetch() {
    if (!this.config.apiKey) {
      console.log('[football-odds] No API key — set ODDS_API_KEY env var. Sign up: https://the-odds-api.com/');
      return [];
    }
    try {
      var allOdds = [];
      // Fetch odds for each sport (to manage credit usage, just do PL + featured)
      for (var i = 0; i < Math.min(this.sportKeys.length, 3); i++) {
        var data = await this._apiGet('/sports/' + this.sportKeys[i] + '/odds/?regions=uk&markets=h2h,totals&oddsFormat=decimal&apiKey=' + this.config.apiKey);
        if (Array.isArray(data)) allOdds = allOdds.concat(data);
      }
      console.log('[football-odds] Fetched odds for ' + allOdds.length + ' events');
      return allOdds;
    } catch (err) {
      console.error('[football-odds] Error: ' + err.message);
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
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Invalid JSON')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, function() { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }

  normalise(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function(event) {
      var bookmakerOdds = {};
      (event.bookmakers || []).forEach(function(bk) {
        var market = (bk.markets || []).find(function(m) { return m.key === 'h2h'; });
        if (market && market.outcomes) {
          bookmakerOdds[bk.key] = {};
          market.outcomes.forEach(function(o) {
            bookmakerOdds[bk.key][o.name] = o.price;
          });
        }
      });
      return {
        eventId: event.id,
        sport: event.sport_key,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        kickoff: event.commence_time,
        bookmakerOdds: bookmakerOdds
      };
    });
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
      console.log(`[${this.name}] Sign up free trial: https://www.theracingapi.com/`);
      return { racecards: [] };
    }

    try {
      const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64');
      // The Racing API correct endpoints: /racecards/pro (best), /racecards/standard, /racecards/basic, /racecards/free
      // Try pro first (premium plan), fall back to standard, then basic, then free
      const endpoints = ['/racecards/pro', '/racecards/standard', '/racecards/basic', '/racecards/free'];
      for (const endpoint of endpoints) {
        try {
          const racecards = await this._apiGet(endpoint, auth);
          if (racecards && racecards.racecards && racecards.racecards.length > 0) {
            console.log(`[${this.name}] Fetched ${racecards.racecards.length} races via ${endpoint}`);
            return racecards;
          }
        } catch (e) {
          // Try next endpoint
        }
      }
      console.log(`[${this.name}] All endpoints returned empty — no races today`);
      return { racecards: [] };
    } catch (err) {
      console.error(`[${this.name}] API Error: ${err.message}`);
      this.errorCount++;
      return { racecards: [] };
    }
  }

  // Fetch results for a specific date
  async fetchResults(date) {
    if (!this.config.apiKey || !this.config.apiSecret) return { results: [] };
    try {
      const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64');
      // Correct endpoint: /results (no date param, returns recent results) or /results/{date}
      const results = await this._apiGet(`/results`, auth);
      console.log(`[${this.name}] Fetched ${(results.results || []).length} results`);
      return results;
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
    return raw.racecards.map(race => ({
      raceId: race.race_id || race.id,
      meeting: race.course || race.meeting,
      time: race.off_time || race.time,
      raceClass: race.race_class || race.class,
      distance: race.distance,
      going: race.going,
      surface: race.surface || 'Turf',
      prizeMoney: race.prize,
      raceName: race.race_name || race.name,
      runners: (race.runners || []).map(r => ({
        horseName: r.horse || r.horse_name,
        horseId: r.horse_id,
        jockey: r.jockey,
        trainer: r.trainer,
        age: r.age,
        weight: r.weight || r.lbs,
        draw: r.draw || r.stall,
        officialRating: r.or || r.official_rating,
        form: r.form,
        odds: r.odds || r.forecast_price,
        silkUrl: r.silk_url,
        ownerName: r.owner
      }))
    }));
  }
}

/**
 * Racing Odds Source
 * Primary: Oddschecker API or Betfair SP data
 * Fallback: Scraped odds from major bookmakers
 */
class RacingOddsSource extends DataSource {
  constructor() {
    super('racing-odds', {
      refreshInterval: 60000, // 1 minute — pre-race markets move fast
    });
  }

  async fetch() {
    console.log(`[${this.name}] Fetch called — using sample data`);
    return [];
  }

  normalise(raw) {
    // Transform to: { raceId, runnerId, bookmaker, odds, timestamp, movement }
    return raw;
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
 * Odds Movement Tracker
 * Monitors odds changes across bookmakers to detect steam moves and value shifts.
 * Stores time-series data for movement charts.
 */
class OddsMovementTracker extends DataSource {
  constructor() {
    super('odds-movement', { refreshInterval: 30000 }); // 30 seconds when active
    this.movementLog = [];
  }

  async fetch() {
    console.log(`[${this.name}] Fetch called — using sample data`);
    return [];
  }

  normalise(raw) { return raw; }

  /**
   * Detect significant movement (steam move)
   * @param {number} openOdds — Opening odds
   * @param {number} currentOdds — Current odds
   * @returns {Object} Movement analysis
   */
  analyseMovement(openOdds, currentOdds) {
    const change = ((currentOdds - openOdds) / openOdds) * 100;
    return {
      direction: change < 0 ? 'shortening' : change > 0 ? 'drifting' : 'stable',
      percentChange: Math.round(change * 10) / 10,
      isSteamMove: change < -10,  // 10%+ shortening = steam move
      isDrift: change > 15,       // 15%+ lengthening = market drift
      signal: change < -10 ? 'strong support' : change > 15 ? 'caution' : 'neutral',
    };
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
