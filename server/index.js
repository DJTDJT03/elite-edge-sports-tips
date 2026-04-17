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

// Utilities
const helpers = require('./utils/helpers');
const oddsHelpers = require('./utils/oddsHelpers');

// App setup
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'elite-edge-secret-key-change-in-production';

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
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
// Start scheduled tasks
// ---------------------------------------------------------------------------
const scheduler = require('./services/scheduler')(deps);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════╗');
  console.log('  ║     ELITE EDGE SPORTS TIPS — Server Running          ║');
  console.log('  ║     Port: ' + PORT + '                                        ║');
  console.log('  ║     Database: ' + (db.isAvailable() ? 'PostgreSQL' : 'JSON Fallback') + '                        ║');
  console.log('  ║     Admin: /admin                                    ║');
  console.log('  ╚═══════════════════════════════════════════════════════╝');
  console.log('');
});

module.exports = app;
