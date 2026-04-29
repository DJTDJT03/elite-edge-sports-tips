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
      alert_prefs           JSONB DEFAULT '{}',
      agreement_timestamp   TIMESTAMPTZ,
      agreement_text        TEXT,
      login_history         JSONB DEFAULT '[]',
      reset_token           TEXT,
      reset_token_expiry    TIMESTAMPTZ,
      expiry_warned         TEXT,
      trial_active          BOOLEAN DEFAULT FALSE,
      trial_start           TIMESTAMPTZ,
      trial_end             TIMESTAMPTZ,
      trial_warned          BOOLEAN DEFAULT FALSE,
      stripe_customer_id    TEXT,
      stripe_subscription_id TEXT,
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
      advised_price_decimal NUMERIC(8,2),
      closing_price_decimal NUMERIC(8,2),
      clv_percent           NUMERIC(8,4),
      fair_odds_decimal     NUMERIC(8,2),
      settled_at            TIMESTAMPTZ,
      settlement_source     TEXT,
      adjusted_factors      JSONB,
      enrichment_id         INTEGER,
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
    name: 'tip_price_history',
    sql: `CREATE TABLE IF NOT EXISTS tip_price_history (
      id                    SERIAL PRIMARY KEY,
      tip_id                TEXT NOT NULL REFERENCES tips(id) ON DELETE CASCADE,
      price_decimal         NUMERIC(8,2) NOT NULL,
      bookmaker             TEXT,
      source                TEXT DEFAULT 'odds-api',
      recorded_at           TIMESTAMPTZ DEFAULT NOW()
    )`,
  },
  {
    name: 'tip_price_history_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_tph_tip_id ON tip_price_history(tip_id);
          CREATE INDEX IF NOT EXISTS idx_tph_recorded ON tip_price_history(recorded_at DESC)`,
  },
  {
    name: 'analyst_performance_snapshots',
    sql: `CREATE TABLE IF NOT EXISTS analyst_performance_snapshots (
      id                    SERIAL PRIMARY KEY,
      analyst_key           TEXT NOT NULL,
      snapshot_date         DATE NOT NULL,
      total_tips            INTEGER DEFAULT 0,
      wins                  INTEGER DEFAULT 0,
      losses                INTEGER DEFAULT 0,
      voids                 INTEGER DEFAULT 0,
      strike_rate           NUMERIC(6,4),
      avg_odds              NUMERIC(8,2),
      total_pnl             NUMERIC(10,2),
      avg_clv               NUMERIC(8,4),
      roi_percent           NUMERIC(8,4),
      sport                 TEXT,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(analyst_key, snapshot_date, sport)
    )`,
  },
  {
    name: 'analyst_snapshots_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_aps_analyst ON analyst_performance_snapshots(analyst_key, snapshot_date DESC)`,
  },
  {
    name: 'sonar_cache',
    sql: `CREATE TABLE IF NOT EXISTS sonar_cache (
      id                    SERIAL PRIMARY KEY,
      cache_key             TEXT NOT NULL UNIQUE,
      call_site             TEXT NOT NULL,
      entity_id             TEXT NOT NULL,
      time_bucket           BIGINT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'pending',
      claimed_at            TIMESTAMPTZ DEFAULT NOW(),
      response_json         JSONB,
      citations             JSONB DEFAULT '[]',
      ttl_seconds           INTEGER NOT NULL,
      expires_at            TIMESTAMPTZ NOT NULL,
      input_tokens          INTEGER,
      output_tokens         INTEGER,
      search_count          INTEGER DEFAULT 0,
      latency_ms            INTEGER,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(call_site, entity_id, time_bucket)
    )`,
  },
  {
    name: 'sonar_cache_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_sonar_cache_key ON sonar_cache(cache_key);
          CREATE INDEX IF NOT EXISTS idx_sonar_cache_expires ON sonar_cache(expires_at);
          CREATE INDEX IF NOT EXISTS idx_sonar_cache_site ON sonar_cache(call_site, entity_id)`,
  },
  {
    name: 'sonar_spend_ledger',
    sql: `CREATE TABLE IF NOT EXISTS sonar_spend_ledger (
      id                    SERIAL PRIMARY KEY,
      call_site             TEXT NOT NULL,
      entity_id             TEXT,
      model                 TEXT NOT NULL DEFAULT 'sonar',
      input_tokens          INTEGER NOT NULL DEFAULT 0,
      output_tokens         INTEGER NOT NULL DEFAULT 0,
      search_count          INTEGER NOT NULL DEFAULT 0,
      token_cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
      request_fee_usd       NUMERIC(10,6) NOT NULL DEFAULT 0,
      cost_usd              NUMERIC(10,6) NOT NULL DEFAULT 0,
      date                  DATE NOT NULL DEFAULT CURRENT_DATE,
      tip_id                TEXT,
      bulletin_id           TEXT,
      latency_ms            INTEGER,
      cache_hit             BOOLEAN DEFAULT FALSE,
      enrichment_skipped    TEXT,
      error                 TEXT,
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )`,
  },
  {
    name: 'sonar_spend_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_sonar_spend_date ON sonar_spend_ledger(date);
          CREATE INDEX IF NOT EXISTS idx_sonar_spend_site ON sonar_spend_ledger(call_site)`,
  },
  {
    name: 'sonar_admin_events',
    sql: `CREATE TABLE IF NOT EXISTS sonar_admin_events (
      id                    SERIAL PRIMARY KEY,
      action                TEXT NOT NULL,
      user_id               TEXT,
      user_email            TEXT,
      reason                TEXT,
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )`,
  },
  {
    name: 'sonar_admin_events_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_sonar_admin_created ON sonar_admin_events(created_at DESC)`,
  },
  {
    name: 'tip_enrichment',
    sql: `CREATE TABLE IF NOT EXISTS tip_enrichment (
      id                    SERIAL PRIMARY KEY,
      tip_id                TEXT NOT NULL REFERENCES tips(id) ON DELETE CASCADE,
      call_site             TEXT NOT NULL DEFAULT 'per-tip',
      raw_response          JSONB NOT NULL,
      extracted_signals     JSONB NOT NULL DEFAULT '{}',
      citations             JSONB DEFAULT '[]',
      dropped_claims        JSONB DEFAULT '[]',
      low_quality           BOOLEAN NOT NULL DEFAULT FALSE,
      parse_error           BOOLEAN NOT NULL DEFAULT FALSE,
      used_in_decision      BOOLEAN NOT NULL DEFAULT FALSE,
      sonar_model           TEXT DEFAULT 'sonar',
      input_tokens          INTEGER,
      output_tokens         INTEGER,
      search_count          INTEGER DEFAULT 0,
      request_fee_usd       NUMERIC(10,6) DEFAULT 0,
      latency_ms            INTEGER,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT chk_no_decision_on_bad_data
        CHECK (NOT (used_in_decision AND (parse_error OR low_quality)))
    )`,
  },
  {
    name: 'tip_enrichment_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_enrichment_tip ON tip_enrichment(tip_id);
          CREATE INDEX IF NOT EXISTS idx_enrichment_quality ON tip_enrichment(low_quality, used_in_decision)`,
  },
  {
    name: 'enrichment_quality_snapshots',
    sql: `CREATE TABLE IF NOT EXISTS enrichment_quality_snapshots (
      id                    SERIAL PRIMARY KEY,
      snapshot_date         DATE NOT NULL,
      is_aggregate          BOOLEAN NOT NULL DEFAULT FALSE,
      signal_key            TEXT,
      tips_with             INTEGER NOT NULL DEFAULT 0,
      avg_clv_with          NUMERIC(8,2),
      roi_pct_with          NUMERIC(8,2),
      strike_rate_with      NUMERIC(6,2),
      tips_without          INTEGER NOT NULL DEFAULT 0,
      avg_clv_without       NUMERIC(8,2),
      roi_pct_without       NUMERIC(8,2),
      strike_rate_without   NUMERIC(6,2),
      clv_delta             NUMERIC(8,2),
      roi_delta_pct         NUMERIC(8,2),
      verdict               TEXT,
      sample_sufficient     BOOLEAN DEFAULT TRUE,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(snapshot_date, is_aggregate, signal_key)
    )`,
  },
  {
    name: 'enrichment_quality_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_eqs_date ON enrichment_quality_snapshots(snapshot_date DESC);
          CREATE INDEX IF NOT EXISTS idx_eqs_signal ON enrichment_quality_snapshots(signal_key)`,
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
