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
      imgSrc: ["'self'", "data:", "https:"],
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
  understatService,
  basketballData,
  rugbyData,
  nflData,
  tennisData,
  gptVerifier,
  perplexityClient,
};

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
app.use('/api', require('./routes/odds')(deps));
app.use('/api', require('./routes/tips')(deps));
app.use('/api', require('./routes/results')(deps));
app.use('/api', require('./routes/admin')(deps));
app.use('/api', require('./routes/support')(deps));
app.use('/api', require('./routes/analytics')(deps));
app.use('/api', require('./routes/stripe')(deps));
app.use('/api', require('./routes/userBets')(deps));
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
      ];
      for (var ci = 0; ci < alterCols.length; ci++) {
        try { await db.query(alterCols[ci]); } catch(e) {}
      }
      console.log('[Startup] Schema up to date');

      // One-time re-seed: import persistent volume data into DB if DB has fewer tips
      // This fixes the case where DB was seeded from bundled (old) data instead of live data
      try {
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
      } else if (u.subscription === 'premium' && u.creditsMonthlyAllowance !== 120) {
        updates.credits = 120;
        updates.creditsMonthlyAllowance = 120;
        var resetDate = new Date();
        resetDate.setMonth(resetDate.getMonth() + 1);
        updates.creditsResetDate = resetDate.toISOString().split('T')[0];
        needsUpdate = true;
      } else if (u.subscription === 'starter' && u.creditsMonthlyAllowance !== 40) {
        updates.credits = 40;
        updates.creditsMonthlyAllowance = 40;
        var resetDate2 = new Date();
        resetDate2.setMonth(resetDate2.getMonth() + 1);
        updates.creditsResetDate = resetDate2.toISOString().split('T')[0];
        needsUpdate = true;
      } else if (u.subscription === 'free' && !u.credits && u.credits !== 0) {
        updates.credits = 5;
        updates.creditsMonthlyAllowance = 0;
        needsUpdate = true;
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

module.exports = app;
