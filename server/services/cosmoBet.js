/**
 * Cosmo Bet — official sportsbook partner integration (InplayNet odds feed).
 *
 * Scaffolding built ahead of Cosmo confirming three things (see PENDING below).
 * Everything that CAN be built now is built; the unknowns are config values, so
 * when Cosmo's tech team replies we set env vars / the team map and it goes live
 * with no structural change.
 *
 * PENDING FROM COSMO (fill these in and the full "live odds + add-to-betslip"
 * lights up):
 *   1. TEAM NAMES — a team-id -> name map (their odds feed has only numeric ids).
 *      Provide as JSON at COSMO_TEAM_MAP_PATH or inline via setTeamMap().
 *   2. BETSLIP DEEP-LINK FORMAT — the URL that pre-fills a slip. Set the template
 *      in COSMO_BETSLIP_TEMPLATE using {gameId} {marketId} {positionId} tokens,
 *      e.g. "https://cosmobet.com/?betslip={gameId}_{marketId}_{positionId}".
 *   3. TRACKING DESTINATION PARAM — how the Cellxpert tracking link carries a
 *      redirect target. Set COSMO_TRACK_DEST_PARAM (e.g. "url" or "dl"); we then
 *      wrap the deep-link so the click is tracked AND lands on the slip.
 *
 * Partner/company id is 217. Affiliate tracking link (Cellxpert): bta=42583.
 */

'use strict';

var https = require('https');
var fs = require('fs');

var BASE = 'sportservice.inplaynet.tech';
var TEAMS_HOST = 'analytics-sp.googleserv.tech'; // team-id -> name map (Ivan, 15 Jul 2026)
var COMPANY = process.env.COSMO_COMPANY_ID || '217';
var SOCCER_SPORT_ID = 1;

// Affiliate tracking link — a click drops the CPA cookie (lands new users on
// registration, which is where the CPA converts). Public, not a secret.
var TRACK_URL = process.env.COSMO_TRACK_URL || 'https://track.cosmobetpartners.com/visit/?bta=42583&nci=6102';

// Pre-filled betslip URL. Format confirmed by Ivan: selectedOdds=<index>_<outcomeId>
// (the outcome's unique `id`). A single-selection slip is index 0.
var BETSLIP_BASE = process.env.COSMO_BETSLIP_BASE || 'https://cosmobet.com/en/sportsbook/prematch?selectedOdds=0_';

// Soccer market map (decoded live from the feed). marketId -> how its positions
// map to our pick markets/selections. pos 1/2/3 on market 448 = home/draw/away.
var SOCCER_MARKETS = {
  matchResult: { marketId: 448, pos: { home: 1, draw: 2, away: 3 } },
  doubleChance: { marketId: 476, pos: { homeOrDraw: 57, homeOrAway: 58, drawOrAway: 59 } },
  totalGoals: { marketId: 537 }, // over/under keyed by handicap line (h), positions confirmed on wiring
};

function CosmoBet() {
  this.name = 'CosmoBet';
  this._headerCache = null;
  this._headerAt = 0;
  this._teamMap = null; // id(string) -> name, once Cosmo supply it
  this._loadTeamMap();
}

// ---- config helpers --------------------------------------------------------

