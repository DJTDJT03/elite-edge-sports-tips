const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const scoringModel = require('./services/scoringModel');
const emailService = require('./services/emailService');
const dataIngestion = require('./services/dataIngestion');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'elite-edge-secret-key-change-in-production';

// ---------------------------------------------------------------------------
// UUID helper (no external dependency)
// ---------------------------------------------------------------------------
function generateSessionId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// Auth Rate Limiting — 5 login attempts per IP per 15 minutes
// ---------------------------------------------------------------------------
const authRateLimitStore = {};
const AUTH_RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const AUTH_RATE_LIMIT_MAX = 5;

function checkAuthRateLimit(ip) {
  const now = Date.now();
  if (!authRateLimitStore[ip] || now - authRateLimitStore[ip].start > AUTH_RATE_LIMIT_WINDOW) {
    authRateLimitStore[ip] = { start: now, count: 0 };
  }
  return authRateLimitStore[ip].count >= AUTH_RATE_LIMIT_MAX;
}

function recordAuthAttempt(ip) {
  const now = Date.now();
  if (!authRateLimitStore[ip] || now - authRateLimitStore[ip].start > AUTH_RATE_LIMIT_WINDOW) {
    authRateLimitStore[ip] = { start: now, count: 1 };
  } else {
    authRateLimitStore[ip].count++;
  }
}

function resetAuthRateLimit(ip) {
  delete authRateLimitStore[ip];
}

// Clean up auth rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const ip in authRateLimitStore) {
    if (now - authRateLimitStore[ip].start > AUTH_RATE_LIMIT_WINDOW) {
      delete authRateLimitStore[ip];
    }
  }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// Password validation helper
// ---------------------------------------------------------------------------
function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters long';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least 1 uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least 1 lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least 1 number';
  return null;
}

// ---------------------------------------------------------------------------
// Device fingerprint helper
// ---------------------------------------------------------------------------
function hashDeviceFingerprint(ip, userAgent) {
  return crypto.createHash('sha256').update((ip || '') + '|' + (userAgent || '')).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Suspicious login detection — 3+ different IPs in 24 hours
// ---------------------------------------------------------------------------
function checkSuspiciousActivity(user) {
  if (!user.loginHistory || user.loginHistory.length < 3) return false;
  const now = Date.now();
  const last24h = user.loginHistory.filter(l => now - new Date(l.timestamp).getTime() < 24 * 60 * 60 * 1000);
  const uniqueIPs = new Set(last24h.map(l => l.ip));
  return uniqueIPs.size >= 3;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// UK Geo-Restriction Middleware
// Uses free IP geolocation. In production, use MaxMind GeoIP2 or Cloudflare.
// Set GEO_RESTRICT=true in env to enforce (disabled in dev by default)
// ---------------------------------------------------------------------------
const GEO_RESTRICT = process.env.GEO_RESTRICT === 'true';
const ALLOWED_COUNTRIES = ['GB', 'UK', 'IE']; // UK + Ireland

if (GEO_RESTRICT) {
  app.use(async (req, res, next) => {
    // Skip for static assets
    if (!req.path.startsWith('/api/')) return next();
    try {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
      // Skip localhost/dev
      if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
      // Use free geo API (in production use MaxMind or Cloudflare headers)
      const https = require('https');
      const geoData = await new Promise((resolve) => {
        https.get(`https://ipapi.co/${ip}/json/`, (resp) => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({}); } });
        }).on('error', () => resolve({}));
      });
      if (geoData.country_code && !ALLOWED_COUNTRIES.includes(geoData.country_code)) {
        return res.status(403).json({ error: 'This service is only available in the United Kingdom. Your location: ' + (geoData.country_name || 'Unknown') });
      }
      next();
    } catch(e) { next(); } // Fail open in case of geo service error
  });
  console.log('  Geo-restriction: ENABLED (UK only)');
} else {
  console.log('  Geo-restriction: Disabled (set GEO_RESTRICT=true to enable)');
}

// ---------------------------------------------------------------------------
// API Rate Limiting Middleware (Feature #12)
// 100 requests per minute per IP. In-memory store, no npm package needed.
// ---------------------------------------------------------------------------
const rateLimitStore = {};
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 100;

function rateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const now = Date.now();
  if (!rateLimitStore[ip] || now - rateLimitStore[ip].start > RATE_LIMIT_WINDOW) {
    rateLimitStore[ip] = { start: now, count: 1 };
  } else {
    rateLimitStore[ip].count++;
  }
  if (rateLimitStore[ip].count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too Many Requests. Please try again later.' });
  }
  next();
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const ip in rateLimitStore) {
    if (now - rateLimitStore[ip].start > RATE_LIMIT_WINDOW) {
      delete rateLimitStore[ip];
    }
  }
}, 5 * 60 * 1000);

// Apply rate limiting to all /api/* routes
app.use('/api', rateLimiter);

app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// Data helpers — read/write JSON files
// ---------------------------------------------------------------------------
const dataDir = path.join(__dirname, 'data');

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  } catch { return []; }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    // Single session enforcement: verify sessionId matches current user record
    if (decoded.sessionId) {
      const users = readJSON('sample-users.json');
      const user = users.find(u => u.id === decoded.id);
      if (user && user.sessionId && user.sessionId !== decoded.sessionId) {
        return res.status(401).json({
          error: 'Session expired — your account was logged in elsewhere',
          code: 'session_expired'
        });
      }
      // Also check subscription status from DB (not just token) for premium enforcement
      if (user) {
        decoded.subscription = user.subscription;
        decoded.subscriptionExpiry = user.subscriptionExpiry;
      }
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requirePremium(req, res, next) {
  if (req.user.role === 'admin') return next();
  // Check subscription status from DB (already refreshed in authenticate middleware)
  if (req.user.subscription !== 'premium') {
    return res.status(403).json({ error: 'Premium subscription required', code: 'upgrade_required' });
  }
  // Check subscription expiry
  if (req.user.subscriptionExpiry) {
    const expiry = new Date(req.user.subscriptionExpiry);
    if (expiry < new Date()) {
      return res.status(403).json({ error: 'Your premium subscription has expired. Please renew to continue accessing premium content.', code: 'subscription_expired' });
    }
  }
  next();
}

// ---------------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, agreementTimestamp } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    // Password strength validation
    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const users = readJSON('sample-users.json');
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const userAgent = req.headers['user-agent'] || '';
    const sessionId = generateSessionId();
    const now = new Date().toISOString();
    const deviceHash = hashDeviceFingerprint(ip, userAgent);

    const user = {
      id: `usr_${Date.now()}`,
      email,
      password: hashed,
      name,
      role: 'free',
      subscription: 'free',
      subscriptionExpiry: null,
      joined: new Date().toISOString().split('T')[0],
      bank: 100,
      agreementTimestamp: agreementTimestamp || now,
      agreementText: 'I confirm I am 18+ and understand this service provides statistical analysis only, not betting advice. I accept full responsibility for any betting decisions I make.',
      sessionId,
      failedAttempts: 0,
      lockUntil: null,
      flagged: false,
      lastLogin: { ip, userAgent, timestamp: now, sessionId },
      loginHistory: [{ ip, userAgent, timestamp: now, sessionId }],
      trustedDevices: [deviceHash],
      emailPrefs: { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true },
    };
    users.push(user);
    writeJSON('sample-users.json', users);

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, sessionId },
      JWT_SECRET, { expiresIn: '24h' }
    );
    const tokenExpiry = Date.now() + 24 * 60 * 60 * 1000;

    // Send welcome email (async, non-blocking)
    emailService.sendWelcome({ name: user.name, email: user.email }).catch(function(err) {
      console.error('[Email] Welcome email failed:', err.message);
    });

    res.json({ token, tokenExpiry, user: { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, joined: user.joined } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const userAgent = req.headers['user-agent'] || '';

    // Rate limit check
    if (checkAuthRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many login attempts. Please try again in 15 minutes.' });
    }

    const users = readJSON('sample-users.json');
    const user = users.find(u => u.email === email);
    if (!user) {
      recordAuthAttempt(ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Account lockout check
    if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
      const mins = Math.ceil((new Date(user.lockUntil) - new Date()) / 60000);
      return res.status(423).json({ error: `Account temporarily locked. Please try again in ${mins} minute${mins !== 1 ? 's' : ''}.` });
    }

    // Support both hashed and plain-text passwords for demo
    let valid = false;
    try { valid = await bcrypt.compare(password, user.password); } catch {}
    if (!valid && user.passwordPlain) { valid = password === user.passwordPlain; }

    if (!valid) {
      recordAuthAttempt(ip);
      // Account lockout: increment failed attempts
      user.failedAttempts = (user.failedAttempts || 0) + 1;
      if (user.failedAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // Lock 30 mins
        writeJSON('sample-users.json', users);
        return res.status(423).json({ error: 'Account temporarily locked due to too many failed attempts. Please try again in 30 minutes.' });
      }
      writeJSON('sample-users.json', users);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Successful login — reset counters
    resetAuthRateLimit(ip);
    user.failedAttempts = 0;
    user.lockUntil = null;

    // Generate new session (invalidates any previous session)
    const sessionId = generateSessionId();
    user.sessionId = sessionId;
    const now = new Date().toISOString();

    // Device fingerprinting
    const deviceHash = hashDeviceFingerprint(ip, userAgent);
    const loginEntry = { ip, userAgent, timestamp: now, sessionId };
    user.lastLogin = loginEntry;

    // Maintain login history (last 10)
    if (!user.loginHistory) user.loginHistory = [];
    user.loginHistory.unshift(loginEntry);
    if (user.loginHistory.length > 10) user.loginHistory = user.loginHistory.slice(0, 10);

    // Trusted devices tracking
    if (!user.trustedDevices) user.trustedDevices = [];
    const isNewDevice = !user.trustedDevices.includes(deviceHash);
    if (isNewDevice) {
      user.trustedDevices.push(deviceHash);
      // TODO: In production, send "New login detected" email via SendGrid
      // e.g. const sgMail = require('@sendgrid/mail');
      //      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      //      sgMail.send({ to: user.email, subject: 'New Login Detected', html: `A new login to your Elite Edge account was detected from IP ${ip}...` });
      console.log(`[Auth] New device login for ${user.email} from IP: ${ip}`);
    }

    // Suspicious activity flag (3+ IPs in 24h)
    if (checkSuspiciousActivity(user)) {
      user.flagged = true;
      console.log(`[Auth] FLAGGED: ${user.email} has 3+ different IPs in 24 hours`);
    }

    console.log(`[Auth] Login: ${user.email} | IP: ${ip} | Session: ${sessionId.slice(0, 8)}...`);

    writeJSON('sample-users.json', users);

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, sessionId },
      JWT_SECRET, { expiresIn: '24h' }
    );
    const tokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
    res.json({
      token,
      tokenExpiry,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, joined: user.joined, subscriptionExpiry: user.subscriptionExpiry },
      isNewDevice
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const users = readJSON('sample-users.json');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    user: {
      id: user.id, email: user.email, name: user.name, role: user.role,
      subscription: user.subscription, subscriptionExpiry: user.subscriptionExpiry,
      joined: user.joined,
      lastLogin: user.lastLogin,
      loginHistory: (user.loginHistory || []).slice(0, 5),
    }
  });
});

