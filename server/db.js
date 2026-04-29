/**
 * Elite Edge Sports Tips — Database Layer
 *
 * PostgreSQL connection pool + query helpers for all entities.
 * Falls back gracefully to JSON file storage when DATABASE_URL is not set.
 *
 * Usage:
 *   const db = require('./db');
 *   const user = await db.getUserByEmail('test@example.com');
 *   const tips = await db.getTips({ sport: 'racing', status: 'active' });
 */

const USE_DB = !!process.env.DATABASE_URL;
let pool = null;

if (USE_DB) {
  const { Pool } = require('pg');
  const isRailway = process.env.DATABASE_URL.includes('railway');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isRailway ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });
  console.log('[DB] PostgreSQL pool created' + (isRailway ? ' (Railway SSL)' : ''));
} else {
  console.log('[DB] No DATABASE_URL — using JSON file fallback');
}

// JSON file fallback
let fileStore = null;
function getFileStore() {
  if (!fileStore) fileStore = require('./dataFileStore');
  return fileStore;
}

// ---------------------------------------------------------------------------
// Core query helper
// ---------------------------------------------------------------------------
async function query(text, params) {
  if (!pool) throw new Error('Database not configured');
  return pool.query(text, params);
}

function isAvailable() {
  return !!pool;
}

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------
async function getUsers() {
  if (!pool) return getFileStore().readJSON('sample-users.json') || [];
  const { rows } = await query('SELECT * FROM users ORDER BY created_at DESC');
  return rows.map(dbUserToApp);
}

async function getUserById(id) {
  if (!pool) {
    const users = getFileStore().readJSON('sample-users.json') || [];
    return users.find(u => u.id === id) || null;
  }
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows.length > 0 ? dbUserToApp(rows[0]) : null;
}

async function getUserByEmail(email) {
  if (!pool) {
    const users = getFileStore().readJSON('sample-users.json') || [];
    return users.find(u => u.email === (email || '').toLowerCase()) || null;
  }
  const { rows } = await query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  return rows.length > 0 ? dbUserToApp(rows[0]) : null;
}

async function getUserByResetToken(token) {
  if (!pool) {
    const users = getFileStore().readJSON('sample-users.json') || [];
    return users.find(u => u.resetToken === token) || null;
  }
  const { rows } = await query('SELECT * FROM users WHERE reset_token = $1', [token]);
  return rows.length > 0 ? dbUserToApp(rows[0]) : null;
}

