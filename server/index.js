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
const dataIngestion = require('./services/dataIngestion');
const aiReports = require('./services/aiReports');
const alertEngine = require('./services/alertEngine');
const telegramBot = require('./services/telegramBot');
const newsService = require('./services/newsService');

// Utilities
const helpers = require('./utils/helpers');
const oddsHelpers = require('./utils/oddsHelpers');

// App setup
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'elite-edge-secret-key-change-in-production';

// Warn if using default JWT secret
if (!process.env.JWT_SECRET) {
  console.warn('[SECURITY] WARNING: JWT_SECRET not set — using default. Set JWT_SECRET in production!');
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:3000', 'https://eliteedgesports.co.uk', 'https://www.eliteedgesports.co.uk'];
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '1mb' }));

// Geo-restriction (conditional on GEO_RESTRICT env)
require('./middleware/geoRestrict')(app);

// Rate limiting
const rateLimiterFns = require('./middleware/rateLimiter');
app.use('/api', rateLimiterFns.rateLimiter);

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));
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
};

// ---------------------------------------------------------------------------
// Mount routes
// ---------------------------------------------------------------------------
app.use('/api/auth', require('./routes/auth')(deps));
app.use('/api', require('./routes/racing')(deps));
app.use('/api', require('./routes/football')(deps));
app.use('/api', require('./routes/odds')(deps));
app.use('/api', require('./routes/tips')(deps));
app.use('/api', require('./routes/results')(deps));
app.use('/api', require('./routes/admin')(deps));
app.use('/api', require('./routes/support')(deps));
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
      console.log('[Startup] Database tables already exist — skipping migration');
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
          expiry_warned TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
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
      await migrationPool.end();
      console.log('[Startup] Auto-migration complete — all tables created');

      // Seed from JSON files if tables are empty
      try {
        var userCount = await db.query('SELECT COUNT(*) FROM users');
        if (parseInt(userCount.rows[0].count) === 0) {
          console.log('[Startup] Seeding database from JSON files...');
          var fs = require('fs');
          var path = require('path');
          var dataDir = path.join(__dirname, 'data');

          // Seed tips
          try {
            var tips = JSON.parse(fs.readFileSync(path.join(dataDir, 'sample-tips.json'), 'utf8'));
            if (Array.isArray(tips)) {
              for (var t = 0; t < tips.length; t++) { try { await db.createTip(tips[t]); } catch(e) {} }
              console.log('[Startup] Seeded ' + tips.length + ' tips');
            }
          } catch(e) {}

          // Seed results
          try {
            var results = JSON.parse(fs.readFileSync(path.join(dataDir, 'sample-results.json'), 'utf8'));
            if (Array.isArray(results)) {
              for (var r = 0; r < results.length; r++) { try { await db.createResult(results[r]); } catch(e) {} }
              console.log('[Startup] Seeded ' + results.length + ' results');
            }
          } catch(e) {}

          console.log('[Startup] Database seeding complete');
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
// Startup: ensure admin account is promoted
// ---------------------------------------------------------------------------
(async function ensureAdmin() {
  try {
    var adminEmail = 'darren@ecocleaningsystems.co.uk';
    var user = await db.getUserByEmail(adminEmail);
    if (user && (user.role !== 'admin' || user.subscription !== 'premium')) {
      await db.updateUser(user.id, {
        role: 'admin',
        subscription: 'premium',
        subscriptionExpiry: '2027-12-31',
      });
      console.log('[Startup] Promoted ' + adminEmail + ' to admin + premium');
    } else if (user) {
      console.log('[Startup] ' + adminEmail + ' already admin + premium');
    }
  } catch (e) {
    console.log('[Startup] Admin promotion skipped:', e.message);
  }
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
