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
     trial_active, trial_start, trial_end, trial_warned, stripe_customer_id, stripe_subscription_id, mobile)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
    [u.id, u.email, u.password_hash, u.name, u.role, u.subscription, u.subscription_expiry,
     u.joined, u.bank, u.session_id, u.failed_attempts, u.lock_until, u.flagged,
     u.trusted_devices, u.email_prefs, u.alert_prefs, u.agreement_timestamp, u.agreement_text,
     u.login_history, u.reset_token, u.reset_token_expiry, u.expiry_warned,
     u.trial_active, u.trial_start, u.trial_end, u.trial_warned,
     u.stripe_customer_id || null, u.stripe_subscription_id || null, data.mobile || null]
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
    credits: parseInt(row.credits) || 0,
    creditsMonthlyAllowance: parseInt(row.credits_monthly_allowance) || 0,
    creditsResetDate: row.credits_reset_date || null,
    referralCode: row.referral_code || null,
    referredBy: row.referred_by || null,
    referralCount: parseInt(row.referral_count) || 0,
    emailVerified: row.email_verified || false,
    emailVerifyToken: row.email_verify_token || null,
    paymentFailedAt: row.payment_failed_at || null,
    paymentGraceEnd: row.payment_grace_end || null,
    dunningStage: row.dunning_stage || 0,
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
  if (data.credits !== undefined) result.credits = data.credits;
  if (data.creditsMonthlyAllowance !== undefined) result.credits_monthly_allowance = data.creditsMonthlyAllowance;
  if (data.creditsResetDate !== undefined) result.credits_reset_date = data.creditsResetDate;
  if (data.referralCode !== undefined) result.referral_code = data.referralCode;
  if (data.referredBy !== undefined) result.referred_by = data.referredBy;
  if (data.referralCount !== undefined) result.referral_count = data.referralCount;
  if (data.emailVerified !== undefined) result.email_verified = data.emailVerified;
  if (data.emailVerifyToken !== undefined) result.email_verify_token = data.emailVerifyToken;
  if (data.paymentFailedAt !== undefined) result.payment_failed_at = data.paymentFailedAt;
  if (data.paymentGraceEnd !== undefined) result.payment_grace_end = data.paymentGraceEnd;
  if (data.dunningStage !== undefined) result.dunning_stage = data.dunningStage;
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
    adjustedFactors: row.adjusted_factors || null,
    enrichmentId: row.enrichment_id || null,
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
  if (data.adjustedFactors !== undefined) result.adjusted_factors = data.adjustedFactors ? JSON.stringify(data.adjustedFactors) : null;
  if (data.enrichmentId !== undefined) result.enrichment_id = data.enrichmentId;
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
// SCORED CANDIDATES (shadow scoring)
// ---------------------------------------------------------------------------
async function saveScoredCandidate(data) {
  if (!pool) return;
  await query(
    `INSERT INTO scored_candidates (sport, selection, event, meeting, league, market, odds, confidence,
     model_probability, implied_probability, edge, analyst, date, kickoff, was_published, tip_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [data.sport, data.selection, data.event || null, data.meeting || null, data.league || null,
     data.market || null, data.odds || null, data.confidence || null,
     data.modelProbability || null, data.impliedProbability || null, data.edge || null,
     data.analyst || null, data.date, data.kickoff || null,
     data.wasPublished || false, data.tipId || null]
  );
}

async function getScoredCandidates(filters) {
  if (!pool) return [];
  var sql = 'SELECT * FROM scored_candidates';
  var conditions = [];
  var values = [];
  var idx = 1;
  if (filters) {
    if (filters.date) { conditions.push('date = $' + idx); values.push(filters.date); idx++; }
    if (filters.sport) { conditions.push('sport = $' + idx); values.push(filters.sport); idx++; }
    if (filters.settled !== undefined) { conditions.push('settled = $' + idx); values.push(filters.settled); idx++; }
  }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY date DESC, confidence DESC LIMIT 500';
  var { rows } = await query(sql, values);
  return rows.map(function(r) {
    return {
      id: r.id, sport: r.sport, selection: r.selection, event: r.event, meeting: r.meeting,
      league: r.league, market: r.market, odds: parseFloat(r.odds) || 0,
      confidence: r.confidence, modelProbability: parseFloat(r.model_probability) || 0,
      impliedProbability: parseFloat(r.implied_probability) || 0, edge: parseFloat(r.edge) || 0,
      analyst: r.analyst, date: r.date, kickoff: r.kickoff,
      wasPublished: r.was_published, tipId: r.tip_id,
      result: r.result, pnl: parseFloat(r.pnl) || 0, settled: r.settled, settledAt: r.settled_at,
    };
  });
}

async function settleCandidate(id, result, pnl) {
  if (!pool) return;
  await query(
    'UPDATE scored_candidates SET result = $2, pnl = $3, settled = true, settled_at = NOW() WHERE id = $1',
    [id, result, pnl]
  );
}

async function getCandidateStats(days) {
  if (!pool) return {};
  var d = days || 30;
  var { rows } = await query(`
    SELECT
      sport,
      was_published,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE result = 'won') as wins,
      COUNT(*) FILTER (WHERE result = 'lost') as losses,
      COUNT(*) FILTER (WHERE settled = true) as settled_count,
      AVG(odds) FILTER (WHERE result = 'won') as avg_winner_odds,
      SUM(pnl) FILTER (WHERE settled = true) as total_pnl
    FROM scored_candidates
    WHERE date >= CURRENT_DATE - $1
    GROUP BY sport, was_published
    ORDER BY sport, was_published DESC
  `, [d]);
  return rows;
}

// ---------------------------------------------------------------------------
// CREDIT TRANSACTIONS
// ---------------------------------------------------------------------------
async function recordCreditTransaction(data) {
  if (!pool) return;
  await query(
    'INSERT INTO credit_transactions (user_id, amount, balance_after, type, description, tip_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [data.userId, data.amount, data.balanceAfter, data.type, data.description || null, data.tipId || null]
  );
}

async function getCreditHistory(userId, limit) {
  if (!pool) return [];
  var lim = limit || 20;
  const { rows } = await query(
    'SELECT * FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, lim]
  );
  return rows.map(function(r) {
    return {
      id: r.id, userId: r.user_id, amount: r.amount, balanceAfter: r.balance_after,
      type: r.type, description: r.description, tipId: r.tip_id, createdAt: r.created_at,
    };
  });
}

/**
 * Deduct credits from a user. Returns the new balance or -1 if insufficient.
 * Atomic: uses UPDATE with WHERE credits >= cost to prevent going negative.
 */
async function deductCredits(userId, cost, type, description, tipId) {
  if (!pool) return -1;
  const { rows } = await query(
    'UPDATE users SET credits = credits - $2 WHERE id = $1 AND credits >= $2 RETURNING credits',
    [userId, cost]
  );
  if (rows.length === 0) return -1; // insufficient credits
  var newBalance = parseInt(rows[0].credits);
  await recordCreditTransaction({ userId: userId, amount: -cost, balanceAfter: newBalance, type: type, description: description, tipId: tipId });
  return newBalance;
}

/**
 * Add credits to a user.
 */
async function addCredits(userId, amount, type, description) {
  if (!pool) return 0;
  const { rows } = await query(
    'UPDATE users SET credits = credits + $2 WHERE id = $1 RETURNING credits',
    [userId, amount]
  );
  if (rows.length === 0) return 0;
  var newBalance = parseInt(rows[0].credits);
  await recordCreditTransaction({ userId: userId, amount: amount, balanceAfter: newBalance, type: type, description: description });
  return newBalance;
}

// ---------------------------------------------------------------------------
// SONAR CACHE
// ---------------------------------------------------------------------------
async function getSonarCache(cacheKey) {
  if (!pool) return null;
  const { rows } = await query(
    "SELECT * FROM sonar_cache WHERE cache_key = $1 AND status = 'complete' AND expires_at > NOW()",
    [cacheKey]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function claimSonarCache(cacheKey, callSite, entityId, timeBucket, ttlSeconds) {
  if (!pool) return false;
  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await query(
      `INSERT INTO sonar_cache (cache_key, call_site, entity_id, time_bucket, status, ttl_seconds, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6) ON CONFLICT (cache_key) DO NOTHING`,
      [cacheKey, callSite, entityId, timeBucket, ttlSeconds, expiresAt]
    );
    // Check if we won the claim
    const { rows } = await query(
      "SELECT status FROM sonar_cache WHERE cache_key = $1 AND status = 'pending' AND claimed_at > NOW() - INTERVAL '10 seconds'",
      [cacheKey]
    );
    return rows.length > 0;
  } catch (e) { return false; }
}

async function completeSonarCache(cacheKey, responseJson, citations, inputTokens, outputTokens, searchCount, latencyMs) {
  if (!pool) return;
  await query(
    `UPDATE sonar_cache SET status = 'complete', response_json = $2, citations = $3,
     input_tokens = $4, output_tokens = $5, search_count = $6, latency_ms = $7 WHERE cache_key = $1`,
    [cacheKey, JSON.stringify(responseJson), JSON.stringify(citations), inputTokens, outputTokens, searchCount || 0, latencyMs]
  );
}

/**
 * Check if another caller has claimed this cache key.
 * Returns 'in_flight' if a pending claim exists within the stale threshold.
 * Returns 'stale' if the claim is older than the threshold (caller crashed).
 * Returns 'none' if no pending claim exists.
 * @param {string} cacheKey
 * @param {number} staleThresholdMs - default 30000 (30s). Should be (timeout * (retries+1)) + 5s.
 */
async function checkSonarClaim(cacheKey, staleThresholdMs) {
  if (!pool) return 'none';
  var threshold = Math.max(staleThresholdMs || 30000, 30000);
  var thresholdSec = Math.ceil(threshold / 1000);
  const { rows } = await query(
    "SELECT status, claimed_at FROM sonar_cache WHERE cache_key = $1 AND status = 'pending'",
    [cacheKey]
  );
  if (rows.length === 0) return 'none';
  var claimedAt = new Date(rows[0].claimed_at);
  var ageMs = Date.now() - claimedAt.getTime();
  return ageMs > threshold ? 'stale' : 'in_flight';
}

async function reclaimStaleSonarCache(cacheKey, staleThresholdMs) {
  if (!pool) return false;
  var thresholdSec = Math.ceil(Math.max(staleThresholdMs || 30000, 30000) / 1000);
  const { rowCount } = await query(
    `UPDATE sonar_cache SET status = 'pending', claimed_at = NOW()
     WHERE cache_key = $1 AND status = 'pending' AND claimed_at < NOW() - make_interval(secs => $2)`,
    [cacheKey, thresholdSec]
  );
  return rowCount > 0;
}

async function cleanExpiredSonarCache() {
  if (!pool) return;
  await query("DELETE FROM sonar_cache WHERE expires_at < NOW()");
}

// ---------------------------------------------------------------------------
// SONAR SPEND LEDGER
// ---------------------------------------------------------------------------
async function recordSonarSpend(data) {
  if (!pool) return;
  await query(
    `INSERT INTO sonar_spend_ledger (call_site, entity_id, model, input_tokens, output_tokens,
     search_count, token_cost_usd, request_fee_usd, cost_usd, tip_id, bulletin_id,
     latency_ms, cache_hit, enrichment_skipped, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [data.callSite, data.entityId || null, data.model || 'sonar', data.inputTokens || 0,
     data.outputTokens || 0, data.searchCount || 0, data.tokenCostUsd || 0,
     data.requestFeeUsd || 0, data.costUsd || 0, data.tipId || null, data.bulletinId || null,
     data.latencyMs || null, data.cacheHit || false, data.enrichmentSkipped || null,
     data.error || null]
  );
}

