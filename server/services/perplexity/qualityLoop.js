/**
 * Perplexity Sonar — Nightly Quality Loop
 *
 * Answers two questions:
 *   1. AGGREGATE (per-sport): Do enriched tips outperform non-enriched tips?
 *   2. PER-SIGNAL (sport-partitioned): For each signal key within its sport,
 *      do tips WITH that signal outperform enriched tips WITHOUT that signal?
 *
 * Question 2 uses "enriched-without-X within same sport" as the baseline,
 * so racing signals are only compared against other racing tips and football
 * signals only against football tips. This prevents sport-mix differences
 * from polluting each signal's apparent delta.
 *
 * Verdict tiers:
 *   - |clv_delta| < 0.5%                → "Inconclusive" (grey)
 *   - clv_delta >= 0.5 AND roi_delta > 0  → "Earning its keep" (green)
 *   - clv_delta <= -0.5 AND roi_delta < 0 → "No benefit — consider disabling" (red)
 *   - Directional disagreement or flat   → "Mixed signal" (amber)
 *   - sample_sufficient = false          → "Insufficient data" (grey)
 *
 * NOTE for runbook v2: verdicts ignore sample-size variance beyond the >=10
 * cutoff. Add confidence-interval columns once enough data accumulates.
 */

'use strict';

var MIN_SAMPLE_SIZE = 10;
var INCONCLUSIVE_THRESHOLD = 0.5;

function computeVerdict(clvDelta, roiDelta, sampleSufficient) {
  if (!sampleSufficient) return 'Insufficient data';
  if (Math.abs(clvDelta) < INCONCLUSIVE_THRESHOLD) return 'Inconclusive';
  var clvUp = clvDelta >= INCONCLUSIVE_THRESHOLD;
  var clvDown = clvDelta <= -INCONCLUSIVE_THRESHOLD;
  var roiUp = roiDelta > 0;
  var roiDown = roiDelta < 0;
  if (clvUp && roiUp) return 'Earning its keep';
  if (clvDown && roiDown) return 'No benefit — consider disabling';
  return 'Mixed signal';
}

// Helper: parse a query result row into numbers
function _parseRow(row) {
  return {
    tips: parseInt(row.tips) || 0,
    avgClv: parseFloat(row.avg_clv) || 0,
    roi: (parseFloat(row.roi) || 0) * 100,
    wins: parseInt(row.wins) || 0,
  };
}

function _strikeRate(wins, tips) {
  return tips > 0 ? Math.round((wins / tips) * 10000) / 100 : 0;
}

function _round(v) { return Math.round(v * 100) / 100; }

/**
 * Run the nightly quality-loop analysis.
 * @param {object} db - Database module
 * @returns {Promise<{aggregates: Array, signals: Array}>}
 */
