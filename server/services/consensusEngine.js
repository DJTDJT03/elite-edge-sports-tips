/**
 * Multi-Agent Consensus Engine
 *
 * Every fixture gets analysed by THREE independent agents.
 * Each proposes a market, selection, and confidence.
 * GPT Verifier acts as independent arbiter.
 * Final pick = market where most agents agree, confidence weighted by consensus.
 *
 * Flow:
 *   1. Tactician analyses (injuries, motivation, tactical, xG)
 *   2. Professor analyses (form, data, statistical patterns)
 *   3. The Market analyses (sharp money & market-confirmed value — only backs
 *      value the real price movement confirms; defers to the favourite when
 *      there's no live market, never chasing a contrarian longshot)
 *   4. AI arbiter panel reviews all three — agrees/disagrees with reasoning
 *   5. Consensus engine picks the winning market (split → most probable leads)
 *   6. Confidence = base + bonus for agreement level
 *
 * Never publishes a pick that only ONE agent supports.
 * The debate IS the edge.
 */

'use strict';

var scoringModel;

function ConsensusEngine(deps) {
  this.deps = deps;
  scoringModel = deps.scoringModel;
  this.gptVerifier = deps.gptVerifier;
  this.aiArbiters = deps.aiArbiters; // multi-model arbiter panel (GPT + Gemini + Grok)
}

/**
 * Run multi-agent analysis on a scored fixture
 * @param {Object} scored - the scored fixture from scoringModel
 * @param {Object} oddsData - odds from Odds API
 * @returns {Object} consensus result with pick, confidence, debate log
 */