CosmoBet.prototype._loadTeamMap = function() {
  var p = process.env.COSMO_TEAM_MAP_PATH;
  if (p) {
    try { this._teamMap = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { this._teamMap = null; }
  }
};
CosmoBet.prototype.setTeamMap = function(map) { this._teamMap = map || null; };
CosmoBet.prototype.hasTeamMap = function() { return !!(this._teamMap && Object.keys(this._teamMap).length); };

// Fetch the official Cosmo team-id -> name map (soccer only), cached 6h. This is
// the reliable source — no more kickoff-heuristic matching needed.
CosmoBet.prototype.ensureTeamMap = async function() {
  var now = Date.now();
  if (this.hasTeamMap() && (now - (this._teamMapAt || 0)) < 21600000) return this._teamMap;
  try {
    var list = await this._get('/api/sport/getheader/teams/en', TEAMS_HOST);
    if (typeof list === 'string') list = JSON.parse(list);
    var map = {};
    (list || []).forEach(function(t) { if (t && t.Sport === SOCCER_SPORT_ID && t.ID != null) map[String(t.ID)] = t.Name; });
    if (Object.keys(map).length) { this._teamMap = map; this._teamMapAt = now; this._headerCache = null; }
  } catch (e) { /* keep any existing map */ }
  return this._teamMap;
};

// We can match fixtures + build pre-filled betslips once the team map is loaded
// (betslip format is known). Deep-link ATTRIBUTION (tracked slip) is a separate
// config step pending Cosmo's method — until then betslipLink is CPA-safe.
CosmoBet.prototype.isReady = function() { return this.hasTeamMap(); };
CosmoBet.prototype.isBetslipReady = CosmoBet.prototype.isReady;

// ---- HTTP ------------------------------------------------------------------

CosmoBet.prototype._get = function(path, host) {
  return new Promise(function(resolve, reject) {
    var req = https.request({ hostname: host || BASE, path: path, method: 'GET', headers: { 'Accept': 'application/json' } }, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        try {
          // Responses are DOUBLE-encoded: a JSON string whose fields are often
          // themselves JSON strings. Unwrap the outer layer here.
          var outer = JSON.parse(body);
          resolve(typeof outer === 'string' ? JSON.parse(outer) : outer);
        } catch (e) { reject(new Error('Cosmo parse failed')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, function() { req.destroy(); reject(new Error('Cosmo timeout')); });
    req.end();
  });
};

// ---- fixtures --------------------------------------------------------------

// Flat list of upcoming soccer games from the header, cached 5 min. Team names
// are filled from the team map when available (ids otherwise).
CosmoBet.prototype.getSoccerGames = async function() {
  var now = Date.now();
  if (this._headerCache && (now - this._headerAt) < 300000) return this._headerCache;
  await this.ensureTeamMap(); // load official names so games are decorated
  var data = await this._get('/api/sport/getheader/en');
  var en = data.EN || data;
  var soccer = (en.Sports || {})[String(SOCCER_SPORT_ID)] || {};
  var out = [];
  var self = this;
  Object.values(soccer.Regions || {}).forEach(function(region) {
    Object.values(region.Champs || {}).forEach(function(champ) {
      Object.values(champ.GameSmallItems || {}).forEach(function(g) {
        if (!g.t1 || !g.t2 || Number(g.ID) < 0) return; // skip outrights/placeholders
        out.push({
          gameId: g.ID,
          tournament: champ.Name || '',
          homeId: g.t1, awayId: g.t2,
          home: self._teamName(g.t1), away: self._teamName(g.t2),
          start: g.StartTime || null,
        });
      });
    });
  });
  this._headerCache = out; this._headerAt = now;
  return out;
};

CosmoBet.prototype._teamName = function(id) {
  if (this._teamMap && this._teamMap[String(id)]) return this._teamMap[String(id)];
  return null; // unknown until Cosmo supply the map
};

// ---- odds ------------------------------------------------------------------

// Main-market odds for a game, mapped to our pick markets. Returns
// { matchResult:{home,draw,away}, doubleChance:{...}, totals:[{line,over,under}] }
// with decimal odds (coef). Any market absent -> that key omitted/null.
CosmoBet.prototype.getGameOdds = async function(gameId) {
  var outer = await this._get('/api/prematch/getprematchgameall/en/' + COMPANY + '/?games=' + gameId);
  var games = outer.game;
  if (typeof games === 'string') games = JSON.parse(games);
  var g = Array.isArray(games) ? games[0] : games;
  if (!g || !g.ev) return null;
  var ev = g.ev;
  var byPos = function(marketId) {
    var m = ev[String(marketId)] || {};
    var map = {};
    // Outcomes are keyed BY their id on the prematch endpoint (not repeated
    // inside the object), so carry the key through as the outcome id.
    Object.keys(m).forEach(function(oid) { var o = m[oid]; map[o.pos] = { id: o.id || oid, coef: o.coef, h: o.h, pos: o.pos }; });
    return map;
  };
  var out = { gameId: g.id };
  // Match result 1X2 — keep each outcome's `id` (needed to build the betslip).
  var mr = byPos(SOCCER_MARKETS.matchResult.marketId), P = SOCCER_MARKETS.matchResult.pos;
  if (mr[P.home] || mr[P.away]) {
    out.matchResult = {
      home: mr[P.home] ? mr[P.home].coef : null, homeId: mr[P.home] ? mr[P.home].id : null,
      draw: mr[P.draw] ? mr[P.draw].coef : null, drawId: mr[P.draw] ? mr[P.draw].id : null,
      away: mr[P.away] ? mr[P.away].coef : null, awayId: mr[P.away] ? mr[P.away].id : null,
    };
  }
  // Double chance
  var dc = byPos(SOCCER_MARKETS.doubleChance.marketId), D = SOCCER_MARKETS.doubleChance.pos;
  if (dc[D.homeOrDraw] || dc[D.drawOrAway]) {
    out.doubleChance = {
      homeOrDraw: dc[D.homeOrDraw] ? dc[D.homeOrDraw].coef : null,
      homeOrAway: dc[D.homeOrAway] ? dc[D.homeOrAway].coef : null,
      drawOrAway: dc[D.drawOrAway] ? dc[D.drawOrAway].coef : null,
    };
  }
  // Total goals — group over/under by the handicap line (h)
  var tg = ev[String(SOCCER_MARKETS.totalGoals.marketId)] || {};
  var lines = {};
  Object.values(tg).forEach(function(o) {
    var line = o.h;
    if (line == null) return;
    lines[line] = lines[line] || { line: line, over: null, under: null };
    // Over/Under position ids confirmed on final wiring; store both coefs by pos.
    lines[line]._pos = lines[line]._pos || {};
    lines[line]._pos[o.pos] = o.coef;
  });
  out.totals = Object.values(lines);
  return out;
};

// Map OUR pick (market + selection strings) to a Cosmo market + position id,
// so we know exactly what to pre-load into the betslip. Returns null if we can't
// map it cleanly (e.g. BTTS until its market id is confirmed).
CosmoBet.prototype.pickToSelection = function(market, selection, homeName, awayName) {
  var m = (market || '').toLowerCase(), s = (selection || '').toLowerCase();
  var M = SOCCER_MARKETS;
  var nm = function(a, b) { return a && b && (String(a).toLowerCase().indexOf(String(b).toLowerCase()) !== -1 || String(b).toLowerCase().indexOf(String(a).toLowerCase()) !== -1); };
  if (m.indexOf('match result') !== -1 || m.indexOf('match winner') !== -1) {
    if (s.indexOf('draw') !== -1) return { marketId: M.matchResult.marketId, positionId: M.matchResult.pos.draw };
    if (nm(s, homeName)) return { marketId: M.matchResult.marketId, positionId: M.matchResult.pos.home };
    if (nm(s, awayName)) return { marketId: M.matchResult.marketId, positionId: M.matchResult.pos.away };
  }
  if (m.indexOf('double chance') !== -1) {
    if (nm(s, homeName)) return { marketId: M.doubleChance.marketId, positionId: M.doubleChance.pos.homeOrDraw };
    if (nm(s, awayName)) return { marketId: M.doubleChance.marketId, positionId: M.doubleChance.pos.drawOrAway };
  }
  // Totals / BTTS: wired once Cosmo confirm the over/under position ids + BTTS
  // market id (kept explicit rather than guessing and mis-pricing a bet).
  return null;
};

// ---- links -----------------------------------------------------------------

// Plain tracked link (attribution only) — always available.
CosmoBet.prototype.trackedLink = function(subId) {
  return TRACK_URL + (subId ? '&subid=' + encodeURIComponent(subId) : '');
};

// Pre-filled betslip URL for a single outcome id (Ivan's confirmed format).
CosmoBet.prototype.betslipUrl = function(outcomeId) {
  return BETSLIP_BASE + outcomeId;
};

// The link the "add to betslip" button uses. We want BOTH: land on the pre-filled
// slip AND attribute the player to us. How to combine them depends on Cosmo's
// deep-link method (their tracking link's common redirect params bounce to
// registration), so it's config-driven:
//   COSMO_TRACK_DEST_PARAM set  -> wrap the betslip in the tracking link
//   COSMO_BETSLIP_ATTRIB set     -> append this to the betslip URL (e.g. "btag=42583")
//   neither (default now)        -> use the plain tracked link (guaranteed CPA;
//                                   we never send an UNtracked player to Cosmo)
CosmoBet.prototype.betslipLink = function(opts) {
  opts = opts || {};
  if (opts.outcomeId == null) return this.trackedLink(opts.subId);
  var slip = this.betslipUrl(opts.outcomeId);
  var destParam = process.env.COSMO_TRACK_DEST_PARAM;
  var attrib = process.env.COSMO_BETSLIP_ATTRIB;
  if (destParam) return this.trackedLink(opts.subId) + '&' + destParam + '=' + encodeURIComponent(slip);
  if (attrib) return slip + (slip.indexOf('?') !== -1 ? '&' : '?') + attrib;
  return this.trackedLink(opts.subId); // CPA-safe default until Cosmo confirm deep-link attribution
};

// ---- matching --------------------------------------------------------------

// Find Cosmo's game id for one of our fixtures by team names + date. Needs the
// team map (else names are null and we can't match). Returns { gameId, home,
// away } or null.
CosmoBet.prototype.matchFixture = async function(homeName, awayName, dateISO) {
  await this.ensureTeamMap();
  if (!this.hasTeamMap()) return null;
  var games = await this.getSoccerGames();
  var norm = function(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var h = norm(homeName), a = norm(awayName);
  var day = dateISO ? String(dateISO).slice(0, 10) : null;
  var hit = games.find(function(g) {
    var gh = norm(g.home), ga = norm(g.away);
    var teamsOk = (gh && ga) && ((gh.indexOf(h) !== -1 || h.indexOf(gh) !== -1) && (ga.indexOf(a) !== -1 || a.indexOf(ga) !== -1));
    var dayOk = !day || (g.start && String(g.start).slice(0, 10) === day);
    return teamsOk && dayOk;
  });
  return hit || null;
};

// ---- self-service team-map bootstrap --------------------------------------

// Learn Cosmo team-id -> name from OUR fixtures using the one signal both feeds
// share: exact kickoff. Only learns from UNAMBIGUOUS slots — a kickoff minute
// with exactly ONE Cosmo game and exactly ONE of our fixtures — so we never
// guess on a busy slot. Assumes Cosmo t1=home, t2=away. Grows the map each run;
// merged into any official map. Returns { learned, total, sample }.
CosmoBet.prototype.learnTeamMapFromFixtures = async function(ourFixtures) {
  var games = await this.getSoccerGames();
  var minute = function(iso) { return iso ? String(iso).slice(0, 16) : null; }; // to the minute
  var cosmoByKo = {}, oursByKo = {};
  games.forEach(function(g) { var k = minute(g.start); if (k) (cosmoByKo[k] = cosmoByKo[k] || []).push(g); });
  (ourFixtures || []).forEach(function(f) { var k = minute(f.kickoff); if (k) (oursByKo[k] = oursByKo[k] || []).push(f); });
  var map = this._teamMap || {};
  var learned = 0, sample = [];
  Object.keys(cosmoByKo).forEach(function(k) {
    var cg = cosmoByKo[k], of = oursByKo[k];
    if (cg.length === 1 && of && of.length === 1) { // unambiguous: one game each side
      var g = cg[0], f = of[0];
      if (g.homeId && f.home && !map[String(g.homeId)]) { map[String(g.homeId)] = f.home; learned++; }
      if (g.awayId && f.away && !map[String(g.awayId)]) { map[String(g.awayId)] = f.away; learned++; }
      if (sample.length < 12) sample.push({ ko: k, cosmoGame: g.gameId, learnedHome: f.home, learnedAway: f.away });
    }
  });
  this._teamMap = map;
  this._headerCache = null; // force re-decorate games with the new names
  return { learned: learned, total: Object.keys(map).length, sample: sample };
};

// ---- value agent -----------------------------------------------------------

// Compare OUR model's probability against Cosmo's live price and flag value —
// selections we rate MORE likely than Cosmo's (de-vigged) price implies. Only
// returns bets we can (a) confidently match to a Cosmo game and (b) map the
// selection to a Cosmo market. Each carries the tracked add-to-betslip link.
// fixtures: [{home, away, kickoff}]. quantModel: our Elo+Dixon-Coles engine.
CosmoBet.prototype.scanValue = async function(fixtures, quantModel, opts) {
  opts = opts || {};
  var minEdge = opts.minEdge != null ? opts.minEdge : 3; // percentage points
  if (!quantModel || !quantModel.predict) return { ready: false, reason: 'quant model unavailable' };
  var out = [];
  for (var i = 0; i < (fixtures || []).length; i++) {
    var f = fixtures[i];
    var game = await this.matchFixture(f.home, f.away, f.kickoff);
    if (!game) continue;
    var odds = await this.getGameOdds(game.gameId);
    if (!odds || !odds.matchResult) continue;
    var pred;
    try { pred = quantModel.predict(f.home, f.away, { neutral: !!opts.neutral }); } catch (e) { continue; }
    if (!pred || !pred.winProb) continue;
    // De-vig the 1X2 price so we compare like-for-like (fair probability).
    var mr = odds.matchResult;
    var imp = { home: mr.home ? 1 / mr.home : 0, draw: mr.draw ? 1 / mr.draw : 0, away: mr.away ? 1 / mr.away : 0 };
    var vig = imp.home + imp.draw + imp.away;
    if (vig <= 0) continue;
    var fair = { home: imp.home / vig, draw: imp.draw / vig, away: imp.away / vig };
    var legs = [
      { sel: f.home + ' Win', model: pred.winProb.home / 100, price: mr.home, fair: fair.home, outcomeId: mr.homeId },
      { sel: 'Draw', model: pred.winProb.draw / 100, price: mr.draw, fair: fair.draw, outcomeId: mr.drawId },
      { sel: f.away + ' Win', model: pred.winProb.away / 100, price: mr.away, fair: fair.away, outcomeId: mr.awayId },
    ];
    legs.forEach(function(l) {
      if (!l.price) return;
      var edge = (l.model - l.fair) * 100;
      if (edge < minEdge) return;
      out.push({
        fixture: f.home + ' v ' + f.away, kickoff: f.kickoff,
        selection: l.sel, cosmoOdds: l.price,
        modelProb: Math.round(l.model * 100), marketProb: Math.round(l.fair * 100),
        edge: Math.round(edge * 10) / 10,
        betslipLink: this.betslipLink({ outcomeId: l.outcomeId, subId: 'value' }),
      });
    }, this);
  }
  out.sort(function(a, b) { return b.edge - a.edge; });
  return { ready: true, count: out.length, valueBets: out };
};

CosmoBet.prototype.getStatus = function() {
  return {
    company: COMPANY,
    hasTeamMap: this.hasTeamMap(),
    betslipReady: this.isBetslipReady(),
    trackUrlConfigured: !!TRACK_URL,
  };
};

module.exports = CosmoBet;
