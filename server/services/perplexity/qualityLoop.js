/**
 * Perplexity Sonar — Nightly Quality Loop
 *
 * Answers two questions:
 *   1. AGGREGATE: Do enriched tips outperform non-enriched tips on CLV and ROI?
 *   2. PER-SIGNAL: For each signal key, do tips WITH that signal outperform
 *      enriched tips WITHOUT that signal?
 *
 * Question 2 uses "enriched-without-X" as the baseline (not "all non-enriched"),
 * so each signal's delta isolates its own contribution rather than inheriting
 * the "enrichment overall helps" effect.
 *
 * Verdict tiers:
 *   - |clv_delta| < 0.5%              → "Inconclusive" (grey)
 *   - clv_delta > 0.5 AND roi_delta > 0 → "Earning its keep" (green)
 *   - clv_delta > 0.5 AND roi_delta <= 0 → "Mixed signal" (amber)
 *   - clv_delta < -0.5 AND roi_delta < 0 → "No benefit — consider disabling" (red)
 *   - clv_delta < -0.5 AND roi_delta >= 0 → "Mixed signal" (amber)
 *   - sample_sufficient = false          → overrides to "Insufficient data" (grey)
 *
 * NOTE for future runbook v2: these verdicts ignore sample size variance beyond
 * the >=10 cutoff. With N=12 the noise band is wide; with N=200 it tightens.
 * Add a confidence-interval column once enough data accumulates.
 */

'use strict';

var MIN_SAMPLE_SIZE = 10;
var INCONCLUSIVE_THRESHOLD = 0.5; // |clv_delta| < 0.5% = noise

/**
 * Compute verdict from deltas and sample sufficiency.
 * @param {number} clvDelta
 * @param {number} roiDelta
 * @param {boolean} sampleSufficient
 * @returns {string}
 */
function computeVerdict(clvDelta, roiDelta, sampleSufficient) {
  if (!sampleSufficient) return 'Insufficient data';
  if (Math.abs(clvDelta) < INCONCLUSIVE_THRESHOLD) return 'Inconclusive';
  var clvUp = clvDelta >= INCONCLUSIVE_THRESHOLD;   // CLV clearly positive
  var clvDown = clvDelta <= -INCONCLUSIVE_THRESHOLD; // CLV clearly negative
  var roiUp = roiDelta > 0;
  var roiDown = roiDelta < 0;
  if (clvUp && roiUp) return 'Earning its keep';
  if (clvDown && roiDown) return 'No benefit — consider disabling';
  // Directional disagreement or one side zero → mixed
  return 'Mixed signal';
}

/**
 * Run the nightly quality-loop analysis.
 *
 * @param {object} db - Database module
 * @returns {Promise<{aggregate: object|null, signals: Array}>}
 */
