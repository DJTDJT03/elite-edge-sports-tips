/**
 * Elite Edge Sports Tips — Scoring Model
 *
 * Multi-factor weighted scoring framework for generating tip confidence,
 * edge calculations, and value ratings for horse racing and football markets.
 */

class ScoringModel {
  constructor() {
    // Racing factor weights (must sum to 1.0)
    this.racingWeights = {
      form: 0.20,
      going: 0.15,
      class: 0.12,
      trainerJockey: 0.12,
      course: 0.10,
      draw: 0.08,
      weight: 0.05,
      speedRatings: 0.10,
      marketSupport: 0.08,
    };

    // Football factor weights (must sum to 1.0)
    this.footballWeights = {
      xG: 0.20,
      form: 0.18,
      h2h: 0.10,
      injuries: 0.12,
      homeAway: 0.15,
      motivation: 0.08,
      shots: 0.07,
      scheduleCongestion: 0.05,
      marketMovement: 0.05,
    };

    // Value rating thresholds
    this.valueThresholds = {
      elite: 0.12,   // 12%+ edge
      high: 0.07,    // 7-12% edge
      medium: 0.04,  // 4-7% edge
      low: 0.01,     // 1-4% edge
    };
  }

  /**
   * Calculate implied probability from decimal odds
   * @param {number} odds — Decimal odds (e.g., 3.5)
   * @returns {number} Implied probability (0-1)
   */
  impliedProbability(odds) {
    if (odds <= 1) return 1;
    return 1 / odds;
  }

  /**
   * Calculate edge: the difference between model probability and market implied probability
   * @param {number} modelProb — Model-calculated probability (0-1)
   * @param {number} odds — Decimal odds
   * @returns {number} Edge as decimal (e.g., 0.12 = 12%)
   */
  calculateEdge(modelProb, odds) {
    const implied = this.impliedProbability(odds);
    return modelProb - implied;
  }

  /**
   * Determine value rating based on edge
   * @param {number} edge — Edge as decimal
   * @returns {string} Value rating: Elite, High, Medium, Low, or No Value
   */
  getValueRating(edge) {
    if (edge >= this.valueThresholds.elite) return 'Elite';
    if (edge >= this.valueThresholds.high) return 'High';
    if (edge >= this.valueThresholds.medium) return 'Medium';
    if (edge >= this.valueThresholds.low) return 'Low';
    return 'No Value';
  }

  /**
   * Calculate confidence score (1-10) based on edge and number of supporting factors
   * @param {number} edge — Edge as decimal
   * @param {number} supportingFactors — Count of positive factors (0-10)
   * @returns {number} Confidence score 1-10
   */
  calculateConfidence(edge, supportingFactors) {
    // Edge contributes 60%, factor alignment contributes 40%
    const edgeScore = Math.min(edge / 0.15, 1) * 6; // Max 6 from edge
    const factorScore = (supportingFactors / 10) * 4; // Max 4 from factors
    return Math.min(Math.max(Math.round(edgeScore + factorScore), 1), 10);
  }

  /**
   * Calculate recommended stake based on confidence and edge (Kelly-inspired)
   * @param {number} confidence — Confidence score 1-10
   * @param {number} edge — Edge as decimal
   * @param {number} odds — Decimal odds
   * @returns {string} Staking recommendation
   */
  calculateStake(confidence, edge, odds) {
    // Modified Kelly criterion — fraction of Kelly for safety
    const kellyFraction = 0.25; // Quarter-Kelly
    const kellyStake = (edge * odds - (1 - edge)) / (odds - 1);
    const adjustedStake = Math.max(kellyStake * kellyFraction, 0);

    // Convert to units (1-5 scale)
    const units = Math.min(Math.max(Math.round(adjustedStake * 10 * 2) / 2, 0.5), 5);

    if (confidence >= 9) return `${units} units (banker)`;
    if (confidence >= 7) return `${units} units`;
    if (confidence >= 5) return `${units} units`;
    return `${units} units (speculative)`;
  }

  /**
   * Score a horse racing selection using multi-factor analysis
   *
   * @param {Object} factors — Racing-specific input factors
   * @param {number} factors.form — Form rating 0-1 (recent results, consistency)
   * @param {number} factors.going — Going suitability 0-1 (track condition match)
   * @param {number} factors.class — Class indicator 0-1 (dropping=high, rising=low)
   * @param {number} factors.trainerJockey — Trainer/jockey combo rating 0-1
   * @param {number} factors.course — Course record rating 0-1
   * @param {number} factors.draw — Draw advantage 0-1 (bias analysis)
   * @param {number} factors.weight — Weight advantage 0-1 (well-in = high)
   * @param {number} factors.speedRatings — Speed figure ranking 0-1
   * @param {number} factors.marketSupport — Market support indicator 0-1
   * @param {number} odds — Current decimal odds
   * @returns {Object} Complete scoring output
   */
  scoreRacing(factors, odds) {
    // Calculate weighted model probability
    let rawScore = 0;
    let supportingFactors = 0;

    for (const [factor, weight] of Object.entries(this.racingWeights)) {
      const value = factors[factor] || 0;
      rawScore += value * weight;
      if (value >= 0.6) supportingFactors++;
    }

    // Normalize to probability range (model calibration)
    // Raw score 0-1 maps to probability with dampening for extremes
    const modelProbability = Math.min(Math.max(rawScore * 0.85 + 0.05, 0.02), 0.95);
    const impliedProb = this.impliedProbability(odds);
    const edge = this.calculateEdge(modelProbability, odds);
    const confidence = this.calculateConfidence(edge, supportingFactors);
    const valueRating = this.getValueRating(edge);
    const staking = this.calculateStake(confidence, edge, odds);

    return {
      modelProbability: Math.round(modelProbability * 1000) / 1000,
      impliedProbability: Math.round(impliedProb * 1000) / 1000,
      edge: Math.round(edge * 1000) / 1000,
      confidence,
      valueRating,
      staking,
      riskLevel: this._riskLevel(odds, confidence),
      factorBreakdown: this._factorBreakdown(factors, this.racingWeights),
    };
  }

