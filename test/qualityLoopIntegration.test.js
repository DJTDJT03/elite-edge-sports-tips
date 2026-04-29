/**
 * Quality-loop SQL integration test.
 *
 * Requires DATABASE_URL to be set. Skips gracefully in CI/local without DB.
 * Inserts synthetic tips, results, and tip_enrichment rows, runs the quality
 * loop, and asserts the output deltas are computed correctly.
 *
 * Uses a test-specific date prefix to avoid polluting production data.
 * Cleans up after itself.
 */

'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');

var HAS_DB = !!process.env.DATABASE_URL;

// Skip entire file if no DB
if (!HAS_DB) {
  test('qualityLoop integration — SKIPPED (no DATABASE_URL)', function() {
    assert.ok(true, 'Set DATABASE_URL to run integration tests');
  });
} else {

  var db = require('../server/db');
  var ql = require('../server/services/perplexity/qualityLoop');

  // Test-specific IDs to avoid collision with real data
  var PREFIX = 'qltest_' + Date.now() + '_';
  var TODAY = new Date().toISOString().split('T')[0];

  // Cleanup function — runs after all tests
  async function cleanup() {
    try {
      await db.query("DELETE FROM enrichment_quality_snapshots WHERE snapshot_date = $1 AND signal_key LIKE 'going%'", [TODAY]);
      await db.query("DELETE FROM tip_enrichment WHERE tip_id LIKE $1", [PREFIX + '%']);
      await db.query("DELETE FROM results WHERE tip_id LIKE $1", [PREFIX + '%']);
      await db.query("DELETE FROM tips WHERE id LIKE $1", [PREFIX + '%']);
    } catch (e) { /* tables may not exist yet */ }
  }

  // Insert synthetic data
  async function insertTestData() {
    // 12 racing tips: 6 enriched with going_update, 6 enriched without going_update
    for (var i = 0; i < 12; i++) {
      var tipId = PREFIX + 'racing_' + i;
      var won = i < 8; // 8 wins, 4 losses for easy math
      var clv = i < 6 ? 3.5 : 0.5; // tips 0-5 (with going_update) have high CLV; 6-11 have low CLV
      var odds = 3.0;
      var stake = 2.0;
      var pnl = won ? (odds - 1) * stake : -stake;

      await db.query(
        "INSERT INTO tips (id, sport, selection, odds, status, result, date, clv_percent, confidence, is_premium) VALUES ($1, 'racing', $2, $3, 'settled', $4, $5, $6, 7, true)",
        [tipId, 'Horse_' + i, odds, won ? 'won' : 'lost', TODAY, clv]
      );

      await db.query(
        "INSERT INTO results (id, tip_id, sport, selection, odds, stake, result, pnl, date, is_premium) VALUES ($1, $2, 'racing', $3, $4, $5, $6, $7, $8, true)",
        [PREFIX + 'res_' + i, tipId, 'Horse_' + i, odds, stake, won ? 'won' : 'lost', pnl, TODAY]
      );

      // Enrichment: tips 0-5 have going_update signal, tips 6-11 have stable_form only
      var signals = i < 6
        ? { going_update: { value: 'Going changed', citation_index: 0 }, stable_form: { value: 'Yard in form', citation_index: 1 } }
        : { stable_form: { value: 'Yard quiet', citation_index: 0 } };

      await db.query(
        "INSERT INTO tip_enrichment (tip_id, call_site, raw_response, extracted_signals, low_quality, parse_error, used_in_decision) VALUES ($1, 'per-tip', '{}'::jsonb, $2, false, false, false)",
        [tipId, JSON.stringify(signals)]
      );
    }

    // 5 non-enriched racing tips (for aggregate baseline)
    for (var j = 0; j < 5; j++) {
      var neTipId = PREFIX + 'ne_' + j;
      var neWon = j < 2;
      var neClv = 0.8;
      var neOdds = 3.0;
      var neStake = 2.0;
      var nePnl = neWon ? (neOdds - 1) * neStake : -neStake;

      await db.query(
        "INSERT INTO tips (id, sport, selection, odds, status, result, date, clv_percent, confidence, is_premium) VALUES ($1, 'racing', $2, $3, 'settled', $4, $5, $6, 7, true)",
        [neTipId, 'NEHorse_' + j, neOdds, neWon ? 'won' : 'lost', TODAY, neClv]
      );

      await db.query(
        "INSERT INTO results (id, tip_id, sport, selection, odds, stake, result, pnl, date, is_premium) VALUES ($1, $2, 'racing', $3, $4, $5, $6, $7, $8, true)",
        [PREFIX + 'neres_' + j, neTipId, 'NEHorse_' + j, neOdds, neStake, neWon ? 'won' : 'lost', nePnl, TODAY]
      );
      // No tip_enrichment for these — they form the non-enriched baseline
    }
  }

  test('qualityLoop integration — sport-partitioned signal deltas', async function() {
    await cleanup();

    try {
      await insertTestData();

      var results = await ql.runQualityLoop(db);

      // Check aggregates — should have at least one for 'racing'
      var racingAgg = results.aggregates.find(function(a) { return a.sport === 'racing'; });
      assert.ok(racingAgg, 'racing aggregate should exist');
      assert.ok(racingAgg.tipsWith > 0, 'enriched tips count > 0');
      assert.ok(racingAgg.tipsWithout > 0, 'non-enriched tips count > 0');

      // Enriched racing tips: avg CLV = (6*3.5 + 6*0.5) / 12 = 24/12 = 2.0
      // Non-enriched: avg CLV = 0.8
      // Delta should be positive (~1.2)
      assert.ok(racingAgg.clvDelta > 0, 'enriched CLV should be higher than baseline, got delta: ' + racingAgg.clvDelta);

      // Check per-signal — going_update should exist for racing
      var goingSignal = results.signals.find(function(s) { return s.signalKey === 'going_update' && s.sport === 'racing'; });
      assert.ok(goingSignal, 'going_update signal for racing should exist');

      // going_update tips (0-5): avg CLV = 3.5, 5 wins 1 loss
      // enriched-without-going_update tips (6-11): avg CLV = 0.5, 3 wins 3 losses
      // Delta should be positive (~3.0)
      assert.ok(goingSignal.clvDelta > 0, 'going_update CLV delta should be positive, got: ' + goingSignal.clvDelta);
      assert.ok(goingSignal.tipsWith === 6, 'going_update tips count should be 6, got: ' + goingSignal.tipsWith);
      assert.ok(goingSignal.tipsWithout === 6, 'without-going_update count should be 6, got: ' + goingSignal.tipsWithout);

      // stable_form appears in ALL 12 enriched tips (both with and without going_update)
      // So its with-count should be 12 and without-count should be 0 (all enriched have it)
      var stableSignal = results.signals.find(function(s) { return s.signalKey === 'stable_form' && s.sport === 'racing'; });
      assert.ok(stableSignal, 'stable_form signal for racing should exist');
      assert.equal(stableSignal.tipsWith, 12, 'stable_form present in all 12 enriched tips');
      // Without count = 0, so sample_sufficient should be false
      assert.equal(stableSignal.sampleSufficient, false, 'stable_form has no without-group, insufficient');
      assert.equal(stableSignal.verdict, 'Insufficient data');

      // Verify no football signals leaked into racing results
      var footballSignals = results.signals.filter(function(s) { return s.sport === 'football'; });
      assert.equal(footballSignals.length, 0, 'no football signals from racing-only test data');

    } finally {
      await cleanup();
    }
  });
}