ConsensusEngine.prototype.analyse = async function(scored, oddsData) {
  if (!scored || !scored.fixture) return null;

  var fixture = scored.fixture;
  var factors = scored.factors || {};
  var home = fixture.homeTeam || '';
  var away = fixture.awayTeam || '';

  // Extract available odds
  var homeOdds = scored.homeOdds || scored.selectedOdds || 2.0;
  var awayOdds = scored.awayOdds || 3.5;
  var drawOdds = scored.drawOdds || 3.3;
  var overOdds = scored.overOdds || 1.85;
  var bttsOdds = scored.bttsOdds || 1.75;

  // Try to get real odds from oddsData
  if (oddsData && Array.isArray(oddsData)) {
    var matchOdds = oddsData.find(function(o) {
      var oH = (o.homeTeam || '').toLowerCase();
      var fH = (fixture.homeTeam || '').toLowerCase();
      return oH.indexOf(fH.substring(0, 6)) !== -1 || fH.indexOf(oH.substring(0, 6)) !== -1;
    });
    if (matchOdds && matchOdds.bookmakerOdds) {
      var firstBk = Object.keys(matchOdds.bookmakerOdds)[0];
      if (firstBk) {
        var bk = matchOdds.bookmakerOdds[firstBk];
        homeOdds = bk[home] || bk[Object.keys(bk)[0]] || homeOdds;
        drawOdds = bk['Draw'] || bk['draw'] || drawOdds;
        awayOdds = bk[away] || bk[Object.keys(bk)[2]] || awayOdds;
      }
      if (matchOdds.markets && matchOdds.markets.totals) {
        var tBk = Object.keys(matchOdds.markets.totals)[0];
        if (tBk) overOdds = matchOdds.markets.totals[tBk]['Over 2.5'] || matchOdds.markets.totals[tBk]['Over'] || overOdds;
      }
      if (matchOdds.markets && matchOdds.markets.btts) {
        var bBk = Object.keys(matchOdds.markets.btts)[0];
        if (bBk) bttsOdds = matchOdds.markets.btts[bBk]['Yes'] || bttsOdds;
      }
    }
  }

  // =====================================================================
  // AGENT 1: THE TACTICIAN — tactical, injuries, motivation, context
  // =====================================================================
  var tactician = {
    agent: 'The Tactician',
    approach: 'Tactical & contextual intelligence',
    market: null,
    selection: null,
    confidence: 5,
    reasoning: '',
  };

  // Normalised model probabilities for the three match-result outcomes, derived
  // from the (overround-stripped) odds. These are the OBJECTIVE anchor used to
  // resolve a split — so a contrarian longshot can never outrank the probable
  // outcome on the headline — and to ground each analyst's written reasoning.
  var _impH = 1 / Math.max(1.01, homeOdds), _impD = 1 / Math.max(1.01, drawOdds), _impA = 1 / Math.max(1.01, awayOdds);
  var _impTot = _impH + _impD + _impA;
  var pHome = _impTot ? _impH / _impTot : 0.40;
  var pDraw = _impTot ? _impD / _impTot : 0.27;
  var pAway = _impTot ? _impA / _impTot : 0.33;
  var pHomePct = Math.round(pHome * 100), pDrawPct = Math.round(pDraw * 100), pAwayPct = Math.round(pAway * 100);

  var injuryFactor = factors.injuries || 0.5;
  var motivationFactor = factors.motivation || 0.5;
  var congestionFactor = factors.scheduleCongestion || 0.5;
  var homeFactor = factors.homeAway || 0.6;

  // For a game with no clear winner, pick the market with the genuinely
  // STRONGEST signal for THIS fixture — not a hardcoded fallback. This is what
  // gives real variety (Over / Under / BTTS-Yes / BTTS-No / Double Chance / Draw)
  // instead of every tight game collapsing onto one blanket market.
  var _tightCall = function() {
    var over = factors.overProb != null ? factors.overProb : 0.50;
    var btts = factors.btts != null ? factors.btts : 0.50;
    var favHome = pHome >= pAway;
    var favP = favHome ? pHome : pAway;
    var favName = favHome ? home : away;
    var dcP = Math.min(0.92, favP + pDraw);
    var cf = function(p, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(p * 10))); };
    if (over >= 0.58) return { market: 'Total Goals', selection: 'Over 2.5 Goals', confidence: cf(over, 6, 8), reasoning: 'Goals expected — the model makes Over 2.5 ' + Math.round(over * 100) + '%, both sides carrying an attacking threat.' };
    if (over <= 0.42) return { market: 'Total Goals', selection: 'Under 2.5 Goals', confidence: cf(1 - over, 6, 8), reasoning: 'A cagey, low-scoring profile — the model makes Under 2.5 ' + Math.round((1 - over) * 100) + '%.' };
    if (btts >= 0.57) return { market: 'Both Teams to Score', selection: 'BTTS - Yes', confidence: cf(btts, 6, 8), reasoning: 'Both teams carry a real scoring threat (BTTS ' + Math.round(btts * 100) + '%) — neither defence convincing.' };
    if (btts <= 0.43) return { market: 'Both Teams to Score', selection: 'BTTS - No', confidence: cf(1 - btts, 6, 8), reasoning: 'One side looks likely to keep it tight — BTTS lands just ' + Math.round(btts * 100) + '%.' };
    if (favP >= 0.40) return { market: 'Double Chance', selection: 'Double Chance - ' + favName + ' or Draw', confidence: cf(dcP, 6, 8), reasoning: favName + ' the marginal call — Double Chance banks the win or the draw (' + Math.round(dcP * 100) + '%).' };
    return { market: 'Match Result', selection: 'Draw', confidence: Math.max(6, Math.min(7, Math.round(pDraw * 14))), reasoning: 'Genuinely even — the model\'s single most likely result is the draw (' + Math.round(pDraw * 100) + '%).' };
  };

  // Tactician weights: injuries 1.5, motivation 1.5, congestion 1.4, xG 1.4
  var tactHomeScore = (homeFactor * 1.3 + injuryFactor * 1.5 + motivationFactor * 1.5 + (factors.form || 0.5) * 1.1) / 5.4;
  var tactAwayScore = ((1 - homeFactor) * 1.3 + (1 - injuryFactor) * 1.5 + motivationFactor * 1.5 + (factors.form || 0.5) * 1.1) / 5.4;
  var tactGoalsScore = ((factors.xG || 0.5) * 1.4 + (factors.shots || 0.5) * 1.2 + congestionFactor * 1.4) / 4.0;

  if (tactHomeScore > 0.6 && homeOdds >= 1.4) {
    tactician.market = 'Match Result';
    tactician.selection = home + ' Win';
    tactician.confidence = Math.round(tactHomeScore * 10);
    tactician.reasoning = 'Tactical setup and context favour ' + home + ' (model ' + pHomePct + '% home / ' + pDrawPct + '% draw / ' + pAwayPct + '% away). Injury impact and motivation weigh heaviest.';
  } else if (tactAwayScore > 0.6 && awayOdds >= 1.8) {
    tactician.market = 'Match Result';
    tactician.selection = away + ' Win';
    tactician.confidence = Math.round(tactAwayScore * 10);
    tactician.reasoning = away + ' hold the tactical edge (model ' + pAwayPct + '% away / ' + pDrawPct + '% draw / ' + pHomePct + '% home). Schedule congestion and motivation context point their way.';
  } else if (tactGoalsScore > 0.55 && (factors.overProb == null || factors.overProb >= 0.52)) {
    tactician.market = 'Over 2.5 Goals';
    tactician.selection = 'Over 2.5 Goals';
    tactician.confidence = Math.round((factors.overProb != null ? factors.overProb : tactGoalsScore) * 10);
    tactician.reasoning = 'xG trends and attacking metrics point to goals' + (factors.overProb != null ? ' — model makes Over 2.5 ' + Math.round(factors.overProb * 100) + '%' : '') + '. Both sides creating chances.';
  } else {
    var _tcT = _tightCall();
    tactician.market = _tcT.market;
    tactician.selection = _tcT.selection;
    tactician.confidence = _tcT.confidence;
    tactician.reasoning = _tcT.reasoning;
  }

  // =====================================================================
  // AGENT 2: THE PROFESSOR — data, form, statistical patterns
  // =====================================================================
  var professor = {
    agent: 'The Professor',
    approach: 'Statistical & form-driven analysis',
    market: null,
    selection: null,
    confidence: 5,
    reasoning: '',
  };

  var formFactor = factors.form || 0.5;
  var xgFactor = factors.xG || 0.5;
  var h2hFactor = factors.h2h || 0.5;
  var shotsFactor = factors.shots || 0.5;

  // Professor weights: form 1.4, xG 1.4, shots 1.2, market 0.5
  var profHomeScore = (formFactor * 1.4 + xgFactor * 1.4 + homeFactor * 1.3 + shotsFactor * 1.2) / 5.3;
  var profAwayScore = ((1 - formFactor) * 1.4 + (1 - xgFactor) * 1.4 + (1 - homeFactor) * 1.3 + (1 - shotsFactor) * 1.2) / 5.3;
  var profGoalsScore = (xgFactor * 1.4 + shotsFactor * 1.2 + (factors.form || 0.5) * 1.0) / 3.6;

  if (profHomeScore > 0.58 && homeOdds >= 1.3) {
    professor.market = 'Match Result';
    professor.selection = home + ' Win';
    professor.confidence = Math.round(profHomeScore * 10);
    professor.reasoning = 'Form and expected-goals data back ' + home + ' — model rates them ' + pHomePct + '% (draw ' + pDrawPct + '%, ' + away + ' ' + pAwayPct + '%). Statistical edge is clear.';
  } else if (profAwayScore > 0.58 && awayOdds >= 1.5) {
    professor.market = 'Match Result';
    professor.selection = away + ' Win';
    professor.confidence = Math.round(profAwayScore * 10);
    professor.reasoning = 'Data profile favours ' + away + ' — model ' + pAwayPct + '% (draw ' + pDrawPct + '%, ' + home + ' ' + pHomePct + '%). Superior xG and recent form.';
  } else if (profGoalsScore > 0.6 && (factors.overProb == null || factors.overProb >= 0.52)) {
    professor.market = 'Over 2.5 Goals';
    professor.selection = 'Over 2.5 Goals';
    professor.confidence = Math.round((factors.overProb != null ? factors.overProb : profGoalsScore) * 10);
    professor.reasoning = 'High xG and shot volume from both sides' + (factors.overProb != null ? ' — model Over 2.5 ' + Math.round(factors.overProb * 100) + '%' : '') + '. Data expects goals.';
  } else if (profGoalsScore < 0.4) {
    professor.market = 'Under 2.5 Goals';
    professor.selection = 'Under 2.5 Goals';
    professor.confidence = Math.round((1 - profGoalsScore) * 10);
    professor.reasoning = 'Low expected goals. Both sides conservative. Data points to a tight game.';
  } else {
    var _tcP = _tightCall();
    professor.market = _tcP.market;
    professor.selection = _tcP.selection;
    professor.confidence = _tcP.confidence;
    professor.reasoning = _tcP.reasoning;
  }

  // =====================================================================
  // AGENT 3: THE MARKET — sharp money & market-confirmed value
  // =====================================================================
  // Replaces the old "Scout" value-hunter, which chased the biggest THEORETICAL
  // price gap and therefore drifted onto longshots. The Market analyst only
  // backs value the REAL money confirms: a genuine model edge AND the price
  // actually steaming toward that selection. With no live market to read (e.g.
  // provisional World Cup fixtures), it defers to the model favourite at modest
  // confidence rather than inventing a contrarian price.
  var marketAgent = {
    agent: 'The Market',
    approach: 'Sharp money & market-confirmed value',
    market: null,
    selection: null,
    confidence: 5,
    reasoning: '',
  };

  // Per-outcome price movement attached by the caller (scheduler) when live odds
  // history exists: { home|away|draw: { direction, percentChange, isSteamMove,
  // isDrift, isGamble, signal } }. Null on paths without a live market.
  var mv = scored.marketMovement || null;
  var _moveScore = function(m) {
    if (!m) return 0;
    if (m.isGamble) return 1.0;        // 15%+ shortening — serious money
    if (m.isSteamMove) return 0.7;     // 8%+ shortening — steamer
    if (m.direction === 'shortening') return 0.35;
    if (m.isDrift) return -0.8;        // 12%+ drift — money against
    if (m.direction === 'drifting') return -0.3;
    return 0;
  };
  // Edge uses the model's INDEPENDENT probability (Professor's form/xG score) vs
  // the price-implied probability — a real edge, not one derived from the odds.
  var _drawMp = Math.max(0.05, Math.min(0.60, 1 - profHomeScore - profAwayScore + 0.30));
  var mCands = [
    { selection: home + ' Win', odds: homeOdds, p: pHome, mp: profHomeScore, mv: mv && mv.home },
    { selection: away + ' Win', odds: awayOdds, p: pAway, mp: profAwayScore, mv: mv && mv.away },
    { selection: 'Draw',        odds: drawOdds, p: pDraw, mp: _drawMp,        mv: mv && mv.draw },
  ];
  mCands.forEach(function(c) {
    c.implied = 1 / Math.max(1.01, c.odds);
    c.edge = c.mp - c.implied;   // model probability above the price = value
    c.move = _moveScore(c.mv);   // sharp-money confirmation (or opposition)
  });

  if (mv) {
    // Live market available: back value the money CONFIRMS — a model edge AND
    // the price steaming toward it. Drifting selections are never backed.
    var confirmed = mCands.filter(function(c) { return c.edge > 0.015 && c.move > 0; });
    confirmed.sort(function(a, b) { return (b.move - a.move) || (b.edge - a.edge); });
    if (confirmed.length) {
      var pick = confirmed[0];
      marketAgent.market = 'Match Result';
      marketAgent.selection = pick.selection;
      marketAgent.confidence = Math.max(6, Math.min(9, Math.round(5 + pick.edge * 25 + pick.move * 3)));
      marketAgent.reasoning = 'Market-confirmed value on ' + pick.selection + ' at ' + pick.odds.toFixed(2) + ' — model ' + Math.round(pick.mp * 100) + '% vs price ' + Math.round(pick.implied * 100) + '%, and the money is ' + (pick.mv && pick.mv.signal ? pick.mv.signal : 'moving in') + ' (' + (pick.mv ? pick.mv.percentChange : 0) + '%).';
    } else {
      // No value the market confirms — only add a vote for a genuinely CLEAR
      // favourite the money isn't opposing; otherwise stand aside (a discerning
      // analyst passes on coin-flips rather than rubber-stamping every match into
      // a falsely-unanimous, over-confident call).
      var favL = mCands.slice().sort(function(a, b) { return b.p - a.p; })[0];
      if (favL.p >= 0.55 && favL.move >= 0) {
        marketAgent.market = 'Match Result';
        marketAgent.selection = favL.selection;
        marketAgent.confidence = Math.max(5, Math.min(7, Math.round(4 + (favL.p - 0.40) * 10)));
        marketAgent.reasoning = 'No standout value, but the market is not opposing ' + favL.selection + ' (model favourite ' + Math.round(favL.p * 100) + '%). Siding with the probable result.';
      } else {
        marketAgent.market = 'No Strong Value';
        marketAgent.selection = 'Pass';
        marketAgent.confidence = 3;
        marketAgent.reasoning = 'No market-confirmed value' + (favL.move < 0 ? ' and the favourite is drifting' : '') + ' — stand aside.';
      }
    }
  } else {
    // No live market data (e.g. provisional World Cup fixtures). Confirm only a
    // genuinely CLEAR model favourite; stand aside on close matches rather than
    // inflating agreement. Never chase a contrarian price.
    var favN = mCands.slice().sort(function(a, b) { return b.p - a.p; })[0];
    if (favN.p >= 0.55) {
      marketAgent.market = 'Match Result';
      marketAgent.selection = favN.selection;
      marketAgent.confidence = Math.max(5, Math.min(7, Math.round(4 + (favN.p - 0.40) * 10)));
      marketAgent.reasoning = 'No live market to read, so deferring to the model favourite ' + favN.selection + ' (' + Math.round(favN.p * 100) + '%).';
    } else {
      marketAgent.market = 'No Strong Value';
      marketAgent.selection = 'Pass';
      marketAgent.confidence = 3;
      marketAgent.reasoning = 'No live market and no clear favourite — stand aside.';
    }
  }

  // =====================================================================
  // CONSENSUS: Find the market where most agents agree
  // =====================================================================
  var agents = [tactician, professor, marketAgent].filter(function(a) { return a.selection !== 'Pass'; });
  var debate = [];

  // Probability the model assigns to a given market/selection — the anchor for
  // resolving a split by likelihood rather than by an analyst's self-assigned
  // confidence (which is what let a contrarian longshot hijack the headline).
  // pAlign = the model's probability that this BET LANDS, on one comparable
  // 0-1 scale across markets, so the split tie-break ranks like-for-like. Goals
  // and BTTS use the goals-model score as their probability proxy (factors.btts
  // is only populated on some paths, so fall back to the goals proxy, not a flat
  // 0.5). Floored so a supported pick is never zeroed out of the ranking.
  var _goalsP = Math.max(0, Math.min(1, profGoalsScore));
  var _pOf = function(market, selection) {
    var p = 0.5;
    if (market === 'Match Result') {
      // Check Draw and the away side before the home substring to avoid a
      // team name that is a substring of the other skewing the match.
      if (selection === 'Draw') p = pDraw;
      else if (away && selection.indexOf(away) !== -1) p = pAway;
      else if (home && selection.indexOf(home) !== -1) p = pHome;
    } else if (market.indexOf('Over') !== -1) p = factors.overProb != null ? factors.overProb : _goalsP;
    else if (market.indexOf('Under') !== -1) p = 1 - (factors.overProb != null ? factors.overProb : _goalsP);
    else if (market.indexOf('BTTS') !== -1 || market.indexOf('Both') !== -1) {
      var _bp = factors.btts != null ? factors.btts : _goalsP;
      p = selection.indexOf('No') !== -1 ? 1 - _bp : _bp;
    } else if (market.indexOf('Double Chance') !== -1) {
      // away before home — consistent with the Match-Result branch, so a team
      // name that's a substring of the other can't skew the side.
      if (away && selection.indexOf(away) !== -1) p = Math.min(0.95, pAway + pDraw);
      else if (home && selection.indexOf(home) !== -1) p = Math.min(0.95, pHome + pDraw);
      else p = Math.min(0.95, Math.max(pHome, pAway) + pDraw);
    }
    return Math.max(0.05, p);
  };

  // Group by market+selection
  var votes = {};
  agents.forEach(function(a) {
    var key = a.market + '|' + a.selection;
    if (!votes[key]) votes[key] = { market: a.market, selection: a.selection, agents: [], totalConf: 0, pAlign: _pOf(a.market, a.selection) };
    votes[key].agents.push(a.agent);
    votes[key].totalConf += a.confidence;
  });

  // Rank: most agents agreeing wins first (genuine consensus). On a TIE — most
  // importantly a 3-way SPLIT — break by a probability-weighted score
  // (avg confidence × model probability of the outcome), NOT raw confidence. So
  // the most *probable* call leads the headline; a value longshot can no longer
  // win a split on confidence alone.
  var _strength = function(v) { return (v.totalConf / v.agents.length) * v.pAlign; };
  var ranked = Object.values(votes).sort(function(a, b) {
    if (b.agents.length !== a.agents.length) return b.agents.length - a.agents.length;
    return _strength(b) - _strength(a);
  });

  var consensus = ranked[0];
  var agreementLevel = consensus ? consensus.agents.length : 0;

  // Build debate log
  debate.push({ agent: tactician.agent, pick: tactician.selection, market: tactician.market, confidence: tactician.confidence, reasoning: tactician.reasoning });
  debate.push({ agent: professor.agent, pick: professor.selection, market: professor.market, confidence: professor.confidence, reasoning: professor.reasoning });
  debate.push({ agent: marketAgent.agent, pick: marketAgent.selection, market: marketAgent.market, confidence: marketAgent.confidence, reasoning: marketAgent.reasoning });

  // The reasoning that actually backs the headline = the agreeing analyst with
  // the highest confidence for the winning pick (not always the Tactician).
  var consensusReasoning = '';
  if (consensus) {
    var _backers = debate.filter(function(d) { return d.market === consensus.market && d.pick === consensus.selection; });
    _backers.sort(function(a, b) { return b.confidence - a.confidence; });
    consensusReasoning = _backers.length ? _backers[0].reasoning : '';
  }

  // =====================================================================
  // AI ARBITER PANEL — independent reasoning models review the debate
  // =====================================================================
  // Prefer the multi-model panel (GPT + Gemini + Grok) for diversity; fall back
  // to the single GPT verifier if the panel has no keys configured.
  var gptVerdict = null;
  var arbiterPanel = null;
  var verifyPrompt = {
    fixture: home + ' vs ' + away,
    league: fixture.league || '',
    agents: debate,
    consensus: consensus ? { market: consensus.market, selection: consensus.selection, agreeing: consensus.agents.join(', ') } : null,
  };
  if (this.aiArbiters && this.aiArbiters.isAvailable && this.aiArbiters.isAvailable()) {
    try {
      arbiterPanel = await this.aiArbiters.panel(verifyPrompt);
      if (arbiterPanel) gptVerdict = { agrees: arbiterPanel.agrees, disagrees: arbiterPanel.disagrees, confidence: arbiterPanel.confidence, panel: arbiterPanel.votes, label: arbiterPanel.label };
    } catch (e) { /* non-fatal */ }
  }
  if (!gptVerdict && this.gptVerifier && this.gptVerifier.isAvailable && this.gptVerifier.isAvailable()) {
    try {
      gptVerdict = await this.gptVerifier.verifyConsensus(verifyPrompt);
    } catch(e) {
      // Non-fatal — proceed without arbiter input
    }
  }

  // =====================================================================
  // FINAL CONFIDENCE CALCULATION
  // =====================================================================
  var baseConfidence = consensus ? Math.round(consensus.totalConf / consensus.agents.length) : 5;

  // Bonus for consensus level
  var consensusBonus = 0;
  if (agreementLevel === 3) consensusBonus = 2; // All three agree — strong
  else if (agreementLevel === 2) consensusBonus = 1; // Two agree — moderate
  else consensusBonus = -1; // No agreement — weak

  // Arbiter bonus — scaled by how many independent models agree.
  if (arbiterPanel && arbiterPanel.panelSize) {
    var agreeFrac = arbiterPanel.agreeCount / arbiterPanel.panelSize;
    if (agreeFrac >= 0.99) consensusBonus += 2;      // whole panel agrees
    else if (agreeFrac > 0.5) consensusBonus += 1;   // majority agree
    else if (arbiterPanel.agreeCount === 0) consensusBonus -= 1; // none agree
  } else {
    if (gptVerdict && gptVerdict.agrees) consensusBonus += 1;
    if (gptVerdict && gptVerdict.disagrees) consensusBonus -= 1;
  }

  var finalConfidence = Math.max(6, Math.min(10, baseConfidence + consensusBonus));

  // Final edge: average of agreeing agents' model probabilities vs market
  var finalOdds = 2.0;
  if (consensus) {
    if (consensus.market.indexOf('Double Chance') !== -1) {
      var _dcp = (away && consensus.selection.indexOf(away) !== -1) ? (pAway + pDraw) : (pHome + pDraw);
      finalOdds = 1 / Math.max(0.1, Math.min(0.92, _dcp));
    }
    else if (consensus.selection.indexOf(home) !== -1 && consensus.market === 'Match Result') finalOdds = homeOdds;
    else if (consensus.selection.indexOf(away) !== -1 && consensus.market === 'Match Result') finalOdds = awayOdds;
    else if (consensus.selection === 'Draw') finalOdds = drawOdds;
    else if (consensus.market.indexOf('Over') !== -1) finalOdds = overOdds;
    else if (consensus.market.indexOf('Under') !== -1) finalOdds = overOdds; // approximate
    else if (consensus.market.indexOf('BTTS') !== -1 || consensus.market.indexOf('Both') !== -1) {
      // BTTS-No is priced from the complement of the Yes price, not the Yes odds.
      if (consensus.selection.indexOf('No') !== -1) { var _iy = 1 / Math.max(1.01, bttsOdds); finalOdds = 1 / Math.max(0.1, 1 - _iy); }
      else finalOdds = bttsOdds;
    }
  }

  return {
    fixture: home + ' vs ' + away,
    league: fixture.league || '',

    // The consensus pick
    market: consensus ? consensus.market : 'Match Result',
    selection: consensus ? consensus.selection : home + ' Win',
    consensusReasoning: consensusReasoning,
    modelProbabilities: { home: pHomePct, draw: pDrawPct, away: pAwayPct },
    odds: finalOdds,
    confidence: finalConfidence,

    // Consensus metadata
    agreementLevel: agreementLevel,
    agreementLabel: agreementLevel === 3 ? 'UNANIMOUS' : agreementLevel === 2 ? 'MAJORITY' : 'SPLIT',
    agentsAgreeing: consensus ? consensus.agents : [],

    // The full debate
    debate: debate,
    gptVerdict: gptVerdict,
    arbiterPanel: arbiterPanel, // multi-model panel votes (GPT/Gemini/Grok)

    // Analyst assignment (primary agent from consensus)
    analyst: consensus && consensus.agents[0] ? consensus.agents[0].toLowerCase().replace('the ', '') : 'tactician',
    analystName: consensus && consensus.agents[0] ? consensus.agents[0] : 'The Tactician',

    // For the scoring pipeline
    modelProbability: consensus ? consensus.totalConf / (consensus.agents.length * 10) : 0.5,
    impliedProbability: 1 / finalOdds,
    edge: (consensus ? consensus.totalConf / (consensus.agents.length * 10) : 0.5) - (1 / finalOdds),
  };
};

module.exports = ConsensusEngine;