  /**
   * Score a football selection using multi-factor analysis
   *
   * @param {Object} factors — Football-specific input factors
   * @param {number} factors.xG — xG-based probability 0-1
   * @param {number} factors.form — Recent form indicator 0-1
   * @param {number} factors.h2h — Head-to-head indicator 0-1
   * @param {number} factors.injuries — Injury advantage 0-1 (opponent weaker = higher)
   * @param {number} factors.homeAway — Home/away performance 0-1
   * @param {number} factors.motivation — Motivation/context factor 0-1
   * @param {number} factors.shots — Shot volume/quality indicator 0-1
   * @param {number} factors.scheduleCongestion — Freshness advantage 0-1
   * @param {number} factors.marketMovement — Smart money indicator 0-1
   * @param {number} odds — Current decimal odds
   * @returns {Object} Complete scoring output
   */
  scoreFootball(factors, odds) {
    let rawScore = 0;
    let supportingFactors = 0;

    for (const [factor, weight] of Object.entries(this.footballWeights)) {
      const value = factors[factor] || 0;
      rawScore += value * weight;
      if (value >= 0.6) supportingFactors++;
    }

    const modelProbability = Math.min(Math.max(rawScore * 0.85 + 0.05, 0.02), 0.95);
    const impliedProb = this.impliedProbability(odds);
    const edge = this.calculateEdge(modelProbability, odds);
    const confidence = this.calculateConfidence(edge, supportingFactors);
    const valueRating = this.getValueRating(edge);
    const staking = this.calculateStake(confidence, edge, odds);

    return {
      modelProbability: Math.round(modelProbability * 1000) / 1000,
      impliedProbability: Math.round(impliedProb * 1000) / 1000,
      edge: Math.round(edge * 1000) / 1000,
      confidence,
      valueRating,
      staking,
      riskLevel: this._riskLevel(odds, confidence),
      factorBreakdown: this._factorBreakdown(factors, this.footballWeights),
    };
  }

  /**
   * Determine risk level from odds and confidence
   */
  _riskLevel(odds, confidence) {
    if (odds >= 10) return 'High';
    if (odds >= 5) return confidence >= 7 ? 'Medium' : 'Medium-High';
    if (odds >= 3) return confidence >= 7 ? 'Low-Medium' : 'Medium';
    return confidence >= 8 ? 'Very Low' : 'Low';
  }

  /**
   * Generate factor-by-factor breakdown for transparency
   */
  _factorBreakdown(factors, weights) {
    const breakdown = {};
    for (const [factor, weight] of Object.entries(weights)) {
      const value = factors[factor] || 0;
      breakdown[factor] = {
        score: Math.round(value * 100),
        weight: Math.round(weight * 100) + '%',
        contribution: Math.round(value * weight * 100),
        signal: value >= 0.7 ? 'strong' : value >= 0.5 ? 'moderate' : 'weak',
      };
    }
    return breakdown;
  }

  /**
   * Calculate performance statistics from historical results
   * @param {Array} results — Array of result objects with { odds, stake, result, pnl }
   * @returns {Object} Performance metrics
   */
  calculatePerformance(results) {
    if (!results.length) {
      return { roi: 0, strikeRate: 0, totalPnl: 0, totalStaked: 0, runningBank: 100 };
    }

    const totalStaked = results.reduce((sum, r) => sum + r.stake, 0);
    const totalPnl = results.reduce((sum, r) => sum + r.pnl, 0);
    const wins = results.filter(r => r.result === 'won' || r.result === 'placed').length;
    const roi = totalStaked > 0 ? (totalPnl / totalStaked) * 100 : 0;
    const strikeRate = (wins / results.length) * 100;

    // Running bank calculation (starting from 100 units)
    let bank = 100;
    const bankHistory = [{ date: 'Start', bank: 100 }];
    const sorted = [...results].sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const result of sorted) {
      bank += result.pnl;
      bankHistory.push({ date: result.date, bank: Math.round(bank * 100) / 100 });
    }

    return {
      roi: Math.round(roi * 100) / 100,
      strikeRate: Math.round(strikeRate * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalStaked: Math.round(totalStaked * 100) / 100,
      totalTips: results.length,
      wins,
      losses: results.filter(r => r.result === 'lost').length,
      voids: results.filter(r => r.result === 'void').length,
      runningBank: Math.round(bank * 100) / 100,
      bankHistory,
      avgOdds: Math.round((results.reduce((s, r) => s + r.odds, 0) / results.length) * 100) / 100,
      bestWin: results.filter(r => r.result === 'won').sort((a, b) => b.pnl - a.pnl)[0] || null,
      longestWinStreak: this._longestStreak(sorted, 'won'),
    };
  }

  _longestStreak(results, type) {
    let max = 0, current = 0;
    for (const r of results) {
      if (r.result === type || (type === 'won' && r.result === 'placed')) {
        current++;
        max = Math.max(max, current);
      } else {
        current = 0;
      }
    }
    return max;
  }
}

module.exports = new ScoringModel();
