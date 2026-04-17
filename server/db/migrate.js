#!/usr/bin/env node
/**
 * Elite Edge Sports Tips — Database Migration
 *
 * Creates all PostgreSQL tables for the platform.
 * Run: node server/db/migrate.js
 * Or:  npm run db:migrate
 *
 * Safe to run multiple times — uses IF NOT EXISTS.
 * Requires DATABASE_URL environment variable.
 */

if (!process.env.DATABASE_URL) {
  console.error('[migrate] ERROR: DATABASE_URL not set. Set it in your environment or .env file.');
  process.exit(1);
}

const { Pool } = require('pg');
const isRailway = process.env.DATABASE_URL.includes('railway');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRailway ? { rejectUnauthorized: false } : false,
});

const tables = [
  {
    name: 'users',
    sql: `CREATE TABLE IF NOT EXISTS users (
      id                    TEXT PRIMARY KEY,
      email                 TEXT UNIQUE NOT NULL,
      password_hash         TEXT NOT NULL,
      name                  TEXT NOT NULL,
      role                  TEXT NOT NULL DEFAULT 'free',
      subscription          TEXT NOT NULL DEFAULT 'free',
      subscription_expiry   TIMESTAMPTZ,
      joined                DATE NOT NULL DEFAULT CURRENT_DATE,
      bank                  NUMERIC(10,2) DEFAULT 100,
      session_id            TEXT,
      failed_attempts       INTEGER DEFAULT 0,
      lock_until            TIMESTAMPTZ,
      flagged               BOOLEAN DEFAULT FALSE,
      trusted_devices       TEXT[] DEFAULT '{}',
      email_prefs           JSONB DEFAULT '{"dailyBulletin":true,"weeklySummary":true,"marketing":true,"bigWins":true}',
      agreement_timestamp   TIMESTAMPTZ,
      agreement_text        TEXT,
      login_history         JSONB DEFAULT '[]',
      reset_token           TEXT,
      reset_token_expiry    TIMESTAMPTZ,
      expiry_warned         TEXT,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      updated_at            TIMESTAMPTZ DEFAULT NOW()
    )`,
  },
  {
    name: 'tips',
    sql: `CREATE TABLE IF NOT EXISTS tips (
      id                    TEXT PRIMARY KEY,
      sport                 TEXT NOT NULL,
      event                 TEXT,
      meeting               TEXT,
      race_time             TEXT,
      race_class            TEXT,
      distance              TEXT,
      going                 TEXT,
      league                TEXT,
      kickoff               TEXT,
      venue                 TEXT,
      market                TEXT,
      selection             TEXT NOT NULL,
      odds                  NUMERIC(8,2),
      confidence            INTEGER,
      model_probability     NUMERIC(6,4),
      implied_probability   NUMERIC(6,4),
      edge                  NUMERIC(6,4),
      value_rating          TEXT,
      is_premium            BOOLEAN DEFAULT FALSE,
      status                TEXT DEFAULT 'active',
      result                TEXT,
      date                  DATE,
      tipster               TEXT,
      tipster_profile       TEXT,
      staking               TEXT,
      risk_level            TEXT,
      analysis              JSONB DEFAULT '{}',
      is_nap                BOOLEAN DEFAULT FALSE,
      is_outsider           BOOLEAN DEFAULT FALSE,
      opening_odds          NUMERIC(8,2),
      bookmaker_odds        JSONB DEFAULT '{}',
      recent_form           TEXT[] DEFAULT '{}',
      is_weekly_acca        BOOLEAN DEFAULT FALSE,
      acca_selections       JSONB,
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )`,
  },
  {
    name: 'tips_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_tips_date ON tips(date);
          CREATE INDEX IF NOT EXISTS idx_tips_status ON tips(status);
          CREATE INDEX IF NOT EXISTS idx_tips_sport ON tips(sport)`,
  },
  {
    name: 'results',
    sql: `CREATE TABLE IF NOT EXISTS results (
      id                    TEXT PRIMARY KEY,
      tip_id                TEXT REFERENCES tips(id) ON DELETE SET NULL,
      sport                 TEXT,
      event                 TEXT,
      selection             TEXT,
      market                TEXT,
      odds                  NUMERIC(8,2),
      stake                 NUMERIC(8,2),
      result                TEXT,
      pnl                   NUMERIC(10,2),
      date                  DATE,
      is_premium            BOOLEAN DEFAULT FALSE,
      tipster_profile       TEXT,
      confidence            INTEGER,
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )`,
  },
  {
    name: 'results_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_results_date ON results(date);
          CREATE INDEX IF NOT EXISTS idx_results_tip_id ON results(tip_id);
          CREATE INDEX IF NOT EXISTS idx_results_sport ON results(sport)`,
  },
  {
    name: 'support_tickets',
    sql: `CREATE TABLE IF NOT EXISTS support_tickets (
      id                    TEXT PRIMARY KEY,
      user_id               TEXT,
      name                  TEXT NOT NULL,
      email                 TEXT NOT NULL,
      subject               TEXT NOT NULL,
      message               TEXT NOT NULL,
      status                TEXT DEFAULT 'open',
      priority              TEXT DEFAULT 'medium',
      date                  TIMESTAMPTZ DEFAULT NOW(),
      replies               JSONB DEFAULT '[]',
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )`,
  },
  {
    name: 'blog_reviews',
    sql: `CREATE TABLE IF NOT EXISTS blog_reviews (
      slug                  TEXT PRIMARY KEY,
      title                 TEXT NOT NULL,
      date                  DATE,
      author                TEXT,
      excerpt               TEXT,
      content               TEXT,
      is_auto_generated     BOOLEAN DEFAULT FALSE,
      stats                 JSONB DEFAULT '{}',
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )`,
  },
  {
    name: 'form_guide',
    sql: `CREATE TABLE IF NOT EXISTS form_guide (
      id                    SERIAL PRIMARY KEY,
      category              TEXT NOT NULL UNIQUE,
      data                  JSONB NOT NULL,
      updated_at            TIMESTAMPTZ DEFAULT NOW()
    )`,
  },
  {
    name: 'notifications',
    sql: `CREATE TABLE IF NOT EXISTS notifications (
      id                    TEXT PRIMARY KEY,
      type                  TEXT DEFAULT 'info',
      message               TEXT,
      tip_id                TEXT,
      timestamp             TIMESTAMPTZ DEFAULT NOW(),
      audience              TEXT DEFAULT 'all'
    )`,
  },
  {
    name: 'notifications_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp DESC)`,
  },
  {
    name: 'audit_log',
    sql: `CREATE TABLE IF NOT EXISTS audit_log (
      id                    SERIAL PRIMARY KEY,
      user_id               TEXT,
      user_email            TEXT,
      action                TEXT NOT NULL,
      entity                TEXT,
      entity_id             TEXT,
      details               JSONB,
      ip                    TEXT,
      timestamp             TIMESTAMPTZ DEFAULT NOW()
    )`,
  },
  {
    name: 'audit_log_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC)`,
  },
];

async function migrate() {
  console.log('[migrate] Connecting to PostgreSQL...');
  const client = await pool.connect();
  try {
    for (const table of tables) {
      console.log('[migrate] Creating: ' + table.name + '...');
      await client.query(table.sql);
    }
    console.log('[migrate] All tables created successfully.');
  } catch (err) {
    console.error('[migrate] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