async function createUser(data) {
  if (!pool) {
    const users = getFileStore().readJSON('sample-users.json') || [];
    users.push(data);
    getFileStore().writeJSON('sample-users.json', users);
    return data;
  }
  const u = appUserToDb(data);
  await query(
    `INSERT INTO users (id, email, password_hash, name, role, subscription, subscription_expiry,
     joined, bank, session_id, failed_attempts, lock_until, flagged, trusted_devices,
     email_prefs, alert_prefs, agreement_timestamp, agreement_text, login_history, reset_token, reset_token_expiry, expiry_warned,
     trial_active, trial_start, trial_end, trial_warned, stripe_customer_id, stripe_subscription_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
    [u.id, u.email, u.password_hash, u.name, u.role, u.subscription, u.subscription_expiry,
     u.joined, u.bank, u.session_id, u.failed_attempts, u.lock_until, u.flagged,
     u.trusted_devices, u.email_prefs, u.alert_prefs, u.agreement_timestamp, u.agreement_text,
     u.login_history, u.reset_token, u.reset_token_expiry, u.expiry_warned,
     u.trial_active, u.trial_start, u.trial_end, u.trial_warned,
     u.stripe_customer_id || null, u.stripe_subscription_id || null]
  );
  return data;
}

async function updateUser(id, fields) {
  if (!pool) {
    const users = getFileStore().readJSON('sample-users.json') || [];
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    Object.assign(users[idx], fields);
    getFileStore().writeJSON('sample-users.json', users);
    return users[idx];
  }
  // Build dynamic UPDATE
  const dbFields = appUserToDb(fields);
  const setClauses = [];
  const values = [];
  let paramIdx = 1;
  for (const [key, val] of Object.entries(dbFields)) {
    if (key === 'id') continue;
    if (val !== undefined) {
      setClauses.push(key + ' = $' + paramIdx);
      values.push(val);
      paramIdx++;
    }
  }
  if (setClauses.length === 0) return await getUserById(id);
  setClauses.push('updated_at = NOW()');
  values.push(id);
  await query('UPDATE users SET ' + setClauses.join(', ') + ' WHERE id = $' + paramIdx, values);
  return await getUserById(id);
}

async function deleteUser(id) {
  if (!pool) {
    const users = getFileStore().readJSON('sample-users.json') || [];
    const filtered = users.filter(u => u.id !== id);
    getFileStore().writeJSON('sample-users.json', filtered);
    return;
  }
  await query('DELETE FROM users WHERE id = $1', [id]);
}

async function saveUsers(users) {
  if (!pool) {
    getFileStore().writeJSON('sample-users.json', users);
    return;
  }
  // Batch update — used by scheduled tasks that modify multiple users
  for (const user of users) {
    await updateUser(user.id, user);
  }
}

// User field mapping: app (camelCase) ↔ db (snake_case)
function dbUserToApp(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password: row.password_hash,
    name: row.name,
    role: row.role,
    subscription: row.subscription,
    subscriptionExpiry: row.subscription_expiry,
    joined: row.joined,
    bank: parseFloat(row.bank) || 0,
    sessionId: row.session_id,
    failedAttempts: row.failed_attempts || 0,
    lockUntil: row.lock_until,
    flagged: row.flagged || false,
    trustedDevices: row.trusted_devices || [],
    emailPrefs: row.email_prefs || { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true },
    alertPrefs: row.alert_prefs || { highConfidence: false, steamers: false, preRace: false, bigOdds: false, newTips: false },
    agreementTimestamp: row.agreement_timestamp,
    agreementText: row.agreement_text,
    loginHistory: row.login_history || [],
    resetToken: row.reset_token,
    resetTokenExpiry: row.reset_token_expiry,
    expiryWarned: row.expiry_warned,
    trialActive: row.trial_active || false,
    trialStart: row.trial_start,
    trialEnd: row.trial_end,
    trialWarned: row.trial_warned || false,
    stripeCustomerId: row.stripe_customer_id || null,
    stripeSubscriptionId: row.stripe_subscription_id || null,
    dripsSent: row.drips_sent || [],
  };
}

function appUserToDb(data) {
  const result = {};
  if (data.id !== undefined) result.id = data.id;
  if (data.email !== undefined) result.email = data.email;
  if (data.password !== undefined) result.password_hash = data.password;
  if (data.name !== undefined) result.name = data.name;
  if (data.role !== undefined) result.role = data.role;
  if (data.subscription !== undefined) result.subscription = data.subscription;
  if (data.subscriptionExpiry !== undefined) result.subscription_expiry = data.subscriptionExpiry;
  if (data.joined !== undefined) result.joined = data.joined;
  if (data.bank !== undefined) result.bank = data.bank;
  if (data.sessionId !== undefined) result.session_id = data.sessionId;
  if (data.failedAttempts !== undefined) result.failed_attempts = data.failedAttempts;
  if (data.lockUntil !== undefined) result.lock_until = data.lockUntil;
  if (data.flagged !== undefined) result.flagged = data.flagged;
  if (data.trustedDevices !== undefined) result.trusted_devices = Array.isArray(data.trustedDevices) ? data.trustedDevices : [];
  if (data.emailPrefs !== undefined) result.email_prefs = JSON.stringify(data.emailPrefs);
  if (data.alertPrefs !== undefined) result.alert_prefs = JSON.stringify(data.alertPrefs);
  if (data.agreementTimestamp !== undefined) result.agreement_timestamp = data.agreementTimestamp;
  if (data.agreementText !== undefined) result.agreement_text = data.agreementText;
  if (data.loginHistory !== undefined) result.login_history = JSON.stringify(data.loginHistory);
  if (data.resetToken !== undefined) result.reset_token = data.resetToken;
  if (data.resetTokenExpiry !== undefined) result.reset_token_expiry = data.resetTokenExpiry;
  if (data.expiryWarned !== undefined) result.expiry_warned = data.expiryWarned;
  if (data.trialActive !== undefined) result.trial_active = data.trialActive;
  if (data.trialStart !== undefined) result.trial_start = data.trialStart;
  if (data.trialEnd !== undefined) result.trial_end = data.trialEnd;
  if (data.trialWarned !== undefined) result.trial_warned = data.trialWarned;
  if (data.stripeCustomerId !== undefined) result.stripe_customer_id = data.stripeCustomerId;
  if (data.stripeSubscriptionId !== undefined) result.stripe_subscription_id = data.stripeSubscriptionId;
  if (data.dripsSent !== undefined) result.drips_sent = JSON.stringify(data.dripsSent);
  return result;
}

// ---------------------------------------------------------------------------
// TIPS
// ---------------------------------------------------------------------------
async function getTips(filters) {
  if (!pool) {
    let tips = getFileStore().readJSON('sample-tips.json') || [];
    if (filters) {
      if (filters.sport) tips = tips.filter(t => t.sport === filters.sport);
      if (filters.status) tips = tips.filter(t => t.status === filters.status);
      if (filters.date) tips = tips.filter(t => t.date === filters.date);
      if (filters.isPremium !== undefined) tips = tips.filter(t => t.isPremium === filters.isPremium);
    }
    return tips;
  }
  let sql = 'SELECT * FROM tips';
  const conditions = [];
  const values = [];
  let idx = 1;
  if (filters) {
    if (filters.sport) { conditions.push('sport = $' + idx); values.push(filters.sport); idx++; }
    if (filters.status) { conditions.push('status = $' + idx); values.push(filters.status); idx++; }
    if (filters.date) { conditions.push('date = $' + idx); values.push(filters.date); idx++; }
    if (filters.isPremium !== undefined) { conditions.push('is_premium = $' + idx); values.push(filters.isPremium); idx++; }
  }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY date DESC, created_at DESC';
  const { rows } = await query(sql, values);
  return rows.map(dbTipToApp);
}

async function getTipById(id) {
  if (!pool) {
    const tips = getFileStore().readJSON('sample-tips.json') || [];
    return tips.find(t => t.id === id) || null;
  }
  const { rows } = await query('SELECT * FROM tips WHERE id = $1', [id]);
  return rows.length > 0 ? dbTipToApp(rows[0]) : null;
}

async function createTip(data) {
  if (!pool) {
    const tips = getFileStore().readJSON('sample-tips.json') || [];
    tips.push(data);
    getFileStore().writeJSON('sample-tips.json', tips);
    return data;
  }
  const t = appTipToDb(data);
  await query(
    `INSERT INTO tips (id, sport, event, meeting, race_time, race_class, distance, going,
     league, kickoff, venue, market, selection, odds, confidence, model_probability,
     implied_probability, edge, value_rating, is_premium, status, result, date,
     tipster, tipster_profile, staking, risk_level, analysis, is_nap, is_outsider,
     opening_odds, bookmaker_odds, recent_form, is_weekly_acca, acca_selections)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)`,
    [t.id, t.sport, t.event, t.meeting, t.race_time, t.race_class, t.distance, t.going,
     t.league, t.kickoff, t.venue, t.market, t.selection, t.odds, t.confidence,
     t.model_probability, t.implied_probability, t.edge, t.value_rating, t.is_premium,
     t.status, t.result, t.date, t.tipster, t.tipster_profile, t.staking, t.risk_level,
     t.analysis, t.is_nap, t.is_outsider, t.opening_odds, t.bookmaker_odds,
     t.recent_form, t.is_weekly_acca, t.acca_selections]
  );
  return data;
}

async function updateTip(id, fields) {
  if (!pool) {
    const tips = getFileStore().readJSON('sample-tips.json') || [];
    const idx = tips.findIndex(t => t.id === id);
    if (idx === -1) return null;
    Object.assign(tips[idx], fields);
    getFileStore().writeJSON('sample-tips.json', tips);
    return tips[idx];
  }
  const dbFields = appTipToDb(fields);
  const setClauses = [];
  const values = [];
  let paramIdx = 1;
  for (const [key, val] of Object.entries(dbFields)) {
    if (key === 'id') continue;
    if (val !== undefined) {
      setClauses.push(key + ' = $' + paramIdx);
      values.push(val);
      paramIdx++;
    }
  }
  if (setClauses.length === 0) return await getTipById(id);
  values.push(id);
  await query('UPDATE tips SET ' + setClauses.join(', ') + ' WHERE id = $' + paramIdx, values);
  return await getTipById(id);
}

async function deleteTip(id) {
  if (!pool) {
    const tips = getFileStore().readJSON('sample-tips.json') || [];
    const filtered = tips.filter(t => t.id !== id);
    getFileStore().writeJSON('sample-tips.json', filtered);
    return;
  }
  await query('DELETE FROM tips WHERE id = $1', [id]);
}

async function saveTips(tips) {
  if (!pool) {
    getFileStore().writeJSON('sample-tips.json', tips);
    return;
  }
  for (const tip of tips) {
    const existing = await getTipById(tip.id);
    if (existing) {
      await updateTip(tip.id, tip);
    } else {
      await createTip(tip);
    }
  }
}

function dbTipToApp(row) {
  if (!row) return null;
  return {
    id: row.id,
    sport: row.sport,
    event: row.event,
    meeting: row.meeting,
    raceTime: row.race_time,
    raceClass: row.race_class,
    distance: row.distance,
    going: row.going,
    league: row.league,
    kickoff: row.kickoff,
    venue: row.venue,
    market: row.market,
    selection: row.selection,
    odds: parseFloat(row.odds) || 0,
    confidence: row.confidence,
    modelProbability: parseFloat(row.model_probability) || 0,
    impliedProbability: parseFloat(row.implied_probability) || 0,
    edge: parseFloat(row.edge) || 0,
    valueRating: row.value_rating,
    isPremium: row.is_premium || false,
    status: row.status,
    result: row.result,
    date: row.date,
    tipster: row.tipster,
    tipsterProfile: row.tipster_profile,
    staking: row.staking,
    riskLevel: row.risk_level,
    analysis: row.analysis || {},
    isNap: row.is_nap || false,
    isOutsider: row.is_outsider || false,
    openingOdds: parseFloat(row.opening_odds) || 0,
    bookmakerOdds: row.bookmaker_odds || {},
    recentForm: row.recent_form || [],
    isWeeklyAcca: row.is_weekly_acca || false,
    accaSelections: row.acca_selections,
    advisedPriceDecimal: parseFloat(row.advised_price_decimal) || null,
    closingPriceDecimal: parseFloat(row.closing_price_decimal) || null,
    clvPercent: parseFloat(row.clv_percent) || null,
    fairOddsDecimal: parseFloat(row.fair_odds_decimal) || null,
    settledAt: row.settled_at || null,
    settlementSource: row.settlement_source || null,
    createdAt: row.created_at,
  };
}

function appTipToDb(data) {
  const result = {};
  if (data.id !== undefined) result.id = data.id;
  if (data.sport !== undefined) result.sport = data.sport;
  if (data.event !== undefined) result.event = data.event;
  if (data.meeting !== undefined) result.meeting = data.meeting;
  if (data.raceTime !== undefined) result.race_time = data.raceTime;
  if (data.raceClass !== undefined) result.race_class = data.raceClass;
  if (data.distance !== undefined) result.distance = data.distance;
  if (data.going !== undefined) result.going = data.going;
  if (data.league !== undefined) result.league = data.league;
  if (data.kickoff !== undefined) result.kickoff = data.kickoff;
  if (data.venue !== undefined) result.venue = data.venue;
  if (data.market !== undefined) result.market = data.market;
  if (data.selection !== undefined) result.selection = data.selection;
  if (data.odds !== undefined) result.odds = data.odds;
  if (data.confidence !== undefined) result.confidence = data.confidence;
  if (data.modelProbability !== undefined) result.model_probability = data.modelProbability;
  if (data.impliedProbability !== undefined) result.implied_probability = data.impliedProbability;
  if (data.edge !== undefined) result.edge = data.edge;
  if (data.valueRating !== undefined) result.value_rating = data.valueRating;
  if (data.isPremium !== undefined) result.is_premium = data.isPremium;
  if (data.status !== undefined) result.status = data.status;
  if (data.result !== undefined) result.result = data.result;
  if (data.date !== undefined) result.date = data.date;
  if (data.tipster !== undefined) result.tipster = data.tipster;
  if (data.tipsterProfile !== undefined) result.tipster_profile = data.tipsterProfile;
  if (data.staking !== undefined) result.staking = data.staking;
  if (data.riskLevel !== undefined) result.risk_level = data.riskLevel;
  if (data.analysis !== undefined) result.analysis = JSON.stringify(data.analysis);
  if (data.isNap !== undefined) result.is_nap = data.isNap;
  if (data.isOutsider !== undefined) result.is_outsider = data.isOutsider;
  if (data.openingOdds !== undefined) result.opening_odds = data.openingOdds;
  if (data.bookmakerOdds !== undefined) result.bookmaker_odds = JSON.stringify(data.bookmakerOdds);
  if (data.recentForm !== undefined) result.recent_form = Array.isArray(data.recentForm) ? data.recentForm.map(String) : [];
  if (data.isWeeklyAcca !== undefined) result.is_weekly_acca = data.isWeeklyAcca;
  if (data.accaSelections !== undefined) result.acca_selections = data.accaSelections ? JSON.stringify(data.accaSelections) : null;
  if (data.advisedPriceDecimal !== undefined) result.advised_price_decimal = data.advisedPriceDecimal;
  if (data.closingPriceDecimal !== undefined) result.closing_price_decimal = data.closingPriceDecimal;
  if (data.clvPercent !== undefined) result.clv_percent = data.clvPercent;
  if (data.fairOddsDecimal !== undefined) result.fair_odds_decimal = data.fairOddsDecimal;
  if (data.settledAt !== undefined) result.settled_at = data.settledAt;
  if (data.settlementSource !== undefined) result.settlement_source = data.settlementSource;
  return result;
}

// ---------------------------------------------------------------------------
// RESULTS
// ---------------------------------------------------------------------------
async function getResults(filters) {
  if (!pool) {
    let results = getFileStore().readJSON('sample-results.json') || [];
    if (filters) {
      if (filters.sport) results = results.filter(r => r.sport === filters.sport);
      if (filters.date) results = results.filter(r => r.date === filters.date);
      if (filters.tipId) results = results.filter(r => r.tipId === filters.tipId);
    }
    return results;
  }
  let sql = 'SELECT * FROM results';
  const conditions = [];
  const values = [];
  let idx = 1;
  if (filters) {
    if (filters.sport) { conditions.push('sport = $' + idx); values.push(filters.sport); idx++; }
    if (filters.date) { conditions.push('date = $' + idx); values.push(filters.date); idx++; }
    if (filters.tipId) { conditions.push('tip_id = $' + idx); values.push(filters.tipId); idx++; }
  }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY date DESC, created_at DESC';
  const { rows } = await query(sql, values);
  return rows.map(dbResultToApp);
}

async function createResult(data) {
  if (!pool) {
    const results = getFileStore().readJSON('sample-results.json') || [];
    results.push(data);
    getFileStore().writeJSON('sample-results.json', results);
    return data;
  }
  const r = appResultToDb(data);
  await query(
    `INSERT INTO results (id, tip_id, sport, event, selection, market, odds, stake,
     result, pnl, date, is_premium, tipster_profile, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [r.id, r.tip_id, r.sport, r.event, r.selection, r.market, r.odds, r.stake,
     r.result, r.pnl, r.date, r.is_premium, r.tipster_profile, r.confidence]
  );
  return data;
}

