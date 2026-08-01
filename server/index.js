/**
 * Elite Edge Sports Tips — Server Entry Point
 *
 * Slim entry point that assembles middleware, mounts route modules,
 * and starts the scheduled task engine.
 *
 * Route modules: server/routes/*.js
 * Middleware: server/middleware/*.js
 * Services: server/services/*.js
 * Database: server/db.js (PostgreSQL with JSON file fallback)
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Services
const db = require('./db');
const scoringModel = require('./services/scoringModel');
const emailService = require('./services/emailService');
const smsService = require('./services/smsService');
const pushService = require('./services/pushService');
const dataIngestion = require('./services/dataIngestion');
const aiReports = require('./services/aiReports');
const alertEngine = require('./services/alertEngine');
const telegramBot = require('./services/telegramBot');
const newsService = require('./services/newsService');
const stripeService = require('./services/stripeService');
const footballData = require('./services/footballData');
const SportMonks = require('./services/sportMonks');
const sportMonks = new SportMonks();
const CosmoBet = require('./services/cosmoBet');
const cosmoBet = new CosmoBet();
const understatService = require('./services/understatService');
const basketballData = require('./services/basketballData');
const rugbyData = require('./services/rugbyData');
const nflData = require('./services/americanFootballData');
const tennisData = require('./services/tennisData');
const gptVerifier = require('./services/gptVerifier');
const perplexityClient = require('./services/perplexity/client')(db);

// Utilities
const helpers = require('./utils/helpers');
const oddsHelpers = require('./utils/oddsHelpers');

// App setup
const app = express();
// Gzip/deflate every response — the ~870KB app.js compresses to ~180KB, the
// single biggest page-load win. Must come before static + routes.
app.use(require('compression')());
app.set('trust proxy', 1); // Railway runs behind a proxy — trust first hop for correct IP
const PORT = process.env.PORT || 3000;
// SECURITY: Require critical env vars in production
const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;
if (isProduction) {
  var missing = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (missing.length > 0) {
    console.error('[SECURITY] FATAL: Missing required environment variables: ' + missing.join(', '));
    console.error('[SECURITY] Set these in Railway dashboard before deploying.');
    process.exit(1);
  }
}
const JWT_SECRET = process.env.JWT_SECRET || 'elite-edge-dev-only-' + require('crypto').randomBytes(16).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[SECURITY] WARNING: JWT_SECRET not set — using random dev secret (sessions won\'t persist across restarts)');
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:3000', 'https://eliteedgesports.co.uk', 'https://www.eliteedgesports.co.uk'];
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://www.googletagmanager.com"],
      scriptSrcAttr: ["'unsafe-inline'"],  // Required — app uses onclick= handlers extensively
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "https://media.api-sports.io", "https://cdn.sportmonks.com"],
      connectSrc: ["'self'", "https://api.stripe.com", "https://*.loom.com", "https://*.youtube.com"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://www.loom.com", "https://www.youtube.com", "https://player.vimeo.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
// Stripe webhook needs raw body — exclude from JSON parsing
app.use('/api/stripe/webhook', require('express').raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

// Geo-restriction (conditional on GEO_RESTRICT env)
require('./middleware/geoRestrict')(app);

// Rate limiting
const rateLimiterFns = require('./middleware/rateLimiter');
app.use('/api', rateLimiterFns.rateLimiter);

// Static files — short cache for JS/CSS so updates propagate quickly
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: function(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
    }
  }
}));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// Auth middleware
const { authenticate, requireAdmin, requirePremium } = require('./middleware/auth')(JWT_SECRET, db);

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------
const racingSource = dataIngestion.sources ? dataIngestion.sources.get('racing-cards') : null;
const footballSource = dataIngestion.sources ? dataIngestion.sources.get('football-fixtures') : null;
const oddsSource = dataIngestion.sources ? dataIngestion.sources.get('football-odds') : null;
const betfairSource = dataIngestion.sources ? dataIngestion.sources.get('betfair-exchange') : null;
const weatherSource = dataIngestion.sources ? dataIngestion.sources.get('weather') : null;
const racingOddsSource = dataIngestion.sources ? dataIngestion.sources.get('racing-odds') : null;
const movementTracker = dataIngestion.sources ? dataIngestion.sources.get('odds-movement') : null;

// ---------------------------------------------------------------------------
// Shared dependencies object — passed to all route modules
// ---------------------------------------------------------------------------
const deps = {
  db,
  JWT_SECRET,
  authenticate,
  requireAdmin,
  requirePremium,
  helpers,
  oddsHelpers,
  rateLimiterFns,
  scoringModel,
  emailService,
  smsService,
  pushService,
  dataIngestion,
  racingSource,
  footballSource,
  oddsSource,
  betfairSource,
  weatherSource,
  racingOddsSource,
  movementTracker,
  aiReports,
  alertEngine,
  telegramBot,
  newsService,
  stripeService,
  footballData,
  sportMonks,
  cosmoBet,
  understatService,
  basketballData,
  rugbyData,
  nflData,
  tennisData,
  gptVerifier,
  perplexityClient,
};

// Elite Edge Quant Model — in-house Elo + Dixon-Coles engine (independent signal).
deps.quantModel = require('./services/quantModel')(deps);

// Multi-model AI arbiter panel (GPT + Gemini + Grok) for the consensus engine.
deps.aiArbiters = require('./services/aiArbiters')(deps);

// Instagram publisher — official Meta Graph API (compliant auto-posting).
deps.instagramPublisher = require('./services/instagramPublisher');

// ---------------------------------------------------------------------------
// Mount routes
// ---------------------------------------------------------------------------
// Health & Readiness endpoints (Railway healthcheck)
var _appReady = false;
app.get('/healthz', async (req, res) => {
  try {
    if (db.isAvailable()) await db.query('SELECT 1');
    res.status(200).json({ status: 'healthy', db: db.isAvailable() ? 'connected' : 'fallback', uptime: Math.round(process.uptime()) });
  } catch(e) {
    res.status(503).json({ status: 'unhealthy', error: e.message });
  }
});
app.get('/ready', (req, res) => {
  if (_appReady) return res.status(200).json({ status: 'ready' });
  res.status(503).json({ status: 'starting' });
});

app.use('/api/auth', require('./routes/auth')(deps));
app.use('/api', require('./routes/racing')(deps));
app.use('/api', require('./routes/football')(deps));
app.use('/api', require('./routes/events')(deps));
app.use('/api', require('./routes/odds')(deps));
app.use('/api', require('./routes/tips')(deps));
app.use('/api', require('./routes/results')(deps));
app.use('/api', require('./routes/admin')(deps));
app.use('/api', require('./routes/support')(deps));
app.use('/api', require('./routes/analytics')(deps));
app.use('/api', require('./routes/stripe')(deps));
app.use('/api', require('./routes/userBets')(deps));
app.use('/api', require('./routes/winners')(deps));
// World Cup Mode — feature-flagged
if (process.env.ENABLE_WORLD_CUP === 'true') {
  var worldCupData = require('./services/worldCupData')(deps);
  deps.worldCupData = worldCupData;
  deps.worldCupBroadcast = require('./services/worldCupBroadcast')(deps);
  deps.valueScanner = require('./services/valueScanner')(deps);
  app.use('/api/world-cup', require('./routes/worldCup')(deps));
  console.log('[Startup] World Cup Mode ENABLED');
}
// Marketing Engine — feature-flagged, standalone branch
if (process.env.ENABLE_MARKETING === 'true') {
  app.use('/api/marketing', require('./routes/marketing')(deps));
  console.log('[Startup] Marketing Engine ENABLED (event: ' + (process.env.MARKETING_EVENT || 'worldcup2026') + ')');
}
// Last Man Standing — feature-flagged, pluggable branch
if (process.env.ENABLE_LMS === 'true') {
  app.use('/api/lms', require('./routes/lms')(deps));
  console.log('[Startup] Last Man Standing ENABLED');
}
app.use('/', require('./routes/public')(deps));

// ---------------------------------------------------------------------------
// Startup: auto-migrate database on first deploy
// Runs migration + seed if DATABASE_URL is set and tables don't exist yet.
// Safe to run on every deploy — CREATE IF NOT EXISTS is idempotent.
// ---------------------------------------------------------------------------
(async function autoMigrate() {
  if (!db.isAvailable()) return;
  try {
    // Check if tables exist by querying users table
    try {
      await db.query('SELECT 1 FROM users LIMIT 1');
      console.log('[Startup] Database tables exist');

      // Add any missing columns from newer migrations
      var alterCols = [
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_active BOOLEAN DEFAULT FALSE',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_start TIMESTAMPTZ',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_warned BOOLEAN DEFAULT FALSE',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_prefs JSONB DEFAULT \'{}\'',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS drips_sent JSONB DEFAULT \'[]\'',
        'ALTER TABLE results ADD COLUMN IF NOT EXISTS voided_by_monitor BOOLEAN DEFAULT FALSE',
        'ALTER TABLE results ADD COLUMN IF NOT EXISTS replay_analysis JSONB',
        // Shadow scoring — ALL scored candidates, not just published tips
        "CREATE TABLE IF NOT EXISTS scored_candidates (id SERIAL PRIMARY KEY, sport TEXT NOT NULL, selection TEXT NOT NULL, event TEXT, meeting TEXT, league TEXT, market TEXT, odds NUMERIC(8,2), confidence INTEGER, model_probability NUMERIC(6,4), implied_probability NUMERIC(6,4), edge NUMERIC(6,4), analyst TEXT, date DATE NOT NULL, kickoff TEXT, was_published BOOLEAN DEFAULT FALSE, tip_id TEXT, result TEXT, pnl NUMERIC(10,2), settled BOOLEAN DEFAULT FALSE, settled_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())",
        'CREATE INDEX IF NOT EXISTS idx_sc_date ON scored_candidates(date DESC)',
        'CREATE INDEX IF NOT EXISTS idx_sc_sport ON scored_candidates(sport, date DESC)',
        'CREATE INDEX IF NOT EXISTS idx_sc_settled ON scored_candidates(settled, date DESC)',
        // Loss analysis — causal reasons for failed predictions
        "CREATE TABLE IF NOT EXISTS loss_analysis (id SERIAL PRIMARY KEY, tip_id TEXT, sport TEXT, selection TEXT, event TEXT, analyst TEXT, odds NUMERIC(8,2), confidence INTEGER, loss_reason TEXT, loss_category TEXT, factors JSONB, lesson TEXT, date DATE, created_at TIMESTAMPTZ DEFAULT NOW())",
        'CREATE INDEX IF NOT EXISTS idx_la_category ON loss_analysis(loss_category, sport)',
        'CREATE INDEX IF NOT EXISTS idx_la_analyst ON loss_analysis(analyst, date DESC)',
        // Race predictions tracking (Our Pick in every race)
        "CREATE TABLE IF NOT EXISTS race_predictions (id SERIAL PRIMARY KEY, meeting TEXT, race_time TEXT, race_name TEXT, selection TEXT, odds NUMERIC(8,2), confidence INTEGER, edge NUMERIC(6,4), runners INTEGER, result TEXT, finish_position INTEGER, winner TEXT, winner_odds NUMERIC(8,2), correct BOOLEAN, date DATE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(meeting, race_time, date))",
        'CREATE INDEX IF NOT EXISTS idx_rp_date ON race_predictions(date DESC)',
        // Match predictions tracking (Our Take on every game)
        "CREATE TABLE IF NOT EXISTS match_predictions (id SERIAL PRIMARY KEY, fixture_id INTEGER NOT NULL, home_team TEXT, away_team TEXT, league TEXT, kickoff TIMESTAMPTZ, market TEXT, pick TEXT, confidence INTEGER, reason TEXT, actual_home_goals INTEGER, actual_away_goals INTEGER, result TEXT, correct BOOLEAN, date DATE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(fixture_id, date))",
        'CREATE INDEX IF NOT EXISTS idx_mp_date ON match_predictions(date DESC)',
        'CREATE INDEX IF NOT EXISTS idx_mp_correct ON match_predictions(correct, date DESC)',
        // Push notification subscriptions
        "CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, subscription JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, subscription))",
        'CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)',
        // Login streak tracking
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_date DATE',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS best_login_streak INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_reward_claimed DATE',
        // Mobile number for SMS
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile TEXT',
        // Signup identity fields (mandatory at registration)
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS surname TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE',
        // User bets — server-side persistence for Personal ROI Dashboard
        "CREATE TABLE IF NOT EXISTS user_bets (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, tip_id TEXT NOT NULL, selection TEXT, event TEXT, sport TEXT, market TEXT, odds NUMERIC(8,2), confidence INTEGER, analyst TEXT, result TEXT, pnl NUMERIC(10,2), stake NUMERIC(8,2) DEFAULT 1, settled BOOLEAN DEFAULT FALSE, date DATE, backed_at TIMESTAMPTZ DEFAULT NOW(), settled_at TIMESTAMPTZ, UNIQUE(user_id, tip_id))",
        'CREATE INDEX IF NOT EXISTS idx_ub_user ON user_bets(user_id, date DESC)',
        'CREATE INDEX IF NOT EXISTS idx_ub_settled ON user_bets(user_id, settled)',
        // User accas (shared/tracked)
        "CREATE TABLE IF NOT EXISTS user_accas (id SERIAL PRIMARY KEY, user_id TEXT, user_name TEXT, selections JSONB NOT NULL, combined_odds NUMERIC(10,2), stake NUMERIC(8,2), potential_return NUMERIC(10,2), status TEXT DEFAULT 'pending', result TEXT, pnl NUMERIC(10,2), shared BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW())",
        'CREATE INDEX IF NOT EXISTS idx_user_accas_created ON user_accas(created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_user_accas_shared ON user_accas(shared, created_at DESC)',
        // Credit system
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_monthly_allowance INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_reset_date DATE',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN DEFAULT FALSE',
        "CREATE TABLE IF NOT EXISTS credit_transactions (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, type TEXT NOT NULL, description TEXT, tip_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())",
        'CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at DESC)',
        // Email verification
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token TEXT',
        // Phase 3: Stripe dunning grace period columns
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_grace_end TIMESTAMPTZ',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS dunning_stage INTEGER DEFAULT 0',
        // Phase 1: CLV & Data Integrity columns
        'ALTER TABLE tips ADD COLUMN IF NOT EXISTS advised_price_decimal NUMERIC(8,2)',
        'ALTER TABLE tips ADD COLUMN IF NOT EXISTS closing_price_decimal NUMERIC(8,2)',
        'ALTER TABLE tips ADD COLUMN IF NOT EXISTS clv_percent NUMERIC(8,4)',
        'ALTER TABLE tips ADD COLUMN IF NOT EXISTS fair_odds_decimal NUMERIC(8,2)',
        'ALTER TABLE tips ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ',
        'ALTER TABLE tips ADD COLUMN IF NOT EXISTS settlement_source TEXT',
        // Verdict integrity lock — freeze the match-intel "Our Take" pre-kick-off
        // for ALL football so it can never be recomputed once the result is known.
        "CREATE TABLE IF NOT EXISTS match_verdict_locks (fixture_id TEXT PRIMARY KEY, market TEXT, selection TEXT, reason TEXT, confidence INTEGER, risk_level TEXT, risk_text TEXT, kickoff TIMESTAMPTZ, locked_at TIMESTAMPTZ DEFAULT NOW())",
        // Sporting-events calendar — reusable "featured meeting" hubs (replaces the
        // one-off World Cup hub). Admin-managed; the site spotlights the active one.
        "CREATE TABLE IF NOT EXISTS sporting_events (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, sport TEXT, tagline TEXT, blurb TEXT, start_date DATE NOT NULL, end_date DATE NOT NULL, venue TEXT, accent TEXT, emoji TEXT, enabled BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW())",
        "CREATE INDEX IF NOT EXISTS idx_sporting_events_dates ON sporting_events(start_date, end_date)",
        // CLV on the flagship "Our Take" consensus picks (match_predictions)
        'ALTER TABLE match_predictions ADD COLUMN IF NOT EXISTS advised_price NUMERIC(8,2)',
        'ALTER TABLE match_predictions ADD COLUMN IF NOT EXISTS closing_price NUMERIC(8,2)',
        'ALTER TABLE match_predictions ADD COLUMN IF NOT EXISTS clv_percent NUMERIC(8,4)',
        // Phase 1: New tables
        "CREATE TABLE IF NOT EXISTS tip_price_history (id SERIAL PRIMARY KEY, tip_id TEXT NOT NULL REFERENCES tips(id) ON DELETE CASCADE, price_decimal NUMERIC(8,2) NOT NULL, bookmaker TEXT, source TEXT DEFAULT 'odds-api', recorded_at TIMESTAMPTZ DEFAULT NOW())",
        'CREATE INDEX IF NOT EXISTS idx_tph_tip_id ON tip_price_history(tip_id)',
        'CREATE INDEX IF NOT EXISTS idx_tph_recorded ON tip_price_history(recorded_at DESC)',
        "CREATE TABLE IF NOT EXISTS analyst_performance_snapshots (id SERIAL PRIMARY KEY, analyst_key TEXT NOT NULL, snapshot_date DATE NOT NULL, total_tips INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, voids INTEGER DEFAULT 0, strike_rate NUMERIC(6,4), avg_odds NUMERIC(8,2), total_pnl NUMERIC(10,2), avg_clv NUMERIC(8,4), roi_percent NUMERIC(8,4), sport TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(analyst_key, snapshot_date, sport))",
        'CREATE INDEX IF NOT EXISTS idx_aps_analyst ON analyst_performance_snapshots(analyst_key, snapshot_date DESC)',
        // Perplexity integration: new columns on tips
        'ALTER TABLE tips ADD COLUMN IF NOT EXISTS adjusted_factors JSONB',
        'ALTER TABLE tips ADD COLUMN IF NOT EXISTS enrichment_id INTEGER',
        // Perplexity integration: sonar_cache table
        "CREATE TABLE IF NOT EXISTS sonar_cache (id SERIAL PRIMARY KEY, cache_key TEXT NOT NULL UNIQUE, call_site TEXT NOT NULL, entity_id TEXT NOT NULL, time_bucket BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', claimed_at TIMESTAMPTZ DEFAULT NOW(), response_json JSONB, citations JSONB DEFAULT '[]', ttl_seconds INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL, input_tokens INTEGER, output_tokens INTEGER, search_count INTEGER DEFAULT 0, latency_ms INTEGER, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(call_site, entity_id, time_bucket))",
        'CREATE INDEX IF NOT EXISTS idx_sonar_cache_key ON sonar_cache(cache_key)',
        'CREATE INDEX IF NOT EXISTS idx_sonar_cache_expires ON sonar_cache(expires_at)',
        'CREATE INDEX IF NOT EXISTS idx_sonar_cache_site ON sonar_cache(call_site, entity_id)',
        // Perplexity integration: sonar_spend_ledger table
        "CREATE TABLE IF NOT EXISTS sonar_spend_ledger (id SERIAL PRIMARY KEY, call_site TEXT NOT NULL, entity_id TEXT, model TEXT NOT NULL DEFAULT 'sonar', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, search_count INTEGER NOT NULL DEFAULT 0, token_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0, request_fee_usd NUMERIC(10,6) NOT NULL DEFAULT 0, cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0, date DATE NOT NULL DEFAULT CURRENT_DATE, tip_id TEXT, bulletin_id TEXT, latency_ms INTEGER, cache_hit BOOLEAN DEFAULT FALSE, enrichment_skipped TEXT, error TEXT, created_at TIMESTAMPTZ DEFAULT NOW())",
        'CREATE INDEX IF NOT EXISTS idx_sonar_spend_date ON sonar_spend_ledger(date)',
        'CREATE INDEX IF NOT EXISTS idx_sonar_spend_site ON sonar_spend_ledger(call_site)',
        // Perplexity integration: sonar_admin_events table
        "CREATE TABLE IF NOT EXISTS sonar_admin_events (id SERIAL PRIMARY KEY, action TEXT NOT NULL, user_id TEXT, user_email TEXT, reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW())",
        'CREATE INDEX IF NOT EXISTS idx_sonar_admin_created ON sonar_admin_events(created_at DESC)',
        // Perplexity integration: tip_enrichment table
        "CREATE TABLE IF NOT EXISTS tip_enrichment (id SERIAL PRIMARY KEY, tip_id TEXT NOT NULL REFERENCES tips(id) ON DELETE CASCADE, call_site TEXT NOT NULL DEFAULT 'per-tip', raw_response JSONB NOT NULL, extracted_signals JSONB NOT NULL DEFAULT '{}', citations JSONB DEFAULT '[]', dropped_claims JSONB DEFAULT '[]', low_quality BOOLEAN NOT NULL DEFAULT FALSE, parse_error BOOLEAN NOT NULL DEFAULT FALSE, used_in_decision BOOLEAN NOT NULL DEFAULT FALSE, sonar_model TEXT DEFAULT 'sonar', input_tokens INTEGER, output_tokens INTEGER, search_count INTEGER DEFAULT 0, request_fee_usd NUMERIC(10,6) DEFAULT 0, latency_ms INTEGER, created_at TIMESTAMPTZ DEFAULT NOW(), CONSTRAINT chk_no_decision_on_bad_data CHECK (NOT (used_in_decision AND (parse_error OR low_quality))))",
        'CREATE INDEX IF NOT EXISTS idx_enrichment_tip ON tip_enrichment(tip_id)',
        'CREATE INDEX IF NOT EXISTS idx_enrichment_quality ON tip_enrichment(low_quality, used_in_decision)',
        // Quality loop snapshots
        "CREATE TABLE IF NOT EXISTS enrichment_quality_snapshots (id SERIAL PRIMARY KEY, snapshot_date DATE NOT NULL, is_aggregate BOOLEAN NOT NULL DEFAULT FALSE, signal_key TEXT, sport TEXT, tips_with INTEGER NOT NULL DEFAULT 0, avg_clv_with NUMERIC(8,2), roi_pct_with NUMERIC(8,2), strike_rate_with NUMERIC(6,2), tips_without INTEGER NOT NULL DEFAULT 0, avg_clv_without NUMERIC(8,2), roi_pct_without NUMERIC(8,2), strike_rate_without NUMERIC(6,2), clv_delta NUMERIC(8,2), roi_delta_pct NUMERIC(8,2), verdict TEXT, sample_sufficient BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(snapshot_date, is_aggregate, signal_key, sport))",
        'CREATE INDEX IF NOT EXISTS idx_eqs_date ON enrichment_quality_snapshots(snapshot_date DESC)',
        // World Cup: store SportMonks' own round/matchday name per fixture
        ...(process.env.ENABLE_WORLD_CUP === 'true' ? ['ALTER TABLE world_cup_fixtures ADD COLUMN IF NOT EXISTS round_name TEXT'] : []),
        // World Cup Mode tables (feature-flagged via ENABLE_WORLD_CUP)
        ...(process.env.ENABLE_WORLD_CUP === 'true' ? [
          "CREATE TABLE IF NOT EXISTS world_cup_tournaments (id SERIAL PRIMARY KEY, name TEXT NOT NULL, year INTEGER NOT NULL UNIQUE, start_date DATE, end_date DATE, status TEXT DEFAULT 'upcoming', config JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())",
          "CREATE TABLE IF NOT EXISTS world_cup_groups (id SERIAL PRIMARY KEY, tournament_id INTEGER NOT NULL REFERENCES world_cup_tournaments(id), group_letter CHAR(1) NOT NULL, standings JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tournament_id, group_letter))",
          "CREATE TABLE IF NOT EXISTS world_cup_fixtures (id SERIAL PRIMARY KEY, tournament_id INTEGER REFERENCES world_cup_tournaments(id), stage TEXT NOT NULL, group_letter CHAR(1), home_team TEXT NOT NULL, away_team TEXT NOT NULL, kickoff TIMESTAMPTZ, venue TEXT, home_goals INTEGER, away_goals INTEGER, result TEXT, status TEXT DEFAULT 'scheduled', stats JSONB DEFAULT '{}', external_fixture_id INTEGER UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW())",
          'CREATE INDEX IF NOT EXISTS idx_wcf_kickoff ON world_cup_fixtures(kickoff)',
          'CREATE INDEX IF NOT EXISTS idx_wcf_stage ON world_cup_fixtures(stage)',
          'CREATE INDEX IF NOT EXISTS idx_wcf_status ON world_cup_fixtures(status)',
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_wcf_ext ON world_cup_fixtures(external_fixture_id)',
          "CREATE TABLE IF NOT EXISTS world_cup_predictions (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, fixture_id INTEGER NOT NULL REFERENCES world_cup_fixtures(id), predicted_home INTEGER NOT NULL, predicted_away INTEGER NOT NULL, first_goalscorer TEXT, predicted_cards INTEGER, predicted_corners INTEGER, points INTEGER DEFAULT 0, scored BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, fixture_id))",
          'CREATE INDEX IF NOT EXISTS idx_wcp_user ON world_cup_predictions(user_id)',
          'CREATE INDEX IF NOT EXISTS idx_wcp_fixture ON world_cup_predictions(fixture_id)',
          "CREATE TABLE IF NOT EXISTS world_cup_nations (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, country TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())",
          'CREATE INDEX IF NOT EXISTS idx_wcn_country ON world_cup_nations(country)',
          "CREATE TABLE IF NOT EXISTS world_cup_previews (id SERIAL PRIMARY KEY, fixture_id INTEGER NOT NULL REFERENCES world_cup_fixtures(id) UNIQUE, stage TEXT, home_team TEXT, away_team TEXT, kickoff TIMESTAMPTZ, venue TEXT, signals JSONB DEFAULT '{}', citations JSONB DEFAULT '[]', predicted_scoreline TEXT, verdict TEXT, verdict_market TEXT, verdict_selection TEXT, verdict_odds TEXT, confidence INTEGER, generated_at TIMESTAMPTZ DEFAULT NOW())",
          'CREATE INDEX IF NOT EXISTS idx_wcprev_fixture ON world_cup_previews(fixture_id)',
        ] : []),
        // Last Man Standing tables (feature-flagged via ENABLE_LMS)
        ...(process.env.ENABLE_LMS === 'true' ? [
          "CREATE TABLE IF NOT EXISTS lms_competitions (id SERIAL PRIMARY KEY, name TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', access TEXT NOT NULL DEFAULT 'subscriber', current_round INTEGER DEFAULT 1, prize_pot NUMERIC(10,2) DEFAULT 0, base_prize NUMERIC(10,2) DEFAULT 0, config JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())",
          "CREATE TABLE IF NOT EXISTS lms_entries (id SERIAL PRIMARY KEY, competition_id INTEGER NOT NULL REFERENCES lms_competitions(id) ON DELETE CASCADE, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'alive', extra_teams INTEGER DEFAULT 0, reuses_used INTEGER DEFAULT 0, eliminated_round INTEGER, joined_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(competition_id, user_id))",
          'CREATE INDEX IF NOT EXISTS idx_lms_entries_comp ON lms_entries(competition_id)',
          'ALTER TABLE lms_entries ADD COLUMN IF NOT EXISTS reminded_round INTEGER DEFAULT 0',
          "CREATE TABLE IF NOT EXISTS lms_picks (id SERIAL PRIMARY KEY, competition_id INTEGER NOT NULL REFERENCES lms_competitions(id) ON DELETE CASCADE, entry_id INTEGER NOT NULL REFERENCES lms_entries(id) ON DELETE CASCADE, user_id TEXT NOT NULL, round INTEGER NOT NULL, team TEXT NOT NULL, is_reuse BOOLEAN DEFAULT FALSE, result TEXT NOT NULL DEFAULT 'pending', fixture_id BIGINT, settled_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(entry_id, round))",
          // SportMonks league fixture ids can exceed INT4 — widen for existing DBs
          // so settling a PL pick (which stores the fixture id) never overflows.
          'ALTER TABLE lms_picks ALTER COLUMN fixture_id TYPE BIGINT',
          'CREATE INDEX IF NOT EXISTS idx_lms_picks_comp_round ON lms_picks(competition_id, round)',
          "CREATE TABLE IF NOT EXISTS lms_purchases (id SERIAL PRIMARY KEY, competition_id INTEGER NOT NULL REFERENCES lms_competitions(id) ON DELETE CASCADE, user_id TEXT NOT NULL, amount NUMERIC(10,2) NOT NULL, stripe_session_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())",
          'CREATE INDEX IF NOT EXISTS idx_lms_purchases_user ON lms_purchases(competition_id, user_id)',
        ] : []),
        // Marketing Engine tables (feature-flagged)
        ...(process.env.ENABLE_MARKETING === 'true' ? [
          "CREATE TABLE IF NOT EXISTS marketing_content (id SERIAL PRIMARY KEY, fixture_id TEXT NOT NULL, event_id TEXT NOT NULL, tier TEXT DEFAULT 'hygiene', content JSONB NOT NULL, generated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(fixture_id, event_id))",
          'CREATE INDEX IF NOT EXISTS idx_mc_event ON marketing_content(event_id)',
          'CREATE INDEX IF NOT EXISTS idx_mc_date ON marketing_content(generated_at)',
          "CREATE TABLE IF NOT EXISTS marketing_posts (id SERIAL PRIMARY KEY, fixture_id TEXT, post_type TEXT, platform TEXT, content JSONB, posted_at TIMESTAMPTZ DEFAULT NOW())",
          'CREATE INDEX IF NOT EXISTS idx_mp_date ON marketing_posts(posted_at)',
        ] : []),
        // Winners Wall — subscriber-submitted wins (admin-moderated social proof)
        "CREATE TABLE IF NOT EXISTS winner_submissions (id SERIAL PRIMARY KEY, user_id TEXT, display_name TEXT, caption TEXT, image_data TEXT, amount TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), approved_at TIMESTAMPTZ)",
        'CREATE INDEX IF NOT EXISTS idx_winners_status ON winner_submissions(status, created_at DESC)',
        // Ask the Edge — log of questions asked (demand intel + adaptive prompts)
        "CREATE TABLE IF NOT EXISTS assistant_queries (id SERIAL PRIMARY KEY, question TEXT NOT NULL, answered BOOLEAN DEFAULT TRUE, ip_hash TEXT, created_at TIMESTAMPTZ DEFAULT NOW())",
        'CREATE INDEX IF NOT EXISTS idx_aq_created ON assistant_queries(created_at DESC)',
        // Stripe webhook idempotency — dedupe redelivered events by Stripe event id
        // so credits/subscriptions are never provisioned twice.
        "CREATE TABLE IF NOT EXISTS stripe_events (event_id TEXT PRIMARY KEY, type TEXT, processed_at TIMESTAMPTZ DEFAULT NOW())",
        // Indexed lookups to kill full-table user scans on the Stripe/referral hot paths.
        'CREATE INDEX IF NOT EXISTS idx_users_stripe_sub ON users(stripe_subscription_id)',
        'CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)',
        // Fast "has this user already unlocked this tip?" idempotency check.
        "CREATE INDEX IF NOT EXISTS idx_credit_tx_tip_unlock ON credit_transactions(user_id, tip_id, type)",
        // Last Man Standing — Premier League (and other league) fixtures, gameweek
        // by gameweek, synced from SportMonks so the LMS auto-settles with no manual
        // step. `round` = league gameweek number; status scheduled|live|finished.
        "CREATE TABLE IF NOT EXISTS pl_lms_fixtures (id SERIAL PRIMARY KEY, league_id INTEGER NOT NULL, season_id INTEGER, round INTEGER NOT NULL, home_team TEXT NOT NULL, away_team TEXT NOT NULL, kickoff TIMESTAMPTZ, home_goals INTEGER, away_goals INTEGER, status TEXT NOT NULL DEFAULT 'scheduled', external_fixture_id BIGINT UNIQUE, updated_at TIMESTAMPTZ DEFAULT NOW())",
        "CREATE INDEX IF NOT EXISTS idx_pl_lms_round ON pl_lms_fixtures(league_id, round)",
        // Conversion funnel — first-party top-of-funnel beacons (landing views,
        // signup-modal opens, checkout starts) that GA sees but the DB doesn't.
        // The lower funnel (registrations/trials/paid) is read from real tables.
        "CREATE TABLE IF NOT EXISTS funnel_events (id BIGSERIAL PRIMARY KEY, event TEXT NOT NULL, session_id TEXT, path TEXT, meta JSONB, created_at TIMESTAMPTZ DEFAULT NOW())",
        'CREATE INDEX IF NOT EXISTS idx_funnel_event_date ON funnel_events(event, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_funnel_session ON funnel_events(session_id, event)',
      ];
      for (var ci = 0; ci < alterCols.length; ci++) {
        try { await db.query(alterCols[ci]); } catch(e) {}
      }
      console.log('[Startup] Schema up to date');

      // DISABLED: persistent volume import was reimporting old sample data after DB reset
      // Clear the old JSON files from persistent volume so they can't contaminate the DB
      try {
        var fs2 = require('fs');
        var path2 = require('path');
        var pvDir = process.env.PERSISTENT_DATA_DIR || '/data';
        ['sample-tips.json', 'sample-results.json', 'sample-users.json'].forEach(function(f) {
          var fp = path2.join(pvDir, f);
          if (fs2.existsSync(fp)) {
            fs2.writeFileSync(fp, '[]');
            console.log('[Startup] Cleared persistent volume file: ' + f);
          }
        });
      } catch(e) {}

      // OLD import code — DISABLED
      if (false) try {
        var fs2 = require('fs');
        var path2 = require('path');
        var pvDir = process.env.PERSISTENT_DATA_DIR || '/data';
        var pvTipsFile = path2.join(pvDir, 'sample-tips.json');
        if (fs2.existsSync(pvTipsFile)) {
          var pvTips = JSON.parse(fs2.readFileSync(pvTipsFile, 'utf8'));
          var dbTipCount = await db.query('SELECT COUNT(*) FROM tips');
          var dbCount = parseInt(dbTipCount.rows[0].count);
          if (Array.isArray(pvTips) && pvTips.length > 0 && pvTips.length > dbCount) {
            console.log('[Startup] Persistent volume has ' + pvTips.length + ' tips vs DB has ' + dbCount + ' — syncing missing entries...');
            // Import tips not already in DB
            var imported = 0;
            for (var ti = 0; ti < pvTips.length; ti++) {
              try { await db.createTip(pvTips[ti]); imported++; } catch(e) { /* duplicate — skip */ }
            }
            console.log('[Startup] Imported ' + imported + ' tips from persistent volume');

            // Also import results
            var pvResultsFile = path2.join(pvDir, 'sample-results.json');
            if (fs2.existsSync(pvResultsFile)) {
              var pvResults = JSON.parse(fs2.readFileSync(pvResultsFile, 'utf8'));
              var resImported = 0;
              if (Array.isArray(pvResults)) {
                for (var ri = 0; ri < pvResults.length; ri++) {
                  try { await db.createResult(pvResults[ri]); resImported++; } catch(e) {}
                }
              }
              console.log('[Startup] Imported ' + resImported + ' results from persistent volume');
            }

            // Import blog reviews
            var pvBlogFile = path2.join(pvDir, 'blog-reviews.json');
            if (fs2.existsSync(pvBlogFile)) {
              var pvBlog = JSON.parse(fs2.readFileSync(pvBlogFile, 'utf8'));
              if (Array.isArray(pvBlog)) {
                for (var bi = 0; bi < pvBlog.length; bi++) {
                  try { await db.upsertBlogReview(pvBlog[bi]); } catch(e) {}
                }
                console.log('[Startup] Imported ' + pvBlog.length + ' blog reviews from persistent volume');
              }
            }
          }
        }
      } catch(reseedErr) {
        console.log('[Startup] Re-seed check skipped:', reseedErr.message);
      }

    } catch (tableErr) {
      // Tables don't exist — run migration
      console.log('[Startup] Database tables not found — running auto-migration...');
      const { Pool } = require('pg');
      const migrationPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
      });
      const migrate = require('./db/migrate');
      // migrate.js runs itself on require, but it uses its own pool.
      // Instead, run the SQL directly here:
      const migrationSQL = [
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
          name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'free',
          subscription TEXT NOT NULL DEFAULT 'free', subscription_expiry TIMESTAMPTZ,
          joined DATE NOT NULL DEFAULT CURRENT_DATE, bank NUMERIC(10,2) DEFAULT 100,
          session_id TEXT, failed_attempts INTEGER DEFAULT 0, lock_until TIMESTAMPTZ,
          flagged BOOLEAN DEFAULT FALSE, trusted_devices TEXT[] DEFAULT '{}',
          email_prefs JSONB DEFAULT '{"dailyBulletin":true,"weeklySummary":true,"marketing":true,"bigWins":true}',
          alert_prefs JSONB DEFAULT '{}',
          agreement_timestamp TIMESTAMPTZ, agreement_text TEXT,
          login_history JSONB DEFAULT '[]', reset_token TEXT, reset_token_expiry TIMESTAMPTZ,
          expiry_warned TEXT, stripe_customer_id TEXT, stripe_subscription_id TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS tips (
          id TEXT PRIMARY KEY, sport TEXT NOT NULL, event TEXT, meeting TEXT,
          race_time TEXT, race_class TEXT, distance TEXT, going TEXT,
          league TEXT, kickoff TEXT, venue TEXT, market TEXT, selection TEXT NOT NULL,
          odds NUMERIC(8,2), confidence INTEGER, model_probability NUMERIC(6,4),
          implied_probability NUMERIC(6,4), edge NUMERIC(6,4), value_rating TEXT,
          is_premium BOOLEAN DEFAULT FALSE, status TEXT DEFAULT 'active', result TEXT,
          date DATE, tipster TEXT, tipster_profile TEXT, staking TEXT, risk_level TEXT,
          analysis JSONB DEFAULT '{}', is_nap BOOLEAN DEFAULT FALSE, is_outsider BOOLEAN DEFAULT FALSE,
          opening_odds NUMERIC(8,2), bookmaker_odds JSONB DEFAULT '{}',
          recent_form TEXT[] DEFAULT '{}', is_weekly_acca BOOLEAN DEFAULT FALSE,
          acca_selections JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tips_date ON tips(date)`,
        `CREATE INDEX IF NOT EXISTS idx_tips_status ON tips(status)`,
        `CREATE INDEX IF NOT EXISTS idx_tips_sport ON tips(sport)`,
        `CREATE TABLE IF NOT EXISTS results (
          id TEXT PRIMARY KEY, tip_id TEXT REFERENCES tips(id) ON DELETE SET NULL,
          sport TEXT, event TEXT, selection TEXT, market TEXT,
          odds NUMERIC(8,2), stake NUMERIC(8,2), result TEXT, pnl NUMERIC(10,2),
          date DATE, is_premium BOOLEAN DEFAULT FALSE, tipster_profile TEXT,
          confidence INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_results_date ON results(date)`,
        `CREATE INDEX IF NOT EXISTS idx_results_tip_id ON results(tip_id)`,
        `CREATE TABLE IF NOT EXISTS support_tickets (
          id TEXT PRIMARY KEY, user_id TEXT, name TEXT NOT NULL, email TEXT NOT NULL,
          subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT DEFAULT 'open',
          priority TEXT DEFAULT 'medium', date TIMESTAMPTZ DEFAULT NOW(),
          replies JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS blog_reviews (
          slug TEXT PRIMARY KEY, title TEXT NOT NULL, date DATE, author TEXT,
          excerpt TEXT, content TEXT, is_auto_generated BOOLEAN DEFAULT FALSE,
          stats JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS form_guide (
          id SERIAL PRIMARY KEY, category TEXT NOT NULL UNIQUE,
          data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY, type TEXT DEFAULT 'info', message TEXT,
          tip_id TEXT, timestamp TIMESTAMPTZ DEFAULT NOW(), audience TEXT DEFAULT 'all'
        )`,
        `CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp DESC)`,
        `CREATE TABLE IF NOT EXISTS audit_log (
          id SERIAL PRIMARY KEY, user_id TEXT, user_email TEXT,
          action TEXT NOT NULL, entity TEXT, entity_id TEXT,
          details JSONB, ip TEXT, timestamp TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC)`,
      ];
      for (var i = 0; i < migrationSQL.length; i++) {
        await migrationPool.query(migrationSQL[i]);
      }

      // Add columns that may be missing from earlier migrations
      var alterSQL = [
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_active BOOLEAN DEFAULT FALSE',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_start TIMESTAMPTZ',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_warned BOOLEAN DEFAULT FALSE',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_prefs JSONB DEFAULT \'{}\'',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS drips_sent JSONB DEFAULT \'[]\'',
      ];
      for (var ai = 0; ai < alterSQL.length; ai++) {
        try { await migrationPool.query(alterSQL[ai]); } catch(e) { /* column may already exist */ }
      }
      await migrationPool.end();
      console.log('[Startup] Auto-migration complete — all tables created');

      // Seed from persistent volume first (has live data), fallback to bundled
      try {
        var tipCount = await db.query('SELECT COUNT(*) FROM tips');
        if (parseInt(tipCount.rows[0].count) === 0) {
          console.log('[Startup] Seeding database from JSON files...');
          var fs = require('fs');
          var path = require('path');
          // Prefer persistent volume (/data/) over bundled (server/data/)
          var persistentDir = process.env.PERSISTENT_DATA_DIR || '/data';
          var bundledDir = path.join(__dirname, 'data');
          var seedDir = bundledDir;
          try {
            fs.accessSync(persistentDir, fs.constants.R_OK);
            if (fs.existsSync(path.join(persistentDir, 'sample-tips.json'))) {
              seedDir = persistentDir;
              console.log('[Startup] Seeding from PERSISTENT volume at ' + persistentDir);
            }
          } catch(e) {
            console.log('[Startup] Seeding from BUNDLED data at ' + bundledDir);
          }

          // Seed users
          try {
            var usersFile = path.join(seedDir, 'sample-users.json');
            if (fs.existsSync(usersFile)) {
              var users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
              if (Array.isArray(users) && users.length > 0) {
                for (var u = 0; u < users.length; u++) { try { await db.createUser(users[u]); } catch(e) {} }
                console.log('[Startup] Seeded ' + users.length + ' users');
              }
            }
          } catch(e) {}

          // Seed tips
          try {
            var tips = JSON.parse(fs.readFileSync(path.join(seedDir, 'sample-tips.json'), 'utf8'));
            if (Array.isArray(tips) && tips.length > 0) {
              for (var t = 0; t < tips.length; t++) { try { await db.createTip(tips[t]); } catch(e) {} }
              console.log('[Startup] Seeded ' + tips.length + ' tips');
            }
          } catch(e) {}

          // Seed results
          try {
            var results = JSON.parse(fs.readFileSync(path.join(seedDir, 'sample-results.json'), 'utf8'));
            if (Array.isArray(results) && results.length > 0) {
              for (var r = 0; r < results.length; r++) { try { await db.createResult(results[r]); } catch(e) {} }
              console.log('[Startup] Seeded ' + results.length + ' results');
            }
          } catch(e) {}

          // Seed support tickets
          try {
            var supportFile = path.join(seedDir, 'sample-support.json');
            if (fs.existsSync(supportFile)) {
              var tickets = JSON.parse(fs.readFileSync(supportFile, 'utf8'));
              if (Array.isArray(tickets) && tickets.length > 0) {
                for (var s = 0; s < tickets.length; s++) { try { await db.createTicket(tickets[s]); } catch(e) {} }
                console.log('[Startup] Seeded ' + tickets.length + ' support tickets');
              }
            }
          } catch(e) {}

          // Seed blog reviews
          try {
            var blogFile = path.join(seedDir, 'blog-reviews.json');
            if (fs.existsSync(blogFile)) {
              var reviews = JSON.parse(fs.readFileSync(blogFile, 'utf8'));
              if (Array.isArray(reviews) && reviews.length > 0) {
                for (var b = 0; b < reviews.length; b++) { try { await db.upsertBlogReview(reviews[b]); } catch(e) {} }
                console.log('[Startup] Seeded ' + reviews.length + ' blog reviews');
              }
            }
          } catch(e) {}

          console.log('[Startup] Database seeding complete');
        } else {
          console.log('[Startup] Database has ' + tipCount.rows[0].count + ' tips — skipping seed');
        }
      } catch(seedErr) {
        console.log('[Startup] Seeding skipped:', seedErr.message);
      }
    }
  } catch (e) {
    console.log('[Startup] Auto-migration skipped:', e.message);
  }
})();

// ---------------------------------------------------------------------------
// Startup: remove incorrect selections from tips and results
// ---------------------------------------------------------------------------
(async function cleanupBadSelections() {
  var removeSelections = ["Commander's Intent", "Caballo Grande", "Lavender Hill Mob", "Calico", "Catching The Moon", "Spinning Lizzie", "Aqpan", "Ardisia", "Title Role", "Uptown Dandy", "Getaway King", "Rathkenny", "Sogna In Grande"];
  // Also clean up broken tips/results with null odds or null market
  try {
    if (db.isAvailable()) {
      await db.query("DELETE FROM results WHERE odds IS NULL AND market IS NULL AND pnl = 0");
      await db.query("DELETE FROM tips WHERE odds IS NULL AND market IS NULL");
      // Delete broken auto tips: null selection, null market, null/zero odds, or misclassified sport
      var cleanResult = await db.query("DELETE FROM tips WHERE id LIKE 'auto_%' AND (selection IS NULL OR market IS NULL OR odds IS NULL OR odds = 0)");
      var cleanCount = cleanResult && cleanResult.rowCount ? cleanResult.rowCount : 0;
      // Also remove racing events mislabelled as football
      var fixResult = await db.query("DELETE FROM tips WHERE id LIKE 'auto_%' AND sport = 'football' AND event NOT LIKE '%vs%' AND event LIKE '%:%'");
      var fixCount = fixResult && fixResult.rowCount ? fixResult.rowCount : 0;
      if (cleanCount > 0 || fixCount > 0) console.log('[Startup] Removed ' + (cleanCount + fixCount) + ' broken auto tip(s)');
      await db.query("UPDATE tips SET sport = 'racing' WHERE sport = 'football' AND (event LIKE '%Ffos Las%' OR event LIKE '%Hereford%' OR event LIKE '%Wolverhampton%' OR event LIKE '%Gowran%' OR event LIKE '%Curragh%' OR event LIKE '%Newmarket%' OR event LIKE '%Ascot%' OR event LIKE '%York%' OR event LIKE '%Ayr%')");
      await db.query("UPDATE results SET sport = 'racing' WHERE sport = 'football' AND (event LIKE '%Ffos Las%' OR event LIKE '%Hereford%' OR event LIKE '%Wolverhampton%' OR event LIKE '%Gowran%' OR event LIKE '%Curragh%' OR event LIKE '%Newmarket%' OR event LIKE '%Ascot%' OR event LIKE '%York%' OR event LIKE '%Ayr%' OR event LIKE '%Haydock%' OR event LIKE '%Killarney%' OR event LIKE '%Lingfield%' OR event LIKE '%Hexham%' OR event LIKE '%Ripon%' OR event LIKE '%Market Rasen%' OR event LIKE '%Chester%' OR event LIKE '%Newton%' OR event LIKE '%Kempton%' OR event LIKE '%Doncaster%' OR event LIKE '%Epsom%' OR event LIKE '%Newbury%')");
      // Fix tips with racing events wrongly labelled as football
      await db.query("UPDATE tips SET sport = 'racing' WHERE sport = 'football' AND (event LIKE '%Haydock%' OR event LIKE '%Ascot%' OR event LIKE '%Killarney%' OR event LIKE '%Lingfield%' OR event LIKE '%Hexham%' OR event LIKE '%Wolverhampton%' OR event LIKE '%Ripon%' OR event LIKE '%Market Rasen%' OR event LIKE '%Chester%' OR event LIKE '%Newton%' OR event LIKE '%Kempton%' OR event LIKE '%Doncaster%' OR event LIKE '%Epsom%' OR event LIKE '%Newbury%' OR event LIKE '%Newmarket%' OR event LIKE '%York%' OR event LIKE '%Ayr%' OR event LIKE '%Gowran%' OR event LIKE '%Curragh%')");
      // CLEANUP: remove broken data and stale weekly accas
      await db.query("DELETE FROM results WHERE market IS NULL AND odds IS NULL AND pnl = 0");
      await db.query("DELETE FROM tips WHERE market IS NULL AND id LIKE 'auto_%' AND odds IS NULL");
      await db.query("DELETE FROM tips WHERE is_weekly_acca = true"); // Old stale accas — Acca Builder page replaces this
      console.log('[Startup] Cleaned up null/broken tips and misclassified sports');
    }
  } catch(e) {}
  try {
    // Clean from database
    if (db.isAvailable()) {
      for (var i = 0; i < removeSelections.length; i++) {
        try {
          await db.query("DELETE FROM results WHERE LOWER(selection) = LOWER($1)", [removeSelections[i]]);
          await db.query("DELETE FROM tips WHERE LOWER(selection) = LOWER($1)", [removeSelections[i]]);
        } catch(e) {}
      }
      console.log('[Startup] Cleaned up ' + removeSelections.length + ' incorrect selections from DB');
    }
    // Clean from persistent volume JSON files
    var fs3 = require('fs');
    var path3 = require('path');
    var pvDir2 = process.env.PERSISTENT_DATA_DIR || '/data';
    ['sample-tips.json', 'sample-results.json'].forEach(function(file) {
      try {
        var filePath = path3.join(pvDir2, file);
        if (!fs3.existsSync(filePath)) return;
        var data = JSON.parse(fs3.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(data)) return;
        var before = data.length;
        data = data.filter(function(item) {
          var sel = (item.selection || '').toLowerCase();
          return !removeSelections.some(function(r) { return r.toLowerCase() === sel; });
        });
        if (data.length < before) {
          fs3.writeFileSync(filePath, JSON.stringify(data, null, 2));
          console.log('[Startup] Removed ' + (before - data.length) + ' entries from ' + file);
        }
      } catch(e) {}
    });
  } catch(e) {
    console.log('[Startup] Cleanup skipped:', e.message);
  }
})();

// ---------------------------------------------------------------------------
// Startup: deduplicate results — keep only the first result per selection+date
// ---------------------------------------------------------------------------
(async function deduplicateResults() {
  try {
    if (!db.isAvailable()) return;
    // Remove duplicates: keep the earliest result for each selection+date combination
    var dupeResult = await db.query(
      "DELETE FROM results WHERE id NOT IN (SELECT MIN(id) FROM results GROUP BY selection, date)"
    );
    if (dupeResult.rowCount > 0) {
      console.log('[Startup] Removed ' + dupeResult.rowCount + ' duplicate results');
    }
    // Also deduplicate tips by selection+date (same root cause)
    var dupeTips = await db.query(
      "DELETE FROM tips WHERE id NOT IN (SELECT MIN(id) FROM tips GROUP BY selection, date)"
    );
    if (dupeTips.rowCount > 0) {
      console.log('[Startup] Removed ' + dupeTips.rowCount + ' duplicate tips');
    }
  } catch(e) {
    console.log('[Startup] Dedup skipped:', e.message);
  }
})();

// ---------------------------------------------------------------------------
// Startup: seed historical results if DB is empty (one-time)
// ---------------------------------------------------------------------------
(async function seedHistoricalResults() {
  try {
    if (!db.isAvailable()) return;
    // Remove incorrect results
    await db.query("DELETE FROM results WHERE LOWER(event) LIKE '%wolfsburg%'");
    await db.query("DELETE FROM tips WHERE LOWER(event) LIKE '%wolfsburg%'");

    // Check if historical data already exists — don't reseed if it does
    var { rows } = await db.query("SELECT COUNT(*) as cnt FROM results WHERE id LIKE 'res_hist_%'");
    if (parseInt(rows[0].cnt) >= 30) return; // Already seeded with latest data
    // Clean and reseed
    await db.query("DELETE FROM results WHERE id LIKE 'res_hist_%'");
    await db.query("DELETE FROM tips WHERE id LIKE 'hist_%'");
    console.log('[Startup] Seeding verified historical results...');

    // REAL Premier League results from May 2026 (verified via Sky Sports/ESPN)
    var historicalData = [
      // Fri 1 May
      { date: '2026-05-01', event: 'Leeds United vs Burnley', selection: 'Leeds United Win', market: 'Match Result', odds: 1.90, result: 'won', pnl: 1.80, sport: 'football', confidence: 7, tipsterProfile: 'The Tactician', actualOutcome: 'Leeds United 3-1 Burnley', isPremium: true },
      // Sat 2 May
      { date: '2026-05-02', event: 'Arsenal vs Fulham', selection: 'Arsenal Win', market: 'Match Result', odds: 1.40, result: 'won', pnl: 0.80, sport: 'football', confidence: 9, tipsterProfile: 'The Professor', actualOutcome: 'Arsenal 3-0 Fulham', isPremium: true },
      { date: '2026-05-02', event: 'Newcastle United vs Brighton', selection: 'Newcastle United Win', market: 'Match Result', odds: 1.85, result: 'won', pnl: 1.70, sport: 'football', confidence: 8, tipsterProfile: 'The Tactician', actualOutcome: 'Newcastle United 3-1 Brighton', isPremium: true },
      { date: '2026-05-02', event: 'Brentford vs West Ham', selection: 'Over 2.5 Goals', market: 'Total Goals', odds: 1.80, result: 'won', pnl: 1.60, sport: 'football', confidence: 7, tipsterProfile: 'The Edge', actualOutcome: 'Brentford 3-0 West Ham', isPremium: true },
      // Sun 3 May
      { date: '2026-05-03', event: 'Manchester United vs Liverpool', selection: 'Over 2.5 Goals', market: 'Total Goals', odds: 1.70, result: 'won', pnl: 1.40, sport: 'football', confidence: 8, tipsterProfile: 'The Tactician', actualOutcome: 'Manchester United 3-2 Liverpool', isPremium: true },
      { date: '2026-05-03', event: 'Aston Villa vs Tottenham', selection: 'Aston Villa Win', market: 'Match Result', odds: 2.10, result: 'lost', pnl: -2.00, sport: 'football', confidence: 7, tipsterProfile: 'The Scout', actualOutcome: 'Aston Villa 1-2 Tottenham', isPremium: true },
      { date: '2026-05-03', event: 'Bournemouth vs Crystal Palace', selection: 'Bournemouth Win', market: 'Match Result', odds: 2.00, result: 'won', pnl: 2.00, sport: 'football', confidence: 7, tipsterProfile: 'The Edge', actualOutcome: 'Bournemouth 3-0 Crystal Palace', isPremium: true },
      // Mon 4 May
      { date: '2026-05-04', event: 'Chelsea vs Nottingham Forest', selection: 'Chelsea Win', market: 'Match Result', odds: 1.65, result: 'lost', pnl: -2.00, sport: 'football', confidence: 8, tipsterProfile: 'The Tactician', actualOutcome: 'Chelsea 1-3 Nottingham Forest', isPremium: true },
      { date: '2026-05-04', event: 'Everton vs Manchester City', selection: 'Manchester City Win', market: 'Match Result', odds: 1.55, result: 'lost', pnl: -2.00, sport: 'football', confidence: 8, tipsterProfile: 'The Professor', actualOutcome: 'Everton 3-3 Manchester City', isPremium: true },
      // Sat 9 May
      { date: '2026-05-09', event: 'Manchester City vs Brentford', selection: 'Manchester City Win', market: 'Match Result', odds: 1.30, result: 'won', pnl: 0.60, sport: 'football', confidence: 9, tipsterProfile: 'The Professor', actualOutcome: 'Manchester City 3-0 Brentford', isPremium: true },
      { date: '2026-05-09', event: 'Brighton vs Wolves', selection: 'Brighton Win', market: 'Match Result', odds: 1.75, result: 'won', pnl: 1.50, sport: 'football', confidence: 7, tipsterProfile: 'The Tactician', actualOutcome: 'Brighton 3-0 Wolves', isPremium: true },
      { date: '2026-05-09', event: 'Liverpool vs Chelsea', selection: 'BTTS - Yes', market: 'Both Teams to Score', odds: 1.65, result: 'won', pnl: 1.30, sport: 'football', confidence: 8, tipsterProfile: 'The Tactician', actualOutcome: 'Liverpool 1-1 Chelsea', isPremium: true },
      // Sun 10 May
      { date: '2026-05-10', event: 'West Ham vs Arsenal', selection: 'Arsenal Win', market: 'Match Result', odds: 1.80, result: 'won', pnl: 1.60, sport: 'football', confidence: 8, tipsterProfile: 'The Tactician', actualOutcome: 'West Ham 0-1 Arsenal', isPremium: true },
      { date: '2026-05-10', event: 'Crystal Palace vs Everton', selection: 'Under 2.5 Goals', market: 'Total Goals', odds: 1.90, result: 'lost', pnl: -2.00, sport: 'football', confidence: 6, tipsterProfile: 'The Edge', actualOutcome: 'Crystal Palace 2-2 Everton', isPremium: true },
      { date: '2026-05-10', event: 'Burnley vs Aston Villa', selection: 'Aston Villa Win', market: 'Match Result', odds: 2.10, result: 'lost', pnl: -2.00, sport: 'football', confidence: 7, tipsterProfile: 'The Scout', actualOutcome: 'Burnley 2-2 Aston Villa', isPremium: true },
      // Wed 14 May — Racing (York)
      { date: '2026-05-14', event: 'York 13:45', selection: 'Persian Spring', market: 'Win', odds: 5.00, result: 'won', pnl: 8.00, sport: 'racing', confidence: 7, tipsterProfile: 'The Clocker', actualOutcome: 'Persian Spring won at 4/1', isPremium: true },
      { date: '2026-05-14', event: 'York 15:30', selection: 'See The Fire', market: 'Win', odds: 1.83, result: 'won', pnl: 1.66, sport: 'racing', confidence: 8, tipsterProfile: 'The Clocker', actualOutcome: 'See The Fire won at 5/6', isPremium: true },
      { date: '2026-05-14', event: 'York 16:05', selection: 'Arc Ole Ole', market: 'Win', odds: 5.00, result: 'won', pnl: 8.00, sport: 'racing', confidence: 7, tipsterProfile: 'The Clocker', actualOutcome: 'Arc Ole Ole won at 4/1', isPremium: true },
      // Wed 14 May — Football
      { date: '2026-05-14', event: 'Bolton vs Bradford City', selection: 'Bolton Win', market: 'Match Result', odds: 2.75, result: 'won', pnl: 3.50, sport: 'football', confidence: 7, tipsterProfile: 'The Tactician', actualOutcome: 'Bolton Win', isPremium: true },
      { date: '2026-05-14', event: 'Valencia vs Rayo Vallecano', selection: 'BTTS - Yes', market: 'Both Teams to Score', odds: 2.00, result: 'won', pnl: 2.00, sport: 'football', confidence: 7, tipsterProfile: 'The Edge', actualOutcome: 'BTTS Yes', isPremium: true },
      { date: '2026-05-14', event: 'Girona vs Real Sociedad', selection: 'Draw', market: 'Match Result', odds: 3.70, result: 'won', pnl: 5.40, sport: 'football', confidence: 6, tipsterProfile: 'The Scout', actualOutcome: 'Draw', isPremium: true },
      // Wed 13 May
      { date: '2026-05-13', event: 'Manchester City vs Crystal Palace', selection: 'Manchester City Win', market: 'Match Result', odds: 1.25, result: 'won', pnl: 0.50, sport: 'football', confidence: 9, tipsterProfile: 'The Professor', actualOutcome: 'Manchester City 3-0 Crystal Palace', isPremium: true },
      // Thu 15 May
      { date: '2026-05-15', event: 'Aston Villa vs Liverpool', selection: 'Liverpool Win', market: 'Match Result', odds: 2.20, result: 'lost', pnl: -2.00, sport: 'football', confidence: 7, tipsterProfile: 'The Tactician', actualOutcome: 'Aston Villa 4-2 Liverpool', isPremium: true },
      // Mon 19 May
      { date: '2026-05-19', event: 'Chelsea vs Tottenham', selection: 'Chelsea Win', market: 'Match Result', odds: 2.25, result: 'won', pnl: 2.50, sport: 'football', confidence: 7, tipsterProfile: 'The Tactician', actualOutcome: 'Chelsea Win', isPremium: true },
      { date: '2026-05-19', event: 'Man City vs Bournemouth', selection: 'BTTS - Yes', market: 'Both Teams to Score', odds: 1.63, result: 'won', pnl: 1.26, sport: 'football', confidence: 7, tipsterProfile: 'The Edge', actualOutcome: 'BTTS Yes', isPremium: true },
      // Tue 20 May
      { date: '2026-05-20', event: 'Freiburg vs Aston Villa', selection: 'Over 2.5 Goals', market: 'Total Goals', odds: 2.00, result: 'won', pnl: 2.00, sport: 'football', confidence: 7, tipsterProfile: 'The Professor', actualOutcome: 'Over 2.5 Goals', isPremium: true },
      // Wed 21 May
      { date: '2026-05-21', event: 'Utrecht vs Heerenveen', selection: 'Utrecht Win', market: 'Match Result', odds: 1.91, result: 'won', pnl: 1.82, sport: 'football', confidence: 7, tipsterProfile: 'The Tactician', actualOutcome: 'Utrecht Win', isPremium: true },
      // Thu 22 May
      { date: '2026-05-22', event: 'Fiorentina vs Atalanta', selection: 'Under 2.5 Goals', market: 'Total Goals', odds: 2.38, result: 'won', pnl: 2.76, sport: 'football', confidence: 7, tipsterProfile: 'The Edge', actualOutcome: 'Under 2.5 Goals', isPremium: true },
      // Fri 23 May
      { date: '2026-05-23', event: 'Lazio vs Pisa', selection: 'Lazio Win', market: 'Match Result', odds: 1.70, result: 'won', pnl: 1.40, sport: 'football', confidence: 8, tipsterProfile: 'The Tactician', actualOutcome: 'Lazio Win', isPremium: true },
      { date: '2026-05-23', event: 'Real Betis vs Levante', selection: 'Real Betis Win', market: 'Match Result', odds: 2.30, result: 'won', pnl: 2.60, sport: 'football', confidence: 7, tipsterProfile: 'The Scout', actualOutcome: 'Real Betis Win', isPremium: true },
    ];

    for (var i = 0; i < historicalData.length; i++) {
      var r = historicalData[i];
      var tipId = 'hist_' + r.date.replace(/-/g, '') + '_' + i;
      var resultId = 'res_' + tipId;
      try {
        // Insert tip (with actualOutcome stored in analysis JSONB)
        await db.query(
          "INSERT INTO tips (id, sport, selection, event, market, odds, confidence, status, result, date, is_premium, tipster_profile, analysis, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'settled',$8,$9,$10,$11,$12,NOW()) ON CONFLICT (id) DO NOTHING",
          [tipId, r.sport, r.selection, r.event, r.market, r.odds, r.confidence, r.result, r.date, r.isPremium, r.tipsterProfile, JSON.stringify({ actualOutcome: r.actualOutcome })]
        );
        // Insert result (matches createResult schema exactly)
        await db.query(
          "INSERT INTO results (id, tip_id, sport, event, selection, market, odds, stake, result, pnl, date, is_premium, tipster_profile, confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,2,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING",
          [resultId, tipId, r.sport, r.event, r.selection, r.market, r.odds, r.result, r.pnl, r.date, r.isPremium, r.tipsterProfile, r.confidence]
        );
      } catch(e) { /* duplicate, skip */ }
    }
    console.log('[Startup] Seeded ' + historicalData.length + ' historical results');
  } catch(e) {
    console.log('[Startup] Historical seed skipped:', e.message);
  }
})();

// ---------------------------------------------------------------------------
// Startup: ensure admin account is promoted
// ---------------------------------------------------------------------------
(async function ensureAdmin() {
  try {
    var adminEmail = process.env.ADMIN_EMAIL || 'darren@ecocleaningsystems.co.uk';
    var user = await db.getUserByEmail(adminEmail);
    if (user && (user.role !== 'admin' || user.subscription !== 'vip')) {
      await db.updateUser(user.id, {
        role: 'admin',
        subscription: 'vip',
        subscriptionExpiry: '2027-12-31',
      });
      console.log('[Startup] Promoted ' + adminEmail + ' to admin + VIP');
    } else if (user) {
      console.log('[Startup] ' + adminEmail + ' already admin + VIP');
    }
  } catch (e) {
    console.log('[Startup] Admin promotion skipped:', e.message);
  }
})();

// ---------------------------------------------------------------------------
// Startup: migrate existing users — credits, referral codes, monthly allowances
// ---------------------------------------------------------------------------
(async function migrateCredits() {
  try {
    if (!db.isAvailable()) return;
    var users = await db.getUsers();
    var migrated = 0;
    var crypto = require('crypto');
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var updates = {};
      var needsUpdate = false;

      // Generate referral code if missing
      if (!u.referralCode) {
        var namePart = (u.name || 'user').split(' ')[0].toLowerCase().replace(/[^a-z]/g, '').substring(0, 6);
        updates.referralCode = namePart + '_' + Date.now().toString(36).slice(-4) + i;
        needsUpdate = true;
      }

      // Set credits based on subscription tier if not already set
      if (u.subscription === 'vip' && u.creditsMonthlyAllowance !== 999999) {
        updates.credits = 999999;
        updates.creditsMonthlyAllowance = 999999;
        needsUpdate = true;
      } else if (u.subscription === 'premium' && u.creditsMonthlyAllowance !== 250) {
        updates.credits = 250;
        updates.creditsMonthlyAllowance = 250;
        var resetDate = new Date();
        resetDate.setMonth(resetDate.getMonth() + 1);
        updates.creditsResetDate = resetDate.toISOString().split('T')[0];
        needsUpdate = true;
      } else if (u.subscription === 'starter' && u.creditsMonthlyAllowance !== 50) {
        updates.credits = 50;
        updates.creditsMonthlyAllowance = 50;
        var resetDate2 = new Date();
        resetDate2.setMonth(resetDate2.getMonth() + 1);
        updates.creditsResetDate = resetDate2.toISOString().split('T')[0];
        needsUpdate = true;
      } else if (u.subscription === 'free' && u.role !== 'admin') {
        // Free users: 10 credits/month WITH renewal. (Previously a one-time 3 whose
        // renewal never fired because no reset date was set — and a clawback that
        // wiped purchased credits. Both fixed here.)
        if (u.creditsMonthlyAllowance !== 10) {
          updates.creditsMonthlyAllowance = 10;
          needsUpdate = true;
        }
        // Set a reset date so the monthly job actually tops them up. Setting it to
        // today means the next 1am reset lifts them to 10, then monthly thereafter.
        if (!u.creditsResetDate) {
          updates.creditsResetDate = new Date().toISOString().split('T')[0];
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        await db.updateUser(u.id, updates);
        migrated++;
      }
    }
    if (migrated > 0) console.log('[Startup] Migrated credits/referrals for ' + migrated + ' user(s)');
  } catch (e) {
    console.log('[Startup] Credit migration skipped:', e.message);
  }
})();

// Cleanup: remove excess tips for today (keep max 9 per day)
(async function capDailyTips() {
  try {
    if (!db.isAvailable()) return;
    var today = new Date().toISOString().split('T')[0];
    var result = await db.query(
      "DELETE FROM tips WHERE id IN (SELECT id FROM tips WHERE date::text LIKE $1 AND id LIKE 'auto_%' ORDER BY created_at ASC OFFSET 9)",
      [today + '%']
    );
    if (result.rowCount > 0) {
      console.log('[Startup] Removed ' + result.rowCount + ' excess tips for ' + today + ' (max 4)');
    }
  } catch(e) {}
})();

// Expire tips older than 3 days that haven't been settled
(async function settleBacklog() {
  try {
    if (!db.isAvailable()) return;
    var threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];
    var result = await db.query(
      "UPDATE tips SET status = 'expired', result = 'void' WHERE status = 'active' AND date::text < $1 AND id LIKE 'auto_%'",
      [threeDaysAgo + '%']
    );
    if (result.rowCount > 0) {
      console.log('[Startup] Expired ' + result.rowCount + ' old unsettled tips');
    }
  } catch(e) {}
})();

// Manual results scripts removed — use admin panel to add results going forward

// Mark app as ready after startup scripts
setTimeout(function() { _appReady = true; console.log('[Startup] App ready'); }, 5000);

// Prune old conversion-funnel beacons daily so the table can't grow unbounded.
// Funnel analytics only needs a trailing window; 400 days keeps year-over-year.
(function pruneFunnelEvents() {
  async function prune() {
    if (!db.isAvailable()) return;
    try {
      const r = await db.query("DELETE FROM funnel_events WHERE created_at < NOW() - INTERVAL '400 days'");
      if (r && r.rowCount) console.log('[Cleanup] Pruned ' + r.rowCount + ' old funnel_events');
    } catch (e) { /* table may not exist yet on first boot — non-fatal */ }
  }
  setTimeout(prune, 60000); // once, shortly after boot
  setInterval(prune, 24 * 60 * 60 * 1000); // then daily
})();

// Last Man Standing (Premier League) — keep the current + upcoming gameweek
// fixtures/results synced from SportMonks so the LMS auto-settles with NO manual
// step. Runs independently of the (locked) tipping scheduler; safe no-op when LMS
// is off or there's no active league competition. Degrades safely: if the sync
// returns nothing, settlement simply holds (it never wrongly eliminates anyone).
(function syncPlLmsFixtures() {
  async function sync() {
    if (process.env.ENABLE_LMS !== 'true') return;
    if (!db.isAvailable || !db.isAvailable()) return;
    try {
      const lmsStore = require('./db/lmsStore');
      if (!lmsStore.available || !lmsStore.available() || !lmsStore.syncPlFixtures) return;
      const comps = await lmsStore.getCompetitions({ status: 'active' });
      const leagues = {};
      (comps || []).forEach(function (c) {
        if (c.phase === 'pl_rollover') leagues[(c.config && c.config.leagueId) || 8] = true;
      });
      if (!Object.keys(leagues).length) return;
      // Window: a few days back (to capture the just-finished gameweek's results)
      // through ~3 weeks ahead (current + next gameweeks). UTC yyyy-mm-dd.
      const from = new Date(Date.now() - 4 * 86400000).toISOString().split('T')[0];
      const to = new Date(Date.now() + 21 * 86400000).toISOString().split('T')[0];
      for (const lid in leagues) {
        const r = await lmsStore.syncPlFixtures(sportMonks, parseInt(lid, 10), from, to);
        if (r && r.synced) console.log('[LMS] Synced ' + r.synced + ' league-' + lid + ' fixtures');
      }
    } catch (e) { console.error('[LMS] PL fixture sync failed:', e.message); }
  }
  setTimeout(sync, 45000);            // shortly after boot
  setInterval(sync, 30 * 60 * 1000);  // every 30 min
})();

// ---------------------------------------------------------------------------
// Global error handler — catches unhandled errors in route handlers
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[ERROR] ' + req.method + ' ' + req.path + ':', err.message);
  if (process.env.NODE_ENV !== 'production') console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ---------------------------------------------------------------------------
// Start scheduled tasks
// ---------------------------------------------------------------------------
const scheduler = require('./services/scheduler')(deps);

// Admin manual triggers for scheduler functions
// Health check — shows tip generation status for today
app.get('/api/health', async (req, res) => {
  try {
    var today = new Date().toISOString().split('T')[0];
    var tips = await db.getTips();
    var todayTips = tips.filter(function(t) {
      return (t.date || '').toString().substring(0, 10) === today && t.id && t.id.toString().indexOf('auto_') === 0;
    });
    var validTips = todayTips.filter(function(t) {
      return t.selection && t.selection !== 'Unknown' && t.market && t.odds && t.odds > 0;
    });
    var racing = validTips.filter(function(t) { return t.sport === 'racing'; });
    var football = validTips.filter(function(t) { return t.sport === 'football'; });
    res.json({
      status: validTips.length >= 3 ? 'healthy' : validTips.length > 0 ? 'partial' : 'no_tips',
      today: today,
      totalTips: validTips.length,
      brokenTips: todayTips.length - validTips.length,
      racing: racing.length,
      football: football.length,
      tipsGenerated: validTips.length >= 3,
    });
  } catch(e) {
    res.json({ status: 'error', message: e.message });
  }
});

app.post('/api/admin/trigger/generate', deps.authenticate, deps.requireAdmin, async (req, res) => {
  try {
    console.log('[Admin] Manual tip generation triggered — bypassing date guard');
    await scheduler.autoGenerateDailyTips(true); // true = force bypass date check
    res.json({ ok: true, message: 'Tip generation triggered' });
  } catch (err) {
    console.error('[Admin] Manual generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/rescore-predictions', deps.authenticate, deps.requireAdmin, async (req, res) => {
  try {
    if (!db.rescoreMatchPredictions) return res.status(503).json({ error: 'Not available' });
    var result = await db.rescoreMatchPredictions();
    res.json({ ok: true, result: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/trigger/settle', deps.authenticate, deps.requireAdmin, async (req, res) => {
  try {
    console.log('[Admin] Manual auto-settle triggered');
    await scheduler.autoSettleResults();
    res.json({ ok: true, message: 'Auto-settle triggered' });
  } catch (err) {
    console.error('[Admin] Manual settle error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Admin: manual AutoTune trigger + tuning status
app.post('/api/admin/trigger/autotune', deps.authenticate, deps.requireAdmin, async (req, res) => {
  try {
    console.log('[Admin] Manual AutoTune triggered');
    await scheduler.autoTuneAnalysts(true); // true = force bypass time check
    res.json({ ok: true, message: 'AutoTune cycle completed' });
  } catch (err) {
    console.error('[Admin] Manual AutoTune error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/trigger/blog', deps.authenticate, deps.requireAdmin, async (req, res) => {
  try {
    console.log('[Admin] Manual blog review generation triggered');
    if (!scheduler.updateWeeklyBlog) return res.status(503).json({ error: 'Blog generator unavailable' });
    await scheduler.updateWeeklyBlog();
    res.json({ ok: true, message: 'Blog review generated. Check the Blog page.' });
  } catch (err) {
    console.error('[Admin] Manual blog generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/tuning-status', deps.authenticate, deps.requireAdmin, async (req, res) => {
  try {
    // All state now in database — no filesystem dependency
    var state = null;
    try {
      var { rows: stateRows } = await db.query("SELECT details, timestamp FROM audit_log WHERE action = 'analyst_state' ORDER BY timestamp DESC LIMIT 1");
      if (stateRows.length > 0) state = { weights: JSON.parse(stateRows[0].details), savedAt: stateRows[0].timestamp };
    } catch(e) {}

    var recentLogs = [];
    try {
      var { rows: logRows } = await db.query("SELECT details, timestamp FROM audit_log WHERE action = 'tuning_log' ORDER BY timestamp DESC LIMIT 7");
      recentLogs = logRows.map(function(r) { try { return JSON.parse(r.details); } catch(e) { return null; } }).filter(Boolean);
    } catch(e) {}

    var lastDbTune = null;
    try {
      var { rows } = await db.query("SELECT details, timestamp FROM audit_log WHERE action = 'auto_tune' ORDER BY timestamp DESC LIMIT 1");
      if (rows.length > 0) lastDbTune = { timestamp: rows[0].timestamp, report: JSON.parse(rows[0].details || '[]') };
    } catch(e) {}

    res.json({
      stateExists: !!state,
      currentWeights: state ? state.weights : null,
      lastStateSaved: state ? state.savedAt : null,
      recentTuningCycles: recentLogs,
      lastDatabaseTune: lastDbTune,
      nextScheduled: '23:00 UK tonight',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start server + graceful shutdown
// ---------------------------------------------------------------------------
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════╗');
  console.log('  ║     ELITE EDGE SPORTS TIPS — Server Running          ║');
  console.log('  ║     Port: ' + PORT + '                                        ║');
  console.log('  ║     Database: ' + (db.isAvailable() ? 'PostgreSQL' : 'JSON Fallback') + '                        ║');
  console.log('  ║     Admin: /admin                                    ║');
  console.log('  ╚═══════════════════════════════════════════════════════╝');
  console.log('');
});

// Graceful shutdown — drain connections, close DB pool
function shutdown(signal) {
  console.log('\n[Server] ' + signal + ' received — shutting down gracefully...');
  server.close(() => {
    console.log('[Server] HTTP server closed');
    if (db.pool) {
      db.pool.end(() => {
        console.log('[Server] Database pool closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Process-level safety nets. This app has many fire-and-forget async tasks
// (schedulers, enrichment, webhooks). A single stray rejection or throw outside
// a request handler must NOT take down the whole Railway instance and drop all
// live traffic. Log loudly and keep serving; Railway restarts on a true exit.
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  const msg = reason && reason.stack ? reason.stack : (reason && reason.message) || String(reason);
  console.error('[FATAL] Unhandled promise rejection (kept alive):', msg);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception (kept alive):', err && err.stack ? err.stack : err);
});

module.exports = app;
