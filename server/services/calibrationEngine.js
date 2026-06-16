/**
 * Calibration & backtesting engine.
 *
 * Measures whether our stated probabilities/confidence are HONEST:
 *  - Brier score + Brier Skill Score (accuracy of probabilistic forecasts)
 *  - Reliability curve (predicted prob vs actual outcome frequency, by band)
 *  - Expected Calibration Error (ECE) → an overall calibration grade
 *  - Confidence-ordering check (do 9/10 picks win more than 7/10? — charter rule 6)
 *  - Per-analyst calibration
 *  - "Backtest" performance by edge/odds band (where the real ROI lives)
 *
 * Pure measurement — reads settled results, NEVER modifies the locked scoring
 * model or AutoTune. It surfaces the evidence; humans/AutoTune act on it.
 */

function outcomeOf(t) {
  if (t.result === 'won' || t.result === 'placed') return 1;
  if (t.result === 'lost') return 0;
  return null; // void/pending — excluded
}
function probOf(t) {
  if (t.modelProbability && t.modelProbability > 0 && t.modelProbability <= 1) return t.modelProbability;
  if (t.confidence) return Math.max(0.01, Math.min(0.99, t.confidence / 10));
  return null;
}

function analyse(tips, opts) {
  opts = opts || {};
  var rows = (tips || []).map(function (t) {
    return { p: probOf(t), o: outcomeOf(t), conf: t.confidence || null, sport: t.sport || 'unknown', analyst: t.tipsterProfile || t.analyst || 'Unknown', odds: t.odds || t.advisedPriceDecimal || null, edge: t.edge || null, result: t.result };
  }).filter(function (r) { return r.p != null && r.o != null; });

  var n = rows.length;
  if (n < (opts.minSample || 10)) return { ready: false, sample: n, minSample: opts.minSample || 10 };

  // Brier score + skill score
  var brier = rows.reduce(function (s, r) { return s + Math.pow(r.p - r.o, 2); }, 0) / n;
  var baseRate = rows.reduce(function (s, r) { return s + r.o; }, 0) / n;
  var brierRef = baseRate * (1 - baseRate);
  var bss = brierRef > 0 ? 1 - brier / brierRef : 0; // >0 means better than always-predict-base-rate

  // Reliability curve (probability bands)
  var bands = [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.0001]];
  var reliability = bands.map(function (b) {
    var inB = rows.filter(function (r) { return r.p >= b[0] && r.p < b[1]; });
    if (!inB.length) return null;
    var pred = inB.reduce(function (s, r) { return s + r.p; }, 0) / inB.length;
    var act = inB.reduce(function (s, r) { return s + r.o; }, 0) / inB.length;
    return { band: Math.round(b[0] * 100) + '-' + Math.round(Math.min(b[1], 1) * 100) + '%', sample: inB.length, predicted: Math.round(pred * 100), actual: Math.round(act * 100), gap: Math.round((act - pred) * 100) };
  }).filter(Boolean);

  // Expected Calibration Error (sample-weighted mean |gap|) → grade
  var ece = reliability.reduce(function (s, b) { return s + (b.sample / n) * Math.abs(b.gap / 100); }, 0);
  var grade = ece < 0.05 ? 'Excellent' : ece < 0.10 ? 'Good' : ece < 0.15 ? 'Fair' : 'Needs work';

  // Confidence-ordering check (charter rule 6): higher confidence should win more.
  var byConf = {};
  rows.forEach(function (r) { if (!r.conf) return; var k = r.conf; if (!byConf[k]) byConf[k] = { n: 0, w: 0 }; byConf[k].n++; byConf[k].w += r.o; });
  var confBands = Object.keys(byConf).map(Number).sort(function (a, b) { return a - b; }).map(function (c) {
    return { confidence: c, sample: byConf[c].n, winRate: Math.round((byConf[c].w / byConf[c].n) * 100) };
  });
  // Inversion: a higher confidence band winning LESS than a lower one (min sample 5 each).
  var inversions = [];
  for (var i = 1; i < confBands.length; i++) {
    var lo = confBands[i - 1], hi = confBands[i];
    if (lo.sample >= 5 && hi.sample >= 5 && hi.winRate < lo.winRate - 5) {
      inversions.push(hi.confidence + '/10 (' + hi.winRate + '%) below ' + lo.confidence + '/10 (' + lo.winRate + '%)');
    }
  }

  // Per-analyst calibration
  var byAnalyst = {};
  rows.forEach(function (r) { var k = r.analyst; if (!byAnalyst[k]) byAnalyst[k] = { n: 0, w: 0, brier: 0 }; byAnalyst[k].n++; byAnalyst[k].w += r.o; byAnalyst[k].brier += Math.pow(r.p - r.o, 2); });
  var analysts = Object.keys(byAnalyst).map(function (a) {
    return { analyst: a, sample: byAnalyst[a].n, winRate: Math.round((byAnalyst[a].w / byAnalyst[a].n) * 100), brier: Math.round((byAnalyst[a].brier / byAnalyst[a].n) * 1000) / 1000 };
  }).sort(function (a, b) { return a.brier - b.brier; });

  // Backtest: ROI by odds band (1u level stakes) — where edge actually shows.
  var oddsBands = [[1, 2, 'Odds-on/short (<2.0)'], [2, 3.5, 'Mid (2.0-3.5)'], [3.5, 6, 'Value (3.5-6)'], [6, 1000, 'Big price (6+)']];
  var byOdds = oddsBands.map(function (b) {
    var inB = rows.filter(function (r) { return r.odds && r.odds >= b[0] && r.odds < b[1]; });
    if (inB.length < 5) return null;
    var wins = inB.filter(function (r) { return r.o === 1; });
    var pnl = wins.reduce(function (s, r) { return s + (r.odds - 1); }, 0) - (inB.length - wins.length);
    return { band: b[2], sample: inB.length, winRate: Math.round((wins.length / inB.length) * 100), roi: Math.round((pnl / inB.length) * 1000) / 10 };
  }).filter(Boolean);

  return {
    ready: true,
    sample: n,
    brier: Math.round(brier * 1000) / 1000,
    brierSkillScore: Math.round(bss * 1000) / 1000,
    baseRate: Math.round(baseRate * 100),
    ece: Math.round(ece * 1000) / 1000,
    grade: grade,
    reliability: reliability,
    confidenceOrdering: { bands: confBands, inversions: inversions, healthy: inversions.length === 0 },
    byAnalyst: analysts,
    backtestByOdds: byOdds,
  };
}

module.exports = { analyse: analyse };
