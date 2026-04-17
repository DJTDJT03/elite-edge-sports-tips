#!/usr/bin/env node
/**
 * Elite Edge Sports Tips — Database Seeder
 *
 * Imports existing JSON data files into PostgreSQL.
 * Run: node server/db/seed.js
 * Or:  npm run db:seed
 *
 * Run migrate.js first to create tables.
 * Skips seeding if tables already have data (use --force to override).
 */

if (!process.env.DATABASE_URL) {
  console.error('[seed] ERROR: DATABASE_URL not set.');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const isRailway = process.env.DATABASE_URL.includes('railway');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRailway ? { rejectUnauthorized: false } : false,
});

const DATA_DIR = path.join(__dirname, '..', 'data');
const forceMode = process.argv.includes('--force');

function readData(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch (err) {
    console.log('[seed] Warning: Could not read ' + file + ': ' + err.message);
    return null;
  }
}

async function seedUsers(client) {
  const users = readData('sample-users.json');
  if (!users || !Array.isArray(users) || users.length === 0) return 0;

  let count = 0;
  for (const u of users) {
    try {
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, role, subscription, subscription_expiry,
         joined, bank, session_id, failed_attempts, lock_until, flagged, trusted_devices,
         email_prefs, agreement_timestamp, agreement_text, login_history)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO NOTHING`,
        [
          u.id, u.email, u.password, u.name, u.role || 'free', u.subscription || 'free',
          u.subscriptionExpiry || null, u.joined || new Date().toISOString().split('T')[0],
          u.bank || 100, u.sessionId || null, u.failedAttempts || 0, u.lockUntil || null,
          u.flagged || false, u.trustedDevices || [],
          JSON.stringify(u.emailPrefs || { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true }),
          u.agreementTimestamp || null, u.agreementText || null,
          JSON.stringify(u.loginHistory || []),
        ]
      );
      count++;
    } catch (err) {
      console.log('[seed] Skipping user ' + (u.email || u.id) + ': ' + err.message);
    }
  }
  return count;
}

async function seedTips(client) {
  const tips = readData('sample-tips.json');
  if (!tips || !Array.isArray(tips) || tips.length === 0) return 0;

  let count = 0;
  for (const t of tips) {
    try {
      await client.query(
        `INSERT INTO tips (id, sport, event, meeting, race_time, race_class, distance, going,
         league, kickoff, venue, market, selection, odds, confidence, model_probability,
         implied_probability, edge, value_rating, is_premium, status, result, date,
         tipster, tipster_profile, staking, risk_level, analysis, is_nap, is_outsider,
         opening_odds, bookmaker_odds, recent_form, is_weekly_acca, acca_selections)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
         ON CONFLICT (id) DO NOTHING`,
        [
          t.id, t.sport, t.event, t.meeting || null, t.raceTime || null, t.raceClass || null,
          t.distance || null, t.going || null, t.league || null, t.kickoff || null,
          t.venue || null, t.market, t.selection, t.odds, t.confidence,
          t.modelProbability || null, t.impliedProbability || null, t.edge || null,
          t.valueRating || null, t.isPremium || false, t.status || 'active', t.result || null,
          t.date, t.tipster || null, t.tipsterProfile || null, t.staking || null,
          t.riskLevel || null, JSON.stringify(t.analysis || {}), t.isNap || false,
          t.isOutsider || false, t.openingOdds || null, JSON.stringify(t.bookmakerOdds || {}),
          (t.recentForm || []).map(String), t.isWeeklyAcca || false,
          t.accaSelections ? JSON.stringify(t.accaSelections) : null,
        ]
      );
      count++;
    } catch (err) {
      console.log('[seed] Skipping tip ' + (t.id || 'unknown') + ': ' + err.message);
    }
  }
  return count;
}

async function seedResults(client) {
  const results = readData('sample-results.json');
  if (!results || !Array.isArray(results) || results.length === 0) return 0;

  let count = 0;
  for (const r of results) {
    try {
      await client.query(
        `INSERT INTO results (id, tip_id, sport, event, selection, market, odds, stake,
         result, pnl, date, is_premium, tipster_profile, confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id, r.tipId || null, r.sport, r.event, r.selection, r.market,
          r.odds, r.stake, r.result, r.pnl, r.date, r.isPremium || false,
          r.tipsterProfile || null, r.confidence || null,
        ]
      );
      count++;
    } catch (err) {
      console.log('[seed] Skipping result ' + (r.id || 'unknown') + ': ' + err.message);
    }
  }
  return count;
}

