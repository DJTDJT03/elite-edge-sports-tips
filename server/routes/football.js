module.exports = function(deps) {
  const router = require('express').Router();
  const { footballSource, oddsSource, betfairSource, scoringModel, authenticate, db, aiReports, footballData, understatService, sportMonks, cosmoBet } = deps;
  const { storeOddsSnapshot, analyseOddsMovement } = deps.oddsHelpers;

  // GET /api/football/cosmo-odds — Cosmo Bet's live price for one of our picks +
  // a tracked "add to betslip" link. Scaffolding: returns { ready:false, ... }
  // until Cosmo supply the team map + betslip template (then it returns odds +
  // a pre-filled betslip link). Always includes a plain tracked link so the CTA
  // works regardless.
  router.get('/football/cosmo-odds', async function(req, res) {
    try {
      if (!cosmoBet) return res.json({ ready: false, reason: 'not configured' });
      var home = req.query.home, away = req.query.away, date = req.query.date;
      var market = req.query.market, selection = req.query.selection;
      var trackedLink = cosmoBet.trackedLink('cosmo-odds');
      var game = await cosmoBet.matchFixture(home, away, date);
      if (!game) return res.json({ ready: true, matched: false, trackedLink: trackedLink });
      var odds = await cosmoBet.getGameOdds(game.gameId);
      // Orientation-safe selection -> outcome mapping (never a wrong-side price).
      var so = cosmoBet.selectionOutcome(odds, selection, game.home, game.away, market);
      var betslipLink = (so && so.outcomeId) ? cosmoBet.betslipLink({ outcomeId: so.outcomeId, subId: 'betslip' }) : trackedLink;
      res.json({
        ready: true, matched: !!(so && so.outcomeId),
        game: { home: game.home, away: game.away },
        cosmoOdds: so ? so.price : null,
        betslipLink: betslipLink,
        deepLink: cosmoBet.isDeepLinkReady(),
      });
    } catch (err) {
      res.json({ ready: false, error: err.message });
    }
  });

  // GET /api/football/cosmo-tip-odds — Cosmo's live price for a specific published
  // TIP (by id), plus a "bigger price than we advised" flag for line-shopping value.
  // Parses home/away from the tip's "Home vs Away - League" event string. Always
  // safe: returns matched:false (→ generic tracked CTA) unless the fixture matches
  // unambiguously AND the selection maps to a real outcome — never a wrong price.
  router.get('/football/cosmo-tip-odds', async function(req, res) {
    try {
      if (!cosmoBet) return res.json({ ready: false, reason: 'not configured' });
      var tipId = req.query.tipId;
      if (!tipId || !db.getTipById) return res.json({ ready: false });
      var tip = await db.getTipById(tipId);
      if (!tip || (tip.sport && tip.sport !== 'football')) return res.json({ ready: false, reason: 'not football' });

      // "Home vs Away - League" → home / away (strip the league suffix).
      var parts = String(tip.event || '').split(/\s+vs\s+|\s+v\s+/i);
      if (parts.length < 2) return res.json({ ready: false, reason: 'unparseable' });
      var home = parts[0].trim();
      var away = parts[1].split(/\s+[-–—]\s+/)[0].trim();
      if (!home || !away) return res.json({ ready: false, reason: 'unparseable' });

      var trackedLink = cosmoBet.trackedLink('tip-odds');
      var game = await cosmoBet.matchFixture(home, away, tip.date);
      if (!game) return res.json({ ready: true, matched: false, trackedLink: trackedLink });
      var odds = await cosmoBet.getGameOdds(game.gameId);
      var so = cosmoBet.selectionOutcome(odds, tip.selection, game.home, game.away, tip.market);
      if (!so || !so.outcomeId || !so.price) return res.json({ ready: true, matched: false, trackedLink: trackedLink });

      // Advised odds — only compare when it's a clean decimal (>1). Fractional/odd
      // strings are skipped so we never show a bogus "bigger price" percentage.
      var advised = parseFloat(tip.odds);
      var advisedOk = isFinite(advised) && advised > 1 && !/\//.test(String(tip.odds));
      var cosmo = so.price;
      var betterPct = (advisedOk && cosmo > advised) ? Math.round((cosmo / advised - 1) * 100) : null;

      res.json({
        ready: true, matched: true,
        selection: tip.selection,
        advisedOdds: advisedOk ? advised : null,
        cosmoOdds: cosmo,
        betterPrice: !!(betterPct && betterPct > 0),
        betterPct: betterPct,
        betslipLink: cosmoBet.betslipLink({ outcomeId: so.outcomeId, subId: 'tip-betslip' }),
        deepLink: cosmoBet.isDeepLinkReady(),
      });
    } catch (err) {
      res.json({ ready: false, error: err.message });
    }
  });

  // GET /api/football/admin/cosmo-value — SHADOW value scan for review. Bootstraps
  // the Cosmo team map from our upcoming fixtures (unambiguous kickoff slots),
  // then flags selections our model rates above Cosmo's price. Admin-only so we
  // can verify match accuracy before exposing anything to users.
  router.get('/football/admin/cosmo-value', deps.authenticate, deps.requireAdmin, async function(req, res) {
    try {
      if (!cosmoBet || !deps.quantModel) return res.status(503).json({ error: 'Cosmo/quant not available' });
      // Our upcoming fixtures with kickoff + names, from match_predictions.
      var rows = [];
      if (db.query) {
        var r = await db.query(
          "SELECT DISTINCT home_team, away_team, kickoff FROM match_predictions " +
          "WHERE kickoff IS NOT NULL AND kickoff >= NOW() - INTERVAL '2 hours' AND kickoff <= NOW() + INTERVAL '5 days' ORDER BY kickoff ASC LIMIT 200"
        );
        rows = (r.rows || []).map(function(x) { return { home: x.home_team, away: x.away_team, kickoff: x.kickoff }; });
      }
      var learn = await cosmoBet.learnTeamMapFromFixtures(rows);
      var minEdge = req.query.minEdge ? parseFloat(req.query.minEdge) : 3;
      var scan = await cosmoBet.scanValue(rows, deps.quantModel, { minEdge: minEdge });
      res.json({ ok: true, ourFixtures: rows.length, mapLearned: learn, valueScan: scan, status: cosmoBet.getStatus() });
    } catch (err) {
      res.status(500).json({ error: 'Cosmo value scan failed: ' + err.message });
    }
  });

  // Short-lived server-side cache for match-intelligence responses. The modal
  // fires a dozen external + LLM calls per open; re-opening the same fixture (or
  // many users opening the same WC game) should be instant, not a full recompute.
  var _miCache = {};
  var _bankersCache = {}; // date -> { at, val } — the bankers scan is heavy, cache 5 min

  // ---------------------------------------------------------------------------
  // VERDICT LOCK — integrity guard for the World Cup "Our Take".
  // The first time a verdict is generated for a WC fixture (always pre-kick-off),
  // freeze it to world_cup_previews so it can NEVER be recomputed once the result
  // is known. Write-once (ON CONFLICT DO NOTHING) + skip if the game has already
  // kicked off, so a published pick stays exactly as the subscriber saw it.
  async function lockWcVerdict(cf, reason, market, pick, conf) {
    try {
      if (!db || !db.query || !cf || !cf.id || !pick) return;
      var ko = cf.kickoff ? new Date(cf.kickoff) : null;
      var started = (cf.status === 'finished') || (ko && ko.getTime() <= Date.now());
      if (started) return; // never lock a pick using post-kick-off / post-result data
      await db.query(
        "INSERT INTO world_cup_previews (fixture_id, home_team, away_team, kickoff, verdict, verdict_market, verdict_selection, confidence) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (fixture_id) DO NOTHING",
        [cf.id, cf.home_team || null, cf.away_team || null, cf.kickoff || null, reason || null, market || null, pick || null, conf || null]
      );
      console.log('[Match Intelligence] WC verdict LOCKED pre-match: ' + pick + ' (' + market + ') fixture ' + cf.id);
    } catch (e) { console.warn('[Match Intelligence] verdict lock failed: ' + e.message); }
  }

  // GENERAL verdict lock — the SAME integrity guarantee for ALL football, not
  // just the World Cup. A pick is computed ONCE, pre-kick-off, frozen, and shown
  // identically forever. It is NEVER recomputed from post-result data. If the
  // very first view of a game is after kick-off (no pre-match pick on record),
  // we show "no pre-match take" rather than a retrofitted, result-aware pick.
  // In-play/finished codes across both feeds (incl. penalties 'P', break 'BT',
  // suspended 'SUSP', interrupted 'INT'). Explicit "not yet played" codes below.
  var _STARTED = ['FT', 'AET', 'PEN', 'LIVE', 'HT', '1H', '2H', 'ET', 'BREAK', 'INT', 'P', 'BT', 'SUSP', 'FT_PEN'];
  var _NOT_STARTED = ['NS', 'TBD', 'PST', 'POSTP', 'CANC', 'ABD', 'AWD', 'WO', 'DELAYED'];
  function _hasStarted(status, kickoff) {
    var st = String(status || '').toUpperCase();
    if (_STARTED.indexOf(st) !== -1) return true;      // known in-play/finished
    if (_NOT_STARTED.indexOf(st) !== -1) return false; // known upcoming/void → safe to lock a pre-match pick
    var ko = kickoff ? new Date(kickoff).getTime() : NaN;
    if (!isNaN(ko)) return ko <= Date.now();           // trust a valid kickoff
    return true; // ambiguous (unknown status + no valid kickoff) → FAIL SAFE: treat as started, never retrofit a pick
  }
  async function getLockedVerdict(fid) {
    try {
      if (!db || !db.query) return null;
      var r = await db.query('SELECT market, selection, reason, confidence, risk_level, risk_text FROM match_verdict_locks WHERE fixture_id = $1 LIMIT 1', [String(fid)]);
      if (r.rows && r.rows.length) {
        var v = r.rows[0];
        return { market: v.market, pick: v.selection, reason: v.reason, confidence: v.confidence, riskLevel: v.risk_level || 'medium', riskText: v.risk_text || '', source: 'locked' };
      }
    } catch (e) { /* table may not exist yet */ }
    return null;
  }
  async function saveLockedVerdict(fid, v, kickoff, status) {
    try {
      if (!db || !db.query || !fid || !v || !v.pick) return;
      if (_hasStarted(status, kickoff)) return; // only ever lock a PRE-kick-off pick
      await db.query(
        'INSERT INTO match_verdict_locks (fixture_id, market, selection, reason, confidence, risk_level, risk_text, kickoff) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (fixture_id) DO NOTHING',
        [String(fid), v.market || null, v.pick || null, v.reason || null, v.confidence || null, v.riskLevel || null, v.riskText || null, kickoff || null]
      );
    } catch (e) { /* non-fatal */ }
  }

  // Build an "Our Take" from the quant model's OWN prediction (Elo + Dixon-Coles).
  // Deterministic, transparent, and identical to the model panel shown alongside
  // it — used both to proactively LOCK a pre-match take for every fixture and as
  // the shown take when no editorial tip / locked analyst verdict exists. This is
  // the model's call, never a retrofitted editorial narrative.
  function modelVerdict(pred, homeName, awayName) {
    if (!pred || !pred.pick || !pred.winProb) return null;
    var wp = pred.winProb, eg = pred.expectedGoals || {};
    var reason = 'Our Elo + Dixon-Coles model makes it ' + homeName + ' ' + wp.home + '% · Draw ' +
      wp.draw + '% · ' + awayName + ' ' + wp.away + '%' +
      (eg.home != null ? ', on a projected ' + eg.home + '–' + eg.away + ' expected-goals line' : '') +
      '. ' + pred.pick.selection + ' is the model’s value call.';
    var conf = Math.max(6, Math.min(9, pred.pick.confidence || 6));
    return {
      market: pred.pick.market || 'Match Result', pick: pred.pick.selection, reason: reason,
      confidence: conf, riskLevel: conf >= 8 ? 'Low' : conf >= 7 ? 'Low-Medium' : 'Medium',
      riskText: 'Elite Edge model call.', source: 'model',
    };
  }

  // ---------------------------------------------------------------------------
  // LIVE FOOTBALL DATA — SportMonks primary, API-Football fallback
  // ---------------------------------------------------------------------------

  router.get('/football/live-fixtures', async (req, res) => {
    try {
      var date = req.query.date || new Date().toISOString().split('T')[0];

      // Try SportMonks first (faster, better data)
      if (sportMonks && sportMonks.isAvailable()) {
        try {
          var smFixtures = await sportMonks.getFixturesByDate(date);
          if (smFixtures && smFixtures.length > 0) {
            // Merge real odds from Odds API into SportMonks fixtures
            if (oddsSource && process.env.ODDS_API_KEY && date === new Date().toISOString().split('T')[0]) {
              try {
                var oddsRaw = await oddsSource.fetch();
                var oddsData = oddsSource.normalise(oddsRaw);
                if (oddsData && oddsData.length > 0) {
                  smFixtures.forEach(function(f) {
                    if (f.homeOdds) return; // Already has odds
                    var match = oddsData.find(function(o) {
                      var oH = (o.homeTeam || '').toLowerCase();
                      var oA = (o.awayTeam || '').toLowerCase();
                      var fH = (f.homeTeam || '').toLowerCase();
                      var fA = (f.awayTeam || '').toLowerCase();
                      return (oH.indexOf(fH.substring(0, 6)) !== -1 || fH.indexOf(oH.substring(0, 6)) !== -1) &&
                             (oA.indexOf(fA.substring(0, 6)) !== -1 || fA.indexOf(oA.substring(0, 6)) !== -1);
                    });
                    if (match && match.bookmakerOdds) {
                      var bk = match.bookmakerOdds;
                      var firstBk = Object.keys(bk)[0];
                      if (firstBk && bk[firstBk]) {
                        f.homeOdds = bk[firstBk][f.homeTeam] || bk[firstBk][Object.keys(bk[firstBk])[0]] || null;
                        f.drawOdds = bk[firstBk]['Draw'] || bk[firstBk]['draw'] || null;
                        f.awayOdds = bk[firstBk][f.awayTeam] || bk[firstBk][Object.keys(bk[firstBk])[2]] || null;
                      }
                      // Over/Under + BTTS from markets
                      if (match.markets) {
                        if (match.markets.totals) {
                          var tBk = Object.keys(match.markets.totals)[0];
                          if (tBk) {
                            f.overOdds = match.markets.totals[tBk]['Over 2.5'] || match.markets.totals[tBk]['Over'] || null;
                            f.underOdds = match.markets.totals[tBk]['Under 2.5'] || match.markets.totals[tBk]['Under'] || null;
                          }
                        }
                        if (match.markets.btts) {
                          var bBk = Object.keys(match.markets.btts)[0];
                          if (bBk) {
                            f.bttsOdds = match.markets.btts[bBk]['Yes'] || match.markets.btts[bBk]['yes'] || null;
                          }
                        }
                      }
                    }
                  });
                }
              } catch(oddsErr) {
                // Non-fatal — fixtures still show, just without odds
              }
            }
            // Odds enrichment for tools that need prices on EVERY fixture (acca
            // builder, All Matches). The Odds API above only covers major leagues,
            // so cups/qualifiers arrive priceless. SportMonks prices these by exact
            // fixture id. Gated behind ?odds=1 so the 30s live poller stays cheap.
            if (req.query.odds === '1') {
              try { await sportMonks.enrichFixturesWithOdds(smFixtures, { cap: 60 }); } catch (e) {}
              // Cosmo Bet backup — real prices from our partner book for fixtures the
              // Odds API + SportMonks miss. Real bookmaker odds, so ranked ABOVE the
              // model estimate below (and matches the "Back with Cosmo Bet" CTA).
              if (cosmoBet && cosmoBet.enrichFixturesWithOdds) {
                try { await cosmoBet.enrichFixturesWithOdds(smFixtures, { cap: 40 }); } catch (e) {}
              }
              // Model-price fallback: lower-league / cup fixtures (e.g. League Cup R1)
              // have NO bookmaker odds from ANY source, which starves the acca builder.
              // Derive fair 1X2 / O-U / BTTS prices from our in-house quant model
              // (Elo + Dixon-Coles) so every real fixture is priceable. Flagged
              // oddsSource:'model' so the UI can label an estimated price. Skip when
              // ?model=0 (tools that must show bookmaker prices only).
              // Model-price fallback: fixtures no bookmaker priced get fair 1X2 /
              // O-U / BTTS prices from our quant model so every fixture is
              // priceable (oddsSource:'model'). ?model=0 opts out (bookmaker-only).
              if (req.query.model !== '0' && deps.quantModel && deps.quantModel.predictAsync) {
                var FINQ = { FT: 1, AET: 1, PEN: 1, CANC: 1, POSTP: 1, ABAN: 1 };
                var fairOdds = function (pctv) { var p = (pctv || 0) / 100; return p > 0.02 ? Math.round((1 / p) * 100) / 100 : null; };
                for (var qi = 0; qi < smFixtures.length; qi++) {
                  var qf = smFixtures[qi];
                  if (qf.homeOdds || !qf.homeTeam || !qf.awayTeam || FINQ[qf.status]) continue;
                  try {
                    var pr = await deps.quantModel.predictAsync(qf.homeTeam, qf.awayTeam);
                    if (pr && pr.winProb) {
                      qf.homeOdds = fairOdds(pr.winProb.home);
                      qf.drawOdds = fairOdds(pr.winProb.draw);
                      qf.awayOdds = fairOdds(pr.winProb.away);
                      qf.overOdds = fairOdds(pr.over25);
                      qf.underOdds = fairOdds(pr.under25);
                      qf.bttsOdds = fairOdds(pr.btts);
                      qf.oddsSource = 'model';
                    }
                  } catch (e) { /* non-fatal — fixture just stays priceless */ }
                }
              }
            }
            return res.json({ live: true, fixtures: smFixtures, source: 'sportmonks', fetchedAt: new Date().toISOString() });
          }
        } catch(smErr) {
          console.log('[Football] SportMonks failed, falling back to API-Football:', smErr.message);
        }
      }

      // Fallback to API-Football
      if (!footballSource || !process.env.API_FOOTBALL_KEY) {
        return res.json({ live: false, message: 'No football API configured.', fixtures: [] });
      }
      var raw = await footballSource.fetchFixturesByDate(date);
      var normalised = footballSource.normalise(raw);
      res.json({ live: true, fixtures: normalised, source: 'api-football', fetchedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /football/bankers — model VALUE picks in a "banker" odds band (~evens /
  // 5-6) where our informed model rates the price higher than the market. Uses
  // SportMonks' team-aware predictions (our sparse in-house Elo only when it
  // KNOWS both teams — never its uniform default, which would fabricate value),
  // compared against REAL bookmaker odds. Display-only; does not touch the locked
  // analyst/scoring/settle pipeline.
  router.get('/football/bankers', async (req, res) => {
    try {
      if (!sportMonks || !sportMonks.isAvailable()) return res.json({ bankers: [] });
      var date = req.query.date || new Date().toISOString().split('T')[0];
      // Serve a recent cached scan (the enrichment is heavy) unless ?fresh=1.
      var cHit = _bankersCache[date];
      if (cHit && req.query.fresh !== '1' && (Date.now() - cHit.at) < 300000) return res.json(cHit.val);
      var fixtures = await sportMonks.getFixturesByDate(date);
      if (!fixtures || !fixtures.length) return res.json({ bankers: [], scanned: 0 });
      // Real bookmaker odds: SportMonks 140+ books = the de-vig CONSENSUS (our fair
      // probability). Then attach Cosmo's OWN 1X2 prices alongside (not overwriting)
      // so we can flag where Cosmo pays MORE than the consensus fair price — genuine
      // value, at our partner book. (SportMonks predictions aren't populated for
      // these fixtures, so we don't spend calls on them.)
      try { await sportMonks.enrichFixturesWithOdds(fixtures, { cap: 60 }); } catch (e) {}
      if (cosmoBet && cosmoBet.enrichFixturesWithCosmoPrices) { try { await cosmoBet.enrichFixturesWithCosmoPrices(fixtures, { cap: 50 }); } catch (e) {} }

      // Band tuned to "around evens / 5-6" (~4/6 to 11/10). A banker is a strong,
      // fairly-priced pick — not a sub-1.5 no-value shortie, not a longshot.
      var band = { min: 1.57, max: 2.15 };
      var valueMax = 2.60; // value can sit a touch bigger than a pure banker price
      var FIN = { FT: 1, AET: 1, PEN: 1, CANC: 1, POSTP: 1, ABAN: 1 };
      var devig = function (prices) {
        if (!Array.isArray(prices)) return null;
        var inv = prices.map(function (p) { return (p && p > 1) ? 1 / p : 0; });
        var s = inv.reduce(function (a, b) { return a + b; }, 0);
        return s > 0 ? inv.map(function (x) { return x / s; }) : null;
      };
      var out = [];
      var dbg = { withSM: 0, withCosmo: 0, maxEdge: -99, edgeSample: [] };
      fixtures.forEach(function (f) {
        if (!f.homeTeam || !f.awayTeam || FIN[f.status]) return;
        if (f.oddsSource === 'model') return; // need a REAL market (not our fair-price fallback)
        if (f.homeOdds && f.drawOdds && f.awayOdds) dbg.withSM++;
        if (f.cosmo && f.cosmo.home) dbg.withCosmo++;
        // Consensus source: SportMonks multi-book if present, else Cosmo's own 1X2
        // (single book — no independent value comparison, but still a fair prob).
        var smHasTriple = !!(f.homeOdds && f.drawOdds && f.awayOdds);
        var cos = f.cosmo || {};
        var triple = smHasTriple ? [f.homeOdds, f.drawOdds, f.awayOdds]
          : (cos.home && cos.draw && cos.away) ? [cos.home, cos.draw, cos.away] : null;
        var f1 = triple ? devig(triple) : null;
        var fou = (f.overOdds && f.underOdds) ? devig([f.overOdds, f.underOdds]) : null; // O/U from the consensus book
        var cands = [
          { sel: f.homeTeam + ' Win', market: 'Match Result', consensusOdds: triple ? triple[0] : null, fair: f1 ? f1[0] : null, cosmoOdds: cos.home || null, cosmoLink: cos.homeLink || null, side: 'home' },
          { sel: f.awayTeam + ' Win', market: 'Match Result', consensusOdds: triple ? triple[2] : null, fair: f1 ? f1[2] : null, cosmoOdds: cos.away || null, cosmoLink: cos.awayLink || null, side: 'away' },
          { sel: 'Over 2.5 Goals', market: 'Over/Under', consensusOdds: f.overOdds, fair: fou ? fou[0] : null, cosmoOdds: null, cosmoLink: null, side: null },
          { sel: 'Under 2.5 Goals', market: 'Over/Under', consensusOdds: f.underOdds, fair: fou ? fou[1] : null, cosmoOdds: null, cosmoLink: null, side: null },
        ];
        var best = null;
        cands.forEach(function (c) {
          if (!c.fair) return;
          var fairPct = Math.round(c.fair * 100);
          // VALUE: Cosmo pays more than the (independent SM) consensus fair price.
          var valueEdge = null, betOdds = c.consensusOdds, betLink = null, betSrc = 'consensus';
          if (smHasTriple && c.cosmoOdds && c.cosmoOdds >= band.min && c.cosmoOdds <= valueMax) {
            var ve = c.fair - (1 / c.cosmoOdds);           // fair prob minus Cosmo-implied
            if (ve > dbg.maxEdge) { dbg.maxEdge = Math.round(ve * 1000) / 10; }
            if (ve > 0 && dbg.edgeSample.length < 8) dbg.edgeSample.push({ s: c.sel.slice(0, 14), fair: Math.round(c.fair * 100), cos: c.cosmoOdds, e: Math.round(ve * 1000) / 10 });
            // 5% floor: comfortably above proportional-de-vig favourite bias (which
            // over-states the favourite's fair prob by a point or two) + the small
            // staleness skew between the consensus and Cosmo snapshots, so a flagged
            // edge is genuine, not method artefact.
            if (ve >= 0.05 && c.fair >= 0.42) {
              valueEdge = Math.round(ve * 1000) / 10; betOdds = c.cosmoOdds; betLink = c.cosmoLink; betSrc = 'cosmo';
            }
          }
          // CONSENSUS banker (no value edge): strong favourite at a fair price in band.
          var isConsensus = c.consensusOdds && c.consensusOdds >= band.min && c.consensusOdds <= band.max && c.fair >= 0.50;
          if (valueEdge == null && !isConsensus) return;
          var o = parseFloat(betOdds) || 0;
          if (!o) return;
          var cand = {
            event: f.homeTeam + ' vs ' + f.awayTeam, league: f.league || '', kickoff: f.kickoff || '',
            selection: c.sel, market: c.market, odds: o, marketProb: fairPct,
            valueEdge: valueEdge, valueSource: valueEdge != null ? betSrc : null,
            confidence: Math.min(9, 6 + (valueEdge != null && valueEdge >= 5 ? 1 : 0) + (c.fair >= 0.55 ? 1 : 0) + (c.fair >= 0.62 ? 1 : 0)),
            oddsSource: valueEdge != null ? 'cosmo' : (f.oddsSource || 'book'), side: c.side,
            cosmoLink: betLink,
          };
          // Prefer a value pick over a plain consensus one; else the stronger fair prob.
          var better = !best || (cand.valueEdge != null && best.valueEdge == null) ||
            (((cand.valueEdge != null) === (best.valueEdge != null)) && cand.marketProb > best.marketProb);
          if (better) best = cand;
        });
        if (best) out.push(best);
      });
      // Value bankers first (by edge), then consensus bankers (by conviction).
      out.sort(function (a, b) {
        var av = (a.valueEdge || -1), bv = (b.valueEdge || -1);
        return (bv - av) || (b.marketProb - a.marketProb);
      });
      var payload = { bankers: out.slice(0, 6), scanned: fixtures.length };
      if (req.query.debug === '1') payload.debug = dbg;
      _bankersCache[date] = { at: Date.now(), val: payload };
      res.json(payload);
    } catch (err) { res.json({ bankers: [], error: err.message }); }
  });

  router.get('/football/live-scores', async (req, res) => {
    try {
      // Try SportMonks livescores first (15-second updates)
      if (sportMonks && sportMonks.isAvailable()) {
        try {
          var smLive = await sportMonks.getLivescores();
          if (smLive) {
            return res.json({ live: true, fixtures: smLive, source: 'sportmonks', fetchedAt: new Date().toISOString() });
          }
        } catch(smErr) {
          console.log('[Football] SportMonks livescores failed:', smErr.message);
        }
      }

      // Fallback to API-Football
      if (!footballSource || !process.env.API_FOOTBALL_KEY) {
        return res.json({ live: false, fixtures: [] });
      }
      var raw = await footballSource.fetchLiveScores();
      var normalised = footballSource.normalise(raw);
      res.json({ live: true, fixtures: normalised, source: 'api-football', fetchedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/football/h2h/:team1/:team2', async (req, res) => {
    try {
      if (!footballSource || !process.env.API_FOOTBALL_KEY) return res.json({ live: false });
      var raw = await footballSource.fetchH2H(req.params.team1, req.params.team2);
      res.json({ live: true, matches: footballSource.normalise(raw) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ---------------------------------------------------------------------------
  // MATCH INTELLIGENCE — Deep analysis for any fixture
  // ---------------------------------------------------------------------------
  router.get('/football/match-intelligence/:fixtureId', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!footballSource || !process.env.API_FOOTBALL_KEY) {
        return res.status(503).json({ error: 'API-Football not configured. Set API_FOOTBALL_KEY.' });
      }

      // Credit gate: deduct 1 credit for AI match preview (free users get form guide only)
      var authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          var decoded = require('jsonwebtoken').verify(authHeader.split(' ')[1], deps.JWT_SECRET);
          var user = await db.getUserById(decoded.id);
          if (user && user.subscription !== 'vip' && user.subscription !== 'premium' && user.role !== 'admin') {
            // Starter and free users spend 1 credit
            if (!user.credits || user.credits <= 0) {
              return res.status(402).json({ error: 'No credits remaining. Buy credits or upgrade to Premium for unlimited match intelligence.', creditsRequired: true });
            }
            await db.deductCredits(user.id, 1, 'match_intelligence', 'Match preview: fixture ' + req.params.fixtureId);
          }
        } catch(e) {} // auth failure = treat as free (will show limited data)
      }

      var fixtureId = req.params.fixtureId;

      // Serve a recent computed response if we have one (credits already handled
      // above). Keyed by the original id; 3-min TTL. Errors are never cached.
      var _miKey = String(req.params.fixtureId);
      if (_miCache[_miKey] && _miCache[_miKey].expires > Date.now()) {
        return res.json(_miCache[_miKey].payload);
      }
      var _miOrigJson = res.json.bind(res);
      res.json = function(_p) {
        try {
          if (_p && !_p.error) {
            _miCache[_miKey] = { payload: _p, expires: Date.now() + 180000 };
            if (Object.keys(_miCache).length > 400) _miCache = {}; // simple cap
          }
        } catch (e) {}
        return _miOrigJson(_p);
      };

      // Try SportMonks first for fixture detail (handles SportMonks IDs)
      var fixture, homeTeam, awayTeam, league, venue, kickoff, status;
      var homeFixtures = [], awayFixtures = [];
      var h2hMatches = [];
      var injuriesList = [], predictionsObj = null;
      var homeTeamSeasonStats = null, awayTeamSeasonStats = null;
      var usedSportMonks = false;
      var smRichData = null; // SportMonks All-In rich detail, shared by both branches
      var smRichHomeName = '', smRichAwayName = ''; // SportMonks home/away names for orientation

      // Always use API-Football for deep match intelligence (form, H2H, injuries, predictions, stats).
      // If the fixture ID is from SportMonks, resolve to API-Football by searching by team+date.
      if (!footballSource || !process.env.API_FOOTBALL_KEY) {
        return res.status(503).json({ error: 'API-Football not configured.' });
      }

      // 1. Try direct API-Football lookup first
      var fixtureData = await footballSource._apiGet('/fixtures?id=' + fixtureId);

      // 2. If direct lookup fails (SportMonks ID), resolve via SportMonks then search API-Football
      if ((!fixtureData.response || !fixtureData.response.length) && sportMonks && sportMonks.isAvailable()) {
        try {
          var smFixture = await sportMonks.getFixture(fixtureId);
          if (smFixture && smFixture.homeTeam && smFixture.kickoff) {
            usedSportMonks = true;

            // Pull SportMonks All-In rich detail (lineups + player ratings,
            // formations, full match stats, Pressure Index momentum) ONCE, keyed
            // by the SportMonks id before it's reassigned to an API-Football id.
            // Shared by both branches so this detail shows for every
            // SportMonks-covered fixture year-round — not just the World Cup.
            if (sportMonks.getFixtureRichData) {
              try { smRichData = await sportMonks.getFixtureRichData(fixtureId, smFixture.homeTeamId, smFixture.awayTeamId); }
              catch (e) { console.log('[Match Intelligence] SportMonks rich data failed:', e.message); }
              smRichHomeName = smFixture.homeTeam || ''; smRichAwayName = smFixture.awayTeam || '';
            }

            // World Cup fixtures: SportMonks All-In is the source of truth
            // (predictions, lineups, player ratings, full match stats, Pressure
            // Index). Resolving these to API-Football drops all of that rich data
            // and its WC coverage is sparse — so force the SportMonks branch by
            // leaving fixtureData empty. Detect via SportMonks league id, falling
            // back to our world_cup_fixtures table.
            var _isWorldCup = false;
            var _wcLeagueId = parseInt(process.env.SPORTMONKS_WC_LEAGUE_ID || '732', 10);
            if (smFixture.leagueId === _wcLeagueId) _isWorldCup = true;
            if (!_isWorldCup && db && db.isAvailable && db.isAvailable()) {
              try {
                var _wcChk = await db.query("SELECT 1 FROM world_cup_fixtures WHERE external_fixture_id::text = $1 LIMIT 1", [String(fixtureId)]);
                if (_wcChk.rows && _wcChk.rows.length) _isWorldCup = true;
              } catch (e) { /* table may not exist on non-WC deploys */ }
            }
            if (_isWorldCup) {
              console.log('[Match Intelligence] World Cup fixture ' + fixtureId + ' — using SportMonks All-In directly (skipping API-Football resolution).');
              throw { _wcSkip: true }; // jump to the SportMonks branch below
            }

            var smDate = smFixture.kickoff.toString().split('T')[0].split(' ')[0].substring(0, 10);
            var smHome = smFixture.homeTeam.toLowerCase().replace(/\s*(fc|afc|sc|cf)$/i, '').trim();
            var smAway = smFixture.awayTeam.toLowerCase().replace(/\s*(fc|afc|sc|cf)$/i, '').trim();
            console.log('[Match Intelligence] Resolving: ' + smFixture.homeTeam + ' vs ' + smFixture.awayTeam + ' on ' + smDate);

            var searchData = await footballSource._apiGet('/fixtures?date=' + smDate + '&timezone=Europe/London');
            if (searchData.response && searchData.response.length > 0) {
              console.log('[Match Intelligence] API-Football returned ' + searchData.response.length + ' fixtures for ' + smDate);
              // Fuzzy match: strip FC/AFC/SC suffixes, use first 4 chars as fallback
              var found = searchData.response.find(function(f) {
                var hName = f.teams.home.name.toLowerCase().replace(/\s*(fc|afc|sc|cf)$/i, '').trim();
                var aName = f.teams.away.name.toLowerCase().replace(/\s*(fc|afc|sc|cf)$/i, '').trim();
                // Exact substring match
                if ((hName.indexOf(smHome) !== -1 || smHome.indexOf(hName) !== -1) &&
                    (aName.indexOf(smAway) !== -1 || smAway.indexOf(aName) !== -1)) return true;
                // First 4 chars match (handles "Hibernian" vs "Hibernian FC" etc)
                if (hName.substring(0, 4) === smHome.substring(0, 4) &&
                    aName.substring(0, 4) === smAway.substring(0, 4)) return true;
                return false;
              });
              if (found) {
                fixtureData = { response: [found] };
                fixtureId = found.fixture.id;
                console.log('[Match Intelligence] Resolved to API-Football ID: ' + fixtureId + ' (' + found.teams.home.name + ' vs ' + found.teams.away.name + ')');
              } else {
                console.log('[Match Intelligence] No match found in API-Football. API-Football teams: ' + searchData.response.slice(0, 5).map(function(f) { return f.teams.home.name + ' vs ' + f.teams.away.name; }).join(', '));
              }
            } else {
              console.log('[Match Intelligence] API-Football returned 0 fixtures for date ' + smDate);
            }
          } else {
            console.log('[Match Intelligence] SportMonks returned no team data for fixture ' + fixtureId);
          }
        } catch(smErr) {
          // _wcSkip is an intentional jump (World Cup fixture) — fall through to
          // the SportMonks branch below, not an error.
          if (!(smErr && smErr._wcSkip)) {
            console.log('[Match Intelligence] SportMonks resolve failed:', smErr.message);
          }
        }
      }

      // If API-Football doesn't cover this league, build analysis from SportMonks data
      if (!fixtureData.response || !fixtureData.response.length) {
        if (usedSportMonks) {
          // We have SportMonks data — build a clean analysis from it
          // Reuse the fixture already fetched during resolution (don't fetch it twice).
          var smF = smFixture || await sportMonks.getFixture(fixtureId);
          if (smF && smF.homeTeam) {
            // Kick off H2H + predictions NOW so they run concurrently with the
            // form fetch below, instead of one slow call after another.
            var _h2hP = sportMonks.getH2H ? sportMonks.getH2H(smF.homeTeamId, smF.awayTeamId).catch(function(){return [];}) : Promise.resolve([]);
            var _predsP = sportMonks.getPredictions ? sportMonks.getPredictions(fixtureId).catch(function(){return [];}) : Promise.resolve([]);
            var smH2H = [];

            // Recent form + key stats for each team from SportMonks (last ~6 months)
            function _smDateStr(daysAgo) { var d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]; }
            function _computeTeamForm(fixtures, teamId) {
              var finished = (fixtures || []).filter(function(f) {
                return ['FT', 'AET', 'PEN'].indexOf(f.status) !== -1 && f.homeGoals != null && f.awayGoals != null;
              }).sort(function(a, b) { return new Date(b.kickoff) - new Date(a.kickoff); });
              var form = [], scored = 0, conceded = 0, cs = 0, btts = 0, over25 = 0, n = 0;
              finished.forEach(function(f) {
                var isHome = f.homeTeamId === teamId;
                var gf = isHome ? f.homeGoals : f.awayGoals;
                var ga = isHome ? f.awayGoals : f.homeGoals;
                if (n < 10) { scored += gf; conceded += ga; if (ga === 0) cs++; if (gf > 0 && ga > 0) btts++; if (gf + ga > 2.5) over25++; n++; }
                if (form.length < 5) {
                  form.push({ result: gf > ga ? 'W' : gf < ga ? 'L' : 'D', opponent: isHome ? f.awayTeam : f.homeTeam, goalsFor: gf, goalsAgainst: ga });
                }
              });
              var stats = n > 0 ? {
                avgScored: (scored / n).toFixed(1), avgConceded: (conceded / n).toFixed(1),
                cleanSheetPct: Math.round((cs / n) * 100), bttsPct: Math.round((btts / n) * 100), over25Pct: Math.round((over25 / n) * 100),
              } : { avgScored: '-', avgConceded: '-', cleanSheetPct: '-', bttsPct: '-', over25Pct: '-' };
              return { form: form, stats: stats, sampleSize: n };
            }
            var smHomeForm = { form: [], stats: { avgScored: '-', avgConceded: '-', cleanSheetPct: '-', bttsPct: '-', over25Pct: '-' }, sampleSize: 0 };
            var smAwayForm = smHomeForm;
            if (sportMonks.getTeamRecentFixtures) {
              try {
                var _from = _smDateStr(200), _to = _smDateStr(0);
                var _recent = await Promise.all([
                  sportMonks.getTeamRecentFixtures(smF.homeTeamId, _from, _to).catch(function() { return []; }),
                  sportMonks.getTeamRecentFixtures(smF.awayTeamId, _from, _to).catch(function() { return []; }),
                ]);
                smHomeForm = _computeTeamForm(_recent[0], smF.homeTeamId);
                smAwayForm = _computeTeamForm(_recent[1], smF.awayTeamId);
              } catch (e) { console.log('[Match Intelligence] SportMonks form fetch failed:', e.message); }
            }
            // H2H was fetched concurrently above — collect it now.
            try { smH2H = (await _h2hP) || []; } catch (e) { smH2H = []; }

            // Pre-match predictions (All-In) — mapped by SportMonks type_id
            // 237 = Fulltime Result (1X2), 240 = Correct Score, 231 = BTTS
            var smProb = null, smScore = null, smBtts = null;
            if (sportMonks.getPredictions) {
              try {
                var _preds = (await _predsP) || []; // fetched concurrently above
                (_preds || []).forEach(function(p) {
                  var pv = p.predictions || {};
                  if (p.type_id === 237 && pv.home != null) {
                    smProb = { home: Math.round(pv.home), draw: Math.round(pv.draw), away: Math.round(pv.away) };
                  } else if (p.type_id === 231 && pv.yes != null) {
                    smBtts = Math.round(pv.yes);
                  } else if (p.type_id === 240 && pv.scores) {
                    var best = null, bestP = 0;
                    Object.keys(pv.scores).forEach(function(k) {
                      if (k.indexOf('Other') === -1 && pv.scores[k] > bestP) { bestP = pv.scores[k]; best = k; }
                    });
                    if (best) smScore = best;
                  }
                });
                // Fallback if type ids differ on the plan: detect 1X2 by keys
                if (!smProb) (_preds || []).forEach(function(p) {
                  var pv = p.predictions || {};
                  if (!smProb && pv.home != null && pv.draw != null && pv.away != null) {
                    smProb = { home: Math.round(pv.home), draw: Math.round(pv.draw), away: Math.round(pv.away) };
                  }
                });
              } catch (e) { console.log('[Match Intelligence] SportMonks predictions failed:', e.message); }
            }

            // Rich All-In match detail — lineups WITH player ratings, formations,
            // full team stat sheet, and Pressure Index momentum (one call).
            // Stats/pressure are empty pre-match and parse to null defensively.
            // Reuse the rich detail already fetched during resolution (fall back
            // to a fresh fetch only if we somehow arrived here without it).
            var smLineups = null, smFormations = null, smTeamStats = null, smPressure = null;
            var smRich = smRichData;
            if (!smRich && sportMonks.getFixtureRichData) {
              try { smRich = await sportMonks.getFixtureRichData(fixtureId, smF.homeTeamId, smF.awayTeamId); }
              catch (e) { console.log('[Match Intelligence] SportMonks rich data failed:', e.message); }
            }
            if (smRich) {
              smLineups = smRich.lineups;
              smFormations = smRich.formations;
              smTeamStats = smRich.teamStats;
              smPressure = smRich.pressure;
            }

            // xG from fixture statistics — defensive key match (exact shape confirmed via diagnostic)
            var smHomeXg = null, smAwayXg = null;
            Object.keys(smF.stats || {}).forEach(function(k) {
              if (/expected_goals|xg/i.test(k)) {
                if (k.indexOf('home_') === 0) smHomeXg = smF.stats[k];
                else if (k.indexOf('away_') === 0) smAwayXg = smF.stats[k];
              }
            });

            // Prefer our 5-analyst consensus verdict (stored on the WC preview)
            // over the raw SportMonks model — the provisional WC model is
            // unreliable (it was headlining draws for clear favourites). The
            // consensus engine reasons on live team strength via Perplexity.
            var wcConsensusVerdict = null;
            try {
              var _pv = await db.query(
                "SELECT p.verdict, p.verdict_market, p.verdict_selection, p.confidence " +
                "FROM world_cup_previews p JOIN world_cup_fixtures f ON p.fixture_id = f.id " +
                "WHERE f.external_fixture_id::text = $1 AND p.verdict_selection IS NOT NULL LIMIT 1",
                [String(fixtureId)]
              );
              if (_pv.rows && _pv.rows.length) {
                var _r = _pv.rows[0];
                var _conf = _r.confidence || 7;
                wcConsensusVerdict = {
                  market: _r.verdict_market || 'Match Result',
                  pick: _r.verdict_selection,
                  reason: _r.verdict || 'Elite Edge multi-analyst consensus.',
                  confidence: _conf,
                  riskLevel: _conf >= 8 ? 'low' : _conf >= 6 ? 'low-medium' : 'medium',
                  riskText: 'Selection from the Elite Edge 5-analyst consensus engine.',
                  source: 'consensus',
                };
              }
            } catch (e) { console.log('[Match Intelligence] WC consensus lookup failed:', e.message); }

            // (Market-odds verdict removed — the engine leads; consensus or the
            // model heuristic decides. No wasted odds call here.)

            // Build verdict from the model — pick the BEST market (varied), not
            // always a win: clear favourite → win; goal-heavy → Over; both score
            // → BTTS; tight + low-scoring → Under; genuinely even → Draw.
            var smVerdict;
            if (smProb) {
              var _favHome = smProb.home >= smProb.away;
              var _favTeam = _favHome ? smF.homeTeam : smF.awayTeam;
              var _favProb = _favHome ? smProb.home : smProb.away;
              var _dogProb = _favHome ? smProb.away : smProb.home;
              var _gap = _favProb - _dogProb; // dominance
              var _modelLine = 'SportMonks model: ' + smF.homeTeam + ' ' + smProb.home + '%, Draw ' + smProb.draw + '%, ' + smF.awayTeam + ' ' + smProb.away + '%.'
                + (smHomeXg != null && smAwayXg != null ? ' Expected goals ' + smHomeXg + ' v ' + smAwayXg + '.' : '');
              var _total = null;
              if (smScore) { var _ps = String(smScore).split('-'); if (_ps.length === 2) _total = (parseInt(_ps[0]) || 0) + (parseInt(_ps[1]) || 0); }
              if (_gap >= 25) {
                smVerdict = { market: 'Match Result', pick: _favTeam + ' Win', reason: _modelLine + ' Clear edge to ' + _favTeam + '.', confidence: _gap >= 40 ? 9 : 8, riskLevel: 'low', riskText: 'Model favourite.' };
              } else if (smBtts != null && smBtts >= 62) {
                smVerdict = { market: 'Both Teams to Score', pick: 'BTTS - Yes', reason: _modelLine + ' Model BTTS ' + smBtts + '% — both expected to score.', confidence: Math.min(8, Math.round(smBtts / 12)), riskLevel: 'low-medium', riskText: 'Goals at both ends.' };
              } else if (_total != null && _total >= 3) {
                smVerdict = { market: 'Total Goals', pick: 'Over 2.5 Goals', reason: _modelLine + ' Projected ' + smScore + ' — leans Over 2.5.', confidence: 7, riskLevel: 'low-medium', riskText: 'Goals expected.' };
              } else if (_gap >= 12) {
                smVerdict = { market: 'Match Result', pick: _favTeam + ' Win', reason: _modelLine + ' Model edge to ' + _favTeam + '.', confidence: 7, riskLevel: 'low-medium', riskText: 'Model favours ' + _favTeam + '.' };
              } else if (_total != null && _total <= 2 && (smBtts == null || smBtts < 50)) {
                smVerdict = { market: 'Total Goals', pick: 'Under 2.5 Goals', reason: _modelLine + ' Low projected total (' + smScore + ') — leans Under 2.5.', confidence: 6, riskLevel: 'medium', riskText: 'Tight, low-scoring profile.' };
              } else {
                // Genuinely even — a draw is a legitimate call here.
                smVerdict = { market: 'Match Result', pick: 'Draw', reason: _modelLine + ' Tightly matched — the draw is live.', confidence: 6, riskLevel: 'medium', riskText: 'Evenly poised.' };
              }
            }
            var smH2HHomeWins = 0, smH2HAwayWins = 0, smH2HDraws = 0, smH2HTotalGoals = 0;
            smH2H.forEach(function(m) {
              if (m.homeGoals > m.awayGoals) { if (m.homeTeamId === smF.homeTeamId) smH2HHomeWins++; else smH2HAwayWins++; }
              else if (m.awayGoals > m.homeGoals) { if (m.awayTeamId === smF.awayTeamId) smH2HAwayWins++; else smH2HHomeWins++; }
              else smH2HDraws++;
              smH2HTotalGoals += (m.homeGoals || 0) + (m.awayGoals || 0);
            });
            var smH2HAvg = smH2H.length > 0 ? (smH2HTotalGoals / smH2H.length).toFixed(1) : '2.5';

            // Pick the verdict source, then guard: a World Cup "Our Take" must
            // never headline a bare Draw — back the favourite to win instead.
            var _finalVerdict = wcConsensusVerdict || smVerdict || {
              market: smH2HTotalGoals / Math.max(smH2H.length, 1) > 2.5 ? 'Total Goals' : 'Match Result',
              pick: smH2HTotalGoals / Math.max(smH2H.length, 1) > 2.5 ? 'Over 2.5 Goals' : (smH2HHomeWins > smH2HAwayWins ? smF.homeTeam + ' Win' : smF.awayTeam + ' Win'),
              reason: 'Based on head-to-head record: ' + smH2HHomeWins + ' home wins, ' + smH2HAwayWins + ' away wins, ' + smH2HDraws + ' draws across ' + smH2H.length + ' meetings. Average ' + smH2HAvg + ' goals per game.',
              confidence: 6,
              riskLevel: 'medium',
              riskText: 'Moderate risk — limited data depth for this league.',
            };
            // No draw-guard / market override — the engine's verdict stands as-is.

            // INTEGRITY (all football): a pick is computed ONCE pre-kick-off,
            // frozen, and shown identically forever — NEVER recomputed from
            // post-result data. A stored WC consensus verdict is already frozen,
            // so this only governs the live-model verdict.
            if (!wcConsensusVerdict && _finalVerdict && _finalVerdict.pick) {
              var _locked = await getLockedVerdict(fixtureId);
              if (_locked) {
                _finalVerdict = _locked; // serve the exact pick the subscriber saw pre-match
              } else if (_hasStarted(smF.status, smF.kickoff)) {
                // First ever view is post-kick-off → no locked pre-match analyst
                // take exists. Rather than a dead "no take", surface our
                // deterministic model's read (Elo + Dixon-Coles — the same engine
                // shown in the model panel below), clearly badged as the model's
                // call. We still never retrofit an editorial/analyst narrative.
                var _smMv = null;
                try {
                  if (deps.quantModel) {
                    var _smNeutral = /world cup|world championship|friendl/i.test((smF.league) || '');
                    var _smPred = deps.quantModel.predict(smF.homeTeam || '', smF.awayTeam || '', { neutral: _smNeutral });
                    _smMv = modelVerdict(_smPred, smF.homeTeam || 'Home', smF.awayTeam || 'Away');
                  }
                } catch (e) { /* fall through */ }
                _finalVerdict = _smMv || {
                  market: 'Match Result', pick: 'No pre-match take on record',
                  reason: 'We lock our verdict in before kick-off and never publish one after the result is known — so there is no pre-match take on record for this game.',
                  confidence: 0, riskLevel: 'n/a', riskText: 'Integrity: we only publish pre-kick-off.', source: 'none',
                };
              } else {
                // Pre-kick-off, no lock yet → freeze this pick now.
                await saveLockedVerdict(fixtureId, _finalVerdict, smF.kickoff, smF.status);
              }
              try {
                var _wcfx = await db.query("SELECT id, home_team, away_team, kickoff, status FROM world_cup_fixtures WHERE external_fixture_id::text = $1 LIMIT 1", [String(fixtureId)]);
                if (_wcfx.rows && _wcfx.rows.length) {
                  await lockWcVerdict(_wcfx.rows[0], _finalVerdict.reason, _finalVerdict.market, _finalVerdict.pick, _finalVerdict.confidence);
                }
              } catch (e) { /* non-fatal */ }
            }

            // Elite Edge Quant Model (Elo + Dixon-Coles) — the SAME model that
            // drives the consensus "Our Take", surfaced here so the displayed
            // model and the headline pick line up (the SportMonks panel can
            // diverge from our engine; the quant model is what we actually back).
            var _wcQuant = null;
            try { if (deps.quantModel) _wcQuant = deps.quantModel.predict(smF.homeTeam || '', smF.awayTeam || '', { neutral: true }); } catch (e) { /* non-fatal */ }

            return res.json({
              fixtureId: parseInt(fixtureId),
              source: 'sportmonks',
              quantModel: _wcQuant,
              match: {
                homeTeam: smF.homeTeam, homeTeamId: smF.homeTeamId, homeTeamLogo: smF.homeTeamLogo || '',
                awayTeam: smF.awayTeam, awayTeamId: smF.awayTeamId, awayTeamLogo: smF.awayTeamLogo || '',
                league: smF.league, leagueLogo: smF.leagueLogo || '', country: '',
                venue: smF.venue || '', city: smF.venueCity || '',
                kickoff: smF.kickoff, status: smF.status,
                homeGoals: smF.homeGoals, awayGoals: smF.awayGoals,
              },
              form: { home: smHomeForm.form, away: smAwayForm.form },
              h2h: {
                matches: smH2H.slice(0, 5).map(function(m) { return { home: m.homeTeam, away: m.awayTeam, homeGoals: m.homeGoals, awayGoals: m.awayGoals, date: m.kickoff }; }),
                homeWins: smH2HHomeWins, awayWins: smH2HAwayWins, draws: smH2HDraws, avgGoals: smH2HAvg,
              },
              stats: { home: smHomeForm.stats, away: smAwayForm.stats },
              injuries: { home: [], away: [] },
              predictions: null,
              seasonStats: { home: null, away: null },
              verdict: _finalVerdict,
              winProbability: smProb || null,
              predictedScore: smScore || null,
              bttsPercent: smBtts != null ? smBtts : null,
              lineups: smLineups || null,
              formations: smFormations || null,
              teamStats: smTeamStats || null,
              pressure: smPressure || null,
              xg: (smHomeXg != null && smAwayXg != null) ? { home: smHomeXg, away: smAwayXg } : null,
              analysis: {
                overview: smF.homeTeam + ' host ' + smF.awayTeam + ' at ' + (smF.venue || 'their home ground') + ' in the ' + smF.league + '.'
                  + (smProb ? ' The model makes it ' + smF.homeTeam + ' ' + smProb.home + '% / Draw ' + smProb.draw + '% / ' + smF.awayTeam + ' ' + smProb.away + '%.' : '')
                  + (smScore ? ' Most likely scoreline: ' + smScore + '.' : '')
                  + (smBtts != null ? ' Both teams to score: ' + smBtts + '%.' : '')
                  + (smHomeXg != null && smAwayXg != null ? ' Expected goals: ' + smHomeXg + ' v ' + smAwayXg + '.' : ''),
                form: (smHomeForm.sampleSize || smAwayForm.sampleSize)
                  ? (smF.homeTeam + ' have ' + smHomeForm.form.filter(function(r){return r.result==='W';}).length + ' wins from their last ' + smHomeForm.form.length + ', ' +
                     smF.awayTeam + ' ' + smAwayForm.form.filter(function(r){return r.result==='W';}).length + ' from their last ' + smAwayForm.form.length + '. ' +
                     'Averages: ' + smF.homeTeam + ' ' + smHomeForm.stats.avgScored + ' scored / ' + smHomeForm.stats.avgConceded + ' conceded, ' +
                     smF.awayTeam + ' ' + smAwayForm.stats.avgScored + ' / ' + smAwayForm.stats.avgConceded + ' per game.')
                  : 'Form data is still being gathered for these sides. H2H record shows ' + smH2HHomeWins + ' wins for ' + smF.homeTeam + ', ' + smH2HAwayWins + ' for ' + smF.awayTeam + ', and ' + smH2HDraws + ' draws.',
                h2h: smH2H.length > 0 ? 'In ' + smH2H.length + ' previous meetings, these sides have averaged ' + smH2HAvg + ' goals per game.' : 'No head-to-head history available.',
                injuries: '',
              },
              generatedAt: new Date().toISOString(),
            });
          }
        }
        return res.status(404).json({ error: 'Fixture not found in any data source.' });
      }

      fixture = fixtureData.response[0];
      homeTeam = fixture.teams.home;
      awayTeam = fixture.teams.away;
      league = fixture.league;
      venue = fixture.fixture.venue;
      kickoff = fixture.fixture.date;
      status = fixture.fixture.status;

      // 3. Fetch all deep data from API-Football in parallel
      var parallelResults = await Promise.allSettled([
        footballSource._apiGet('/fixtures/headtohead?h2h=' + homeTeam.id + '-' + awayTeam.id + '&last=10'),
        footballSource._apiGet('/fixtures?team=' + homeTeam.id + '&last=10'),
        footballSource._apiGet('/fixtures?team=' + awayTeam.id + '&last=10'),
        footballSource.fetchInjuries(parseInt(fixtureId)),
        footballSource.fetchPredictions(parseInt(fixtureId)),
        footballSource.fetchTeamStats(homeTeam.id, league.id, '2025'),
        footballSource.fetchTeamStats(awayTeam.id, league.id, '2025'),
      ]);

      h2hMatches = (parallelResults[0].status === 'fulfilled' ? parallelResults[0].value : { response: [] }).response || [];
      homeFixtures = (parallelResults[1].status === 'fulfilled' ? parallelResults[1].value : { response: [] }).response || [];
      awayFixtures = (parallelResults[2].status === 'fulfilled' ? parallelResults[2].value : { response: [] }).response || [];
      injuriesList = (parallelResults[3].status === 'fulfilled' ? parallelResults[3].value : { response: [] }).response || [];
      predictionsObj = (parallelResults[4].status === 'fulfilled' && parallelResults[4].value.response && parallelResults[4].value.response.length > 0) ? parallelResults[4].value.response[0] : null;
      homeTeamSeasonStats = (parallelResults[5].status === 'fulfilled' ? parallelResults[5].value : { response: null }).response || null;
      awayTeamSeasonStats = (parallelResults[6].status === 'fulfilled' ? parallelResults[6].value : { response: null }).response || null;

      // --- Build analysis (wrapped in try/catch — returns basic info if deep analysis fails) ---
      try {

      // Form analysis: last 5 results for each team
      function getForm(fixtures, teamId) {
        return fixtures.slice(0, 5).map(function(f) {
          var isHome = f.teams.home.id === teamId;
          var goalsFor = isHome ? f.goals.home : f.goals.away;
          var goalsAgainst = isHome ? f.goals.away : f.goals.home;
          var opponent = isHome ? f.teams.away.name : f.teams.home.name;
          var result = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
          return { result: result, goalsFor: goalsFor || 0, goalsAgainst: goalsAgainst || 0, opponent: opponent, date: f.fixture.date };
        });
      }

      var homeForm = getForm(homeFixtures, homeTeam.id);
      var awayForm = getForm(awayFixtures, awayTeam.id);

      // Goals analysis from last 10
      function getGoalsStats(fixtures, teamId) {
        if (!fixtures.length) return { avgScored: 0, avgConceded: 0, cleanSheets: 0, bttsCount: 0, over25Count: 0 };
        var totalScored = 0, totalConceded = 0, cleanSheets = 0, bttsCount = 0, over25Count = 0;
        fixtures.forEach(function(f) {
          var isHome = f.teams.home.id === teamId;
          var gf = isHome ? (f.goals.home || 0) : (f.goals.away || 0);
          var ga = isHome ? (f.goals.away || 0) : (f.goals.home || 0);
          totalScored += gf;
          totalConceded += ga;
          if (ga === 0) cleanSheets++;
          if (gf > 0 && ga > 0) bttsCount++;
          if ((gf + ga) > 2) over25Count++;
        });
        var n = fixtures.length;
        return {
          avgScored: +(totalScored / n).toFixed(2),
          avgConceded: +(totalConceded / n).toFixed(2),
          cleanSheets: cleanSheets,
          cleanSheetPct: Math.round((cleanSheets / n) * 100),
          bttsPct: Math.round((bttsCount / n) * 100),
          over25Pct: Math.round((over25Count / n) * 100),
          totalGames: n
        };
      }

      var homeStats = getGoalsStats(homeFixtures, homeTeam.id);
      var awayStats = getGoalsStats(awayFixtures, awayTeam.id);

      // H2H analysis
      var h2hHomeWins = 0, h2hAwayWins = 0, h2hDraws = 0, h2hTotalGoals = 0, h2hBtts = 0, h2hOver25 = 0;
      var h2hSummary = h2hMatches.map(function(f) {
        var hGoals = f.goals.home || 0;
        var aGoals = f.goals.away || 0;
        var isHomeTeamHome = f.teams.home.id === homeTeam.id;
        if (hGoals > aGoals) {
          if (isHomeTeamHome) h2hHomeWins++; else h2hAwayWins++;
        } else if (aGoals > hGoals) {
          if (isHomeTeamHome) h2hAwayWins++; else h2hHomeWins++;
        } else {
          h2hDraws++;
        }
        h2hTotalGoals += hGoals + aGoals;
        if (hGoals > 0 && aGoals > 0) h2hBtts++;
        if ((hGoals + aGoals) > 2) h2hOver25++;
        return {
          date: f.fixture.date,
          home: f.teams.home.name,
          away: f.teams.away.name,
          homeGoals: hGoals,
          awayGoals: aGoals,
          league: f.league.name
        };
      });

      var h2hCount = h2hMatches.length || 1;
      var h2hAvgGoals = +(h2hTotalGoals / h2hCount).toFixed(2);
      var h2hBttsPct = Math.round((h2hBtts / h2hCount) * 100);
      var h2hOver25Pct = Math.round((h2hOver25 / h2hCount) * 100);

      // --- Check if we have a published tip for this fixture first ---
      var verdictMarket = '';
      var verdictPick = '';
      var verdictReason = '';
      var confidence = 5;
      var riskLevel = 'Medium';
      var verdictSource = ''; // '', 'model' — lets the UI badge a model-derived take
      var fromPublishedTip = false;

      // PRIORITY: Use our actual published tip as the verdict (consistency with NAP/dashboard)
      try {
        var allTips = await db.getTips();
        var today = new Date().toISOString().split('T')[0];
        var matchingTip = allTips.find(function(t) {
          if (t.sport !== 'football' || t.status !== 'active') return false;
          var tipEvent = (t.event || '').toLowerCase();
          var hName = (homeTeam.name || '').toLowerCase();
          var aName = (awayTeam.name || '').toLowerCase();
          return (tipEvent.indexOf(hName) !== -1 || tipEvent.indexOf(aName) !== -1) ||
                 (hName.indexOf(tipEvent.split(' vs ')[0] || '') !== -1);
        });
        if (matchingTip) {
          verdictMarket = matchingTip.market || '';
          verdictPick = matchingTip.selection || '';
          var tipConf = Math.max(matchingTip.confidence || 6, 6); // Floor at 6
          var tipEdge = Math.max((matchingTip.edge || 0) * 100, 1).toFixed(1);
          verdictReason = (matchingTip.tipsterProfile ? matchingTip.tipsterProfile + ' rates this selection at ' + tipConf + '/10 confidence. ' : '') + 'Model edge: ' + tipEdge + '%.';
          confidence = tipConf;
          riskLevel = confidence >= 8 ? 'Low' : confidence >= 6 ? 'Medium' : 'High';
          fromPublishedTip = true;
          console.log('[Match Intelligence] Using published tip as verdict: ' + verdictPick + ' (' + verdictMarket + ')');
        }
      } catch(tipLookupErr) { /* non-fatal — fall through to auto-generate */ }

      // WORLD CUP: Elite Edge's 5-analyst consensus LEADS the headline (it's the
      // real engine and has been the sharpest read). Market/heuristics only fill
      // gaps when no consensus exists for the fixture.
      var fromConsensus = false;
      if (!fromPublishedTip) {
        try {
          var _csched = require('../services/wc2026Schedule');
          if (db.query) {
            var _crows = await db.query("SELECT id, home_team, away_team, kickoff, status, home_goals, away_goals FROM world_cup_fixtures");
            var _chn = homeTeam.name, _can = awayTeam.name;
            var _cf = (_crows.rows || []).find(function (r) {
              return (_csched.teamsMatch(r.home_team, _chn) && _csched.teamsMatch(r.away_team, _can)) ||
                     (_csched.teamsMatch(r.home_team, _can) && _csched.teamsMatch(r.away_team, _chn));
            });
            if (_cf) {
              var _cpv = await db.query("SELECT verdict_selection, verdict_market, verdict, confidence FROM world_cup_previews WHERE fixture_id = $1 AND verdict_selection IS NOT NULL LIMIT 1", [_cf.id]);
              if (_cpv.rows && _cpv.rows.length) {
                var _cc = _cpv.rows[0];
                verdictMarket = _cc.verdict_market || 'Match Result';
                verdictPick = _cc.verdict_selection;
                verdictReason = (_cc.verdict || 'Elite Edge 5-analyst consensus.');
                confidence = _cc.confidence || 7;
                riskLevel = confidence >= 8 ? 'Low' : confidence >= 6 ? 'Medium' : 'High';
                fromConsensus = true;
                console.log('[Match Intelligence] WC consensus verdict used: ' + verdictPick + ' (' + verdictMarket + ')');
              }
            }
          }
        } catch (e) { /* non-fatal — fall through to market/heuristics */ }
      }

      // SAFETY NET: a World Cup match that has FINISHED must NEVER show a freshly
      // recomputed verdict. Once it's played, the live form includes the result, so
      // the heuristic would just rationalise the score — that's the "verdict changed
      // after the match" bug. If we locked a pre-match take it's used above; if not,
      // we show the result, not a retrospective pick.
      if (typeof _cf !== 'undefined' && _cf && _cf.status === 'finished' && !fromConsensus && !fromPublishedTip) {
        var _hg = _cf.home_goals, _ag = _cf.away_goals;
        verdictMarket = 'Full-Time Result';
        verdictPick = (_hg != null && _ag != null) ? (_cf.home_team + ' ' + _hg + '–' + _ag + ' ' + _cf.away_team) : 'Match finished';
        verdictReason = 'This match has been played. We lock our verdict in before kick-off and never publish one after the result is known — so there\'s no pre-match take on record for this game.';
        confidence = 6;
        riskLevel = 'Medium';
      }

      // Ensure stats have safe defaults
      homeStats.cleanSheetPct = homeStats.cleanSheetPct || 0;
      homeStats.bttsPct = homeStats.bttsPct || 0;
      homeStats.over25Pct = homeStats.over25Pct || 0;
      homeStats.avgScored = homeStats.avgScored || 0;
      homeStats.avgConceded = homeStats.avgConceded || 0;
      awayStats.cleanSheetPct = awayStats.cleanSheetPct || 0;
      awayStats.bttsPct = awayStats.bttsPct || 0;
      awayStats.over25Pct = awayStats.over25Pct || 0;
      awayStats.avgScored = awayStats.avgScored || 0;
      awayStats.avgConceded = awayStats.avgConceded || 0;

      var combinedBttsPct = (homeStats.bttsPct + awayStats.bttsPct + h2hBttsPct) / 3;
      var combinedOver25Pct = (homeStats.over25Pct + awayStats.over25Pct + h2hOver25Pct) / 3;
      var homeFormWins = homeForm.filter(function(r) { return r.result === 'W'; }).length;
      var awayFormWins = awayForm.filter(function(r) { return r.result === 'W'; }).length;
      var h2hDominance = Math.abs(h2hHomeWins - h2hAwayWins);
      var avgTotalGoals = (homeStats.avgScored + homeStats.avgConceded + awayStats.avgScored + awayStats.avgConceded) / 2;

      // Only auto-generate verdict if no published tip exists for this fixture
      if (verdictMarket && verdictPick) {
        // Already set from published tip — skip auto-generation
      } else if (combinedBttsPct >= 65 && homeStats.avgScored >= 1.0 && awayStats.avgScored >= 1.0) {
        verdictMarket = 'Both Teams to Score';
        verdictPick = 'BTTS - Yes';
        verdictReason = 'Both sides have been finding the net consistently. ' +
          homeTeam.name + ' score in ' + homeStats.bttsPct + '% of matches while ' +
          awayTeam.name + ' manage it in ' + awayStats.bttsPct + '%. ' +
          'The head-to-head record reinforces this with both teams scoring in ' + h2hBttsPct + '% of recent meetings.';
        confidence = Math.min(10, Math.round(combinedBttsPct / 10));
        riskLevel = confidence >= 7 ? 'Low' : 'Medium';
      } else if (h2hDominance >= 3 || (h2hDominance >= 2 && (homeFormWins >= 4 || awayFormWins >= 4))) {
        var dominant = h2hHomeWins > h2hAwayWins ? homeTeam.name : awayTeam.name;
        var dominantWins = Math.max(h2hHomeWins, h2hAwayWins);
        verdictMarket = 'Match Result';
        verdictPick = dominant + ' to Win';
        verdictReason = dominant + ' have won ' + dominantWins + ' of the last ' + h2hMatches.length +
          ' head-to-head meetings. That level of dominance in direct encounters is a strong indicator. ';
        if (dominant === homeTeam.name && homeFormWins >= 3) {
          verdictReason += 'Backed up by strong current form with ' + homeFormWins + ' wins from their last 5 matches.';
        } else if (dominant === awayTeam.name && awayFormWins >= 3) {
          verdictReason += 'Their recent form is equally impressive with ' + awayFormWins + ' wins from 5 outings.';
        }
        confidence = Math.min(10, 5 + h2hDominance);
        riskLevel = confidence >= 7 ? 'Low' : 'Medium';
      } else if (combinedOver25Pct >= 60 || avgTotalGoals >= 3.0) {
        verdictMarket = 'Total Goals';
        verdictPick = 'Over 2.5 Goals';
        verdictReason = 'The numbers point to goals in this one. ' +
          homeTeam.name + ' average ' + homeStats.avgScored.toFixed(1) + ' goals scored and ' +
          homeStats.avgConceded.toFixed(1) + ' conceded per match. ' +
          awayTeam.name + ' contribute ' + awayStats.avgScored.toFixed(1) + ' scored and ' +
          awayStats.avgConceded.toFixed(1) + ' conceded. ' +
          'Head-to-head meetings see an average of ' + h2hAvgGoals + ' goals per game.';
        confidence = Math.min(10, Math.round(combinedOver25Pct / 10));
        riskLevel = confidence >= 7 ? 'Low' : 'Medium';
      } else {
        // Tight/defensive profile
        var homeDraws = homeForm.filter(function(r) { return r.result === 'D'; }).length;
        var awayDraws = awayForm.filter(function(r) { return r.result === 'D'; }).length;
        if (homeDraws + awayDraws >= 4 || h2hDraws >= 3) {
          verdictMarket = 'Match Result';
          verdictPick = 'Draw';
          verdictReason = 'This fixture has stalemate written all over it. ' +
            h2hDraws + ' of the last ' + h2hMatches.length + ' meetings ended level. ' +
            'Neither side shows the kind of form that suggests they can force a result here.';
          confidence = Math.min(10, 4 + h2hDraws);
          riskLevel = 'Medium';
        } else {
          verdictMarket = 'Total Goals';
          verdictPick = 'Under 2.5 Goals';
          verdictReason = 'A low-scoring affair looks the most likely outcome. ' +
            homeTeam.name + ' keep clean sheets in ' + homeStats.cleanSheetPct + '% of games while ' +
            awayTeam.name + ' average just ' + awayStats.avgScored.toFixed(1) + ' goals per game. ' +
            'The head-to-head average is ' + h2hAvgGoals + ' goals per meeting.';
          confidence = Math.min(10, Math.round((100 - combinedOver25Pct) / 12));
          riskLevel = confidence >= 6 ? 'Low-Medium' : 'Medium';
        }
      }

      // NOTE: no market-odds override. The Elite Edge engine leads — the consensus
      // verdict (when present) or the analyst heuristic above. The market is not
      // allowed to overrule the engine's call (including a genuine draw).

      // Confidence floor — never show below 6 or above 9 in auto-generated verdicts
      if (confidence < 6) confidence = 6;
      if (confidence > 9) confidence = 9;

      // INTEGRITY (all football): an AUTO-GENERATED pick is frozen pre-kick-off
      // and NEVER recomputed from post-result data. Published tips + WC consensus
      // are already stable sources (kept as-is). Applies to domestic + friendlies
      // too, not just the World Cup.
      if (!fromConsensus && !fromPublishedTip && verdictPick) {
        var _afStatus = status && (status.short || status);
        var _lockedAf = await getLockedVerdict(fixtureId);
        if (_lockedAf) {
          verdictMarket = _lockedAf.market; verdictPick = _lockedAf.pick; verdictReason = _lockedAf.reason;
          confidence = _lockedAf.confidence || confidence; riskLevel = _lockedAf.riskLevel || riskLevel;
        } else if (_hasStarted(_afStatus, kickoff)) {
          // No locked pre-match take (nobody opened this game before kick-off).
          // Rather than a dead "no take", surface our deterministic model's read —
          // the SAME Elo + Dixon-Coles numbers shown in the model panel below,
          // clearly framed as the model's call. We never retrofit an editorial
          // analyst narrative to a known result.
          var _mv = null;
          try {
            if (deps.quantModel) {
              var _mvNeutral = /world cup|world championship|friendl/i.test(league.name || '');
              var _mvPred = deps.quantModel.predict(homeTeam.name || '', awayTeam.name || '', { neutral: _mvNeutral });
              _mv = modelVerdict(_mvPred, homeTeam.name || 'Home', awayTeam.name || 'Away');
            }
          } catch (e) { /* fall through */ }
          if (_mv) {
            verdictMarket = _mv.market; verdictPick = _mv.pick; verdictReason = _mv.reason;
            confidence = _mv.confidence; riskLevel = _mv.riskLevel; riskText = _mv.riskText;
            verdictSource = 'model';
          } else {
            verdictMarket = 'Match Result';
            verdictPick = 'No pre-match take on record';
            verdictReason = 'We lock our verdict in before kick-off and never publish one after the result is known — so there is no pre-match take on record for this game.';
            confidence = 0; riskLevel = 'n/a';
          }
        } else {
          await saveLockedVerdict(fixtureId, { market: verdictMarket, pick: verdictPick, reason: verdictReason, confidence: confidence, riskLevel: riskLevel, riskText: riskText }, kickoff, _afStatus);
        }
        if (typeof _cf !== 'undefined' && _cf) await lockWcVerdict(_cf, verdictReason, verdictMarket, verdictPick, confidence);
      }

      // Generate written analysis paragraphs
      var overviewText = homeTeam.name + ' welcome ' + awayTeam.name + ' to ' +
        (venue ? venue.name : 'their home ground') + ' in ' + league.name + ' action. ' +
        'Kick-off is scheduled for ' + new Date(kickoff).toLocaleString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
        }) + '.';

      var formText = homeTeam.name + ' come into this match with ' + homeFormWins + ' wins from their last 5 outings' +
        (homeStats.avgScored >= 1.5 ? ', scoring freely at ' + homeStats.avgScored.toFixed(1) + ' goals per game' : '') + '. ' +
        awayTeam.name + ' have recorded ' + awayFormWins + ' wins from 5, ' +
        (awayStats.avgScored >= 1.5 ? 'also finding the net regularly with ' + awayStats.avgScored.toFixed(1) + ' per match' :
         'managing ' + awayStats.avgScored.toFixed(1) + ' goals per game') + '. ' +
        (homeStats.cleanSheetPct >= 40 ? homeTeam.name + ' have been solid defensively with clean sheets in ' + homeStats.cleanSheetPct + '% of recent outings. ' : '') +
        (awayStats.cleanSheetPct >= 40 ? awayTeam.name + ' have kept things tight at the back with ' + awayStats.cleanSheetPct + '% clean sheets. ' : '');

      // Enhanced: add season stats context to form text
      if (homeTeamSeasonStats && homeTeamSeasonStats.goals && homeTeamSeasonStats.goals.for && homeTeamSeasonStats.goals.for.average) {
        var hSeasonGpg = homeTeamSeasonStats.goals.for.average.total;
        var hSeasonPlayed = homeTeamSeasonStats.fixtures && homeTeamSeasonStats.fixtures.played ? homeTeamSeasonStats.fixtures.played.home || 0 : 0;
        if (hSeasonGpg && hSeasonPlayed) {
          formText += homeTeam.name + ' have scored in ' + hSeasonPlayed + ' home games this season, averaging ' + hSeasonGpg + ' goals per game. ';
        }
      }
      if (awayTeamSeasonStats && awayTeamSeasonStats.goals && awayTeamSeasonStats.goals.for && awayTeamSeasonStats.goals.for.average) {
        var aSeasonGpg = awayTeamSeasonStats.goals.for.average.total;
        var aCleanSheetTotal = awayTeamSeasonStats.clean_sheet ? awayTeamSeasonStats.clean_sheet.total || 0 : 0;
        var aPlayedTotal = awayTeamSeasonStats.fixtures && awayTeamSeasonStats.fixtures.played ? awayTeamSeasonStats.fixtures.played.total || 1 : 1;
        var aBttsPctSeason = Math.round(((aPlayedTotal - aCleanSheetTotal) / aPlayedTotal) * 100);
        if (aBttsPctSeason) {
          formText += 'BTTS has landed in ' + aBttsPctSeason + '% of ' + awayTeam.name + '\'s away games. ';
        }
      }

      var h2hText = h2hMatches.length > 0 ?
        'In their last ' + h2hMatches.length + ' meetings, ' + homeTeam.name + ' have won ' + h2hHomeWins +
        ', ' + awayTeam.name + ' have won ' + h2hAwayWins + ', with ' + h2hDraws + ' draws. ' +
        'These fixtures produce an average of ' + h2hAvgGoals + ' goals per game' +
        (h2hBttsPct >= 50 ? ' with both teams scoring in ' + h2hBttsPct + '% of encounters.' : '.') :
        'No recent head-to-head data available for this matchup.';

      // Enhanced analysis: injuries text
      var injuriesText = 'Check team news closer to kick-off for any late changes.';
      if (injuriesList.length > 0) {
        var homeInjuredPlayers = injuriesList.filter(function(inj) { return inj.team && inj.team.id === homeTeam.id; });
        var awayInjuredPlayers = injuriesList.filter(function(inj) { return inj.team && inj.team.id === awayTeam.id; });
        var homeInjuredNames = homeInjuredPlayers.map(function(inj) { return inj.player ? inj.player.name : 'Unknown'; });
        var awayInjuredNames = awayInjuredPlayers.map(function(inj) { return inj.player ? inj.player.name : 'Unknown'; });

        injuriesText = 'Key injuries: ';
        if (homeInjuredNames.length > 0) {
          injuriesText += homeTeam.name + ' missing ' + homeInjuredNames.join(', ') + '. ';
        } else {
          injuriesText += homeTeam.name + ' at full strength. ';
        }
        if (awayInjuredNames.length > 0) {
          injuriesText += awayTeam.name + ' missing ' + awayInjuredNames.join(', ') + '.';
        } else {
          injuriesText += awayTeam.name + ' at full strength.';
        }
      }

      // Enhanced analysis: predictions text
      var predictionsText = '';
      if (predictionsObj && predictionsObj.predictions && predictionsObj.predictions.percent) {
        var pct = predictionsObj.predictions.percent;
        var predHomePct = pct.home || '0%';
        var predDrawPct = pct.draw || '0%';
        var predAwayPct = pct.away || '0%';
        var predWinner = 'draw';
        var predWinnerPct = predDrawPct;
        if (parseInt(predHomePct) > parseInt(predAwayPct) && parseInt(predHomePct) > parseInt(predDrawPct)) {
          predWinner = homeTeam.name; predWinnerPct = predHomePct;
        } else if (parseInt(predAwayPct) > parseInt(predHomePct)) {
          predWinner = awayTeam.name; predWinnerPct = predAwayPct;
        }
        predictionsText = 'Independent prediction model gives ' + predWinner + ' a ' + predWinnerPct + ' chance of winning. ' +
          '(Home: ' + predHomePct + ', Draw: ' + predDrawPct + ', Away: ' + predAwayPct + ')';
      }

      // A model-derived take carries its own risk text — don't overwrite it with
      // the analyst-narrative version (that would dress a transparent model read
      // in editorial framing it never claimed).
      var riskText = 'Elite Edge model call.';
      if (verdictSource !== 'model') {
        if (riskLevel === 'Low') {
          riskText = 'The data signals are clear and consistent across form, head-to-head, and statistical trends. This represents one of the stronger opportunities on the card.';
        } else if (riskLevel === 'Low-Medium') {
          riskText = 'There is a reasonable degree of certainty here, though one or two factors introduce minor uncertainty. A solid proposition overall.';
        } else if (riskLevel === 'Medium') {
          riskText = 'There are competing signals in the data. While the overall direction is clear, this is not a standout selection. Stake accordingly.';
        } else {
          riskText = 'The data is inconclusive or contradictory. This selection carries above-average risk and should be approached with caution.';
        }
      }

      // --- Betfair Exchange enrichment for football ---
      var matchExchangeData = null;
      var exchangeAnalysisText = '';
      if (betfairSource && betfairSource.isConfigured()) {
        try {
          var bfFootballMarkets = await betfairSource.fetchFootballMarkets(homeTeam.name, awayTeam.name);
          if (bfFootballMarkets && bfFootballMarkets.length > 0) {
            // Get exchange data for the main MATCH_ODDS market
            var matchOddsMarket = bfFootballMarkets.find(function(m) {
              return m.description && m.description.marketType === 'MATCH_ODDS';
            }) || bfFootballMarkets[0];

            var bfExData = await betfairSource.getExchangeData(matchOddsMarket.marketId);
            if (bfExData && bfExData.runners && bfExData.runners.length > 0) {
              matchExchangeData = {
                marketId: bfExData.marketId,
                totalMatched: bfExData.totalMatched,
                runners: bfExData.runners.map(function(er) {
                  return {
                    runnerName: er.runnerName,
                    backPrice: er.backPrice,
                    layPrice: er.layPrice,
                    spread: er.spread,
                    tradedVolume: er.tradedVolume,
                    priceMovement: er.priceMovement,
                    volumeRank: er.volumeRank,
                  };
                }),
              };

              // Generate exchange analysis text
              var topVolRunner = bfExData.runners.filter(function(r) { return r.tradedVolume > 0; })
                .sort(function(a, b) { return b.tradedVolume - a.tradedVolume; })[0];
              if (topVolRunner && topVolRunner.tradedVolume > 1000) {
                var fVolFormatted = topVolRunner.tradedVolume >= 1000
                  ? '\u00A3' + (topVolRunner.tradedVolume / 1000).toFixed(0) + 'k'
                  : '\u00A3' + topVolRunner.tradedVolume;
                var fMovText = topVolRunner.priceMovement === 'shortening' ? 'price shortening'
                  : topVolRunner.priceMovement === 'drifting' ? 'price drifting' : 'price stable';
                exchangeAnalysisText = 'Betfair Exchange shows heavy money on ' + topVolRunner.runnerName +
                  ' \u2014 ' + fVolFormatted + ' traded, ' + fMovText + '.';

                // Check for other interesting markets (BTTS, Over/Under)
                for (var bmIdx = 0; bmIdx < bfFootballMarkets.length; bmIdx++) {
                  var bfMkt = bfFootballMarkets[bmIdx];
                  var mktType = bfMkt.description ? bfMkt.description.marketType : (bfMkt.marketName || '');
                  if (mktType === 'OVER_UNDER_25' || mktType === 'BOTH_TEAMS_TO_SCORE') {
                    try {
                      var altExData = await betfairSource.getExchangeData(bfMkt.marketId);
                      if (altExData && altExData.runners) {
                        var altTopRunner = altExData.runners.filter(function(r) { return r.tradedVolume > 0; })
                          .sort(function(a, b) { return b.tradedVolume - a.tradedVolume; })[0];
                        if (altTopRunner && altTopRunner.tradedVolume > 2000) {
                          var altVolFmt = altTopRunner.tradedVolume >= 1000
                            ? '\u00A3' + (altTopRunner.tradedVolume / 1000).toFixed(0) + 'k'
                            : '\u00A3' + altTopRunner.tradedVolume;
                          exchangeAnalysisText += ' Also: ' + altVolFmt + ' traded on ' +
                            (altTopRunner.runnerName || mktType) + ' (' + fMovText + ').';
                        }
                      }
                    } catch (altErr) { /* non-fatal */ }
                    break; // Only check one additional market
                  }
                }
              }
            }
          }
        } catch (bfMatchErr) {
          console.log('[match-intelligence] Betfair data unavailable: ' + bfMatchErr.message);
        }
      }

      // --- Odds Movement Intelligence ---
      var oddsMovementData = null;
      var oddsMovementText = '';
      try {
        var miEventKey = (homeTeam.name + ' v ' + awayTeam.name).toLowerCase();
        // Analyse movement for home team (most common selection)
        var homeMovement = analyseOddsMovement(miEventKey, homeTeam.name);
        var awayMovement = analyseOddsMovement(miEventKey, awayTeam.name);
        // Use the movement for the verdict pick if available, otherwise home team
        var primaryMovement = null;
        var primarySelection = '';
        if (verdictPick && verdictPick.indexOf(homeTeam.name) !== -1) {
          primaryMovement = homeMovement;
          primarySelection = homeTeam.name;
        } else if (verdictPick && verdictPick.indexOf(awayTeam.name) !== -1) {
          primaryMovement = awayMovement;
          primarySelection = awayTeam.name;
        } else {
          primaryMovement = homeMovement;
          primarySelection = homeTeam.name;
        }

        if (primaryMovement) {
          oddsMovementData = {
            direction: primaryMovement.direction,
            openingAvg: primaryMovement.openingAvg,
            currentAvg: primaryMovement.currentAvg,
            changePercent: primaryMovement.changePercent,
            bookmakers: primaryMovement.bookmakerCount,
            selection: primarySelection,
          };
          if (primaryMovement.direction === 'shortening') {
            oddsMovementText = 'Market movement: odds have shortened from ' + primaryMovement.openingAvg.toFixed(2) + ' to ' + primaryMovement.currentAvg.toFixed(2) + ' across ' + primaryMovement.bookmakerCount + ' bookmakers \u2014 strong market confidence in ' + primarySelection + '.';
          } else if (primaryMovement.direction === 'drifting') {
            oddsMovementText = 'Market movement: odds have drifted from ' + primaryMovement.openingAvg.toFixed(2) + ' to ' + primaryMovement.currentAvg.toFixed(2) + ' across ' + primaryMovement.bookmakerCount + ' bookmakers \u2014 market confidence in ' + primarySelection + ' is weakening.';
          } else {
            oddsMovementText = 'Market movement: odds stable around ' + primaryMovement.currentAvg.toFixed(2) + ' across ' + primaryMovement.bookmakerCount + ' bookmakers \u2014 no significant market shifts detected.';
          }
        }
      } catch (omIntelErr) {
        // Non-fatal — skip odds movement
      }

      // Store the prediction for tracking accuracy
      try {
        await db.saveMatchPrediction({
          fixtureId: parseInt(fixtureId),
          homeTeam: homeTeam.name, awayTeam: awayTeam.name,
          league: league.name, kickoff: kickoff,
          market: verdictMarket, pick: verdictPick,
          confidence: confidence, reason: verdictReason,
          date: new Date(kickoff).toISOString().split('T')[0],
        });
      } catch(e) { /* non-fatal — duplicate or DB error */ }

      // Fetch SportMonks logos — always try, using the fixture's actual date
      var _smLogos = { home: '', away: '' };
      if (sportMonks && sportMonks.isAvailable()) {
        try {
          // Use the fixture's kickoff date, not today (could be viewing yesterday's match)
          var fixtureDate = kickoff ? kickoff.toString().split('T')[0].split(' ')[0].substring(0, 10) : new Date().toISOString().split('T')[0];
          var _smFixtures = await sportMonks.getFixturesByDate(fixtureDate);
          var hName = (homeTeam.name || '').toLowerCase().substring(0, 5);
          var aName = (awayTeam.name || '').toLowerCase().substring(0, 5);
          (_smFixtures || []).forEach(function(sf) {
            var sfH = (sf.homeTeam || '').toLowerCase();
            var sfA = (sf.awayTeam || '').toLowerCase();
            if (sfH.indexOf(hName) !== -1 || hName.indexOf(sfH.substring(0,5)) !== -1) _smLogos.home = _smLogos.home || sf.homeTeamLogo || '';
            if (sfA.indexOf(aName) !== -1 || aName.indexOf(sfA.substring(0,5)) !== -1) _smLogos.away = _smLogos.away || sf.awayTeamLogo || '';
            if (sfH.indexOf(aName) !== -1 || aName.indexOf(sfH.substring(0,5)) !== -1) _smLogos.away = _smLogos.away || sf.homeTeamLogo || '';
            if (sfA.indexOf(hName) !== -1 || hName.indexOf(sfA.substring(0,5)) !== -1) _smLogos.home = _smLogos.home || sf.awayTeamLogo || '';
          });
          if (_smLogos.home || _smLogos.away) {
            console.log('[Match Intelligence] SportMonks logos: home=' + (!!_smLogos.home) + ' away=' + (!!_smLogos.away));
          }
        } catch(e) {
          // Non-fatal
        }
      }

      // Orient SportMonks rich detail to API-Football's home/away. The SportMonks
      // data is split by SportMonks' home/away; if the resolver matched a fixture
      // with reversed sides, flip it so lineups/stats/momentum line up with the
      // home/away the modal renders.
      var _smRich = smRichData;
      if (smRichData && smRichHomeName) {
        var _afHome = (homeTeam && (homeTeam.name || homeTeam) || '').toString().toLowerCase();
        var _smH = smRichHomeName.toLowerCase(), _smA = smRichAwayName.toLowerCase();
        var _near = function(a, b) { return a && b && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1); };
        if (!_near(_afHome, _smH) && _near(_afHome, _smA)) {
          var _flipRows = function(rows) { return (rows || []).map(function(r) { return { label: r.label, home: r.away, away: r.home, suffix: r.suffix }; }); };
          var _flipTimeline = function(tl) { return (tl || []).map(function(t) { return { minute: t.minute, home: t.away, away: t.home }; }); };
          _smRich = {
            lineups: smRichData.lineups ? { home: smRichData.lineups.away, away: smRichData.lineups.home } : null,
            formations: smRichData.formations ? { home: smRichData.formations.away, away: smRichData.formations.home } : null,
            teamStats: smRichData.teamStats ? _flipRows(smRichData.teamStats) : null,
            pressure: smRichData.pressure ? { homeShare: smRichData.pressure.awayShare, awayShare: smRichData.pressure.homeShare, timeline: _flipTimeline(smRichData.pressure.timeline) } : null,
          };
          console.log('[Match Intelligence] Oriented SportMonks rich data to API-Football home/away (sides were reversed).');
        }
      }

      // Elite Edge Quant Model — independent Elo + Dixon-Coles prediction (a
      // genuine in-house signal shown alongside the engine's verdict).
      var _quant = null;
      try {
        if (deps.quantModel) {
          var _neutral = /world cup|world championship/i.test(league.name || '');
          _quant = deps.quantModel.predict(homeTeam.name || '', awayTeam.name || '', { neutral: _neutral });
        }
      } catch (e) { /* non-fatal */ }

      res.json({
        fixtureId: parseInt(fixtureId),
        source: usedSportMonks ? 'sportmonks' : 'api-football',
        quantModel: _quant,
        match: {
          homeTeam: homeTeam.name || homeTeam || '',
          homeTeamId: homeTeam.id || 0,
          homeTeamLogo: _smLogos.home || homeTeam.logo || '',
          awayTeam: awayTeam.name || awayTeam || '',
          awayTeamId: awayTeam.id || 0,
          awayTeamLogo: _smLogos.away || awayTeam.logo || '',
          league: league.name || league || '',
          leagueLogo: league.logo || '',
          country: league.country || '',
          venue: venue ? (venue.name || venue || '') : '',
          city: venue ? (venue.city || '') : '',
          kickoff: kickoff,
          status: status ? (status.short || status) : '',
          statusLong: status ? (status.long || '') : '',
          homeGoals: fixture && fixture.goals ? fixture.goals.home : null,
          awayGoals: fixture && fixture.goals ? fixture.goals.away : null
        },
        form: {
          home: homeForm,
          away: awayForm
        },
        h2h: {
          matches: h2hSummary,
          homeWins: h2hHomeWins,
          awayWins: h2hAwayWins,
          draws: h2hDraws,
          avgGoals: h2hAvgGoals,
          bttsPct: h2hBttsPct,
          over25Pct: h2hOver25Pct
        },
        stats: {
          home: homeStats,
          away: awayStats
        },
        injuries: {
          home: injuriesList.filter(function(inj) { return inj.team && inj.team.id === homeTeam.id; }).map(function(inj) {
            return { player: inj.player ? inj.player.name : 'Unknown', type: inj.player ? inj.player.type : '', reason: inj.player ? inj.player.reason : '' };
          }),
          away: injuriesList.filter(function(inj) { return inj.team && inj.team.id === awayTeam.id; }).map(function(inj) {
            return { player: inj.player ? inj.player.name : 'Unknown', type: inj.player ? inj.player.type : '', reason: inj.player ? inj.player.reason : '' };
          }),
        },
        predictions: predictionsObj ? {
          winProbability: predictionsObj.predictions && predictionsObj.predictions.percent ? predictionsObj.predictions.percent : null,
          predictedGoals: predictionsObj.predictions && predictionsObj.predictions.goals ? predictionsObj.predictions.goals : null,
          advice: predictionsObj.predictions ? predictionsObj.predictions.advice : null,
        } : null,
        seasonStats: {
          home: homeTeamSeasonStats || null,
          away: awayTeamSeasonStats || null,
        },
        // SportMonks All-In rich detail (lineups + ratings, formations, match
        // stats, Pressure Index momentum) — present for any SportMonks-covered
        // fixture. Rendered by the same modal sections used for the World Cup.
        // _smRich orients SportMonks' home/away to API-Football's, guarding
        // against a fuzzy resolver that matched a fixture with reversed sides.
        lineups: _smRich ? _smRich.lineups : null,
        formations: _smRich ? _smRich.formations : null,
        teamStats: _smRich ? _smRich.teamStats : null,
        pressure: _smRich ? _smRich.pressure : null,
        verdict: {
          market: verdictMarket,
          pick: verdictPick,
          reason: verdictReason,
          confidence: confidence,
          riskLevel: riskLevel,
          riskText: riskText,
          source: verdictSource
        },
        oddsMovement: oddsMovementData,
        exchangeData: matchExchangeData,
        analysis: {
          overview: overviewText,
          form: formText,
          h2h: h2hText,
          injuries: injuriesText,
          predictions: predictionsText,
          oddsMovement: oddsMovementText || null,
          exchange: exchangeAnalysisText || null,
        },
        generatedAt: new Date().toISOString()
      });

      } catch (analysisErr) {
        // Deep analysis failed — return basic fixture info instead of crashing
        console.error('[match-intelligence] Analysis builder failed:', analysisErr.message);
        res.json({
          fixtureId: parseInt(fixtureId),
          source: usedSportMonks ? 'sportmonks' : 'api-football',
          match: {
            homeTeam: homeTeam ? (homeTeam.name || homeTeam || '') : '',
            awayTeam: awayTeam ? (awayTeam.name || awayTeam || '') : '',
            league: league ? (league.name || league || '') : '',
            venue: venue ? (venue.name || venue || '') : '',
            kickoff: kickoff || '',
            status: status ? (status.short || '') : '',
          },
          form: { home: [], away: [] },
          h2h: { matches: [], homeWins: 0, awayWins: 0, draws: 0 },
          stats: { home: {}, away: {} },
          injuries: { home: [], away: [] },
          predictions: null,
          verdict: { market: 'Match Result', pick: 'Analysis unavailable', reason: 'Deep analysis is loading — try again shortly.', confidence: 5 },
          analysis: { overview: 'Match data is available but detailed analysis could not be generated. The data source may be warming up.', form: '', h2h: '', injuries: '' },
          generatedAt: new Date().toISOString()
        });
      }

    } catch (err) {
      console.error('[match-intelligence] Error:', err.message);
      res.status(500).json({ error: 'Failed to generate match intelligence: ' + err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // AI MATCH PREVIEW — Claude-powered written analysis
  // ---------------------------------------------------------------------------
  router.get('/football/ai-preview/:fixtureId', async (req, res) => {
    try {
      if (!aiReports || !aiReports.isAvailable()) {
        return res.status(503).json({ error: 'AI reports not available. ANTHROPIC_API_KEY not configured.' });
      }

      var fixtureId = req.params.fixtureId;
      var previewData = { homeTeam: 'Home', awayTeam: 'Away', league: '', kickoff: '', venue: '' };

      // Try to get fixture details from API-Football
      if (footballSource && process.env.API_FOOTBALL_KEY) {
        try {
          var fixtureData = await footballSource._apiGet('/fixtures?id=' + fixtureId);
          if (fixtureData && fixtureData.response && fixtureData.response.length > 0) {
            var fixture = fixtureData.response[0];
            previewData.homeTeam = fixture.teams && fixture.teams.home ? fixture.teams.home.name : 'Home';
            previewData.awayTeam = fixture.teams && fixture.teams.away ? fixture.teams.away.name : 'Away';
            previewData.league = fixture.league ? fixture.league.name : '';
            previewData.kickoff = fixture.fixture ? fixture.fixture.date : '';
            previewData.venue = fixture.fixture && fixture.fixture.venue ? fixture.fixture.venue.name : '';

            // Try to get supporting data — all optional, failures are fine
            try {
              var homeTeamId = fixture.teams.home.id;
              var awayTeamId = fixture.teams.away.id;
              var parallel = await Promise.allSettled([
                footballSource._apiGet('/fixtures?team=' + homeTeamId + '&last=5&status=FT'),
                footballSource._apiGet('/fixtures?team=' + awayTeamId + '&last=5&status=FT'),
                footballSource._apiGet('/fixtures/headtohead?h2h=' + homeTeamId + '-' + awayTeamId + '&last=5'),
                footballSource._apiGet('/coachs?team=' + homeTeamId),
                footballSource._apiGet('/coachs?team=' + awayTeamId),
              ]);

              var homeFixtures = (parallel[0].status === 'fulfilled' && parallel[0].value && parallel[0].value.response) ? parallel[0].value.response : [];
              var awayFixtures = (parallel[1].status === 'fulfilled' && parallel[1].value && parallel[1].value.response) ? parallel[1].value.response : [];
              var h2hMatches = (parallel[2].status === 'fulfilled' && parallel[2].value && parallel[2].value.response) ? parallel[2].value.response : [];

              // Extract current manager names
              try {
                var homeCoaches = (parallel[3].status === 'fulfilled' && parallel[3].value && parallel[3].value.response) ? parallel[3].value.response : [];
                var awayCoaches = (parallel[4].status === 'fulfilled' && parallel[4].value && parallel[4].value.response) ? parallel[4].value.response : [];
                // Current coach is the one without an end date in their career
                var findCurrentCoach = function(coaches) {
                  for (var ci = 0; ci < coaches.length; ci++) {
                    var c = coaches[ci];
                    if (c.career && Array.isArray(c.career)) {
                      var current = c.career.find(function(cr) { return !cr.end; });
                      if (current) return c.name;
                    }
                  }
                  return coaches.length > 0 ? coaches[0].name : null;
                };
                previewData.homeManager = findCurrentCoach(homeCoaches);
                previewData.awayManager = findCurrentCoach(awayCoaches);
              } catch(e) { /* coach data optional */ }

              // Safe form extraction
              function safeForm(fixtures, teamId) {
                try {
                  return fixtures.slice(0, 5).map(function(f) {
                    if (!f.teams || !f.goals) return '?';
                    var isHome = f.teams.home && f.teams.home.id === teamId;
                    var gf = isHome ? (f.goals.home || 0) : (f.goals.away || 0);
                    var ga = isHome ? (f.goals.away || 0) : (f.goals.home || 0);
                    return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
                  });
                } catch(e) { return []; }
              }

              function safeAvgGoals(fixtures, teamId) {
                try {
                  if (!fixtures.length) return 0;
                  var total = 0;
                  fixtures.forEach(function(f) {
                    if (!f.teams || !f.goals) return;
                    var isHome = f.teams.home && f.teams.home.id === teamId;
                    total += isHome ? (f.goals.home || 0) : (f.goals.away || 0);
                  });
                  return +(total / fixtures.length).toFixed(2);
                } catch(e) { return 0; }
              }

              previewData.homeForm = safeForm(homeFixtures, homeTeamId);
              previewData.awayForm = safeForm(awayFixtures, awayTeamId);
              previewData.homeGoals = safeAvgGoals(homeFixtures, homeTeamId);
              previewData.awayGoals = safeAvgGoals(awayFixtures, awayTeamId);

              // Safe H2H
              if (h2hMatches.length > 0) {
                var h2hHomeWins = 0, h2hAwayWins = 0, h2hDraws = 0;
                var h2hLast = [];
                try {
                  h2hLast = h2hMatches.slice(0, 5).map(function(f) {
                    if (!f.goals || !f.teams) return null;
                    var hg = f.goals.home || 0; var ag = f.goals.away || 0;
                    var isHH = f.teams.home && f.teams.home.id === homeTeamId;
                    if (hg > ag) { if (isHH) h2hHomeWins++; else h2hAwayWins++; }
                    else if (ag > hg) { if (isHH) h2hAwayWins++; else h2hHomeWins++; }
                    else h2hDraws++;
                    return { home: f.teams.home.name, away: f.teams.away.name, homeGoals: hg, awayGoals: ag };
                  }).filter(Boolean);
                } catch(e) {}
                previewData.h2hRecord = { homeWins: h2hHomeWins, draws: h2hDraws, awayWins: h2hAwayWins, lastMeetings: h2hLast };
              }
            } catch(e) {
              // Supporting data fetch failed — continue with basic data
              console.log('[AI Preview] Supporting data fetch failed (non-fatal):', e.message);
            }
          }
        } catch(e) {
          console.log('[AI Preview] Fixture fetch failed (non-fatal):', e.message);
        }
      }

      // Get real xG data if available
      try {
        var leagueMap = { 'Premier League': 'EPL', 'La Liga': 'La_Liga', 'Bundesliga': 'Bundesliga', 'Serie A': 'Serie_A', 'Ligue 1': 'Ligue_1' };
        var xgLeague = leagueMap[previewData.league] || null;
        if (xgLeague && understatService) {
          var xgData = await understatService.getLeagueXG(xgLeague, '2025');
          if (xgData) {
            // Find home and away team xG
            for (var tName in xgData) {
              if (tName.toLowerCase().indexOf(previewData.homeTeam.toLowerCase()) !== -1) {
                previewData.homeXG = xgData[tName].xGPerMatch;
                previewData.homeXGA = xgData[tName].xGAPerMatch;
                previewData.homeOverperformance = xgData[tName].overperformance;
              }
              if (tName.toLowerCase().indexOf(previewData.awayTeam.toLowerCase()) !== -1) {
                previewData.awayXG = xgData[tName].xGPerMatch;
                previewData.awayXGA = xgData[tName].xGAPerMatch;
                previewData.awayOverperformance = xgData[tName].overperformance;
              }
            }
          }
        }
      } catch(e) { /* xG data optional */ }

      // Generate preview with whatever data we have
      var result = await aiReports.generateFootballPreview(previewData);
      if (!result) {
        return res.status(500).json({ error: 'Failed to generate AI preview. Please try again.' });
      }

      res.json({ fixtureId: parseInt(fixtureId), aiPreview: result, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[AI Football Preview] Error:', err.message);
      res.status(500).json({ error: 'Failed to generate AI preview: ' + err.message });
    }
  });

  // AI diagnostic — tests Claude API directly
  router.get('/football/ai-test', async (req, res) => {
    try {
      if (!aiReports) return res.json({ error: 'aiReports not in deps' });
      if (!aiReports.isAvailable()) return res.json({ error: 'AI not available — client is null', hasKey: !!process.env.ANTHROPIC_API_KEY, keyPrefix: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.substring(0, 12) + '...' : 'NOT SET' });

      // Test Claude API directly
      var Anthropic = require('@anthropic-ai/sdk').default;
      var testClient = new Anthropic();
      var models = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250514', 'claude-3-5-sonnet-20241022'];
      var lastError = null;
      for (var i = 0; i < models.length; i++) {
        try {
          var testResponse = await testClient.messages.create({
            model: models[i],
            max_tokens: 256,
            messages: [{ role: 'user', content: 'Say "Hello from Elite Edge" in one sentence.' }],
          });
          return res.json({ success: true, model: models[i], response: testResponse.content[0].text });
        } catch (modelErr) {
          lastError = { model: models[i], status: modelErr.status, message: modelErr.message, type: modelErr.error ? modelErr.error.type : null, errorBody: modelErr.error || null };
        }
      }
      res.json({ success: false, error: 'All models failed', lastError: lastError });
    } catch (err) {
      res.json({ success: false, error: err.message, stack: err.stack ? err.stack.split('\n').slice(0, 5) : [] });
    }
  });

  // Diagnostic: API-Football status check (admin only)
  router.get('/football/diagnostic', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    try {
      if (!process.env.API_FOOTBALL_KEY) return res.json({ error: 'Not configured' });
      const https = require('https');
      const endpoints = ['/status', '/fixtures?date=' + new Date().toISOString().split('T')[0]];
      const results = {};
      for (const path of endpoints) {
        try {
          const data = await new Promise((resolve, reject) => {
            const r = https.request({
              hostname: 'v3.football.api-sports.io',
              path: path,
              method: 'GET',
              headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
            }, (resp) => {
              let b = '';
              resp.on('data', c => b += c);
              resp.on('end', () => resolve({ status: resp.statusCode, body: b.substring(0, 1500) }));
            });
            r.on('error', reject);
            r.setTimeout(15000, () => { r.destroy(); reject(new Error('Timeout')); });
            r.end();
          });
          results[path] = data;
        } catch (e) { results[path] = { error: e.message }; }
      }
      res.json(results);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ---------------------------------------------------------------------------
  // FOOTBALL-DATA.ORG — League standings and top scorers
  // ---------------------------------------------------------------------------

  // GET /api/football/standings/:league — league table
  // League codes: PL, ELC, CL, SA, BL1, PD, FL1, FL2, SPL
  router.get('/football/standings/:league', async (req, res) => {
    try {
      if (!footballData) {
        return res.status(503).json({ error: 'Football-Data.org service not available.' });
      }
      var leagueCode = req.params.league.toUpperCase();
      var validCodes = ['PL', 'ELC', 'CL', 'SA', 'BL1', 'PD', 'FL1', 'FL2', 'SPL'];
      if (validCodes.indexOf(leagueCode) === -1) {
        return res.status(400).json({ error: 'Invalid league code. Valid codes: ' + validCodes.join(', ') });
      }
      var data = await footballData.getStandings(leagueCode);
      if (!data) {
        return res.status(404).json({ error: 'No standings data available for ' + leagueCode });
      }
      res.json(data);
    } catch (err) {
      console.error('[standings] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/football/sm-standings/:seasonId — SportMonks standings (All-In plan)
  // Covers thousands of leagues beyond football-data.org's 9. Normalised to the
  // SAME shape as /standings/:league so the frontend renders both identically.
  // Rows without detail stats still return position/team/crest/points.
  router.get('/football/sm-standings/:seasonId', async (req, res) => {
    try {
      if (!sportMonks || !sportMonks.isAvailable()) {
        return res.status(503).json({ error: 'SportMonks not available.' });
      }
      var seasonId = parseInt(req.params.seasonId, 10);
      if (!seasonId) return res.status(400).json({ error: 'Invalid season id.' });

      var raw = await sportMonks.getStandings(seasonId);
      if (!raw || !raw.length) return res.status(404).json({ error: 'No standings for season ' + seasonId });

      // Grouped competitions (Champions League, cup group stages, etc.) return
      // one flat array where each row's `position` is relative to ITS group — a
      // single sorted table would be nonsense (many teams at "position 1"). We
      // only serve a flat league table; grouped seasons fall back to fixtures.
      var groupIds = {};
      raw.forEach(function (row) { var g = row.group_id != null ? row.group_id : (row.stage_id != null ? 's' + row.stage_id : null); if (g != null) groupIds[g] = 1; });
      if (Object.keys(groupIds).length > 1) {
        return res.status(404).json({ error: 'Grouped standings not shown as a single table.', grouped: true });
      }

      // Read a stat off a row's details[] by matching the type developer_name,
      // ignoring home/away splits so we only take the overall figure.
      var statOf = function (row, keys) {
        if (!Array.isArray(row.details)) return null;
        for (var i = 0; i < row.details.length; i++) {
          var d = row.details[i];
          var dn = (d.type && d.type.developer_name ? d.type.developer_name : '').toUpperCase();
          if (!dn || dn.indexOf('HOME') !== -1 || dn.indexOf('AWAY') !== -1) continue;
          for (var k = 0; k < keys.length; k++) {
            if (dn.indexOf(keys[k]) !== -1) {
              var v = (d.value != null) ? d.value : (d.data && d.data.value != null ? d.data.value : null);
              if (v != null) return Number(v);
            }
          }
        }
        return null;
      };

      var standings = raw.map(function (row) {
        var p = row.participant || {};
        var gf = statOf(row, ['GOALS_FOR', 'SCORED']);
        var ga = statOf(row, ['GOALS_AGAINST', 'CONCEDED']);
        var gd = statOf(row, ['GOAL_DIFFERENCE']);
        if (gd == null && gf != null && ga != null) gd = gf - ga;
        return {
          position: row.position != null ? row.position : null,
          team: p.name || 'Unknown',
          teamId: p.id != null ? p.id : null, // SportMonks team id → links to /football/club
          teamCrest: p.image_path || null,
          playedGames: statOf(row, ['MATCHES_PLAYED', 'GAMES_PLAYED', 'PLAYED']),
          won: statOf(row, ['WON']),
          draw: statOf(row, ['DRAW']),
          lost: statOf(row, ['LOST']),
          points: row.points != null ? row.points : statOf(row, ['POINTS']),
          goalsFor: gf,
          goalsAgainst: ga,
          goalDifference: gd,
          form: null,
        };
      }).filter(function (r) { return r.position != null; })
        .sort(function (a, b) { return a.position - b.position; });

      res.json({ competition: '', season: '', source: 'sportmonks', standings: standings });
    } catch (err) {
      console.error('[sm-standings] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Nickname / abbreviation -> SportMonks search name, for teams a plain search
  // can't match. Keys are the normalised form (lowercase, club suffixes + non
  // alphanumerics stripped). Successful lookups are also cached in team_sm_map.
  const TEAM_SM_ALIASES = {
    // England
    wolves: 'Wolverhampton Wanderers', wolverhampton: 'Wolverhampton Wanderers',
    spurs: 'Tottenham Hotspur', tottenham: 'Tottenham Hotspur',
    manutd: 'Manchester United', manunited: 'Manchester United', mufc: 'Manchester United',
    mancity: 'Manchester City', mcfc: 'Manchester City',
    forest: 'Nottingham Forest', nottmforest: 'Nottingham Forest', nottinghamforest: 'Nottingham Forest',
    westham: 'West Ham United', newcastle: 'Newcastle United', leeds: 'Leeds United',
    brighton: 'Brighton', westbrom: 'West Bromwich Albion', wba: 'West Bromwich Albion',
    qpr: 'Queens Park Rangers', sheffutd: 'Sheffield United', sheffieldutd: 'Sheffield United',
    sheffwed: 'Sheffield Wednesday', sheffieldwed: 'Sheffield Wednesday',
    boro: 'Middlesbrough', wanderers: 'Bolton Wanderers',
    // Scotland
    celtic: 'Celtic', rangers: 'Rangers', hearts: 'Heart of Midlothian', hibs: 'Hibernian',
    // Major European
    barca: 'Barcelona', atleti: 'Atletico Madrid', atleticomadrid: 'Atletico Madrid',
    inter: 'Internazionale', intermilan: 'Internazionale', acmilan: 'AC Milan',
    bayern: 'Bayern Munich', dortmund: 'Borussia Dortmund', bvb: 'Borussia Dortmund',
    psg: 'Paris Saint-Germain', parissg: 'Paris Saint-Germain', juve: 'Juventus',
    gladbach: 'Borussia Monchengladbach', leverkusen: 'Bayer Leverkusen',
  };

  // GET /api/football/club/:key — rich SportMonks club data (All-In plan).
  // key is a SportMonks team id (numeric) OR a team name to search. Combines
  // team detail + current squad + recent fixtures into one normalised payload.
  router.get('/football/club/:key', async (req, res) => {
    try {
      if (!sportMonks || !sportMonks.isAvailable()) {
        return res.status(503).json({ error: 'SportMonks not available.' });
      }
      var key = req.params.key;
      var teamId = /^\d+$/.test(key) ? parseInt(key, 10) : null;

      // Resolve a name to a SportMonks id. Robust so ANY team (name variants,
      // suffixes, nicknames) pulls its club data: cache -> alias map -> tolerant
      // search, then cache the result so it's instant + reliable next time.
      if (!teamId) {
        var q = decodeURIComponent(key).replace(/-/g, ' ').trim();
        var stripSuffix = function (s) { return String(s).replace(/\b(fc|afc|cf|sc|ac|fk|sk|bk|if|cd|ud|sv|hsc|bsc|rc)\b/gi, '').replace(/\s+/g, ' ').trim(); };
        var norm = function (s) { return stripSuffix(String(s || '').toLowerCase()).replace(/[^a-z0-9]/g, ''); };
        var normKey = norm(q);

        // 1) Persistent cache — already resolved this team before?
        if (db.getTeamSmId) {
          try { var cached = await db.getTeamSmId(normKey); if (cached && cached.id) teamId = cached.id; } catch (e) {}
        }
        // 2) Alias map (nicknames/abbreviations search can't match) + tolerant search.
        if (!teamId) {
          var variants = [];
          if (TEAM_SM_ALIASES[normKey]) variants.push(TEAM_SM_ALIASES[normKey]);
          variants.push(q);
          var qs = stripSuffix(q);
          if (qs && variants.indexOf(qs) === -1) variants.push(qs);
          var firstTwo = q.split(' ').slice(0, 2).join(' ');
          if (firstTwo && variants.indexOf(firstTwo) === -1) variants.push(firstTwo);
          var found = [];
          for (var vi = 0; vi < variants.length && !found.length; vi++) {
            try { found = (await sportMonks.searchTeams(variants[vi])) || []; } catch (e) { found = []; }
          }
          if (found.length) {
            var exact = found.find(function (t) { return norm(t.name) === normKey; });
            var chosen = exact || found[0];
            teamId = chosen.id;
            // Cache so the same team resolves instantly forever after.
            if (db.saveTeamSmId && teamId) { try { await db.saveTeamSmId(normKey, teamId, chosen.name || null); } catch (e) {} }
          }
        }
      }
      if (!teamId) return res.status(404).json({ error: 'Club not found for "' + key + '".' });

      var today = new Date().toISOString().split('T')[0];
      var from = new Date(Date.now() - 160 * 864e5).toISOString().split('T')[0];

      var out = await Promise.all([
        sportMonks.getTeam(teamId).catch(function () { return null; }),
        sportMonks.getTeamSquad(teamId).catch(function () { return []; }),
        sportMonks.getTeamRecentFixtures(teamId, from, today).catch(function () { return []; }),
      ]);
      var t = out[0], squadRaw = out[1] || [], recent = out[2] || [];
      if (!t) return res.status(404).json({ error: 'No data for club ' + teamId });

      // Position bucketing (SportMonks position ids; unknowns fall to "Squad").
      var posName = function (s) {
        if (s.position && s.position.name) return s.position.name;
        var map = { 24: 'Goalkeepers', 25: 'Defenders', 26: 'Midfielders', 27: 'Attackers', 148: 'Goalkeepers', 149: 'Defenders', 150: 'Midfielders', 151: 'Attackers' };
        return map[s.position_id] || 'Squad';
      };
      var squad = squadRaw.map(function (s) {
        var p = s.player || {};
        return {
          name: p.name || p.display_name || p.common_name || '',
          image: p.image_path || null,
          number: s.jersey_number != null ? s.jersey_number : null,
          position: posName(s),
          dob: p.date_of_birth || null,
          nationality: p.nationality ? (p.nationality.name || null) : null,
        };
      }).filter(function (p) { return p.name; });

      var club = {
        id: t.id,
        name: t.name || '',
        shortCode: t.short_code || null,
        logo: t.image_path || null,
        founded: t.founded || null,
        country: t.country ? { name: t.country.name || '', flag: t.country.image_path || null } : null,
        venue: t.venue ? { name: t.venue.name || '', city: t.venue.city_name || '', capacity: t.venue.capacity || null, image: t.venue.image_path || null } : null,
      };

      // Trim recent fixtures to the payload the client needs.
      var recentOut = recent.filter(function (f) { return f.homeGoals != null && f.awayGoals != null; })
        .map(function (f) {
          return { id: f.id, kickoff: f.kickoff, league: f.league, homeTeam: f.homeTeam, awayTeam: f.awayTeam, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, homeTeamLogo: f.homeTeamLogo, awayTeamLogo: f.awayTeamLogo, homeGoals: f.homeGoals, awayGoals: f.awayGoals };
        });

      res.json({ club: club, squad: squad, recent: recentOut });
    } catch (err) {
      console.error('[club] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/football/top-scorers/:league — top scorers
  router.get('/football/top-scorers/:league', async (req, res) => {
    try {
      if (!footballData) {
        return res.status(503).json({ error: 'Football-Data.org service not available.' });
      }
      var leagueCode = req.params.league.toUpperCase();
      var data = await footballData.getTopScorers(leagueCode);
      if (!data) {
        return res.status(404).json({ error: 'No top scorers data available for ' + leagueCode });
      }
      res.json(data);
    } catch (err) {
      console.error('[top-scorers] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/football/team-matches/:teamId — recent results for a team
  router.get('/football/team-matches/:teamId', async (req, res) => {
    try {
      if (!footballData) {
        return res.status(503).json({ error: 'Football-Data.org service not available.' });
      }
      var limit = parseInt(req.query.limit) || 10;
      var data = await footballData.getTeamMatches(parseInt(req.params.teamId), limit);
      if (!data) {
        return res.status(404).json({ error: 'No match data available for team ' + req.params.teamId });
      }
      res.json({ matches: data });
    } catch (err) {
      console.error('[team-matches] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/football/h2h-data/:matchId — head-to-head from Football-Data.org
  router.get('/football/h2h-data/:matchId', async (req, res) => {
    try {
      if (!footballData) {
        return res.status(503).json({ error: 'Football-Data.org service not available.' });
      }
      var data = await footballData.getHeadToHead(parseInt(req.params.matchId));
      if (!data) {
        return res.status(404).json({ error: 'No H2H data available for match ' + req.params.matchId });
      }
      res.json(data);
    } catch (err) {
      console.error('[h2h-data] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // UNDERSTAT xG DATA
  // ---------------------------------------------------------------------------

  // GET /api/football/xg/:league — league xG data
  // Leagues: EPL, La_Liga, Bundesliga, Serie_A, Ligue_1
  router.get('/football/xg/:league', async (req, res) => {
    try {
      if (!understatService) {
        return res.status(503).json({ error: 'Understat xG service not available.' });
      }
      var validLeagues = ['EPL', 'La_Liga', 'Bundesliga', 'Serie_A', 'Ligue_1'];
      var league = req.params.league;
      if (validLeagues.indexOf(league) === -1) {
        return res.status(400).json({ error: 'Invalid league. Valid leagues: ' + validLeagues.join(', ') });
      }
      var season = req.query.season || '2025';
      var data = await understatService.getLeagueXG(league, season);
      res.json(data || {});
    } catch (err) {
      console.error('[xg] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/football/xg/:league/:team — team xG data
  router.get('/football/xg/:league/:team', async (req, res) => {
    try {
      if (!understatService) {
        return res.status(503).json({ error: 'Understat xG service not available.' });
      }
      var league = req.params.league;
      var season = req.query.season || '2025';
      var data = await understatService.getLeagueXG(league, season);
      if (!data) return res.json({ error: 'No data available for ' + league });

      // Find team by partial match
      var teamName = decodeURIComponent(req.params.team).toLowerCase();
      var found = null;
      for (var name in data) {
        if (name.toLowerCase().indexOf(teamName) !== -1 || teamName.indexOf(name.toLowerCase()) !== -1) {
          found = data[name];
          break;
        }
      }
      res.json(found || { error: 'Team not found' });
    } catch (err) {
      console.error('[xg-team] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