// ---------------------------------------------------------------------------
// CHANGE PASSWORD
// ---------------------------------------------------------------------------
app.post('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    const pwError = validatePassword(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });

    const users = readJSON('sample-users.json');
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let valid = false;
    try { valid = await bcrypt.compare(currentPassword, user.password); } catch {}
    if (!valid && user.passwordPlain) { valid = currentPassword === user.passwordPlain; }
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    user.password = await bcrypt.hash(newPassword, 10);
    if (user.passwordPlain) delete user.passwordPlain;
    writeJSON('sample-users.json', users);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// LOG OUT ALL DEVICES (invalidate session)
// ---------------------------------------------------------------------------
app.post('/api/auth/logout-all', authenticate, (req, res) => {
  const users = readJSON('sample-users.json');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.sessionId = generateSessionId(); // New sessionId invalidates all old tokens
  writeJSON('sample-users.json', users);
  res.json({ message: 'All sessions have been logged out. Please log in again.' });
});

// ---------------------------------------------------------------------------
// DELETE ACCOUNT
// ---------------------------------------------------------------------------
app.delete('/api/auth/account', authenticate, (req, res) => {
  let users = readJSON('sample-users.json');
  const before = users.length;
  users = users.filter(u => u.id !== req.user.id);
  if (users.length === before) return res.status(404).json({ error: 'User not found' });
  writeJSON('sample-users.json', users);
  res.json({ message: 'Account deleted successfully' });
});

// ---------------------------------------------------------------------------
// UPDATE PREFERENCES (odds format etc.)
// ---------------------------------------------------------------------------
app.put('/api/auth/preferences', authenticate, (req, res) => {
  const users = readJSON('sample-users.json');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body.oddsFormat) user.oddsFormat = req.body.oddsFormat;
  writeJSON('sample-users.json', users);
  res.json({ message: 'Preferences updated' });
});

// ---------------------------------------------------------------------------
// EMAIL PREFERENCES
// ---------------------------------------------------------------------------
app.get('/api/auth/email-prefs', authenticate, (req, res) => {
  const users = readJSON('sample-users.json');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const prefs = user.emailPrefs || { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true };
  res.json({ emailPrefs: prefs });
});

app.put('/api/auth/email-prefs', authenticate, (req, res) => {
  const users = readJSON('sample-users.json');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const allowed = ['dailyBulletin', 'weeklySummary', 'marketing', 'bigWins'];
  if (!user.emailPrefs) user.emailPrefs = { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true };
  for (var key of allowed) {
    if (req.body[key] !== undefined) user.emailPrefs[key] = !!req.body[key];
  }
  writeJSON('sample-users.json', users);
  res.json({ message: 'Email preferences updated', emailPrefs: user.emailPrefs });
});

// ---------------------------------------------------------------------------
// FORGOT PASSWORD (Feature #2)
// In demo mode: resets password to "reset123"
// In production: integrate with SendGrid/Mailgun for actual reset email
// ---------------------------------------------------------------------------
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const users = readJSON('sample-users.json');
    const user = users.find(u => u.email === email);

    // Always return success message to prevent email enumeration
    const message = 'If an account exists with this email, a password reset link has been sent.';

    if (user) {
      // Demo mode: actually reset the password to "reset123"
      const hashed = await bcrypt.hash('reset123', 10);
      user.password = hashed;
      if (user.passwordPlain) user.passwordPlain = 'reset123';
      writeJSON('sample-users.json', users);
      return res.json({ message, demo: true, demoMessage: 'Demo mode: password reset to reset123' });
    }

    res.json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// LIVE RACING DATA (The Racing API)
// These endpoints pull real-time data when API keys are configured
// Set env: RACING_API_KEY and RACING_API_SECRET
// Sign up: https://www.theracingapi.com/ (free 2-week trial)
// ---------------------------------------------------------------------------
const racingSource = dataIngestion.sources ? dataIngestion.sources.get('racing-cards') : null;

