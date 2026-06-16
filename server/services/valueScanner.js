/**
 * Value Scanner — finds where the Elite Edge Quant Model disagrees with the market.
 *
 * For each upcoming fixture it pulls the in-house model's probabilities and the
 * live bookmaker odds, DE-VIGS the market (strips the bookmaker margin for a fair
 * comparison), and flags selections where the model's probability beats the
 * market's implied probability by a meaningful edge. That gap is where value lives.
 *
 * Pure analysis — reads the model + odds, never touches the locked tipping engine.
 * Results cached briefly to avoid hammering the odds API.
 */
module.exports = function (deps) {
  var db = deps.db, sportMonks = deps.sportMonks, quant = deps.quantModel;
  var _cache = null, _cacheAt = 0;
  var CACHE_MS = 15 * 60 * 1000;

  function devig2(a, b) {
    var ia = a ? 1 / a : 0, ib = b ? 1 / b : 0, s = ia + ib;
    return s ? ia / s : null;
  }
  function devig3(h, d, a) {
    var ih = h ? 1 / h : 0, id = d ? 1 / d : 0, ia = a ? 1 / a : 0, s = ih + id + ia;
    return s ? { home: ih / s, draw: id / s, away: ia / s } : null;
  }

  // Scan upcoming WC fixtures. opts.minEdge = percentage-point threshold (default 5).
  async function scan(opts) {
    opts = opts || {};
    var minEdge = opts.minEdge != null ? opts.minEdge : 5;
    if (!opts.force && _cache && (Date.now() - _cacheAt) < CACHE_MS) return _cache;
    if (!db || !db.query || !quant || !sportMonks || !sportMonks.getMarketOdds) return { ready: false, flags: [] };

    var res = await db.query(
      "SELECT external_fixture_id, home_team, away_team, kickoff FROM world_cup_fixtures " +
      "WHERE status = 'scheduled' AND kickoff > NOW() AND kickoff <= NOW() + INTERVAL '4 days' " +
      "AND external_fixture_id IS NOT NULL AND home_team !~ '^[0-9]' AND home_team NOT ILIKE '%group%' " +
      "AND home_team NOT ILIKE '%winner%' AND home_team NOT ILIKE '%/%' ORDER BY kickoff ASC LIMIT 24"
    );
    var fixtures = res.rows || [];
    var flags = [];
    for (var i = 0; i < fixtures.length; i++) {
      var f = fixtures[i];
      var pred, mo;
      try { pred = quant.predict(f.home_team, f.away_team, { neutral: true }); } catch (e) { continue; }
      try { mo = await sportMonks.getMarketOdds(f.external_fixture_id); } catch (e) { continue; }
      if (!pred || !mo || !mo.home || !mo.away) continue;

      var mkt = devig3(mo.home, mo.draw, mo.away) || {};
      var ou = (mo.over25 && mo.under25) ? { over: devig2(mo.over25, mo.under25), under: devig2(mo.under25, mo.over25) } : {};
      var cands = [
        { market: 'Match Result', selection: f.home_team + ' Win', model: pred.winProb.home / 100, fair: mkt.home, odds: mo.home },
        { market: 'Match Result', selection: 'Draw', model: pred.winProb.draw / 100, fair: mkt.draw || null, odds: mo.draw },
        { market: 'Match Result', selection: f.away_team + ' Win', model: pred.winProb.away / 100, fair: mkt.away, odds: mo.away },
        { market: 'Total Goals', selection: 'Over 2.5 Goals', model: pred.over25 / 100, fair: ou.over != null ? ou.over : (mo.over25 ? 1 / mo.over25 : null), odds: mo.over25 },
        { market: 'Total Goals', selection: 'Under 2.5 Goals', model: pred.under25 / 100, fair: ou.under != null ? ou.under : (mo.under25 ? 1 / mo.under25 : null), odds: mo.under25 },
        { market: 'Both Teams to Score', selection: 'BTTS - Yes', model: pred.btts / 100, fair: mo.bttsYes ? 1 / mo.bttsYes : null, odds: mo.bttsYes },
      ];
      cands.forEach(function (c) {
        if (c.fair == null || !c.odds || c.odds < 1.2) return;
        var edge = (c.model - c.fair) * 100; // percentage points (model vs fair market)
        if (edge >= minEdge) {
          flags.push({
            fixture: f.home_team + ' v ' + f.away_team,
            kickoff: f.kickoff,
            market: c.market,
            selection: c.selection,
            modelProb: Math.round(c.model * 100),
            marketProb: Math.round(c.fair * 100),
            edge: Math.round(edge * 10) / 10,
            odds: Math.round(c.odds * 100) / 100,
            fairOdds: c.model > 0.02 ? Math.round((1 / c.model) * 100) / 100 : null,
          });
        }
      });
    }
    flags.sort(function (a, b) { return b.edge - a.edge; });
    _cache = { ready: true, generatedAt: new Date().toISOString(), count: flags.length, flags: flags };
    _cacheAt = Date.now();
    return _cache;
  }

  return { scan: scan };
};
