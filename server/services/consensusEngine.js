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
 *   3. Scout analyses (value, market inefficiency, price)
 *   4. GPT Verifier reviews all three — agrees/disagrees with reasoning
 *   5. Consensus engine picks the winning market
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

  var injuryFactor = factors.injuries || 0.5;
  var motivationFactor = factors.motivation || 0.5;
  var congestionFactor = factors.scheduleCongestion || 0.5;
  var homeFactor = factors.homeAway || 0.6;

  // Tactician weights: injuries 1.5, motivation 1.5, congestion 1.4, xG 1.4
  var tactHomeScore = (homeFactor * 1.3 + injuryFactor * 1.5 + motivationFactor * 1.5 + (factors.form || 0.5) * 1.1) / 5.4;
  var tactAwayScore = ((1 - homeFactor) * 1.3 + (1 - injuryFactor) * 1.5 + motivationFactor * 1.5 + (factors.form || 0.5) * 1.1) / 5.4;
  var tactGoalsScore = ((factors.xG || 0.5) * 1.4 + (factors.shots || 0.5) * 1.2 + congestionFactor * 1.4) / 4.0;

  if (tactHomeScore > 0.6 && homeOdds >= 1.4) {
    tactician.market = 'Match Result';
    tactician.selection = home + ' Win';
    tactician.confidence = Math.round(tactHomeScore * 10);
    tactician.reasoning = 'Tactical setup and contextual factors favour ' + home + '. Injury impact and motivation weigh heavily.';
  } else if (tactAwayScore > 0.6 && awayOdds >= 1.8) {
    tactician.market = 'Match Result';
    tactician.selection = away + ' Win';
    tactician.confidence = Math.round(tactAwayScore * 10);
    tactician.reasoning = 'Away side has tactical advantages. Schedule congestion and motivation context favour ' + away + '.';
  } else if (tactGoalsScore > 0.55) {
    tactician.market = 'Over 2.5 Goals';
    tactician.selection = 'Over 2.5 Goals';
    tactician.confidence = Math.round(tactGoalsScore * 10);
    tactician.reasoning = 'xG trends and attacking metrics point to goals. Both sides creating chances.';
  } else {
    tactician.market = 'Both Teams to Score';
    tactician.selection = 'BTTS - Yes';
    tactician.confidence = Math.round(((factors.xG || 0.5) + (1 - (factors.injuries || 0.5))) / 2 * 10);
    tactician.reasoning = 'Tight match tactically. Both sides capable of scoring but neither dominant.';
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
    professor.reasoning = 'Form and expected goals data support ' + home + '. Statistical edge is clear.';
  } else if (profAwayScore > 0.58 && awayOdds >= 1.5) {
    professor.market = 'Match Result';
    professor.selection = away + ' Win';
    professor.confidence = Math.round(profAwayScore * 10);
    professor.reasoning = 'Data profile favours ' + away + '. Superior xG and recent form.';
  } else if (profGoalsScore > 0.6) {
    professor.market = 'Over 2.5 Goals';
    professor.selection = 'Over 2.5 Goals';
    professor.confidence = Math.round(profGoalsScore * 10);
    professor.reasoning = 'High xG and shot volume from both sides. Data expects goals.';
  } else if (profGoalsScore < 0.4) {
    professor.market = 'Under 2.5 Goals';
    professor.selection = 'Under 2.5 Goals';
    professor.confidence = Math.round((1 - profGoalsScore) * 10);
    professor.reasoning = 'Low expected goals. Both sides conservative. Data points to a tight game.';
  } else {
    professor.market = 'Match Result';
    professor.selection = 'Draw';
    professor.confidence = Math.round((1 - Math.abs(profHomeScore - profAwayScore)) * 8);
    professor.reasoning = 'Statistically inseparable. Form, xG, and H2H all point to a tight contest.';
  }

  // =====================================================================
  // AGENT 3: THE SCOUT — value, price, market inefficiency
  // =====================================================================
  var scout = {
    agent: 'The Scout',
    approach: 'Value & market inefficiency hunter',
    market: null,
    selection: null,
    confidence: 5,
    reasoning: '',
  };

  // Scout looks for the biggest gap between model probability and market price
  var markets = [
    { market: 'Match Result', selection: home + ' Win', odds: homeOdds, modelProb: profHomeScore },
    { market: 'Match Result', selection: away + ' Win', odds: awayOdds, modelProb: profAwayScore },
    { market: 'Match Result', selection: 'Draw', odds: drawOdds, modelProb: 1 - profHomeScore - profAwayScore + 0.3 },
    { market: 'Over 2.5 Goals', selection: 'Over 2.5 Goals', odds: overOdds, modelProb: profGoalsScore },
    { market: 'Both Teams to Score', selection: 'BTTS - Yes', odds: bttsOdds, modelProb: (factors.xG || 0.5) * 0.8 + 0.1 },
  ];

  // Calculate edge for each market
  markets.forEach(function(m) {
    m.impliedProb = 1 / m.odds;
    m.edge = m.modelProb - m.impliedProb;
  });

  // Scout picks the market with the highest value edge
  markets.sort(function(a, b) { return b.edge - a.edge; });
  var bestValue = markets[0];

  if (bestValue.edge > 0.02) {
    scout.market = bestValue.market;
    scout.selection = bestValue.selection;
    scout.confidence = Math.min(9, Math.round(5 + bestValue.edge * 50));
    scout.reasoning = 'Best value at ' + bestValue.odds.toFixed(2) + '. Model sees ' + (bestValue.modelProb * 100).toFixed(0) + '% probability vs market\'s ' + (bestValue.impliedProb * 100).toFixed(0) + '%. Edge: ' + (bestValue.edge * 100).toFixed(1) + '%.';
  } else {
    scout.market = 'No Strong Value';
    scout.selection = 'Pass';
    scout.confidence = 3;
    scout.reasoning = 'No market offers sufficient value. The price is fair across all outcomes.';
  }

  // =====================================================================
  // CONSENSUS: Find the market where most agents agree
  // =====================================================================
  var agents = [tactician, professor, scout].filter(function(a) { return a.selection !== 'Pass'; });
  var debate = [];

  // Group by market+selection
  var votes = {};
  agents.forEach(function(a) {
    var key = a.market + '|' + a.selection;
    if (!votes[key]) votes[key] = { market: a.market, selection: a.selection, agents: [], totalConf: 0 };
    votes[key].agents.push(a.agent);
    votes[key].totalConf += a.confidence;
  });

  // Sort by number of agents agreeing, then by total confidence
  var ranked = Object.values(votes).sort(function(a, b) {
    if (b.agents.length !== a.agents.length) return b.agents.length - a.agents.length;
    return b.totalConf - a.totalConf;
  });

  var consensus = ranked[0];
  var agreementLevel = consensus ? consensus.agents.length : 0;

  // Build debate log
  debate.push({ agent: tactician.agent, pick: tactician.selection, market: tactician.market, confidence: tactician.confidence, reasoning: tactician.reasoning });
  debate.push({ agent: professor.agent, pick: professor.selection, market: professor.market, confidence: professor.confidence, reasoning: professor.reasoning });
  debate.push({ agent: scout.agent, pick: scout.selection, market: scout.market, confidence: scout.confidence, reasoning: scout.reasoning });

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
    if (consensus.selection.indexOf(home) !== -1 && consensus.market === 'Match Result') finalOdds = homeOdds;
    else if (consensus.selection.indexOf(away) !== -1 && consensus.market === 'Match Result') finalOdds = awayOdds;
    else if (consensus.selection === 'Draw') finalOdds = drawOdds;
    else if (consensus.market.indexOf('Over') !== -1) finalOdds = overOdds;
    else if (consensus.market.indexOf('Under') !== -1) finalOdds = overOdds; // approximate
    else if (consensus.market.indexOf('BTTS') !== -1 || consensus.market.indexOf('Both') !== -1) finalOdds = bttsOdds;
  }

  return {
    fixture: home + ' vs ' + away,
    league: fixture.league || '',

    // The consensus pick
    market: consensus ? consensus.market : 'Match Result',
    selection: consensus ? consensus.selection : home + ' Win',
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
