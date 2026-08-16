/**
 * Elite Edge Quant Model — in-house, independent prediction engine.
 *
 * Elo power ratings + a Dixon-Coles / Poisson scoreline model. Produces a
 * genuinely independent signal (not a re-read of the market): win/draw/win
 * probabilities, expected goals, Over/Under, BTTS and the most likely scorelines.
 *
 * Pluggable: its own service + ratings table. It NEVER modifies the locked
 * tipping engine — it's an extra signal that feeds the consensus and the UI.
 *
 * MVP scope: international sides (World Cup), seeded from a strength baseline and
 * self-updating from results. Club ratings learn from results over time.
 */
module.exports = function (deps) {
  var db = deps && deps.db;

  // Baseline Elo for the 48 WC2026 nations (approx. current international strength;
  // these are starting points — the model updates them from real results).
  var BASELINE = {
    'Spain': 2090, 'France': 2080, 'Argentina': 2060, 'Brazil': 2030, 'England': 2010,
    'Portugal': 1990, 'Netherlands': 1985, 'Germany': 1965, 'Belgium': 1945, 'Croatia': 1900,
    'Uruguay': 1895, 'Colombia': 1875, 'Morocco': 1860, 'Switzerland': 1845, 'Japan': 1840,
    'USA': 1830, 'Senegal': 1825, 'Mexico': 1810, 'Ecuador': 1790, 'Austria': 1790,
    'Sweden': 1775, 'Norway': 1770, 'Egypt': 1760, 'Ivory Coast': 1755, 'Iran': 1755,
    'Turkey': 1745, 'Algeria': 1745, 'South Korea': 1740, 'Scotland': 1735, 'Australia': 1730,
    'Czech Republic': 1720, 'Paraguay': 1710, 'Tunisia': 1700, 'Canada': 1700, 'DR Congo': 1700,
    'Ghana': 1690, 'Bosnia & Herzegovina': 1690, 'Qatar': 1680, 'Saudi Arabia': 1670, 'Panama': 1660,
    'Uzbekistan': 1650, 'South Africa': 1640, 'Iraq': 1640, 'Cape Verde': 1620, 'Jordan': 1620,
    'New Zealand': 1600, 'Curacao': 1560, 'Haiti': 1560,
  };
  // Name aliases so feed names resolve to a rating.
  var ALIAS = {
    'korea republic': 'South Korea', 'south korea': 'South Korea',
    'usa': 'USA', 'united states': 'USA',
    'ivory coast': 'Ivory Coast', "cote d'ivoire": 'Ivory Coast', 'côte d’ivoire': 'Ivory Coast',
    'cape verde islands': 'Cape Verde', 'cape verde': 'Cape Verde', 'cabo verde': 'Cape Verde',
    'dr congo': 'DR Congo', 'd.r. congo': 'DR Congo', 'congo dr': 'DR Congo',
    'czech republic': 'Czech Republic', 'czechia': 'Czech Republic',
    'bosnia & herzegovina': 'Bosnia & Herzegovina', 'bosnia and herzegovina': 'Bosnia & Herzegovina',
    'turkey': 'Turkey', 'türkiye': 'Turkey', 'curacao': 'Curacao', 'curaçao': 'Curacao',
  };

  var DEFAULT_RATING = 1500;   // unknown team (e.g. a club we haven't seen)
  var HOME_ADV = 65;           // Elo home-advantage; 0 at neutral venues
  var K = 32;                  // update sensitivity
  var BASE_TOTAL_GOALS = 2.6;  // league-average total goals
  var SUP_DIVISOR = 220;       // Elo points per goal of supremacy
  var RHO = -0.05;             // Dixon-Coles low-score dependence

  var _ratings = {};           // in-memory cache: canonicalName -> rating
  var _loaded = false;

  function canon(name) {
    if (!name) return '';
    var key = String(name).toLowerCase().trim();
    if (ALIAS[key]) return ALIAS[key];
    // Title-case-ish fallback: return the original trimmed name.
    return String(name).trim();
  }

  function getRating(name) {
    var c = canon(name);
    if (_ratings[c] != null) return _ratings[c];
    if (BASELINE[c] != null) return BASELINE[c];
    return DEFAULT_RATING;
  }

  // ---- Poisson / Dixon-Coles ------------------------------------------------
  function poisson(k, lambda) {
    var p = Math.exp(-lambda), f = 1;
    for (var i = 1; i <= k; i++) { p *= lambda / i; }
    return p;
  }
  function dcTau(i, j, lh, la, rho) {
    if (i === 0 && j === 0) return 1 - lh * la * rho;
    if (i === 0 && j === 1) return 1 + lh * rho;
    if (i === 1 && j === 0) return 1 + la * rho;
    if (i === 1 && j === 1) return 1 - rho;
    return 1;
  }

  /**
   * Predict a fixture. opts.neutral = true for tournament/neutral venues.
   * Returns probabilities, expected goals, markets and top scorelines.
   */
  function predict(homeTeam, awayTeam, opts) {
    opts = opts || {};
    var rH = getRating(homeTeam), rA = getRating(awayTeam);
    var hfa = opts.neutral ? 0 : HOME_ADV;
    var diff = (rH + hfa) - rA;
    var sup = diff / SUP_DIVISOR;                  // expected goal supremacy
    var lh = Math.max(0.18, BASE_TOTAL_GOALS / 2 + sup / 2);
    var la = Math.max(0.15, BASE_TOTAL_GOALS / 2 - sup / 2);

    var MAXG = 8;
    var pH = 0, pD = 0, pA = 0, over25 = 0, over35 = 0, btts = 0;
    var scores = [];
    for (var i = 0; i <= MAXG; i++) {
      for (var j = 0; j <= MAXG; j++) {
        var p = poisson(i, lh) * poisson(j, la) * dcTau(i, j, lh, la, RHO);
        if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
        if (i + j > 2.5) over25 += p;
        if (i + j > 3.5) over35 += p;
        if (i > 0 && j > 0) btts += p;
        scores.push({ h: i, a: j, p: p });
      }
    }
    var norm = pH + pD + pA;
    pH /= norm; pD /= norm; pA /= norm; over25 /= norm; over35 /= norm; btts /= norm;
    scores.forEach(function (s) { s.p /= norm; });
    scores.sort(function (a, b) { return b.p - a.p; });

    var pct = function (x) { return Math.round(x * 100); };
    return {
      ratings: { home: Math.round(rH), away: Math.round(rA), edge: Math.round(diff) },
      expectedGoals: { home: +lh.toFixed(2), away: +la.toFixed(2), total: +(lh + la).toFixed(2) },
      winProb: { home: pct(pH), draw: pct(pD), away: pct(pA) },
      over25: pct(over25), under25: pct(1 - over25), over35: pct(over35), btts: pct(btts),
      topScorelines: scores.slice(0, 4).map(function (s) { return { score: s.h + '-' + s.a, prob: pct(s.p) }; }),
      mostLikelyScore: scores[0] ? scores[0].h + '-' + scores[0].a : null,
      // The model's single best market call (independent of market/AI).
      pick: bestPick(pH, pD, pA, over25, btts, homeTeam, awayTeam),
    };
  }

  // The model's own headline call from its probabilities.
  function bestPick(pH, pD, pA, over25, btts, home, away) {
    var fav = pH >= pA ? { team: home, p: pH } : { team: away, p: pA };
    if (fav.p >= 0.60) return { market: 'Match Result', selection: fav.team + ' Win', prob: Math.round(fav.p * 100), confidence: fav.p >= 0.72 ? 9 : 8 };
    if (over25 >= 0.62) return { market: 'Total Goals', selection: 'Over 2.5 Goals', prob: Math.round(over25 * 100), confidence: 7 };
    if (btts >= 0.60) return { market: 'Both Teams to Score', selection: 'BTTS - Yes', prob: Math.round(btts * 100), confidence: 7 };
    if (fav.p >= 0.45) return { market: 'Match Result', selection: fav.team + ' Win', prob: Math.round(fav.p * 100), confidence: 6 };
    if ((1 - over25) >= 0.58) return { market: 'Total Goals', selection: 'Under 2.5 Goals', prob: Math.round((1 - over25) * 100), confidence: 6 };
    return { market: 'Match Result', selection: 'Draw', prob: Math.round(pD * 100), confidence: 6 };
  }

  // ---- Rating updates from results -----------------------------------------
  function _expectedScore(rH, rA, hfa) { return 1 / (1 + Math.pow(10, -((rH + hfa) - rA) / 400)); }
  function _marginMult(gd) { var g = Math.abs(gd); if (g <= 1) return 1; if (g === 2) return 1.5; return (11 + g) / 8; }

  // Update both teams' Elo from a finished result.
  async function updateFromResult(homeTeam, awayTeam, hg, ag, opts) {
    opts = opts || {};
    if (hg == null || ag == null) return;
    await ensureLoaded();
    var cH = canon(homeTeam), cA = canon(awayTeam);
    var rH = getRating(cH), rA = getRating(cA);
    var hfa = opts.neutral ? 0 : HOME_ADV;
    var eH = _expectedScore(rH, rA, hfa);
    var sH = hg > ag ? 1 : hg === ag ? 0.5 : 0;
    var mult = _marginMult(hg - ag);
    var delta = K * mult * (sH - eH);
    _ratings[cH] = Math.round(rH + delta);
    _ratings[cA] = Math.round(rA - delta);
    if (db && db.query) {
      try {
        await db.query("INSERT INTO team_ratings (team, rating, played, updated_at) VALUES ($1,$2,1,NOW()) ON CONFLICT (team) DO UPDATE SET rating=$2, played=team_ratings.played+1, updated_at=NOW()", [cH, _ratings[cH]]);
        await db.query("INSERT INTO team_ratings (team, rating, played, updated_at) VALUES ($1,$2,1,NOW()) ON CONFLICT (team) DO UPDATE SET rating=$2, played=team_ratings.played+1, updated_at=NOW()", [cA, _ratings[cA]]);
      } catch (e) { /* non-fatal */ }
    }
    return { home: _ratings[cH], away: _ratings[cA] };
  }

  // ---- Persistence ----------------------------------------------------------
  async function ensureLoaded() {
    if (_loaded) return;
    _loaded = true;
    if (!db || !db.query) { _ratings = Object.assign({}, BASELINE); return; }
    try {
      await db.query("CREATE TABLE IF NOT EXISTS team_ratings (team TEXT PRIMARY KEY, rating NUMERIC NOT NULL, played INTEGER DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW())");
      // Seed any missing baseline nations.
      for (var name in BASELINE) {
        await db.query("INSERT INTO team_ratings (team, rating) VALUES ($1,$2) ON CONFLICT (team) DO NOTHING", [name, BASELINE[name]]);
      }
      var rows = (await db.query("SELECT team, rating FROM team_ratings")).rows || [];
      rows.forEach(function (r) { _ratings[r.team] = parseFloat(r.rating); });
    } catch (e) {
      console.warn('[QuantModel] load failed, using baseline:', e.message);
      _ratings = Object.assign({}, BASELINE);
    }
  }

  // Public predict that guarantees ratings are loaded.
  async function predictAsync(homeTeam, awayTeam, opts) {
    await ensureLoaded();
    return predict(homeTeam, awayTeam, opts);
  }

  ensureLoaded().catch(function () {});

  // Do we have a real (non-default) rating for this team? Used so callers only
  // surface model probabilities when they're meaningful (not the fallback default).
  function knows(name) {
    var c = canon(name);
    return _ratings[c] != null || BASELINE[c] != null;
  }

  // Seed a team's INITIAL rating from external grading (e.g. league standings —
  // form, goals, position). Only writes teams we have NOT learned from real
  // results (played = 0): a rating the model earned from outcomes is never
  // clobbered by a seed. Sets in-memory too so predictions are informed at once.
  async function seedRating(name, elo) {
    await ensureLoaded();
    var c = canon(name);
    if (!c || !(elo > 0)) return false;
    elo = Math.round(elo);
    if (db && db.query) {
      try {
        await db.query(
          "INSERT INTO team_ratings (team, rating, played, updated_at) VALUES ($1,$2,0,NOW()) " +
          "ON CONFLICT (team) DO UPDATE SET rating = $2, updated_at = NOW() WHERE team_ratings.played = 0",
          [c, elo]
        );
      } catch (e) { return false; }
    }
    // Reflect immediately unless this team already carries a LEARNED rating. We
    // can't see `played` in memory, so reloadRatings() after a seed batch is the
    // authority; here we only fill defaults/absent to avoid clobbering a learned
    // in-memory value mid-batch.
    if (_ratings[c] == null) _ratings[c] = elo;
    return true;
  }

  // Re-read all ratings from the DB into memory (call after a seed batch so the
  // in-memory cache matches the DB, which honoured the played=0 guard).
  async function reloadRatings() {
    if (!db || !db.query) return;
    try {
      var rows = (await db.query("SELECT team, rating FROM team_ratings")).rows || [];
      rows.forEach(function (r) { _ratings[r.team] = parseFloat(r.rating); });
    } catch (e) { /* keep existing cache */ }
  }

  return {
    predict: predict,             // sync (uses cache/baseline)
    predictAsync: predictAsync,   // ensures DB ratings loaded first
    updateFromResult: updateFromResult,
    getRating: getRating,
    knows: knows,
    ensureLoaded: ensureLoaded,
    seedRating: seedRating,
    reloadRatings: reloadRatings,
    _baseline: BASELINE,
  };
};