async function runQualityLoop(db) {
  if (!db || !db.isAvailable()) return { aggregates: [], signals: [] };

  var today = new Date().toISOString().split('T')[0];
  var aggregates = [];
  var signalResults = [];

  // =====================================================================
  // QUERY 1: Aggregate — enriched vs non-enriched, split by sport
  // =====================================================================
  try {
    var aggRows = await db.query(`
      SELECT
        t.sport,
        CASE WHEN e.id IS NOT NULL AND e.low_quality = false AND e.parse_error = false
             THEN 'enriched' ELSE 'not_enriched' END AS grp,
        COUNT(*) AS tips,
        AVG(t.clv_percent) AS avg_clv,
        CASE WHEN SUM(r.stake) > 0 THEN SUM(r.pnl) / SUM(r.stake) ELSE 0 END AS roi,
        COUNT(*) FILTER (WHERE t.result IN ('won', 'placed')) AS wins
      FROM tips t
      JOIN results r ON r.tip_id = t.id
      LEFT JOIN tip_enrichment e ON e.tip_id = t.id
      WHERE t.status = 'settled'
        AND t.result IN ('won', 'lost', 'placed')
        AND t.date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY t.sport, grp
    `);

    // Group rows by sport
    var sportGroups = {};
    aggRows.rows.forEach(function(r) {
      if (!sportGroups[r.sport]) sportGroups[r.sport] = {};
      sportGroups[r.sport][r.grp] = _parseRow(r);
    });

    var sports = Object.keys(sportGroups);
    for (var ai = 0; ai < sports.length; ai++) {
      var sp = sports[ai];
      var eg = sportGroups[sp].enriched;
      var bg = sportGroups[sp].not_enriched;
      if (!eg || !bg) continue;

      var clvD = _round(eg.avgClv - bg.avgClv);
      var roiD = _round(eg.roi - bg.roi);
      var sufficient = eg.tips >= MIN_SAMPLE_SIZE && bg.tips >= MIN_SAMPLE_SIZE;

      var aggSnap = {
        snapshotDate: today, isAggregate: true, signalKey: null, sport: sp,
        tipsWith: eg.tips, avgClvWith: _round(eg.avgClv),
        roiPctWith: _round(eg.roi), strikeRateWith: _strikeRate(eg.wins, eg.tips),
        tipsWithout: bg.tips, avgClvWithout: _round(bg.avgClv),
        roiPctWithout: _round(bg.roi), strikeRateWithout: _strikeRate(bg.wins, bg.tips),
        clvDelta: clvD, roiDeltaPct: roiD, sampleSufficient: sufficient,
        verdict: computeVerdict(clvD, roiD, sufficient),
      };
      await db.upsertQualitySnapshot(aggSnap);
      aggregates.push(aggSnap);
      console.log('[QualityLoop] Aggregate ' + sp + ': enriched CLV ' + eg.avgClv.toFixed(2) + '% vs baseline ' + bg.avgClv.toFixed(2) + '% (delta ' + clvD + '%) — ' + aggSnap.verdict);
    }
  } catch (aggErr) {
    console.error('[QualityLoop] Aggregate query error:', aggErr.message);
  }

  // =====================================================================
  // QUERY 2: Per-signal, sport-partitioned
  //
  // For each (signal_key, sport) pair:
  //   WITH:    enriched tips in that sport that HAVE the signal
  //   WITHOUT: enriched tips in that sport that DO NOT have the signal
  //
  // This isolates each signal's contribution within its sport.
  // =====================================================================
  try {
    // Get all distinct (signal_key, sport) pairs from quality-filtered enrichment
    var keyRows = await db.query(`
      SELECT DISTINCT s.key AS signal_key, t.sport
      FROM tip_enrichment e
      JOIN tips t ON t.id = e.tip_id
      CROSS JOIN LATERAL jsonb_each_text(e.extracted_signals) AS s(key, val)
      WHERE e.low_quality = false AND e.parse_error = false
        AND t.status = 'settled'
        AND t.result IN ('won', 'lost', 'placed')
        AND t.date >= CURRENT_DATE - INTERVAL '90 days'
        AND s.val IS NOT NULL AND s.val != ''
    `);

    for (var ki = 0; ki < keyRows.rows.length; ki++) {
      var sigKey = keyRows.rows[ki].signal_key;
      var sigSport = keyRows.rows[ki].sport;
      try {
        // Tips WITH this signal in this sport
        var withRows = await db.query(`
          SELECT
            COUNT(*) AS tips,
            AVG(t.clv_percent) AS avg_clv,
            CASE WHEN SUM(r.stake) > 0 THEN SUM(r.pnl) / SUM(r.stake) ELSE 0 END AS roi,
            COUNT(*) FILTER (WHERE t.result IN ('won', 'placed')) AS wins
          FROM tips t
          JOIN results r ON r.tip_id = t.id
          JOIN tip_enrichment e ON e.tip_id = t.id
          WHERE t.status = 'settled'
            AND t.result IN ('won', 'lost', 'placed')
            AND t.sport = $2
            AND t.date >= CURRENT_DATE - INTERVAL '90 days'
            AND e.low_quality = false AND e.parse_error = false
            AND e.extracted_signals ? $1
        `, [sigKey, sigSport]);

        // Enriched tips in this sport WITHOUT this signal
        var withoutRows = await db.query(`
          SELECT
            COUNT(*) AS tips,
            AVG(t.clv_percent) AS avg_clv,
            CASE WHEN SUM(r.stake) > 0 THEN SUM(r.pnl) / SUM(r.stake) ELSE 0 END AS roi,
            COUNT(*) FILTER (WHERE t.result IN ('won', 'placed')) AS wins
          FROM tips t
          JOIN results r ON r.tip_id = t.id
          JOIN tip_enrichment e ON e.tip_id = t.id
          WHERE t.status = 'settled'
            AND t.result IN ('won', 'lost', 'placed')
            AND t.sport = $2
            AND t.date >= CURRENT_DATE - INTERVAL '90 days'
            AND e.low_quality = false AND e.parse_error = false
            AND NOT (e.extracted_signals ? $1)
        `, [sigKey, sigSport]);

        var w = _parseRow(withRows.rows[0] || {});
        var wo = _parseRow(withoutRows.rows[0] || {});
        var sufficient = w.tips >= MIN_SAMPLE_SIZE && wo.tips >= MIN_SAMPLE_SIZE;
        var sigClvD = _round(w.avgClv - wo.avgClv);
        var sigRoiD = _round(w.roi - wo.roi);

        var sigSnap = {
          snapshotDate: today, isAggregate: false, signalKey: sigKey, sport: sigSport,
          tipsWith: w.tips, avgClvWith: _round(w.avgClv),
          roiPctWith: _round(w.roi), strikeRateWith: _strikeRate(w.wins, w.tips),
          tipsWithout: wo.tips, avgClvWithout: _round(wo.avgClv),
          roiPctWithout: _round(wo.roi), strikeRateWithout: _strikeRate(wo.wins, wo.tips),
          clvDelta: sigClvD, roiDeltaPct: sigRoiD, sampleSufficient: sufficient,
          verdict: computeVerdict(sigClvD, sigRoiD, sufficient),
        };
        await db.upsertQualitySnapshot(sigSnap);
        signalResults.push(sigSnap);

        console.log('[QualityLoop] ' + sigSport + '/' + sigKey + ': CLV delta ' + sigClvD + '%, ROI delta ' + sigRoiD + '% (n=' + w.tips + ' vs ' + wo.tips + ') — ' + sigSnap.verdict);
      } catch (sigErr) {
        console.error('[QualityLoop] Signal ' + sigSport + '/' + sigKey + ' error:', sigErr.message);
      }
    }
  } catch (keyErr) {
    console.error('[QualityLoop] Signal keys query error:', keyErr.message);
  }

  return { aggregates: aggregates, signals: signalResults };
}

module.exports = {
  runQualityLoop: runQualityLoop,
  computeVerdict: computeVerdict,
  MIN_SAMPLE_SIZE: MIN_SAMPLE_SIZE,
  INCONCLUSIVE_THRESHOLD: INCONCLUSIVE_THRESHOLD,
};
