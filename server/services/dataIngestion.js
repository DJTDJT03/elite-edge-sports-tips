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
      // apiUrl: 'https://v3.football.api-sports.io',
      // apiKey: process.env.FOOTBALL_API_KEY,
    });
  }

  async fetch() {
    // PLACEHOLDER: Replace with real API call
    // Example real implementation:
    // const res = await fetch(`${this.config.apiUrl}/fixtures?date=${today}`, {
    //   headers: { 'x-apisports-key': this.config.apiKey }
    // });
    // return res.json();

    console.log(`[${this.name}] Fetch called — using sample data (no API key configured)`);
    return { fixtures: [] }; // Returns empty; app falls back to sample-tips.json
  }

  normalise(raw) {
    // Transform API-Football response to internal fixture schema:
    // { id, league, homeTeam, awayTeam, kickoff, venue, status, odds }
    if (!raw.fixtures || !raw.fixtures.length) return [];
    return raw.fixtures.map(f => ({
      id: f.fixture?.id,
      league: f.league?.name,
      homeTeam: f.teams?.home?.name,
      awayTeam: f.teams?.away?.name,
      kickoff: f.fixture?.date,
      venue: f.fixture?.venue?.name,
      status: f.fixture?.status?.short,
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
      // apiUrl: 'https://api.the-odds-api.com/v4',
      // apiKey: process.env.ODDS_API_KEY,
    });
  }

  async fetch() {
    // PLACEHOLDER: Replace with real API call
    // const res = await fetch(
    //   `${this.config.apiUrl}/sports/soccer_epl/odds?regions=uk&markets=h2h,totals,btts&apiKey=${this.config.apiKey}`
    // );
    // return res.json();

    console.log(`[${this.name}] Fetch called — using sample data`);
    return [];
  }

  normalise(raw) {
    // Transform to: { fixtureId, market, bookmaker, selection, odds, timestamp }
    return raw;
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
      refreshInterval: 900000, // 15 minutes — cards don't change often
      // apiUrl: 'https://api.theracingapi.com/v1',
      // apiKey: process.env.RACING_API_KEY,
      // apiSecret: process.env.RACING_API_SECRET,
    });
  }

  async fetch() {
    // PLACEHOLDER: Replace with real API call
    // const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64');
    // const res = await fetch(`${this.config.apiUrl}/racecards?date=${today}`, {
    //   headers: { Authorization: `Basic ${auth}` }
    // });
    // return res.json();

    console.log(`[${this.name}] Fetch called — using sample data`);
    return { racecards: [] };
  }

  normalise(raw) {
    // Transform to: { raceId, meeting, time, runners[], class, distance, going, surface }
    return raw.racecards || [];
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

  /**
   * Start scheduled refresh jobs for all sources.
   * Call this once on server startup.
   *
   * In production, replace setInterval with node-cron for precise scheduling:
   *   const cron = require('node-cron');
   *   cron.schedule('*/5 * * * *', () => this.refreshSource('football-fixtures'));
   *   cron.schedule('*/2 * * * *', () => this.refreshSource('football-odds'));
   *   cron.schedule('*/15 * * * *', () => this.refreshSource('racing-cards'));
   *   cron.schedule('* * * * *', () => this.refreshSource('racing-odds'));
   *   cron.schedule('0 * * * *', () => this.refreshSource('form-enrichment'));
   *   cron.schedule('*/30 * * * *', () => this.refreshSource('injury-news'));
   *   cron.schedule('0 0 * * *', () => this.refreshSource('historical-results'));
   */
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