async function saveResults(results) {
  if (!pool) {
    getFileStore().writeJSON('sample-results.json', results);
    return;
  }
  // For bulk save, upsert each
  for (const result of results) {
    try {
      await createResult(result);
    } catch (e) {
      // May already exist — ignore duplicates
      if (e.code !== '23505') throw e;
    }
  }
}

async function updateResult(id, fields) {
  if (!pool) return null;
  var sets = [];
  var vals = [];
  var idx = 1;
  if (fields.result !== undefined) { sets.push('result = $' + idx); vals.push(fields.result); idx++; }
  if (fields.pnl !== undefined) { sets.push('pnl = $' + idx); vals.push(fields.pnl); idx++; }
  if (fields.voidedByMonitor !== undefined) { sets.push('voided_by_monitor = $' + idx); vals.push(fields.voidedByMonitor); idx++; }
  if (fields.replayAnalysis !== undefined) { sets.push('replay_analysis = $' + idx); vals.push(JSON.stringify(fields.replayAnalysis)); idx++; }
  if (sets.length === 0) return null;
  vals.push(id);
  await query('UPDATE results SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
  return { id: id };
}

function dbResultToApp(row) {
  if (!row) return null;
  return {
    id: row.id,
    tipId: row.tip_id,
    sport: row.sport,
    event: row.event,
    selection: row.selection,
    market: row.market,
    odds: parseFloat(row.odds) || 0,
    stake: parseFloat(row.stake) || 0,
    result: row.result,
    pnl: parseFloat(row.pnl) || 0,
    date: row.date,
    isPremium: row.is_premium || false,
    tipsterProfile: row.tipster_profile,
    confidence: row.confidence,
  };
}

function appResultToDb(data) {
  const result = {};
  if (data.id !== undefined) result.id = data.id;
  if (data.tipId !== undefined) result.tip_id = data.tipId;
  if (data.sport !== undefined) result.sport = data.sport;
  if (data.event !== undefined) result.event = data.event;
  if (data.selection !== undefined) result.selection = data.selection;
  if (data.market !== undefined) result.market = data.market;
  if (data.odds !== undefined) result.odds = data.odds;
  if (data.stake !== undefined) result.stake = data.stake;
  if (data.result !== undefined) result.result = data.result;
  if (data.pnl !== undefined) result.pnl = data.pnl;
  if (data.date !== undefined) result.date = data.date;
  if (data.isPremium !== undefined) result.is_premium = data.isPremium;
  if (data.tipsterProfile !== undefined) result.tipster_profile = data.tipsterProfile;
  if (data.confidence !== undefined) result.confidence = data.confidence;
  return result;
}

// ---------------------------------------------------------------------------
// SUPPORT TICKETS
// ---------------------------------------------------------------------------
async function getTickets(filters) {
  if (!pool) return getFileStore().readJSON('sample-support.json') || [];
  let sql = 'SELECT * FROM support_tickets ORDER BY date DESC';
  const { rows } = await query(sql);
  return rows.map(dbTicketToApp);
}

async function getTicketById(id) {
  if (!pool) {
    const tickets = getFileStore().readJSON('sample-support.json') || [];
    return tickets.find(t => t.id === id) || null;
  }
  const { rows } = await query('SELECT * FROM support_tickets WHERE id = $1', [id]);
  return rows.length > 0 ? dbTicketToApp(rows[0]) : null;
}

async function createTicket(data) {
  if (!pool) {
    const tickets = getFileStore().readJSON('sample-support.json') || [];
    tickets.push(data);
    getFileStore().writeJSON('sample-support.json', tickets);
    return data;
  }
  await query(
    `INSERT INTO support_tickets (id, user_id, name, email, subject, message, status, priority, date, replies)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [data.id, data.userId || null, data.name, data.email, data.subject, data.message,
     data.status || 'open', data.priority || 'medium', data.date || new Date().toISOString(),
     JSON.stringify(data.replies || [])]
  );
  return data;
}

async function updateTicket(id, fields) {
  if (!pool) {
    const tickets = getFileStore().readJSON('sample-support.json') || [];
    const idx = tickets.findIndex(t => t.id === id);
    if (idx === -1) return null;
    Object.assign(tickets[idx], fields);
    getFileStore().writeJSON('sample-support.json', tickets);
    return tickets[idx];
  }
  const sets = [];
  const vals = [];
  let i = 1;
  if (fields.status) { sets.push('status = $' + i); vals.push(fields.status); i++; }
  if (fields.replies) { sets.push('replies = $' + i); vals.push(JSON.stringify(fields.replies)); i++; }
  if (sets.length === 0) return await getTicketById(id);
  vals.push(id);
  await query('UPDATE support_tickets SET ' + sets.join(', ') + ' WHERE id = $' + i, vals);
  return await getTicketById(id);
}

function dbTicketToApp(row) {
  return {
    id: row.id, userId: row.user_id, name: row.name, email: row.email,
    subject: row.subject, message: row.message, status: row.status,
    priority: row.priority, date: row.date, replies: row.replies || [],
  };
}

// ---------------------------------------------------------------------------
// BLOG REVIEWS
// ---------------------------------------------------------------------------
async function getBlogReviews() {
  if (!pool) return getFileStore().readJSON('blog-reviews.json') || [];
  const { rows } = await query('SELECT * FROM blog_reviews ORDER BY date DESC');
  return rows.map(r => ({
    slug: r.slug, title: r.title, date: r.date, author: r.author,
    excerpt: r.excerpt, content: r.content, isAutoGenerated: r.is_auto_generated,
    stats: r.stats || {},
  }));
}

async function upsertBlogReview(data) {
  if (!pool) {
    const reviews = getFileStore().readJSON('blog-reviews.json') || [];
    const idx = reviews.findIndex(r => r.slug === data.slug);
    if (idx >= 0) reviews[idx] = data; else reviews.unshift(data);
    if (reviews.length > 12) reviews.length = 12;
    getFileStore().writeJSON('blog-reviews.json', reviews);
    return data;
  }
  await query(
    `INSERT INTO blog_reviews (slug, title, date, author, excerpt, content, is_auto_generated, stats)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (slug) DO UPDATE SET title=$2, excerpt=$5, content=$6, stats=$8`,
    [data.slug, data.title, data.date, data.author, data.excerpt, data.content,
     data.isAutoGenerated || false, JSON.stringify(data.stats || {})]
  );
  return data;
}

// ---------------------------------------------------------------------------
// FORM GUIDE
// ---------------------------------------------------------------------------
async function getFormGuide() {
  if (!pool) return getFileStore().readJSON('sample-form-guide.json') || { teams: [], horses: [] };
  const { rows } = await query('SELECT * FROM form_guide');
  const result = { teams: [], horses: [] };
  rows.forEach(r => { result[r.category] = r.data || []; });
  return result;
}

// ---------------------------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------------------------
async function getNotifications(limit) {
  if (!pool) {
    try {
      const fs = require('fs');
      const path = require('path');
      const dataDir = getFileStore().dataDir;
      const filePath = path.join(dataDir, 'notifications.json');
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')).slice(0, limit || 50);
      return [];
    } catch { return []; }
  }
  const lim = limit || 50;
  const { rows } = await query('SELECT * FROM notifications ORDER BY timestamp DESC LIMIT $1', [lim]);
  return rows.map(r => ({
    id: r.id, type: r.type, message: r.message, tipId: r.tip_id, timestamp: r.timestamp,
  }));
}

async function createNotification(data) {
  if (!pool) {
    const fs = require('fs');
    const path = require('path');
    const dataDir = getFileStore().dataDir;
    const filePath = path.join(dataDir, 'notifications.json');
    let notifications = [];
    try { notifications = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
    notifications.unshift(data);
    if (notifications.length > 200) notifications.length = 200;
    fs.writeFileSync(filePath, JSON.stringify(notifications, null, 2));
    return data;
  }
  await query(
    'INSERT INTO notifications (id, type, message, tip_id, timestamp) VALUES ($1,$2,$3,$4,$5)',
    [data.id, data.type || 'info', data.message, data.tipId || null, data.timestamp || new Date().toISOString()]
  );
  return data;
}

// ---------------------------------------------------------------------------
// AUDIT LOG
// ---------------------------------------------------------------------------
async function createAuditEntry(data) {
  if (!pool) return; // Audit only works with DB
  await query(
    'INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [data.userId, data.userEmail, data.action, data.entity, data.entityId,
     data.details ? JSON.stringify(data.details) : null, data.ip]
  );
}

async function getAuditLog(page, limit) {
  if (!pool) return { entries: [], total: 0 };
  const lim = limit || 50;
  const offset = ((page || 1) - 1) * lim;
  const countResult = await query('SELECT COUNT(*) FROM audit_log');
  const { rows } = await query('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT $1 OFFSET $2', [lim, offset]);
  return {
    entries: rows.map(r => ({
      id: r.id, userId: r.user_id, userEmail: r.user_email, action: r.action,
      entity: r.entity, entityId: r.entity_id, details: r.details, ip: r.ip, timestamp: r.timestamp,
    })),
    total: parseInt(countResult.rows[0].count),
  };
}

// ---------------------------------------------------------------------------
// TIP PRICE HISTORY
// ---------------------------------------------------------------------------
async function createPriceSnapshot(data) {
  if (!pool) return;
  await query(
    'INSERT INTO tip_price_history (tip_id, price_decimal, bookmaker, source) VALUES ($1,$2,$3,$4)',
    [data.tipId, data.priceDecimal, data.bookmaker || null, data.source || 'odds-api']
  );
}

async function getPriceHistory(tipId) {
  if (!pool) return [];
  const { rows } = await query(
    'SELECT * FROM tip_price_history WHERE tip_id = $1 ORDER BY recorded_at ASC',
    [tipId]
  );
  return rows.map(r => ({
    id: r.id, tipId: r.tip_id, priceDecimal: parseFloat(r.price_decimal),
    bookmaker: r.bookmaker, source: r.source, recordedAt: r.recorded_at,
  }));
}

// ---------------------------------------------------------------------------
// ANALYST PERFORMANCE SNAPSHOTS
// ---------------------------------------------------------------------------
async function createAnalystSnapshot(data) {
  if (!pool) return;
  await query(
    `INSERT INTO analyst_performance_snapshots
     (analyst_key, snapshot_date, total_tips, wins, losses, voids, strike_rate, avg_odds, total_pnl, avg_clv, roi_percent, sport)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (analyst_key, snapshot_date, sport) DO UPDATE SET
       total_tips=$3, wins=$4, losses=$5, voids=$6, strike_rate=$7, avg_odds=$8, total_pnl=$9, avg_clv=$10, roi_percent=$11`,
    [data.analystKey, data.snapshotDate, data.totalTips || 0, data.wins || 0,
     data.losses || 0, data.voids || 0, data.strikeRate || 0, data.avgOdds || 0,
     data.totalPnl || 0, data.avgClv || null, data.roiPercent || 0, data.sport || null]
  );
}

async function getAnalystSnapshots(analystKey, limit) {
  if (!pool) return [];
  const lim = limit || 30;
  const sql = analystKey
    ? 'SELECT * FROM analyst_performance_snapshots WHERE analyst_key = $1 ORDER BY snapshot_date DESC LIMIT $2'
    : 'SELECT * FROM analyst_performance_snapshots ORDER BY snapshot_date DESC LIMIT $1';
  const params = analystKey ? [analystKey, lim] : [lim];
  const { rows } = await query(sql, params);
  return rows.map(r => ({
    id: r.id, analystKey: r.analyst_key, snapshotDate: r.snapshot_date,
    totalTips: r.total_tips, wins: r.wins, losses: r.losses, voids: r.voids,
    strikeRate: parseFloat(r.strike_rate) || 0, avgOdds: parseFloat(r.avg_odds) || 0,
    totalPnl: parseFloat(r.total_pnl) || 0, avgClv: parseFloat(r.avg_clv) || null,
    roiPercent: parseFloat(r.roi_percent) || 0, sport: r.sport,
  }));
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
module.exports = {
  pool,
  query,
  isAvailable,
  // Users
  getUsers, getUserById, getUserByEmail, getUserByResetToken, createUser, updateUser, deleteUser, saveUsers,
  // Tips
  getTips, getTipById, createTip, updateTip, deleteTip, saveTips,
  // Results
  getResults, createResult, updateResult, saveResults,
  // Support
  getTickets, getTicketById, createTicket, updateTicket,
  // Blog
  getBlogReviews, upsertBlogReview,
  // Form Guide
  getFormGuide,
  // Notifications
  getNotifications, createNotification,
  // Audit
  createAuditEntry, getAuditLog,
  // Price History
  createPriceSnapshot, getPriceHistory,
  // Analyst Snapshots
  createAnalystSnapshot, getAnalystSnapshots,
};