async function getDailySpend(date) {
  if (!pool) return 0;
  const d = date || new Date().toISOString().split('T')[0];
  const { rows } = await query(
    'SELECT COALESCE(SUM(cost_usd), 0) as total FROM sonar_spend_ledger WHERE date = $1', [d]
  );
  return parseFloat(rows[0].total) || 0;
}

async function getSpendSummary(days) {
  if (!pool) return [];
  const { rows } = await query(
    `SELECT date, call_site, COUNT(*) as calls, SUM(cost_usd) as total_cost,
     SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END) as cache_hits,
     AVG(latency_ms) as avg_latency_ms
     FROM sonar_spend_ledger WHERE date >= CURRENT_DATE - $1
     GROUP BY date, call_site ORDER BY date DESC, call_site`,
    [days || 7]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// SONAR ADMIN EVENTS
// ---------------------------------------------------------------------------
async function createSonarAdminEvent(data) {
  if (!pool) return;
  await query(
    'INSERT INTO sonar_admin_events (action, user_id, user_email, reason) VALUES ($1,$2,$3,$4)',
    [data.action, data.userId || null, data.userEmail || null, data.reason || null]
  );
}

async function getLatestSonarAdminEvent() {
  if (!pool) return null;
  const { rows } = await query(
    "SELECT * FROM sonar_admin_events WHERE action IN ('disabled', 'enabled') ORDER BY created_at DESC LIMIT 1"
  );
  return rows.length > 0 ? { action: rows[0].action, createdAt: rows[0].created_at, userEmail: rows[0].user_email } : null;
}

// ---------------------------------------------------------------------------
// TIP ENRICHMENT
// ---------------------------------------------------------------------------
async function createTipEnrichment(data) {
  if (!pool) return null;
  // CHECK constraint enforces: used_in_decision cannot be true when parse_error or low_quality is true
  var usedInDecision = data.usedInDecision || false;
  if (data.parseError || data.lowQuality) usedInDecision = false;
  const { rows } = await query(
    `INSERT INTO tip_enrichment (tip_id, call_site, raw_response, extracted_signals, citations,
     dropped_claims, low_quality, parse_error, used_in_decision, sonar_model,
     input_tokens, output_tokens, search_count, request_fee_usd, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [data.tipId, data.callSite || 'per-tip', JSON.stringify(data.rawResponse),
     JSON.stringify(data.extractedSignals || {}), JSON.stringify(data.citations || []),
     JSON.stringify(data.droppedClaims || []), data.lowQuality || false,
     data.parseError || false, usedInDecision, data.sonarModel || 'sonar',
     data.inputTokens || null, data.outputTokens || null, data.searchCount || 0,
     data.requestFeeUsd || 0, data.latencyMs || null]
  );
  return rows.length > 0 ? rows[0].id : null;
}

async function getTipEnrichment(tipId) {
  if (!pool) return null;
  const { rows } = await query('SELECT * FROM tip_enrichment WHERE tip_id = $1 ORDER BY created_at DESC LIMIT 1', [tipId]);
  if (rows.length === 0) return null;
  var r = rows[0];
  return {
    id: r.id, tipId: r.tip_id, callSite: r.call_site,
    rawResponse: r.raw_response, extractedSignals: r.extracted_signals,
    citations: r.citations, droppedClaims: r.dropped_claims,
    lowQuality: r.low_quality, parseError: r.parse_error,
    usedInDecision: r.used_in_decision, sonarModel: r.sonar_model,
    inputTokens: r.input_tokens, outputTokens: r.output_tokens,
    latencyMs: r.latency_ms, createdAt: r.created_at,
  };
}

async function getEnrichmentQualityStats(days) {
  if (!pool) return {};
  const { rows } = await query(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN used_in_decision THEN 1 ELSE 0 END) as used,
       SUM(CASE WHEN low_quality THEN 1 ELSE 0 END) as low_quality,
       SUM(CASE WHEN parse_error THEN 1 ELSE 0 END) as parse_errors,
       AVG(latency_ms) as avg_latency
     FROM tip_enrichment WHERE created_at > NOW() - ($1 || ' days')::INTERVAL`,
    [days || 30]
  );
  return rows[0] || {};
}

// ---------------------------------------------------------------------------
// ENRICHMENT QUALITY SNAPSHOTS
// ---------------------------------------------------------------------------
async function upsertQualitySnapshot(data) {
  if (!pool) return;
  await query(
    `INSERT INTO enrichment_quality_snapshots
     (snapshot_date, is_aggregate, signal_key, sport, tips_with, avg_clv_with, roi_pct_with, strike_rate_with,
      tips_without, avg_clv_without, roi_pct_without, strike_rate_without, clv_delta, roi_delta_pct, verdict, sample_sufficient)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (snapshot_date, is_aggregate, signal_key, sport) DO UPDATE SET
       tips_with=$5, avg_clv_with=$6, roi_pct_with=$7, strike_rate_with=$8,
       tips_without=$9, avg_clv_without=$10, roi_pct_without=$11, strike_rate_without=$12,
       clv_delta=$13, roi_delta_pct=$14, verdict=$15, sample_sufficient=$16`,
    [data.snapshotDate, data.isAggregate || false, data.signalKey || null, data.sport || null,
     data.tipsWith || 0, data.avgClvWith, data.roiPctWith, data.strikeRateWith,
     data.tipsWithout || 0, data.avgClvWithout, data.roiPctWithout, data.strikeRateWithout,
     data.clvDelta, data.roiDeltaPct, data.verdict || null, data.sampleSufficient !== false]
  );
}

async function getQualitySnapshots(date) {
  if (!pool) return [];
  var d = date || new Date().toISOString().split('T')[0];
  const { rows } = await query(
    'SELECT * FROM enrichment_quality_snapshots WHERE snapshot_date = $1 ORDER BY is_aggregate DESC, clv_delta DESC NULLS LAST',
    [d]
  );
  return rows.map(_mapQualityRow);
}

async function getLatestQualitySnapshot() {
  if (!pool) return [];
  const { rows } = await query(
    'SELECT DISTINCT ON (is_aggregate, signal_key, sport) * FROM enrichment_quality_snapshots ORDER BY is_aggregate, signal_key, sport, snapshot_date DESC'
  );
  return rows.map(_mapQualityRow);
}

function _mapQualityRow(r) {
  return {
    snapshotDate: r.snapshot_date, isAggregate: r.is_aggregate, signalKey: r.signal_key,
    sport: r.sport || null,
    tipsWith: r.tips_with, avgClvWith: parseFloat(r.avg_clv_with) || 0,
    roiPctWith: parseFloat(r.roi_pct_with) || 0, strikeRateWith: parseFloat(r.strike_rate_with) || 0,
    tipsWithout: r.tips_without, avgClvWithout: parseFloat(r.avg_clv_without) || 0,
    roiPctWithout: parseFloat(r.roi_pct_without) || 0, strikeRateWithout: parseFloat(r.strike_rate_without) || 0,
    clvDelta: parseFloat(r.clv_delta) || 0, roiDeltaPct: parseFloat(r.roi_delta_pct) || 0,
    verdict: r.verdict, sampleSufficient: r.sample_sufficient,
  };
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
  // Scored Candidates (shadow scoring)
  saveScoredCandidate, getScoredCandidates, settleCandidate, getCandidateStats,
  // Credits
  recordCreditTransaction, getCreditHistory, deductCredits, addCredits,
  // Sonar Cache
  getSonarCache, claimSonarCache, completeSonarCache, checkSonarClaim, reclaimStaleSonarCache, cleanExpiredSonarCache,
  // Sonar Spend
  recordSonarSpend, getDailySpend, getSpendSummary,
  // Sonar Admin Events
  createSonarAdminEvent, getLatestSonarAdminEvent,
  // Tip Enrichment
  createTipEnrichment, getTipEnrichment, getEnrichmentQualityStats,
  // Quality Loop
  upsertQualitySnapshot, getQualitySnapshots, getLatestQualitySnapshot,
  // User Bets (Personal ROI)
  backTip, unbackTip, getUserBets, settleUserBets, getUserROI,
  // Match Predictions (Our Take) + Race Predictions (Our Pick)
  saveMatchPrediction, getMatchPredictions, settleMatchPredictions, getMatchPredictionStats,
  saveRacePrediction, getRacePredictions, settleRacePredictions,
  // Push Subscriptions
  savePushSubscription, removePushSubscription, getPushSubscriptions, getAllPushSubscriptions,
};

// ---------------------------------------------------------------------------
// MATCH PREDICTIONS — "Our Take" on every football game
// ---------------------------------------------------------------------------
async function saveMatchPrediction(data) {
  if (!pool) return null;
  var { rows } = await query(
    `INSERT INTO match_predictions (fixture_id, home_team, away_team, league, kickoff, market, pick, confidence, reason, date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (fixture_id, date) DO NOTHING RETURNING id`,
    [data.fixtureId, data.homeTeam, data.awayTeam, data.league, data.kickoff,
     data.market, data.pick, data.confidence, data.reason, data.date || new Date().toISOString().split('T')[0]]
  );
  return rows.length > 0 ? rows[0].id : null;
}

async function getMatchPredictions(filters) {
  if (!pool) return [];
  var sql = 'SELECT * FROM match_predictions';
  var conditions = [];
  var values = [];
  var idx = 1;
  if (filters) {
    if (filters.date) { conditions.push('date = $' + idx); values.push(filters.date); idx++; }
    if (filters.correct !== undefined) { conditions.push('correct = $' + idx); values.push(filters.correct); idx++; }
  }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY date DESC, kickoff ASC LIMIT 500';
  var { rows } = await query(sql, values);
  return rows;
}

async function settleMatchPredictions(footballResults) {
  if (!pool || !footballResults || footballResults.length === 0) return 0;
  var settled = 0;
  for (var i = 0; i < footballResults.length; i++) {
    var match = footballResults[i];
    if (match.homeScore === null || match.awayScore === null) continue;
    var homeGoals = parseInt(match.homeScore) || 0;
    var awayGoals = parseInt(match.awayScore) || 0;
    var totalGoals = homeGoals + awayGoals;

    // Find prediction for this fixture
    var { rows } = await query(
      'SELECT * FROM match_predictions WHERE fixture_id = $1 AND result IS NULL',
      [match.fixtureId || match.id]
    );
    if (rows.length === 0) continue;

    var pred = rows[0];
    var pick = (pred.pick || '').toLowerCase();
    var market = (pred.market || '').toLowerCase();
    var correct = false;

    // Evaluate prediction
    if (market.includes('result') || market.includes('match')) {
      if (pick.includes('draw')) correct = homeGoals === awayGoals;
      else if (pick.includes(pred.home_team.toLowerCase())) correct = homeGoals > awayGoals;
      else if (pick.includes(pred.away_team.toLowerCase())) correct = awayGoals > homeGoals;
    } else if (market.includes('both teams') || market.includes('btts')) {
      correct = pick.includes('yes') ? (homeGoals > 0 && awayGoals > 0) : !(homeGoals > 0 && awayGoals > 0);
    } else if (market.includes('over')) {
      if (pick.includes('3.5')) correct = totalGoals > 3;
      else if (pick.includes('2.5')) correct = totalGoals > 2;
      else if (pick.includes('1.5')) correct = totalGoals > 1;
    } else if (market.includes('under')) {
      if (pick.includes('2.5')) correct = totalGoals < 3;
      else if (pick.includes('1.5')) correct = totalGoals < 2;
    }

    var resultStr = homeGoals + '-' + awayGoals;
    await query(
      'UPDATE match_predictions SET actual_home_goals = $2, actual_away_goals = $3, result = $4, correct = $5 WHERE id = $1',
      [pred.id, homeGoals, awayGoals, resultStr, correct]
    );
    settled++;
  }
  return settled;
}

async function getMatchPredictionStats(days) {
  if (!pool) return {};
  var d = days || 30;
  var { rows } = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE correct = true) as correct_count,
      COUNT(*) FILTER (WHERE correct = false) as incorrect_count,
      COUNT(*) FILTER (WHERE result IS NULL) as pending,
      COUNT(*) FILTER (WHERE market ILIKE '%result%' AND correct = true) as match_result_correct,
      COUNT(*) FILTER (WHERE market ILIKE '%result%' AND result IS NOT NULL) as match_result_total,
      COUNT(*) FILTER (WHERE market ILIKE '%btts%' OR market ILIKE '%both teams%') FILTER (WHERE correct = true) as btts_correct,
      COUNT(*) FILTER (WHERE market ILIKE '%btts%' OR market ILIKE '%both teams%') FILTER (WHERE result IS NOT NULL) as btts_total,
      COUNT(*) FILTER (WHERE market ILIKE '%over%' OR market ILIKE '%under%' OR market ILIKE '%goal%') FILTER (WHERE correct = true) as goals_correct,
      COUNT(*) FILTER (WHERE market ILIKE '%over%' OR market ILIKE '%under%' OR market ILIKE '%goal%') FILTER (WHERE result IS NOT NULL) as goals_total
    FROM match_predictions WHERE date >= CURRENT_DATE - $1
  `, [d]);
  if (rows.length === 0) return {};
  var r = rows[0];
  var total = parseInt(r.total) || 0;
  var correct = parseInt(r.correct_count) || 0;
  var settled = total - (parseInt(r.pending) || 0);
  return {
    total: total, correct: correct, incorrect: parseInt(r.incorrect_count) || 0, pending: parseInt(r.pending) || 0,
    accuracy: settled > 0 ? Math.round((correct / settled) * 1000) / 10 : 0,
    byMarket: {
      matchResult: { correct: parseInt(r.match_result_correct) || 0, total: parseInt(r.match_result_total) || 0 },
      btts: { correct: parseInt(r.btts_correct) || 0, total: parseInt(r.btts_total) || 0 },
      goals: { correct: parseInt(r.goals_correct) || 0, total: parseInt(r.goals_total) || 0 },
    }
  };
}

// ---------------------------------------------------------------------------
// RACE PREDICTIONS — "Our Pick" in every race
// ---------------------------------------------------------------------------
async function saveRacePrediction(data) {
  if (!pool) return null;
  var { rows } = await query(
    `INSERT INTO race_predictions (meeting, race_time, race_name, selection, odds, confidence, edge, runners, date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (meeting, race_time, date) DO NOTHING RETURNING id`,
    [data.meeting, data.raceTime, data.raceName, data.selection, data.odds,
     data.confidence, data.edge, data.runners, data.date || new Date().toISOString().split('T')[0]]
  );
  return rows.length > 0 ? rows[0].id : null;
}

async function getRacePredictions(filters) {
  if (!pool) return [];
  var sql = 'SELECT * FROM race_predictions';
  var conditions = [];
  var values = [];
  var idx = 1;
  if (filters) {
    if (filters.date) { conditions.push('date = $' + idx); values.push(filters.date); idx++; }
  }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY date DESC, race_time ASC LIMIT 500';
  var { rows } = await query(sql, values);
  return rows;
}

async function settleRacePredictions(raceResults) {
  if (!pool || !raceResults || raceResults.length === 0) return 0;
  var settled = 0;
  var normHorse = function(name) {
    if (!name) return '';
    return name.toLowerCase().replace(/\s*\([a-z]{2,4}\)\s*$/i, '').trim();
  };

  for (var i = 0; i < raceResults.length; i++) {
    var race = raceResults[i];
    if (!race.runners || race.runners.length === 0) continue;

    var winner = race.runners.find(function(r) { return parseInt(r.position, 10) === 1; });
    if (!winner) continue;

    var meeting = (race.course || race.meeting || '').toLowerCase().trim();
    var raceTime = race.time || race.off_time || '';

    // Find matching prediction
    var { rows } = await query(
      "SELECT * FROM race_predictions WHERE result IS NULL AND LOWER(meeting) = $1 AND race_time = $2",
      [meeting, raceTime]
    );
    if (rows.length === 0) {
      // Try partial match on meeting name
      var { rows: rows2 } = await query(
        "SELECT * FROM race_predictions WHERE result IS NULL AND (LOWER(meeting) LIKE $1 OR $1 LIKE '%' || LOWER(meeting) || '%') AND date = CURRENT_DATE",
        ['%' + meeting + '%']
      );
      if (rows2.length > 0) rows = rows2;
    }
    if (rows.length === 0) continue;

    var pred = rows[0];
    var predSelection = normHorse(pred.selection);
    var winnerName = normHorse(winner.horse);
    var correct = predSelection === winnerName;

    // Check if placed (top 3)
    var tipRunner = race.runners.find(function(r) { return normHorse(r.horse) === predSelection; });
    var finishPos = tipRunner ? parseInt(tipRunner.position, 10) : null;

    await query(
      'UPDATE race_predictions SET result = $2, finish_position = $3, winner = $4, winner_odds = $5, correct = $6 WHERE id = $1',
      [pred.id, winner.horse + (winner.sp ? ' (SP ' + winner.sp + ')' : ''), finishPos, winner.horse, winner.sp ? parseFloat(winner.sp) : null, correct]
    );
    settled++;
  }
  return settled;
}

// ---------------------------------------------------------------------------
// PUSH SUBSCRIPTIONS
// ---------------------------------------------------------------------------
async function savePushSubscription(userId, subscription) {
  if (!pool) return null;
  var { rows } = await query(
    'INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2) ON CONFLICT (user_id, subscription) DO NOTHING RETURNING id',
    [userId, JSON.stringify(subscription)]
  );
  return rows.length > 0 ? rows[0].id : null;
}

async function removePushSubscription(id) {
  if (!pool) return;
  await query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
}

async function getPushSubscriptions(userId) {
  if (!pool) return [];
  var { rows } = await query('SELECT id, subscription FROM push_subscriptions WHERE user_id = $1', [userId]);
  return rows.map(function(r) { return { id: r.id, subscription: r.subscription }; });
}

async function getAllPushSubscriptions(audience) {
  if (!pool) return [];
  var sql = 'SELECT ps.id, ps.subscription, ps.user_id FROM push_subscriptions ps';
  if (audience === 'premium' || audience === 'vip') {
    sql += " JOIN users u ON ps.user_id = u.id WHERE u.subscription IN ('premium', 'vip')";
  } else if (audience === 'vip-only') {
    sql += " JOIN users u ON ps.user_id = u.id WHERE u.subscription = 'vip'";
  }
  var { rows } = await query(sql);
  return rows.map(function(r) { return { id: r.id, subscription: r.subscription, userId: r.user_id }; });
}

// ---------------------------------------------------------------------------
// USER BETS — server-side bet tracking for Personal ROI Dashboard
// ---------------------------------------------------------------------------
async function backTip(userId, data) {
  if (!pool) return null;
  var { rows } = await query(
    `INSERT INTO user_bets (user_id, tip_id, selection, event, sport, market, odds, confidence, analyst, date, stake)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (user_id, tip_id) DO NOTHING RETURNING id`,
    [userId, data.tipId, data.selection, data.event, data.sport, data.market,
     data.odds, data.confidence, data.analyst, data.date, data.stake || 1]
  );
  return rows.length > 0 ? rows[0].id : null;
}

async function unbackTip(userId, tipId) {
  if (!pool) return;
  await query('DELETE FROM user_bets WHERE user_id = $1 AND tip_id = $2', [userId, tipId]);
}

async function getUserBets(userId, limit) {
  if (!pool) return [];
  var lim = limit || 200;
  var { rows } = await query(
    'SELECT * FROM user_bets WHERE user_id = $1 ORDER BY date DESC, backed_at DESC LIMIT $2',
    [userId, lim]
  );
  return rows.map(function(r) {
    return {
      id: r.id, tipId: r.tip_id, selection: r.selection, event: r.event,
      sport: r.sport, market: r.market, odds: parseFloat(r.odds) || 0,
      confidence: r.confidence, analyst: r.analyst, result: r.result,
      pnl: parseFloat(r.pnl) || 0, stake: parseFloat(r.stake) || 1,
      settled: r.settled, date: r.date, backedAt: r.backed_at, settledAt: r.settled_at,
    };
  });
}

async function settleUserBets() {
  if (!pool) return 0;
  // Match unsettled user bets against the results table
  var { rows } = await query(`
    UPDATE user_bets ub SET
      result = r.result,
      pnl = CASE
        WHEN r.result = 'won' THEN (ub.odds - 1) * ub.stake
        WHEN r.result = 'placed' THEN ((ub.odds - 1) / 4) * ub.stake
        WHEN r.result = 'lost' THEN -ub.stake
        ELSE 0
      END,
      settled = true,
      settled_at = NOW()
    FROM results r
    WHERE ub.tip_id = r.tip_id AND ub.settled = false AND r.result IS NOT NULL
    RETURNING ub.id
  `);
  return rows.length;
}

async function getUserROI(userId) {
  if (!pool) return {};
  var { rows } = await query(`
    SELECT
      COUNT(*) as total_bets,
      COUNT(*) FILTER (WHERE settled = true) as settled_bets,
      COUNT(*) FILTER (WHERE result = 'won') as wins,
      COUNT(*) FILTER (WHERE result = 'lost') as losses,
      COUNT(*) FILTER (WHERE result = 'placed') as placed,
      COUNT(*) FILTER (WHERE settled = false) as pending,
      COALESCE(SUM(pnl) FILTER (WHERE settled = true), 0) as total_pnl,
      COALESCE(SUM(stake) FILTER (WHERE settled = true), 0) as total_staked,
      COALESCE(MAX(pnl) FILTER (WHERE result = 'won'), 0) as best_win_pnl,
      -- By sport
      COUNT(*) FILTER (WHERE sport = 'racing' AND settled = true) as racing_total,
      COUNT(*) FILTER (WHERE sport = 'racing' AND result = 'won') as racing_wins,
      COALESCE(SUM(pnl) FILTER (WHERE sport = 'racing' AND settled = true), 0) as racing_pnl,
      COUNT(*) FILTER (WHERE sport = 'football' AND settled = true) as football_total,
      COUNT(*) FILTER (WHERE sport = 'football' AND result = 'won') as football_wins,
      COALESCE(SUM(pnl) FILTER (WHERE sport = 'football' AND settled = true), 0) as football_pnl,
      -- By analyst
      COUNT(*) FILTER (WHERE analyst = 'The Professor' AND settled = true) as prof_total,
      COUNT(*) FILTER (WHERE analyst = 'The Professor' AND (result = 'won' OR result = 'placed')) as prof_wins,
      COALESCE(SUM(pnl) FILTER (WHERE analyst = 'The Professor' AND settled = true), 0) as prof_pnl,
      COUNT(*) FILTER (WHERE analyst = 'The Scout' AND settled = true) as scout_total,
      COUNT(*) FILTER (WHERE analyst = 'The Scout' AND (result = 'won' OR result = 'placed')) as scout_wins,
      COALESCE(SUM(pnl) FILTER (WHERE analyst = 'The Scout' AND settled = true), 0) as scout_pnl,
      COUNT(*) FILTER (WHERE analyst = 'The Clocker' AND settled = true) as clocker_total,
      COUNT(*) FILTER (WHERE analyst = 'The Clocker' AND (result = 'won' OR result = 'placed')) as clocker_wins,
      COALESCE(SUM(pnl) FILTER (WHERE analyst = 'The Clocker' AND settled = true), 0) as clocker_pnl,
      COUNT(*) FILTER (WHERE analyst = 'The Edge' AND settled = true) as edge_total,
      COUNT(*) FILTER (WHERE analyst = 'The Edge' AND (result = 'won' OR result = 'placed')) as edge_wins,
      COALESCE(SUM(pnl) FILTER (WHERE analyst = 'The Edge' AND settled = true), 0) as edge_pnl,
      -- By confidence tier
      COUNT(*) FILTER (WHERE confidence >= 9 AND settled = true) as elite_total,
      COUNT(*) FILTER (WHERE confidence >= 9 AND (result = 'won' OR result = 'placed')) as elite_wins,
      COALESCE(SUM(pnl) FILTER (WHERE confidence >= 9 AND settled = true), 0) as elite_pnl,
      COUNT(*) FILTER (WHERE confidence >= 7 AND confidence < 9 AND settled = true) as strong_total,
      COUNT(*) FILTER (WHERE confidence >= 7 AND confidence < 9 AND (result = 'won' OR result = 'placed')) as strong_wins,
      COALESCE(SUM(pnl) FILTER (WHERE confidence >= 7 AND confidence < 9 AND settled = true), 0) as strong_pnl,
      COUNT(*) FILTER (WHERE confidence < 7 AND settled = true) as other_total,
      COUNT(*) FILTER (WHERE confidence < 7 AND (result = 'won' OR result = 'placed')) as other_wins,
      COALESCE(SUM(pnl) FILTER (WHERE confidence < 7 AND settled = true), 0) as other_pnl
    FROM user_bets WHERE user_id = $1
  `, [userId]);

  if (rows.length === 0) return {};
  var r = rows[0];
  var totalStaked = parseFloat(r.total_staked) || 0;
  var totalPnl = parseFloat(r.total_pnl) || 0;
  return {
    totalBets: parseInt(r.total_bets), settledBets: parseInt(r.settled_bets),
    wins: parseInt(r.wins), losses: parseInt(r.losses), placed: parseInt(r.placed), pending: parseInt(r.pending),
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalStaked: Math.round(totalStaked * 100) / 100,
    roi: totalStaked > 0 ? Math.round((totalPnl / totalStaked) * 10000) / 100 : 0,
    strikeRate: (parseInt(r.settled_bets) - parseInt(r.pending)) > 0
      ? Math.round(((parseInt(r.wins) + parseInt(r.placed)) / (parseInt(r.settled_bets))) * 1000) / 10 : 0,
    bestWinPnl: parseFloat(r.best_win_pnl) || 0,
    bySport: {
      racing: { total: parseInt(r.racing_total), wins: parseInt(r.racing_wins), pnl: parseFloat(r.racing_pnl) || 0 },
      football: { total: parseInt(r.football_total), wins: parseInt(r.football_wins), pnl: parseFloat(r.football_pnl) || 0 },
    },
    byAnalyst: {
      'The Professor': { total: parseInt(r.prof_total), wins: parseInt(r.prof_wins), pnl: parseFloat(r.prof_pnl) || 0 },
      'The Scout': { total: parseInt(r.scout_total), wins: parseInt(r.scout_wins), pnl: parseFloat(r.scout_pnl) || 0 },
      'The Clocker': { total: parseInt(r.clocker_total), wins: parseInt(r.clocker_wins), pnl: parseFloat(r.clocker_pnl) || 0 },
      'The Edge': { total: parseInt(r.edge_total), wins: parseInt(r.edge_wins), pnl: parseFloat(r.edge_pnl) || 0 },
    },
    byConfidence: {
      elite: { total: parseInt(r.elite_total), wins: parseInt(r.elite_wins), pnl: parseFloat(r.elite_pnl) || 0 },
      strong: { total: parseInt(r.strong_total), wins: parseInt(r.strong_wins), pnl: parseFloat(r.strong_pnl) || 0 },
      other: { total: parseInt(r.other_total), wins: parseInt(r.other_wins), pnl: parseFloat(r.other_pnl) || 0 },
    },
  };
}