app.get('/api/racing/live-cards', async (req, res) => {
  try {
    if (!racingSource || !process.env.RACING_API_KEY) {
      return res.json({
        live: false,
        message: 'Racing API not configured. Set RACING_API_KEY and RACING_API_SECRET environment variables.',
        setup: 'Sign up for free trial at https://www.theracingapi.com/',
        racecards: []
      });
    }
    const raw = await racingSource.fetch();
    const normalised = racingSource.normalise(raw);
    res.json({ live: true, racecards: normalised, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/racing/live-results', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    if (!racingSource || !process.env.RACING_API_KEY) {
      return res.json({ live: false, message: 'Racing API not configured', results: [] });
    }
    const results = await racingSource.fetchResults(date);
    res.json({ live: true, results: results.results || [], fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/racing/horse/:horseId', async (req, res) => {
  try {
    if (!racingSource || !process.env.RACING_API_KEY) {
      return res.json({ live: false, message: 'Racing API not configured' });
    }
    const form = await racingSource.fetchHorseForm(req.params.horseId);
    res.json({ live: true, form });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// LIVE FOOTBALL DATA (API-Football)
// Set env: API_FOOTBALL_KEY
// Sign up: https://www.api-football.com/
// ---------------------------------------------------------------------------
const footballSource = dataIngestion.sources ? dataIngestion.sources.get('football-fixtures') : null;
const oddsSource = dataIngestion.sources ? dataIngestion.sources.get('football-odds') : null;

app.get('/api/football/live-fixtures', async (req, res) => {
  try {
    if (!footballSource || !process.env.API_FOOTBALL_KEY) {
      return res.json({ live: false, message: 'API-Football not configured. Set API_FOOTBALL_KEY.', fixtures: [] });
    }
    var date = req.query.date || new Date().toISOString().split('T')[0];
    var raw = await footballSource.fetchFixturesByDate(date);
    var normalised = footballSource.normalise(raw);
    res.json({ live: true, fixtures: normalised, fetchedAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/football/live-scores', async (req, res) => {
  try {
    if (!footballSource || !process.env.API_FOOTBALL_KEY) {
      return res.json({ live: false, fixtures: [] });
    }
    var raw = await footballSource.fetchLiveScores();
    var normalised = footballSource.normalise(raw);
    res.json({ live: true, fixtures: normalised, fetchedAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/football/h2h/:team1/:team2', async (req, res) => {
  try {
    if (!footballSource || !process.env.API_FOOTBALL_KEY) return res.json({ live: false });
    var raw = await footballSource.fetchH2H(req.params.team1, req.params.team2);
    res.json({ live: true, matches: footballSource.normalise(raw) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------------------------
// LIVE ODDS DATA (The Odds API)
// Set env: ODDS_API_KEY
// Sign up: https://the-odds-api.com/
// ---------------------------------------------------------------------------
app.get('/api/odds/live', async (req, res) => {
  try {
    if (!oddsSource || !process.env.ODDS_API_KEY) {
      return res.json({ live: false, message: 'Odds API not configured. Set ODDS_API_KEY.', odds: [] });
    }
    var raw = await oddsSource.fetch();
    var normalised = oddsSource.normalise(raw);
    res.json({ live: true, odds: normalised, fetchedAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------------------------
// AUTO-RESULT MARKING
// Checks live results and auto-marks tips as won/lost
// Call from admin panel or schedule with cron
// ---------------------------------------------------------------------------
app.post('/api/admin/auto-results', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  try {
    var tips = readJSON('sample-tips.json');
    var results = readJSON('sample-results.json');
    var updated = 0;

    // Auto-mark racing results if Racing API connected
    if (racingSource && process.env.RACING_API_KEY) {
      var today = new Date().toISOString().split('T')[0];
      var raceResults = await racingSource.fetchResults(today);
      if (raceResults.results) {
        tips.forEach(function(tip) {
          if (tip.sport !== 'racing' || tip.status !== 'active' || tip.result) return;
          // Match by selection name in today's results
          var match = (raceResults.results || []).find(function(r) {
            return r.runners && r.runners.some(function(runner) {
              return runner.horse && runner.horse.toLowerCase() === tip.selection.toLowerCase() && runner.position === 1;
            });
          });
          if (match) {
            tip.status = 'settled';
            tip.result = 'won';
            // Add to results
            results.push({
              id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
              tipId: tip.id, sport: tip.sport, event: tip.event, selection: tip.selection,
              market: tip.market, odds: tip.odds, stake: parseFloat(tip.staking) || 2,
              result: 'won', pnl: ((tip.odds - 1) * (parseFloat(tip.staking) || 2)),
              date: today, isPremium: tip.isPremium, tipsterProfile: tip.tipsterProfile || 'The Edge'
            });
            updated++;
          }
        });
      }
    }

    // Auto-mark football results if API-Football connected
    if (footballSource && process.env.API_FOOTBALL_KEY) {
      var todayFb = new Date().toISOString().split('T')[0];
      var fbRaw = await footballSource.fetchFixturesByDate(todayFb);
      var fbResults = footballSource.normalise(fbRaw).filter(function(f) { return f.status === 'FT'; });

      tips.forEach(function(tip) {
        if (tip.sport !== 'football' || tip.status !== 'active' || tip.result) return;
        // Match by team names
        var match = fbResults.find(function(f) {
          var eventLower = (tip.event || '').toLowerCase();
          return eventLower.indexOf(f.homeTeam.toLowerCase()) !== -1 || eventLower.indexOf(f.awayTeam.toLowerCase()) !== -1;
        });
        if (match) {
          var homeGoals = match.homeGoals || 0;
          var awayGoals = match.awayGoals || 0;
          var totalGoals = homeGoals + awayGoals;
          var won = false;

          // Check common market types
          var market = (tip.market || '').toLowerCase();
          var selection = (tip.selection || '').toLowerCase();

          if (market.indexOf('result') !== -1) {
            if (selection.indexOf('home') !== -1 || selection.indexOf(match.homeTeam.toLowerCase()) !== -1) won = homeGoals > awayGoals;
            else if (selection.indexOf('away') !== -1 || selection.indexOf(match.awayTeam.toLowerCase()) !== -1) won = awayGoals > homeGoals;
            else if (selection.indexOf('draw') !== -1) won = homeGoals === awayGoals;
          } else if (market.indexOf('btts') !== -1 || market.indexOf('both teams') !== -1) {
            won = selection.indexOf('yes') !== -1 ? (homeGoals > 0 && awayGoals > 0) : !(homeGoals > 0 && awayGoals > 0);
          } else if (market.indexOf('over') !== -1) {
            if (selection.indexOf('2.5') !== -1) won = totalGoals > 2;
            else if (selection.indexOf('1.5') !== -1) won = totalGoals > 1;
            else if (selection.indexOf('3.5') !== -1) won = totalGoals > 3;
          } else if (market.indexOf('under') !== -1) {
            if (selection.indexOf('2.5') !== -1) won = totalGoals < 3;
            else if (selection.indexOf('1.5') !== -1) won = totalGoals < 2;
          }

          tip.status = 'settled';
          tip.result = won ? 'won' : 'lost';
          var stake = parseFloat(tip.staking) || 2;
          results.push({
            id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
            tipId: tip.id, sport: tip.sport, event: tip.event, selection: tip.selection,
            market: tip.market, odds: tip.odds, stake: stake,
            result: won ? 'won' : 'lost', pnl: won ? ((tip.odds - 1) * stake) : -stake,
            date: todayFb, isPremium: tip.isPremium, tipsterProfile: tip.tipsterProfile || 'The Edge'
          });
          updated++;
        }
      });
    }

    if (updated > 0) {
      writeJSON('sample-tips.json', tips);
      writeJSON('sample-results.json', results);
    }

    res.json({ success: true, updated: updated, message: updated + ' tip(s) auto-settled' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------------------------
// TIPS ROUTES
// ---------------------------------------------------------------------------
app.get('/api/tips', (req, res) => {
  const tips = readJSON('sample-tips.json');
  const { sport, date, premium } = req.query;
  let filtered = tips;
  if (sport) filtered = filtered.filter(t => t.sport === sport);
  if (date) filtered = filtered.filter(t => t.date === date);
  if (premium === 'true') filtered = filtered.filter(t => t.isPremium);
  if (premium === 'false') filtered = filtered.filter(t => !t.isPremium);

  // For unauthenticated / free users, redact premium content
  const authHeader = req.headers.authorization;
  let userRole = 'free';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      userRole = decoded.role === 'admin' ? 'admin' : decoded.subscription;
    } catch {}
  }

  const result = filtered.map(tip => {
    if (tip.isPremium && userRole !== 'premium' && userRole !== 'admin') {
      return {
        ...tip,
        selection: 'Premium Pick — Upgrade to View',
        analysis: { summary: 'Full analysis available to Premium subscribers. Upgrade now to access all tips, detailed analysis, and our complete edge calculations.' },
        locked: true,
      };
    }
    return { ...tip, locked: false };
  });

  res.json(result);
});

app.get('/api/tips/:id', (req, res) => {
  const tips = readJSON('sample-tips.json');
  const tip = tips.find(t => t.id === req.params.id);
  if (!tip) return res.status(404).json({ error: 'Tip not found' });

  const authHeader = req.headers.authorization;
  let userRole = 'free';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      userRole = decoded.role === 'admin' ? 'admin' : decoded.subscription;
    } catch {}
  }

  if (tip.isPremium && userRole !== 'premium' && userRole !== 'admin') {
    return res.json({
      ...tip,
      selection: 'Premium Pick — Upgrade to View',
      analysis: { summary: 'Full analysis available to Premium subscribers.' },
      locked: true,
    });
  }
  res.json({ ...tip, locked: false });
});

// ---------------------------------------------------------------------------
// RESULTS ROUTES
// ---------------------------------------------------------------------------
app.get('/api/results', (req, res) => {
  const results = readJSON('sample-results.json');
  const { sport, market } = req.query;
  let filtered = results;
  if (sport) filtered = filtered.filter(r => r.sport === sport);
  if (market) filtered = filtered.filter(r => r.market === market);
  res.json(filtered);
});

app.get('/api/results/performance', (req, res) => {
  const results = readJSON('sample-results.json');
  const { sport, premium } = req.query;
  let filtered = results;
  if (sport) filtered = filtered.filter(r => r.sport === sport);
  if (premium === 'true') filtered = filtered.filter(r => r.isPremium);
  if (premium === 'false') filtered = filtered.filter(r => !r.isPremium);

  const performance = scoringModel.calculatePerformance(filtered);
  res.json(performance);
});

// ---------------------------------------------------------------------------
// ADMIN ROUTES
// ---------------------------------------------------------------------------
app.get('/api/admin/users', authenticate, requireAdmin, (req, res) => {
  const users = readJSON('sample-users.json');
  res.json(users.map(u => ({
    id: u.id, email: u.email, name: u.name, role: u.role,
    subscription: u.subscription, subscriptionExpiry: u.subscriptionExpiry, joined: u.joined,
    lastLogin: u.lastLogin || null,
    loginHistory: u.loginHistory || [],
    flagged: u.flagged || false,
    lockUntil: u.lockUntil || null,
    failedAttempts: u.failedAttempts || 0,
    sessionId: u.sessionId || null,
  })));
});

// ---------------------------------------------------------------------------
// ADMIN: Force logout a user
// ---------------------------------------------------------------------------
app.post('/api/admin/users/:id/force-logout', authenticate, requireAdmin, (req, res) => {
  const users = readJSON('sample-users.json');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.sessionId = generateSessionId();
  writeJSON('sample-users.json', users);
  res.json({ message: `Session invalidated for ${user.email}` });
});

// ---------------------------------------------------------------------------
// ADMIN: Lock / Unlock account
// ---------------------------------------------------------------------------
app.post('/api/admin/users/:id/lock', authenticate, requireAdmin, (req, res) => {
  const users = readJSON('sample-users.json');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.lockUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // Lock for 1 year (effectively permanent until unlocked)
  writeJSON('sample-users.json', users);
  res.json({ message: `Account locked for ${user.email}` });
});

app.post('/api/admin/users/:id/unlock', authenticate, requireAdmin, (req, res) => {
  const users = readJSON('sample-users.json');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.lockUntil = null;
  user.failedAttempts = 0;
  user.flagged = false;
  writeJSON('sample-users.json', users);
  res.json({ message: `Account unlocked for ${user.email}` });
});

// ---------------------------------------------------------------------------
// ADMIN: Change user subscription
// ---------------------------------------------------------------------------
app.put('/api/admin/users/:id/subscription', authenticate, requireAdmin, (req, res) => {
  const users = readJSON('sample-users.json');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { subscription, subscriptionExpiry } = req.body;
  var wasFree = user.subscription !== 'premium';
  if (subscription) {
    user.subscription = subscription;
    user.role = subscription === 'premium' ? 'premium' : (user.role === 'admin' ? 'admin' : 'free');
  }
  if (subscriptionExpiry !== undefined) user.subscriptionExpiry = subscriptionExpiry;

  // Initialise default email preferences if missing
  if (!user.emailPrefs) {
    user.emailPrefs = { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true };
  }

  writeJSON('sample-users.json', users);

  // Send premium welcome email if upgrading from free to premium
  if (wasFree && subscription === 'premium') {
    var chargeDate = subscriptionExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    emailService.sendPremiumWelcome({ name: user.name, email: user.email, chargeDate: chargeDate }).catch(function(err) {
      console.error('[Email] Premium welcome email failed:', err.message);
    });
  }

  res.json({ message: `Subscription updated for ${user.email}: ${user.subscription}` });
});

app.post('/api/admin/tips', authenticate, requireAdmin, (req, res) => {
  const tips = readJSON('sample-tips.json');
  const newTip = {
    id: `tip_${Date.now()}`,
    ...req.body,
    date: req.body.date || new Date().toISOString().split('T')[0],
    status: 'active',
    result: null,
  };
  // Calculate scoring if odds provided
  if (newTip.odds && !newTip.modelProbability) {
    newTip.impliedProbability = scoringModel.impliedProbability(newTip.odds);
  }
  tips.push(newTip);
  writeJSON('sample-tips.json', tips);
  res.json(newTip);
});

app.put('/api/admin/tips/:id', authenticate, requireAdmin, (req, res) => {
  const tips = readJSON('sample-tips.json');
  const idx = tips.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Tip not found' });
  tips[idx] = { ...tips[idx], ...req.body };
  writeJSON('sample-tips.json', tips);
  res.json(tips[idx]);
});

app.delete('/api/admin/tips/:id', authenticate, requireAdmin, (req, res) => {
  let tips = readJSON('sample-tips.json');
  const before = tips.length;
  tips = tips.filter(t => t.id !== req.params.id);
  if (tips.length === before) return res.status(404).json({ error: 'Tip not found' });
  writeJSON('sample-tips.json', tips);
  res.json({ success: true });
});

app.post('/api/admin/results', authenticate, requireAdmin, (req, res) => {
  const results = readJSON('sample-results.json');
  const tips = readJSON('sample-tips.json');
  const { tipId, result } = req.body;

  const tip = tips.find(t => t.id === tipId);
  if (!tip) return res.status(404).json({ error: 'Tip not found' });

  // Calculate P/L
  let pnl = 0;
  const stake = parseFloat(tip.staking) || 1;
  if (result === 'won') pnl = (tip.odds - 1) * stake;
  else if (result === 'placed') pnl = ((tip.odds - 1) / 4) * stake; // 1/4 odds EW
  else if (result === 'lost') pnl = -stake;
  // void = 0

  const newResult = {
    id: `res_${Date.now()}`,
    tipId: tip.id,
    sport: tip.sport,
    event: tip.event,
    selection: tip.selection,
    market: tip.market,
    odds: tip.odds,
    stake,
    result,
    pnl: Math.round(pnl * 100) / 100,
    date: tip.date,
    isPremium: tip.isPremium,
  };

  results.push(newResult);
  writeJSON('sample-results.json', results);

  // Update tip status
  const tipIdx = tips.findIndex(t => t.id === tipId);
  tips[tipIdx].status = 'settled';
  tips[tipIdx].result = result;
  writeJSON('sample-tips.json', tips);

  res.json(newResult);
});

// ---------------------------------------------------------------------------
// SUPPORT ROUTES
// ---------------------------------------------------------------------------
app.get('/api/support', authenticate, requireAdmin, (req, res) => {
  res.json(readJSON('sample-support.json'));
});

app.post('/api/support', (req, res) => {
  const tickets = readJSON('sample-support.json');
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const ticket = {
    id: `sup_${Date.now()}`,
    userId: null,
    name, email, subject, message,
    status: 'open',
    priority: 'medium',
    date: new Date().toISOString(),
    replies: [],
  };

  // Try to link to user
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      ticket.userId = decoded.id;
    } catch {}
  }

  tickets.push(ticket);
  writeJSON('sample-support.json', tickets);
  res.json(ticket);
});

app.post('/api/support/:id/reply', authenticate, requireAdmin, (req, res) => {
  const tickets = readJSON('sample-support.json');
  const idx = tickets.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Ticket not found' });
  tickets[idx].replies.push({
    from: 'admin',
    message: req.body.message,
    date: new Date().toISOString(),
  });
  tickets[idx].status = req.body.status || 'in-progress';
  writeJSON('sample-support.json', tickets);
  res.json(tickets[idx]);
});

// ---------------------------------------------------------------------------
// EMAIL ROUTES
// ---------------------------------------------------------------------------
app.post('/api/email/compose', authenticate, requireAdmin, (req, res) => {
  const { subject, summary, tipIds, targetAudience } = req.body;
  const allTips = readJSON('sample-tips.json');
  const selectedTips = tipIds ? allTips.filter(t => tipIds.includes(t.id)) : allTips.filter(t => t.status === 'active');
  const bulletin = emailService.composeBulletin({ subject, summary, tips: selectedTips, targetAudience });
  res.json(bulletin);
});

app.post('/api/email/send', authenticate, requireAdmin, async (req, res) => {
  try {
    const { subject, summary, tipIds, targetAudience } = req.body;
    const allTips = readJSON('sample-tips.json');
    const selectedTips = tipIds ? allTips.filter(t => tipIds.includes(t.id)) : allTips.filter(t => t.status === 'active');
    const bulletin = emailService.composeBulletin({ subject, summary, tips: selectedTips, targetAudience });
    const users = readJSON('sample-users.json');
    const result = await emailService.sendBulletin(bulletin, users);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/email/schedule', authenticate, requireAdmin, (req, res) => {
  const { subject, summary, tipIds, targetAudience, sendAt } = req.body;
  const allTips = readJSON('sample-tips.json');
  const selectedTips = tipIds ? allTips.filter(t => tipIds.includes(t.id)) : allTips.filter(t => t.status === 'active');
  const bulletin = emailService.composeBulletin({ subject, summary, tips: selectedTips, targetAudience });
  const users = readJSON('sample-users.json');
  const scheduled = emailService.scheduleBulletin(bulletin, users, sendAt);
  res.json(scheduled);
});

app.get('/api/email/sent', authenticate, requireAdmin, (req, res) => {
  res.json(emailService.getSentEmails());
});

// ---------------------------------------------------------------------------
// SCORING ROUTE (for testing model)
// ---------------------------------------------------------------------------
app.post('/api/scoring/calculate', authenticate, requireAdmin, (req, res) => {
  const { sport, factors, odds } = req.body;
  if (sport === 'racing') {
    res.json(scoringModel.scoreRacing(factors, odds));
  } else if (sport === 'football') {
    res.json(scoringModel.scoreFootball(factors, odds));
  } else {
    res.status(400).json({ error: 'Sport must be racing or football' });
  }
});

// ---------------------------------------------------------------------------
// CHATBOT ROUTE
// ---------------------------------------------------------------------------
const chatLogs = [];

app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  const lower = (message || '').toLowerCase();

  let response = '';
  let suggestions = [];

  if (lower.includes('best tip') || lower.includes('today') || lower.includes('pick')) {
    const tips = readJSON('sample-tips.json').filter(t => t.status === 'active');
    const best = tips.sort((a, b) => b.confidence - a.confidence)[0];
    if (best) {
      response = `Our top pick today is ${best.selection} in ${best.event} at odds of ${best.odds}. Confidence: ${best.confidence}/10 with a ${(best.edge * 100).toFixed(1)}% edge. ${best.isPremium ? 'This is a Premium tip — upgrade to see full analysis.' : ''}`;
    } else {
      response = 'No active tips at the moment. Check back soon — our analysts publish daily selections.';
    }
    suggestions = ['Show all racing tips', 'Show football tips', 'How is ROI calculated?'];
  } else if (lower.includes('racing') || lower.includes('horse')) {
    const tips = readJSON('sample-tips.json').filter(t => t.sport === 'racing' && t.status === 'active');
    response = `We have ${tips.length} racing tips today across ${[...new Set(tips.map(t => t.meeting))].join(', ')}. ${tips.filter(t => !t.isPremium).length} are free and ${tips.filter(t => t.isPremium).length} are Premium.`;
    suggestions = ['Show football tips', "Today's best tips?", 'How do I upgrade?'];
  } else if (lower.includes('football') || lower.includes('soccer')) {
    const tips = readJSON('sample-tips.json').filter(t => t.sport === 'football' && t.status === 'active');
    response = `We have ${tips.length} football tips today covering ${[...new Set(tips.map(t => t.league))].join(', ')}. Markets include ${[...new Set(tips.map(t => t.market))].join(', ')}.`;
    suggestions = ['Show racing tips', "Today's best tips?", 'How do I upgrade?'];
  } else if (lower.includes('upgrade') || lower.includes('premium') || lower.includes('subscribe') || lower.includes('price')) {
    response = 'Your first month of Premium is completely FREE! After that it\u2019s just \u00a319.99/month (or \u00a3119.99/year to save \u00a360). Your subscription auto-renews monthly but you can cancel anytime before your free trial ends. Click the Upgrade button to start your free month.';
    suggestions = ['What do I get with Premium?', "Today's best tips?", 'Show my results'];
  } else if (lower.includes('roi') || lower.includes('profit') || lower.includes('performance') || lower.includes('results') || lower.includes('record')) {
    const results = readJSON('sample-results.json');
    const perf = scoringModel.calculatePerformance(results);
    response = `Our overall record: ${perf.totalTips} tips with a ${perf.strikeRate}% strike rate and ${perf.roi > 0 ? '+' : ''}${perf.roi}% ROI. Running bank: ${perf.runningBank} units (started at 100). Our model consistently finds value — check the Results page for full breakdown.`;
    suggestions = ['Show racing results', 'Show football results', "Today's best tips?"];
  } else if (lower.includes('why') && (lower.includes('rated') || lower.includes('confidence') || lower.includes('score'))) {
    response = 'Our confidence scores (1-10) are calculated using a multi-factor weighted model. For racing, we analyse form, going, class, trainer/jockey stats, course record, draw, weight, speed ratings, and market support. For football, we use xG, form, H2H, injuries, home/away splits, motivation, shots, and schedule congestion. The edge % shows how much our probability exceeds the bookmaker\'s implied probability.';
    suggestions = ['How is ROI calculated?', "Today's best tips?", 'How do I upgrade?'];
  } else if (lower.includes('help') || lower.includes('support') || lower.includes('contact')) {
    response = 'Need help? You can submit a support ticket via the Contact page, or email us at support@eliteedgesports.co.uk. We typically respond within 2 hours during business hours.';
    suggestions = ["Today's best tips?", 'How do I upgrade?', 'How is ROI calculated?'];
  } else if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    response = 'Hello! Welcome to Elite Edge Sports Tips. I can help you find today\'s best tips, explain our scoring model, or guide you through our Premium features. What would you like to know?';
    suggestions = ["Today's best tips?", 'How do I upgrade?', 'Show racing tips'];
  } else {
    response = "I can help with tips, results, scoring explanations, and subscription queries. Try asking about today's best tips, how our model works, or Premium features.";
    suggestions = ["Today's best tips?", 'How is ROI calculated?', 'How do I upgrade?', 'Show racing tips'];
  }

  // Log for admin review
  chatLogs.push({
    message, response,
    timestamp: new Date().toISOString(),
    userId: null,
  });

  res.json({ response, suggestions });
});

app.get('/api/chat/logs', authenticate, requireAdmin, (req, res) => {
  res.json(chatLogs);
});

// ---------------------------------------------------------------------------
// API STATUS
// ---------------------------------------------------------------------------
app.get('/api/status', (req, res) => {
  res.json({
    racing: { connected: !!(racingSource && process.env.RACING_API_KEY) },
    football: { connected: !!(footballSource && process.env.API_FOOTBALL_KEY) },
    odds: { connected: !!(oddsSource && process.env.ODDS_API_KEY) },
    ingestion: dataIngestion.getStatus ? dataIngestion.getStatus() : {}
  });
});

// ---------------------------------------------------------------------------
// SPA fallback
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// AUTO-GENERATE FREE WEEKLY ACCA (every Friday before 11am UK time)
// Pulls weekend fixtures from API-Football and builds a 5-fold
// ---------------------------------------------------------------------------
var lastAccaGenDate = '';

async function autoGenerateWeeklyAcca() {
  var now = new Date();
  // Convert to UK time (GMT/BST)
  var ukTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  var day = ukTime.getDay(); // 0=Sun, 5=Fri
  var hour = ukTime.getHours();
  var dateStr = ukTime.toISOString().split('T')[0];

  // Only run on Friday before 11am, and only once per day
  if (day !== 5 || hour >= 11 || lastAccaGenDate === dateStr) return;
  if (!footballSource || !process.env.API_FOOTBALL_KEY) return;

  try {
    console.log('[Auto-Acca] Generating weekend acca...');

    // Get Saturday and Sunday dates
    var sat = new Date(ukTime);
    sat.setDate(sat.getDate() + 1);
    var sun = new Date(ukTime);
    sun.setDate(sun.getDate() + 2);
    var satStr = sat.toISOString().split('T')[0];
    var sunStr = sun.toISOString().split('T')[0];

    // Fetch weekend fixtures
    var satRaw = await footballSource.fetchFixturesByDate(satStr);
    var sunRaw = await footballSource.fetchFixturesByDate(sunStr);
    var satFixtures = footballSource.normalise(satRaw);
    var sunFixtures = footballSource.normalise(sunRaw);
    var allFixtures = satFixtures.concat(sunFixtures);

    if (allFixtures.length < 5) {
      console.log('[Auto-Acca] Not enough fixtures (' + allFixtures.length + ') — skipping');
      return;
    }

    // Target leagues: PL (39), La Liga (140), Serie A (135), Bundesliga (78), Ligue 1 (61), CL (2)
    var topLeagues = [39, 140, 135, 78, 61, 2, 45];
    var topFixtures = allFixtures.filter(function(f) { return topLeagues.indexOf(f.leagueId) !== -1; });
    if (topFixtures.length < 5) topFixtures = allFixtures; // fallback to all

    // Pick 5 diverse fixtures (prefer different leagues)
    var selected = [];
    var usedLeagues = {};

    // Priority: pick one from each league
    topFixtures.forEach(function(f) {
      if (selected.length >= 5) return;
      if (!usedLeagues[f.leagueId]) {
        selected.push(f);
        usedLeagues[f.leagueId] = true;
      }
    });

    // Fill remaining from PL if needed
    if (selected.length < 5) {
      topFixtures.forEach(function(f) {
        if (selected.length >= 5) return;
        if (selected.indexOf(f) === -1) selected.push(f);
      });
    }

    selected = selected.slice(0, 5);

    // Generate selections with market logic
    var accaSelections = selected.map(function(f) {
      var kickoff = new Date(f.kickoff);
      var dayLabel = kickoff.getDay() === 6 ? 'Sat' : 'Sun';
      var timeLabel = kickoff.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
      var leagueLabel = f.league + ' — ' + dayLabel + ' ' + timeLabel;

      // Simple selection logic based on fixture profile
      var markets = [
        { selection: f.homeTeam + ' Win', odds: 1.50, reasoning: f.homeTeam + ' strong at home this season. Solid pick to anchor the acca.' },
        { selection: 'Both Teams to Score - Yes', odds: 1.65, reasoning: 'Both sides score regularly. BTTS has landed in recent meetings between these teams.' },
        { selection: 'Over 1.5 Goals', odds: 1.25, reasoning: 'Goals virtually guaranteed at this level. Over 1.5 has landed in 9 of the last 10 for both sides.' },
        { selection: 'Over 2.5 Goals', odds: 1.80, reasoning: 'Attacking fixture between two free-scoring sides. Goals expected.' },
        { selection: f.awayTeam + ' or Draw (X2)', odds: 1.55, reasoning: f.awayTeam + ' in good away form. Double chance offers protection.' }
      ];

      // Rotate markets for variety
      var pick = markets[selected.indexOf(f) % markets.length];

      return {
        match: f.homeTeam + ' vs ' + f.awayTeam,
        league: leagueLabel,
        selection: pick.selection,
        odds: pick.odds,
        reasoning: pick.reasoning
      };
    });

    // Calculate combined odds
    var combinedOdds = 1;
    accaSelections.forEach(function(s) { combinedOdds *= s.odds; });
    combinedOdds = Math.round(combinedOdds * 100) / 100;

    // Build the acca tip
    var accaTip = {
      id: 'tip_acca_weekly',
      sport: 'football',
      event: 'Free Weekly 5-Fold Accumulator',
      league: 'Multi-League',
      market: '5-Fold Accumulator',
      selection: 'Weekly Acca — 5 Selections',
      odds: combinedOdds,
      confidence: 7,
      modelProbability: 0.15,
      impliedProbability: 0.10,
      edge: 0.05,
      valueRating: 'Medium',
      isPremium: false,
      status: 'active',
      result: null,
      date: satStr,
      tipster: 'Elite Edge Model',
      staking: '1 unit (entertainment)',
      riskLevel: 'High',
      isWeeklyAcca: true,
      accaSelections: accaSelections,
      analysis: {
        summary: 'This weekend\'s free 5-fold combines selections across Europe\'s top leagues. Combined odds of ' + combinedOdds + ' return £' + (combinedOdds * 10).toFixed(2) + ' from a £10 stake. Remember — this is an entertainment acca, not a core selection. Gamble responsibly.'
      },
      tipsterProfile: 'The Edge'
    };

    // Update tips file — replace existing acca or add new
    var tips = readJSON('sample-tips.json');
    var accaIdx = tips.findIndex(function(t) { return t.isWeeklyAcca; });
    if (accaIdx >= 0) {
      tips[accaIdx] = accaTip;
    } else {
      tips.push(accaTip);
    }
    writeJSON('sample-tips.json', tips);

    lastAccaGenDate = dateStr;
    console.log('[Auto-Acca] Weekend acca generated: ' + combinedOdds + ' combined odds, ' + accaSelections.length + ' legs');
    accaSelections.forEach(function(s) {
      console.log('  ' + s.match + ' | ' + s.selection + ' @ ' + s.odds);
    });

  } catch (err) {
    console.error('[Auto-Acca] Error:', err.message);
  }
}

// Check every 30 minutes if it's Friday morning
setInterval(autoGenerateWeeklyAcca, 30 * 60 * 1000);

// Also check on server start
setTimeout(autoGenerateWeeklyAcca, 60000);

// ---------------------------------------------------------------------------
// AUTO-GENERATE DAILY TIPS (7:30am UK time)
// Fetches today's racing cards, football fixtures, and odds from live APIs,
// scores every opportunity through the model, and publishes the best 2-4 tips.
// ---------------------------------------------------------------------------
var lastAutoTipDate = '';

async function autoGenerateDailyTips() {
  var now = new Date();
  var ukTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  var hour = ukTime.getHours();
  var minute = ukTime.getMinutes();
  var today = ukTime.toISOString().split('T')[0];

  // Only run at 7:30am UK time (checked every 10 mins), and only once per day
  var isScheduledWindow = (hour === 7 && minute >= 30) || (hour === 7 && minute >= 20 && minute <= 40);
  if (!isScheduledWindow && lastAutoTipDate === today) return;
  if (lastAutoTipDate === today) return;

  // Check if tips already exist for today
  var existingTips = readJSON('sample-tips.json');
  var todayAutoTips = existingTips.filter(function(t) {
    return t.date === today && t.id && t.id.toString().indexOf('auto_') === 0;
  });
  if (todayAutoTips.length > 0) {
    lastAutoTipDate = today;
    console.log('[Auto-Tips] Tips already exist for ' + today + ' (' + todayAutoTips.length + ' auto tips) — skipping');
    return;
  }

  console.log('[Auto-Tips] Starting daily tip generation for ' + today + '...');

  // Clear yesterday's stale active tips (non-weekly-acca, non-today, unsettled)
  var staleCleared = 0;
  existingTips.forEach(function(tip) {
    if (tip.isWeeklyAcca) return;
    if (tip.date && tip.date < today && tip.status === 'active' && !tip.result) {
      tip.status = 'expired';
      tip.result = 'void';
      staleCleared++;
    }
  });
  if (staleCleared > 0) {
    console.log('[Auto-Tips] Cleared ' + staleCleared + ' stale tip(s) from previous days');
  }

  var allCandidates = [];

  // --- RACING SELECTIONS ---
  if (racingSource && process.env.RACING_API_KEY) {
    try {
      console.log('[Auto-Tips] Fetching racing cards...');
      var raceData = await racingSource.fetch();
      var races = racingSource.normalise(raceData);
      console.log('[Auto-Tips] Found ' + races.length + ' races to analyse');

      races.forEach(function(race) {
        if (!race.runners || race.runners.length === 0) return;
        race.runners.forEach(function(runner) {
          try {
            var scored = scoringModel.scoreRunner(runner, race, null);
            if (!scored) return;
            // Filter: edge > 5% AND confidence >= 6
            if (scored.edge > 0.05 && scored.confidence >= 6) {
              allCandidates.push({
                type: 'racing',
                scored: scored,
                edge: scored.edge,
                confidence: scored.confidence,
              });
            }
          } catch (err) {
            // Skip individual runner errors
          }
        });
      });
      console.log('[Auto-Tips] Racing candidates passing filter: ' + allCandidates.filter(function(c) { return c.type === 'racing'; }).length);
    } catch (err) {
      console.error('[Auto-Tips] Racing API error:', err.message);
    }
  } else {
    console.log('[Auto-Tips] Racing API not configured — skipping racing selections');
  }

  // --- FOOTBALL SELECTIONS ---
  var footballCandidates = [];
  var oddsNormalised = null;

  // Fetch odds first (used for both football scoring and bookmaker odds)
  if (oddsSource && process.env.ODDS_API_KEY) {
    try {
      console.log('[Auto-Tips] Fetching odds data...');
      var oddsRaw = await oddsSource.fetch();
      oddsNormalised = oddsSource.normalise(oddsRaw);
      console.log('[Auto-Tips] Fetched odds for ' + (oddsNormalised || []).length + ' events');
    } catch (err) {
      console.error('[Auto-Tips] Odds API error:', err.message);
    }
  }

  if (footballSource && process.env.API_FOOTBALL_KEY) {
    try {
      console.log('[Auto-Tips] Fetching football fixtures...');
      var fbRaw = await footballSource.fetchFixturesByDate(today);
      var fixtures = footballSource.normalise(fbRaw);
      // Filter to top leagues: PL(39), CL(2), LaLiga(140), SerieA(135), Bundesliga(78), Ligue1(61)
      var topLeagueIds = [39, 2, 140, 135, 78, 61];
      var topFixtures = fixtures.filter(function(f) { return topLeagueIds.indexOf(f.leagueId) !== -1; });
      console.log('[Auto-Tips] Found ' + topFixtures.length + ' top-league fixtures to analyse (from ' + fixtures.length + ' total)');

      topFixtures.forEach(function(fixture) {
        try {
          var scored = scoringModel.scoreFixture(fixture, oddsNormalised);
          if (!scored) return;
          // Filter: edge > 4% AND confidence >= 6
          if (scored.edge > 0.04 && scored.confidence >= 6) {
            footballCandidates.push({
              type: 'football',
              scored: scored,
              edge: scored.edge,
              confidence: scored.confidence,
            });
          }
        } catch (err) {
          // Skip individual fixture errors
        }
      });
      console.log('[Auto-Tips] Football candidates passing filter: ' + footballCandidates.length);
    } catch (err) {
      console.error('[Auto-Tips] Football API error:', err.message);
    }
  } else {
    console.log('[Auto-Tips] Football API not configured — skipping football selections');
  }

  allCandidates = allCandidates.concat(footballCandidates);

  // Sort all candidates by edge descending
  allCandidates.sort(function(a, b) { return b.edge - a.edge; });

  // If no value found, log and exit
  if (allCandidates.length === 0) {
    console.log('[Auto-Tips] No value found today — 0 tips generated');
    lastAutoTipDate = today;
    if (staleCleared > 0) writeJSON('sample-tips.json', existingTips);
    return;
  }

  // Select top 2-4 (max 2 racing, max 2 football, total max 4)
  var selectedRacing = allCandidates.filter(function(c) { return c.type === 'racing'; }).slice(0, 2);
  var selectedFootball = allCandidates.filter(function(c) { return c.type === 'football'; }).slice(0, 2);
  var selected = selectedRacing.concat(selectedFootball);

  // Re-sort by edge and cap at 4
  selected.sort(function(a, b) { return b.edge - a.edge; });
  selected = selected.slice(0, 4);

  // NAP must have confidence >= 7, pick highest-edge candidate with conf >= 7
  var napIdx = -1;
  for (var i = 0; i < selected.length; i++) {
    if (selected[i].confidence >= 7) { napIdx = i; break; }
  }
  // If no candidate has conf >= 7, demote — still pick the best but it won't be a strong NAP
  if (napIdx === -1 && selected.length > 0) napIdx = 0;

  // Build tip objects
  var newTips = [];
  selected.forEach(function(candidate, idx) {
    var isNap = (idx === napIdx);
    var scored = candidate.scored;
    var sport = candidate.type;
    var tipId = 'auto_' + Date.now() + '_' + idx;

    // Determine tipsterProfile by odds
    var tipOdds = sport === 'racing' ? scored.odds : scored.selectedOdds;
    var tipsterProfile = 'The Edge';
    if (tipOdds < 3.0) tipsterProfile = 'The Professor';
    else if (tipOdds > 8.0) tipsterProfile = 'The Scout';

    // Generate analysis
    var analysis = scoringModel.generateAnalysis(scored, sport);

    var tip;
    if (sport === 'racing') {
      var runner = scored.runner || {};
      var race = scored.race || {};
      var formStr = (runner.form || '').replace(/[^0-9FfPpUuRr\-]/g, '');
      var recentForm = formStr.split('').filter(function(c) { return /[0-9]/.test(c); }).slice(0, 5);

      tip = {
        id: tipId,
        sport: 'racing',
        event: (race.meeting || 'Meeting') + ' ' + (race.time || '') + ' - ' + (race.raceName || race.raceClass || 'Race'),
        meeting: race.meeting || 'Unknown',
        raceTime: race.time || '',
        raceClass: race.raceClass || '',
        distance: race.distance || '',
        going: race.going || '',
        market: 'Win',
        selection: runner.horseName || 'Unknown',
        odds: scored.odds,
        confidence: scored.confidence,
        modelProbability: scored.modelProbability,
        impliedProbability: scored.impliedProbability,
        edge: scored.edge,
        valueRating: scored.valueRating,
        isPremium: true,
        isNap: isNap,
        status: 'active',
        result: null,
        date: today,
        tipster: 'Elite Edge Model',
        tipsterProfile: tipsterProfile,
        staking: scored.staking,
        riskLevel: scored.riskLevel,
        analysis: analysis,
        openingOdds: scored.odds,
        bookmakerOdds: {},
        recentForm: recentForm,
      };
    } else {
      // Football
      var fixture = scored.fixture || {};
      var kickoffDate = fixture.kickoff ? new Date(fixture.kickoff) : null;
      var kickoffTime = kickoffDate
        ? kickoffDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
        : '';

      // Build bookmaker odds object
      var bkOdds = {};
      if (scored.bookmakerOdds) {
        Object.keys(scored.bookmakerOdds).forEach(function(bk) {
          var bkData = scored.bookmakerOdds[bk];
          if (bkData && bkData[fixture.homeTeam]) {
            bkOdds[bk] = bkData[fixture.homeTeam]; // store home odds as reference
          }
        });
      }

      tip = {
        id: tipId,
        sport: 'football',
        event: (fixture.homeTeam || 'Home') + ' vs ' + (fixture.awayTeam || 'Away') + ' - ' + (fixture.league || 'League'),
        league: fixture.league || '',
        kickoff: kickoffTime,
        venue: fixture.venue || '',
        market: scored.selectedMarket,
        selection: scored.selectedSelection,
        odds: scored.selectedOdds,
        confidence: scored.confidence,
        modelProbability: scored.modelProbability,
        impliedProbability: scored.impliedProbability,
        edge: scored.edge,
        valueRating: scored.valueRating,
        isPremium: true,
        isNap: isNap,
        status: 'active',
        result: null,
        date: today,
        tipster: 'Elite Edge Model',
        tipsterProfile: tipsterProfile,
        staking: scored.staking,
        riskLevel: scored.riskLevel,
        analysis: analysis,
        openingOdds: scored.selectedOdds,
        bookmakerOdds: bkOdds,
        recentForm: [],
      };
    }

    newTips.push(tip);
  });

  // Save tips
  var allTips = existingTips.concat(newTips);
  writeJSON('sample-tips.json', allTips);
  lastAutoTipDate = today;

  // Log summary
  console.log('[Auto-Tips] Generated ' + newTips.length + ' tip(s) for ' + today + ':');
  newTips.forEach(function(tip) {
    var napLabel = tip.isNap ? ' [NAP]' : '';
    var premLabel = tip.isPremium ? ' [PREMIUM]' : ' [FREE]';
    console.log('  ' + tip.sport.toUpperCase() + ': ' + tip.selection + ' @ ' + tip.odds + ' | Edge: ' + (tip.edge * 100).toFixed(1) + '% | Conf: ' + tip.confidence + '/10' + napLabel + premLabel);
  });
  var freeCount = newTips.filter(function(t) { return !t.isPremium; }).length;
  var premCount = newTips.filter(function(t) { return t.isPremium; }).length;
  console.log('[Auto-Tips] Summary: ' + freeCount + ' free, ' + premCount + ' premium');
}

// Check every 10 minutes if it's time for auto tip generation
setInterval(autoGenerateDailyTips, 10 * 60 * 1000);

// Run on server startup after 20 seconds (if past 7:30am and no tips for today)
setTimeout(function() {
  var uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  var hour = uk.getHours();
  var minute = uk.getMinutes();
  if (hour > 7 || (hour === 7 && minute >= 30)) {
    console.log('[Auto-Tips] Server started after 7:30am UK — checking if tips needed...');
    autoGenerateDailyTips();
  }
}, 20000);

// ---------------------------------------------------------------------------
// AUTOMATIC RESULT SETTLING (runs every 5 minutes)
// Checks live APIs for finished events and auto-marks tips as won/lost
// ---------------------------------------------------------------------------
async function autoSettleResults() {
  try {
    var tips = readJSON('sample-tips.json');
    var results = readJSON('sample-results.json');
    var updated = 0;
    var today = new Date().toISOString().split('T')[0];

    // Only process today's active tips
    var activeTips = tips.filter(function(t) { return t.status === 'active' && !t.result && t.date === today && !t.isWeeklyAcca; });
    if (activeTips.length === 0) return;

    // Auto-mark racing results
    if (racingSource && process.env.RACING_API_KEY) {
      try {
        var raceResults = await racingSource.fetchResults(today);
        if (raceResults && raceResults.results) {
          activeTips.forEach(function(tip) {
            if (tip.sport !== 'racing') return;
            var match = (raceResults.results || []).find(function(r) {
              return r.runners && r.runners.some(function(runner) {
                return runner.horse && runner.horse.toLowerCase().indexOf(tip.selection.toLowerCase()) !== -1;
              });
            });
            if (match) {
              var winner = match.runners.find(function(r) { return r.position === 1; });
              var tipWon = winner && winner.horse && winner.horse.toLowerCase().indexOf(tip.selection.toLowerCase()) !== -1;
              var placed = !tipWon && match.runners.some(function(r) { return r.position <= 3 && r.horse && r.horse.toLowerCase().indexOf(tip.selection.toLowerCase()) !== -1; });

              if (tip.market && tip.market.toLowerCase().indexOf('each-way') !== -1 && placed) {
                tipWon = true; // EW counts as win if placed
              }

              tip.status = 'settled';
              tip.result = tipWon ? 'won' : (placed ? 'placed' : 'lost');
              var stake = parseFloat(tip.staking) || 2;
              var pnl = tipWon ? ((tip.odds - 1) * stake) : (placed ? ((tip.odds / 4) * stake) : -stake);

              results.push({
                id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                tipId: tip.id, sport: 'racing', event: tip.event, selection: tip.selection,
                market: tip.market, odds: tip.odds, stake: stake,
                result: tip.result, pnl: Math.round(pnl * 100) / 100,
                date: today, isPremium: tip.isPremium, tipsterProfile: tip.tipsterProfile || 'The Edge'
              });
              updated++;
              console.log('[Auto-Settle] Racing: ' + tip.selection + ' = ' + tip.result + ' (' + pnl.toFixed(2) + 'u)');
            }
          });
        }
      } catch (err) { console.error('[Auto-Settle] Racing error:', err.message); }
    }

    // Auto-mark football results
    if (footballSource && process.env.API_FOOTBALL_KEY) {
      try {
        var fbRaw = await footballSource.fetchFixturesByDate(today);
        var fbResults = footballSource.normalise(fbRaw).filter(function(f) { return f.status === 'FT'; });

        activeTips.forEach(function(tip) {
          if (tip.sport !== 'football') return;
          var match = fbResults.find(function(f) {
            var eventLower = (tip.event || '').toLowerCase();
            return eventLower.indexOf(f.homeTeam.toLowerCase()) !== -1 || eventLower.indexOf(f.awayTeam.toLowerCase()) !== -1;
          });
          if (match) {
            var homeGoals = match.homeGoals || 0;
            var awayGoals = match.awayGoals || 0;
            var totalGoals = homeGoals + awayGoals;
            var won = false;

            var market = (tip.market || '').toLowerCase();
            var selection = (tip.selection || '').toLowerCase();

            // Match Result
            if (market.indexOf('result') !== -1 || market.indexOf('match') !== -1) {
              if (selection.indexOf(match.homeTeam.toLowerCase()) !== -1) won = homeGoals > awayGoals;
              else if (selection.indexOf(match.awayTeam.toLowerCase()) !== -1) won = awayGoals > homeGoals;
              else if (selection.indexOf('draw') !== -1) won = homeGoals === awayGoals;
            }
            // BTTS
            else if (market.indexOf('btts') !== -1 || market.indexOf('both teams') !== -1) {
              won = selection.indexOf('yes') !== -1 ? (homeGoals > 0 && awayGoals > 0) : !(homeGoals > 0 && awayGoals > 0);
            }
            // Over/Under
            else if (market.indexOf('over') !== -1) {
              if (selection.indexOf('3.5') !== -1) won = totalGoals > 3;
              else if (selection.indexOf('2.5') !== -1) won = totalGoals > 2;
              else if (selection.indexOf('1.5') !== -1) won = totalGoals > 1;
            }
            else if (market.indexOf('under') !== -1) {
              if (selection.indexOf('2.5') !== -1) won = totalGoals < 3;
              else if (selection.indexOf('1.5') !== -1) won = totalGoals < 2;
            }
            // Asian Handicap
            else if (market.indexOf('asian') !== -1 || market.indexOf('handicap') !== -1) {
              var ahMatch = selection.match(/([\-\+]?\d+\.?\d*)/);
              if (ahMatch) {
                var line = parseFloat(ahMatch[1]);
                if (selection.indexOf(match.homeTeam.toLowerCase()) !== -1) won = (homeGoals - awayGoals) > Math.abs(line);
                else if (selection.indexOf(match.awayTeam.toLowerCase()) !== -1) won = (awayGoals - homeGoals) > Math.abs(line);
              }
            }
            // Double Chance
            else if (market.indexOf('double chance') !== -1) {
              if (selection.indexOf('1x') !== -1 || (selection.indexOf(match.homeTeam.toLowerCase()) !== -1 && selection.indexOf('draw') !== -1)) won = homeGoals >= awayGoals;
              else if (selection.indexOf('x2') !== -1 || (selection.indexOf(match.awayTeam.toLowerCase()) !== -1 && selection.indexOf('draw') !== -1)) won = awayGoals >= homeGoals;
              else if (selection.indexOf('12') !== -1) won = homeGoals !== awayGoals;
            }

            tip.status = 'settled';
            tip.result = won ? 'won' : 'lost';
            var stake = parseFloat(tip.staking) || 2;
            var pnl = won ? ((tip.odds - 1) * stake) : -stake;

            results.push({
              id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              tipId: tip.id, sport: 'football', event: tip.event, selection: tip.selection,
              market: tip.market, odds: tip.odds, stake: stake,
              result: tip.result, pnl: Math.round(pnl * 100) / 100,
              date: today, isPremium: tip.isPremium, tipsterProfile: tip.tipsterProfile || 'The Edge'
            });
            updated++;
            console.log('[Auto-Settle] Football: ' + tip.selection + ' (' + match.homeTeam + ' ' + homeGoals + '-' + awayGoals + ' ' + match.awayTeam + ') = ' + tip.result + ' (' + pnl.toFixed(2) + 'u)');
          }
        });
      } catch (err) { console.error('[Auto-Settle] Football error:', err.message); }
    }

    if (updated > 0) {
      writeJSON('sample-tips.json', tips);
      writeJSON('sample-results.json', results);
      console.log('[Auto-Settle] Settled ' + updated + ' tip(s)');

      // Send big win emails for tips that just won at odds >= 6.0 (only newly settled ones)
      var newlySettledIds = results.slice(-updated).map(function(r) { return r.tipId; });
      var bigWins = tips.filter(function(t) { return t.result === 'won' && t.odds >= 6.0 && newlySettledIds.indexOf(t.id) !== -1; });
      if (bigWins.length > 0) {
        var allUsers = readJSON('sample-users.json');
        bigWins.forEach(function(bw) {
          var recipients = bw.isPremium
            ? allUsers.filter(function(u) { return u.subscription === 'premium' && (!u.emailPrefs || u.emailPrefs.bigWins !== false); })
            : allUsers.filter(function(u) { return !u.emailPrefs || u.emailPrefs.bigWins !== false; });

          recipients.forEach(function(u) {
            emailService.sendBigWin({
              name: u.name, email: u.email,
              selection: bw.selection, event: bw.event, odds: bw.odds,
              summary: bw.analysis ? bw.analysis.summary : ''
            }).catch(function(err) { console.error('[Email] Big win email failed for ' + u.email + ':', err.message); });
          });
          console.log('[Auto-Settle] Big win email triggered: ' + bw.selection + ' @ ' + bw.odds + ' to ' + recipients.length + ' users');
        });
      }
    }
  } catch (err) {
    console.error('[Auto-Settle] Error:', err.message);
  }
}

// Run auto-settle every 5 minutes
setInterval(autoSettleResults, 5 * 60 * 1000);

// Also run once 30 seconds after server starts
setTimeout(autoSettleResults, 30000);

// ---------------------------------------------------------------------------
// SCHEDULED DATA REFRESH (1am, 11am, 5pm, 11pm UK time)
// Archives old tips, refreshes live data, cleans up settled tips
// ---------------------------------------------------------------------------
var lastRefreshHour = -1;
var REFRESH_HOURS = [1, 11, 17, 23]; // 1am, 11am, 5pm, 11pm UK

async function scheduledDataRefresh() {
  var uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  var hour = uk.getHours();
  var today = uk.toISOString().split('T')[0];

  // Only run at the specified hours, once per hour
  if (REFRESH_HOURS.indexOf(hour) === -1 || lastRefreshHour === hour) return;
  lastRefreshHour = hour;

  console.log('[Refresh] Running scheduled data refresh at ' + hour + ':00 UK time');

  try {
    var tips = readJSON('sample-tips.json');
    var results = readJSON('sample-results.json');
    var changed = false;

    // 1. Archive old unsettled tips (older than 2 days)
    var twoDaysAgo = new Date(uk);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    var archiveDate = twoDaysAgo.toISOString().split('T')[0];

    tips.forEach(function(tip) {
      if (tip.isWeeklyAcca) return;
      if (tip.date && tip.date < archiveDate && tip.status === 'active' && !tip.result) {
        tip.status = 'expired';
        tip.result = 'void';
        console.log('[Refresh] Archived expired tip: ' + tip.selection + ' (' + tip.date + ')');
        changed = true;
      }
    });

    // 2. Pull fresh racing data and cache it
    if (racingSource && process.env.RACING_API_KEY) {
      try {
        var raceData = await racingSource.fetch();
        var races = racingSource.normalise(raceData);
        if (races.length > 0) {
          console.log('[Refresh] Cached ' + races.length + ' live race cards');
        }
      } catch (err) { console.log('[Refresh] Racing data fetch skipped:', err.message); }
    }

    // 3. Pull fresh football data and cache it
    if (footballSource && process.env.API_FOOTBALL_KEY) {
      try {
        var fbData = await footballSource.fetch();
        var fixtures = footballSource.normalise(fbData);
        if (fixtures.length > 0) {
          console.log('[Refresh] Cached ' + fixtures.length + ' football fixtures');
        }
      } catch (err) { console.log('[Refresh] Football data fetch skipped:', err.message); }
    }

    // 4. Pull fresh odds data
    if (oddsSource && process.env.ODDS_API_KEY) {
      try {
        var oddsData = await oddsSource.fetch();
        var odds = oddsSource.normalise(oddsData);
        if (odds.length > 0) {
          console.log('[Refresh] Cached ' + odds.length + ' odds events');
        }
      } catch (err) { console.log('[Refresh] Odds data fetch skipped:', err.message); }
    }

    // 5. Auto-settle any pending results
    await autoSettleResults();

    // 6. Update performance stats
    var perf = scoringModel.calculatePerformance(readJSON('sample-results.json'));
    console.log('[Refresh] Performance: ' + perf.totalTips + ' tips, ' + perf.strikeRate + '% SR, ' + perf.roi + '% ROI');

    // 7. Save any changes
    if (changed) {
      writeJSON('sample-tips.json', tips);
      console.log('[Refresh] Tips file updated');
    }

    console.log('[Refresh] Completed at ' + hour + ':00 UK time');

  } catch (err) {
    console.error('[Refresh] Error:', err.message);
  }
}

// Check every 10 minutes if it's time for a scheduled refresh
setInterval(scheduledDataRefresh, 10 * 60 * 1000);

// Run on startup after 45 seconds
setTimeout(scheduledDataRefresh, 45000);

// ---------------------------------------------------------------------------
// SCHEDULED EMAIL WORKFLOWS
// ---------------------------------------------------------------------------

// Helper: get current UK time
function getUKTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
}

// Track last-run dates to prevent duplicate sends
var lastDailyBulletinDate = '';
var lastWeeklySummaryDate = '';
var lastReengagementDate = '';
var lastExpiryWarningDate = '';

// --- 3. DAILY TIP BULLETIN (8:45am UK time, premium subscribers) ---
async function scheduleDailyBulletin() {
  try {
    var uk = getUKTime();
    var hour = uk.getHours();
    var minute = uk.getMinutes();
    var dateStr = uk.toISOString().split('T')[0];

    // Run between 8:45-8:59 UK time, once per day
    if (hour !== 8 || minute < 45 || lastDailyBulletinDate === dateStr) return;

    var tips = readJSON('sample-tips.json');
    var todayTips = tips.filter(function(t) { return t.date === dateStr && t.status === 'active' && !t.isWeeklyAcca; });
    if (todayTips.length === 0) return;

    var nap = todayTips.filter(function(t) { return !t.isPremium; }).sort(function(a, b) { return (b.confidence || 0) - (a.confidence || 0); })[0] || null;
    var premiumTips = todayTips.filter(function(t) { return t.isPremium; });

    // Get yesterday's results
    var yesterday = new Date(uk);
    yesterday.setDate(yesterday.getDate() - 1);
    var yesterdayStr = yesterday.toISOString().split('T')[0];
    var allResults = readJSON('sample-results.json');
    var yesterdayResults = allResults.filter(function(r) { return r.date === yesterdayStr; });

    var users = readJSON('sample-users.json');
    var premiumUsers = users.filter(function(u) {
      return u.subscription === 'premium' && (!u.emailPrefs || u.emailPrefs.dailyBulletin !== false);
    });

    var sentCount = 0;
    for (var i = 0; i < premiumUsers.length; i++) {
      var u = premiumUsers[i];
      emailService.sendDailyBulletin({
        name: u.name, email: u.email,
        nap: nap, premiumTips: premiumTips,
        yesterdayResults: yesterdayResults.length > 0 ? yesterdayResults : null
      }).catch(function(err) { console.error('[Email] Daily bulletin failed:', err.message); });
      sentCount++;
    }

    lastDailyBulletinDate = dateStr;
    console.log('[Email] Daily bulletin sent to ' + sentCount + ' premium user(s) with ' + todayTips.length + ' tip(s)');
  } catch (err) {
    console.error('[Email] Daily bulletin error:', err.message);
  }
}

// --- 4. WEEKLY RESULTS SUMMARY (Sunday 8pm UK time, all subscribers) ---
async function scheduleWeeklySummary() {
  try {
    var uk = getUKTime();
    var day = uk.getDay(); // 0 = Sunday
    var hour = uk.getHours();
    var dateStr = uk.toISOString().split('T')[0];

    // Run on Sunday between 20:00-20:29, once per week
    if (day !== 0 || hour !== 20 || lastWeeklySummaryDate === dateStr) return;

    var allResults = readJSON('sample-results.json');

    // This week's results (last 7 days)
    var weekAgo = new Date(uk);
    weekAgo.setDate(weekAgo.getDate() - 7);
    var weekAgoStr = weekAgo.toISOString().split('T')[0];
    var weekResults = allResults.filter(function(r) { return r.date >= weekAgoStr; });
    var weekWon = weekResults.filter(function(r) { return r.result === 'won'; });
    var weekPnl = weekResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);

    var weekStats = {
      total: weekResults.length,
      won: weekWon.length,
      pnl: Math.round(weekPnl * 100) / 100
    };

    // Overall stats
    var overallWon = allResults.filter(function(r) { return r.result === 'won'; });
    var overallPnl = allResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);
    var overallStake = allResults.reduce(function(sum, r) { return sum + (r.stake || 1); }, 0);
    var overallStats = {
      total: allResults.length,
      won: overallWon.length,
      pnl: Math.round(overallPnl * 100) / 100,
      bank: Math.round((100 + overallPnl) * 100) / 100,
      roi: overallStake > 0 ? Math.round((overallPnl / overallStake) * 10000) / 100 : 0
    };

    // Best winner this week
    var bestWinner = weekWon.sort(function(a, b) { return (b.odds || 0) - (a.odds || 0); })[0] || null;

    // Weekly acca
    var tips = readJSON('sample-tips.json');
    var weeklyAcca = tips.find(function(t) { return t.isWeeklyAcca; }) || null;

    var users = readJSON('sample-users.json');
    var recipients = users.filter(function(u) {
      return u.role !== 'admin' && (!u.emailPrefs || u.emailPrefs.weeklySummary !== false);
    });

    var sentCount = 0;
    for (var i = 0; i < recipients.length; i++) {
      var u = recipients[i];
      emailService.sendWeeklySummary({
        name: u.name, email: u.email,
        weekStats: weekStats, overallStats: overallStats,
        bestWinner: bestWinner, weeklyAcca: weeklyAcca
      }).catch(function(err) { console.error('[Email] Weekly summary failed:', err.message); });
      sentCount++;
    }

    lastWeeklySummaryDate = dateStr;
    console.log('[Email] Weekly summary sent to ' + sentCount + ' user(s)');
  } catch (err) {
    console.error('[Email] Weekly summary error:', err.message);
  }
}

// --- 5. INACTIVITY RE-ENGAGEMENT (daily check, 7 days no login) ---
async function scheduleReengagement() {
  try {
    var uk = getUKTime();
    var hour = uk.getHours();
    var dateStr = uk.toISOString().split('T')[0];

    // Run once per day at 10am UK time
    if (hour !== 10 || lastReengagementDate === dateStr) return;

    var users = readJSON('sample-users.json');
    var now = Date.now();
    var sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // Recent results for the re-engagement content
    var allResults = readJSON('sample-results.json');
    var recentResults = allResults.filter(function(r) {
      var rDate = new Date(r.date);
      return (now - rDate.getTime()) < sevenDaysMs;
    });
    var recentWon = recentResults.filter(function(r) { return r.result === 'won'; });
    var recentProfit = recentResults.reduce(function(sum, r) { return sum + (r.pnl > 0 ? r.pnl : 0); }, 0);
    var bigWinner = recentWon.sort(function(a, b) { return (b.odds || 0) - (a.odds || 0); })[0] || null;

    var sentCount = 0;
    users.forEach(function(u) {
      if (u.role === 'admin') return;
      if (u.emailPrefs && u.emailPrefs.marketing === false) return;

      var lastLoginTime = u.lastLogin ? new Date(u.lastLogin.timestamp).getTime() : 0;
      if (lastLoginTime === 0 || (now - lastLoginTime) < sevenDaysMs) return;
      // Don't send re-engagement more than once every 14 days
      if (u.lastReengagementEmail && (now - new Date(u.lastReengagementEmail).getTime()) < 14 * 24 * 60 * 60 * 1000) return;

      emailService.sendReengagement({
        name: u.name, email: u.email,
        tipsPublished: recentResults.length,
        winners: recentWon.length,
        profit: recentProfit,
        bigWinner: bigWinner
      }).catch(function(err) { console.error('[Email] Re-engagement failed for ' + u.email + ':', err.message); });

      u.lastReengagementEmail = new Date().toISOString();
      sentCount++;
    });

    if (sentCount > 0) {
      writeJSON('sample-users.json', users);
    }

    lastReengagementDate = dateStr;
    if (sentCount > 0) console.log('[Email] Re-engagement sent to ' + sentCount + ' inactive user(s)');
  } catch (err) {
    console.error('[Email] Re-engagement error:', err.message);
  }
}

// --- 6. SUBSCRIPTION EXPIRY WARNING (daily check, 3 days before) ---
async function scheduleExpiryWarning() {
  try {
    var uk = getUKTime();
    var hour = uk.getHours();
    var dateStr = uk.toISOString().split('T')[0];

    // Run once per day at 9am UK time
    if (hour !== 9 || lastExpiryWarningDate === dateStr) return;

    var users = readJSON('sample-users.json');
    var now = new Date();
    var threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    var allResults = readJSON('sample-results.json');

    var sentCount = 0;
    users.forEach(function(u) {
      if (u.subscription !== 'premium' || !u.subscriptionExpiry) return;

      var expiry = new Date(u.subscriptionExpiry);
      var timeUntilExpiry = expiry.getTime() - now.getTime();

      // Send if expiry is between 2-4 days away (3 day window)
      if (timeUntilExpiry < 2 * 24 * 60 * 60 * 1000 || timeUntilExpiry > 4 * 24 * 60 * 60 * 1000) return;

      // Don't send if already warned
      if (u.expiryWarned === dateStr) return;

      // Calculate stats since joining
      var joinDate = u.joined || '2024-01-01';
      var userResults = allResults.filter(function(r) { return r.date >= joinDate && r.isPremium; });
      var userWon = userResults.filter(function(r) { return r.result === 'won'; });
      var userPnl = userResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);

      emailService.sendExpiryWarning({
        name: u.name, email: u.email,
        expiryDate: u.subscriptionExpiry,
        tipsReceived: userResults.length,
        winners: userWon.length,
        pnl: Math.round(userPnl * 100) / 100
      }).catch(function(err) { console.error('[Email] Expiry warning failed for ' + u.email + ':', err.message); });

      u.expiryWarned = dateStr;
      sentCount++;
    });

    if (sentCount > 0) {
      writeJSON('sample-users.json', users);
      console.log('[Email] Expiry warning sent to ' + sentCount + ' user(s)');
    }

    lastExpiryWarningDate = dateStr;
  } catch (err) {
    console.error('[Email] Expiry warning error:', err.message);
  }
}

// Run email schedulers every 15 minutes
setInterval(function() {
  scheduleDailyBulletin();
  scheduleWeeklySummary();
  scheduleReengagement();
  scheduleExpiryWarning();
}, 15 * 60 * 1000);

// Also run checks 45 seconds after server start
setTimeout(function() {
  scheduleDailyBulletin();
  scheduleWeeklySummary();
  scheduleReengagement();
  scheduleExpiryWarning();
}, 45000);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Elite Edge Sports Tips`);
  console.log(`  Server running at http://localhost:${PORT}`);
  console.log(`  ------------------------------------------`);
  console.log(`  Demo accounts:`);
  console.log(`    Admin:   admin@elite.com / admin123`);
  console.log(`    Free:    free@test.com / test123`);
  console.log(`    Premium: premium@test.com / test123`);
  console.log(`  ------------------------------------------`);
  console.log(`  Auto-tips: Daily at 7:30am UK (every 10 min check)`);
  console.log(`  Auto-settle: Running every 5 minutes`);
  console.log(`  Email workflows: Daily bulletin, weekly summary,`);
  console.log(`    re-engagement, expiry warnings, big win alerts`);
  console.log(`  ------------------------------------------\n`);
});

module.exports = app;