async function runQualityLoop(db) {
  if (!db || !db.isAvailable()) return { aggregate: null, signals: [] };

  var today = new Date().toISOString().split('T')[0];

  // =====================================================================
  // QUERY 1: Aggregate — enriched vs non-enriched
  // =====================================================================
  var aggResult = null;
  try {
    var aggRows = await db.query(`
      SELECT
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
      GROUP BY grp
    `);

    var enrichedRow = aggRows.rows.find(function(r) { return r.grp === 'enriched'; });
    var baselineRow = aggRows.rows.find(function(r) { return r.grp === 'not_enriched'; });

    if (enrichedRow && baselineRow) {
      var eClv = parseFloat(enrichedRow.avg_clv) || 0;
      var bClv = parseFloat(baselineRow.avg_clv) || 0;
      var eRoi = (parseFloat(enrichedRow.roi) || 0) * 100;
      var bRoi = (parseFloat(baselineRow.roi) || 0) * 100;
      var eSR = enrichedRow.tips > 0 ? (parseInt(enrichedRow.wins) / parseInt(enrichedRow.tips)) * 100 : 0;
      var bSR = baselineRow.tips > 0 ? (parseInt(baselineRow.wins) / parseInt(baselineRow.tips)) * 100 : 0;
      var clvD = Math.round((eClv - bClv) * 100) / 100;
      var roiD = Math.round((eRoi - bRoi) * 100) / 100;
      var sufficient = parseInt(enrichedRow.tips) >= MIN_SAMPLE_SIZE && parseInt(baselineRow.tips) >= MIN_SAMPLE_SIZE;

      aggResult = {
        snapshotDate: today, isAggregate: true, signalKey: null,
        tipsWith: parseInt(enrichedRow.tips), avgClvWith: Math.round(eClv * 100) / 100,
        roiPctWith: Math.round(eRoi * 100) / 100, strikeRateWith: Math.round(eSR * 100) / 100,
        tipsWithout: parseInt(baselineRow.tips), avgClvWithout: Math.round(bClv * 100) / 100,
        roiPctWithout: Math.round(bRoi * 100) / 100, strikeRateWithout: Math.round(bSR * 100) / 100,
        clvDelta: clvD, roiDeltaPct: roiD, sampleSufficient: sufficient,
        verdict: computeVerdict(clvD, roiD, sufficient),
      };
      await db.upsertQualitySnapshot(aggResult);
      console.log('[QualityLoop] Aggregate: enriched CLV ' + eClv.toFixed(2) + '% vs baseline ' + bClv.toFixed(2) + '% (delta ' + clvD + '%) — ' + aggResult.verdict);
    }
  } catch (aggErr) {
    console.error('[QualityLoop] Aggregate query error:', aggErr.message);
  }

  // =====================================================================
  // QUERY 2: Per-signal — tips WITH signal X vs enriched tips WITHOUT signal X
  // =====================================================================
  var signalResults = [];
  try {
    // Get all distinct signal keys that appear in quality-filtered enrichment
    var keyRows = await db.query(`
      SELECT DISTINCT s.key AS signal_key
      FROM tip_enrichment e, jsonb_each_text(e.extracted_signals) AS s(key, val)
      WHERE e.low_quality = false AND e.parse_error = false
        AND s.val IS NOT NULL AND s.val != ''
    `);
    var signalKeys = keyRows.rows.map(function(r) { return r.signal_key; });

    for (var ki = 0; ki < signalKeys.length; ki++) {
      var sigKey = signalKeys[ki];
      try {
        // Tips WITH this signal (from quality-filtered enrichment)
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
            AND t.date >= CURRENT_DATE - INTERVAL '90 days'
            AND e.low_quality = false AND e.parse_error = false
            AND e.extracted_signals ? $1
        `, [sigKey]);

        // Enriched tips WITHOUT this signal (correct baseline: isolates this signal's contribution)
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
            AND t.date >= CURRENT_DATE - INTERVAL '90 days'
            AND e.low_quality = false AND e.parse_error = false
            AND NOT (e.extracted_signals ? $1)
        `, [sigKey]);

        var wRow = withRows.rows[0] || {};
        var woRow = withoutRows.rows[0] || {};
        var wTips = parseInt(wRow.tips) || 0;
        var woTips = parseInt(woRow.tips) || 0;
        var sufficient = wTips >= MIN_SAMPLE_SIZE && woTips >= MIN_SAMPLE_SIZE;

        var wClv = parseFloat(wRow.avg_clv) || 0;
        var woClv = parseFloat(woRow.avg_clv) || 0;
        var wRoi = (parseFloat(wRow.roi) || 0) * 100;
        var woRoi = (parseFloat(woRow.roi) || 0) * 100;
        var wSR = wTips > 0 ? (parseInt(wRow.wins) / wTips) * 100 : 0;
        var woSR = woTips > 0 ? (parseInt(woRow.wins) / woTips) * 100 : 0;
        var sigClvD = Math.round((wClv - woClv) * 100) / 100;
        var sigRoiD = Math.round((wRoi - woRoi) * 100) / 100;

        var sigResult = {
          snapshotDate: today, isAggregate: false, signalKey: sigKey,
          tipsWith: wTips, avgClvWith: Math.round(wClv * 100) / 100,
          roiPctWith: Math.round(wRoi * 100) / 100, strikeRateWith: Math.round(wSR * 100) / 100,
          tipsWithout: woTips, avgClvWithout: Math.round(woClv * 100) / 100,
          roiPctWithout: Math.round(woRoi * 100) / 100, strikeRateWithout: Math.round(woSR * 100) / 100,
          clvDelta: sigClvD, roiDeltaPct: sigRoiD, sampleSufficient: sufficient,
          verdict: computeVerdict(sigClvD, sigRoiD, sufficient),
        };
        await db.upsertQualitySnapshot(sigResult);
        signalResults.push(sigResult);

        console.log('[QualityLoop] ' + sigKey + ': CLV delta ' + sigClvD + '%, ROI delta ' + sigRoiD + '% (n=' + wTips + ' vs ' + woTips + ') — ' + sigResult.verdict);
      } catch (sigErr) {
        console.error('[QualityLoop] Signal ' + sigKey + ' error:', sigErr.message);
      }
    }
  } catch (keyErr) {
    console.error('[QualityLoop] Signal keys query error:', keyErr.message);
  }

  return { aggregate: aggResult, signals: signalResults };
}

module.exports = {
  runQualityLoop: runQualityLoop,
  computeVerdict: computeVerdict,
  MIN_SAMPLE_SIZE: MIN_SAMPLE_SIZE,
  INCONCLUSIVE_THRESHOLD: INCONCLUSIVE_THRESHOLD,
};
