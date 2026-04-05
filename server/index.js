const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const scoringModel = require('./services/scoringModel');
const emailService = require('./services/emailService');
// Data ingestion is available but not started by default (no API keys in demo)
// const dataIngestion = require('./services/dataIngestion');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'elite-edge-secret-key-change-in-production';

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
  if (req.user.role !== 'admin' && req.user.subscription !== 'premium') {
    return res.status(403).json({ error: 'Premium subscription required' });
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
    const users = readJSON('sample-users.json');
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
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
      agreementTimestamp: agreementTimestamp || new Date().toISOString(),
      agreementText: 'I confirm I am 18+ and understand this service provides statistical analysis only, not betting advice. I accept full responsibility for any betting decisions I make.',
    };
    users.push(user);
    writeJSON('sample-users.json', users);

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = readJSON('sample-users.json');
    const user = users.find(u => u.email === email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // Support both hashed and plain-text passwords for demo
    let valid = false;
    try { valid = await bcrypt.compare(password, user.password); } catch {}
    if (!valid && user.passwordPlain) { valid = password === user.passwordPlain; }
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ user: req.user });
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
  res.json(users.map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, subscription: u.subscription, joined: u.joined })));
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
    response = 'Premium membership gives you access to all tips, full analysis, and priority alerts. Plans start at just \u00a314.99/month or save with our annual plan at \u00a3119.99/year. Click the Upgrade button to get started \u2014 you can cancel anytime.';
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
    response = 'Need help? You can submit a support ticket via the Contact page, or email us at support@eliteedgesports.com. We typically respond within 2 hours during business hours.';
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
// SPA fallback
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  Elite Edge Sports Tips`);
  console.log(`  Server running at http://localhost:${PORT}`);
  console.log(`  ------------------------------------------`);
  console.log(`  Demo accounts:`);
  console.log(`    Admin:   admin@elite.com / admin123`);
  console.log(`    Free:    free@test.com / test123`);
  console.log(`    Premium: premium@test.com / test123`);
  console.log(`  ------------------------------------------\n`);
});

module.exports = app;