async function seedSupport(client) {
  const tickets = readData('sample-support.json');
  if (!tickets || !Array.isArray(tickets) || tickets.length === 0) return 0;

  let count = 0;
  for (const t of tickets) {
    try {
      await client.query(
        `INSERT INTO support_tickets (id, user_id, name, email, subject, message, status, priority, date, replies)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          t.id, t.userId || null, t.name, t.email, t.subject, t.message,
          t.status || 'open', t.priority || 'medium', t.date || new Date().toISOString(),
          JSON.stringify(t.replies || []),
        ]
      );
      count++;
    } catch (err) {
      console.log('[seed] Skipping ticket ' + (t.id || 'unknown') + ': ' + err.message);
    }
  }
  return count;
}

async function seedBlogReviews(client) {
  const reviews = readData('blog-reviews.json');
  if (!reviews || !Array.isArray(reviews) || reviews.length === 0) return 0;

  let count = 0;
  for (const r of reviews) {
    try {
      await client.query(
        `INSERT INTO blog_reviews (slug, title, date, author, excerpt, content, is_auto_generated, stats)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (slug) DO NOTHING`,
        [
          r.slug, r.title, r.date, r.author, r.excerpt, r.content,
          r.isAutoGenerated || false, JSON.stringify(r.stats || {}),
        ]
      );
      count++;
    } catch (err) {
      console.log('[seed] Skipping review ' + (r.slug || 'unknown') + ': ' + err.message);
    }
  }
  return count;
}

async function seedFormGuide(client) {
  const formGuide = readData('sample-form-guide.json');
  if (!formGuide) return 0;

  let count = 0;
  if (formGuide.teams) {
    await client.query(
      `INSERT INTO form_guide (category, data) VALUES ('teams', $1)
       ON CONFLICT (category) DO UPDATE SET data = $1, updated_at = NOW()`,
      [JSON.stringify(formGuide.teams)]
    );
    count++;
  }
  if (formGuide.horses) {
    await client.query(
      `INSERT INTO form_guide (category, data) VALUES ('horses', $1)
       ON CONFLICT (category) DO UPDATE SET data = $1, updated_at = NOW()`,
      [JSON.stringify(formGuide.horses)]
    );
    count++;
  }
  return count;
}

async function seed() {
  console.log('[seed] Connecting to PostgreSQL...');
  const client = await pool.connect();

  try {
    // Check if data already exists (unless --force)
    if (!forceMode) {
      const { rows } = await client.query('SELECT COUNT(*) FROM users');
      if (parseInt(rows[0].count) > 0) {
        console.log('[seed] Database already has data. Use --force to re-seed.');
        return;
      }
    } else {
      console.log('[seed] Force mode — truncating tables...');
      await client.query('TRUNCATE audit_log, notifications, blog_reviews, support_tickets, results, tips, users, form_guide CASCADE');
    }

    await client.query('BEGIN');

    const userCount = await seedUsers(client);
    console.log('[seed] Seeded ' + userCount + ' users');

    const tipCount = await seedTips(client);
    console.log('[seed] Seeded ' + tipCount + ' tips');

    const resultCount = await seedResults(client);
    console.log('[seed] Seeded ' + resultCount + ' results');

    const supportCount = await seedSupport(client);
    console.log('[seed] Seeded ' + supportCount + ' support tickets');

    const reviewCount = await seedBlogReviews(client);
    console.log('[seed] Seeded ' + reviewCount + ' blog reviews');

    const formCount = await seedFormGuide(client);
    console.log('[seed] Seeded ' + formCount + ' form guide entries');

    await client.query('COMMIT');
    console.log('[seed] All data seeded successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
