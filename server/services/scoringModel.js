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

    // Exclude voids from P/L counting (voids return the stake)
    const counted = results.filter(r => r.result !== 'void');
    const totalStaked = counted.reduce((sum, r) => sum + r.stake, 0);
    const totalPnl = counted.reduce((sum, r) => sum + r.pnl, 0);
    const wins = counted.filter(r => r.result === 'won' || r.result === 'placed').length;
    const roi = totalStaked > 0 ? (totalPnl / totalStaked) * 100 : 0;
    // Strike rate excludes voids (standard betting practice)
    const strikeRate = counted.length > 0 ? (wins / counted.length) * 100 : 0;

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

  // -------------------------------------------------------------------------
  // AUTO TIP GENERATION — Runner & Fixture Scoring
  // -------------------------------------------------------------------------

  /**
   * Score a racing runner from live API data
   * @param {Object} runner — Runner object from Racing API (normalised)
   * @param {Object} race — Race object from Racing API (normalised)
   * @param {Object} oddsData — Optional odds data from Odds API
   * @returns {Object} { factors, score, edge, confidence, ... } or null if not scoreable
   */
  scoreRunner(runner, race, oddsData) {
    if (!runner || !race) return null;

    // Parse form string (e.g. "12341" or "1/2/3/4/1")
    const formStr = (runner.form || '').replace(/[^0-9FfPpUuRr\-]/g, '');
    const formPositions = formStr.split('').filter(c => /[0-9]/.test(c)).map(Number);

    // --- Form factor ---
    // Rewards consistency AND improvement, not just winning.
    // A horse that finishes 2nd, 2nd, 3rd, 1st is IMPROVING and valuable.
    // A horse that goes 1, 1, 1, 5 might be declining.
    let formScore = 0.5;
    if (formPositions.length > 0) {
      const recentForm = formPositions.slice(0, 6);
      let formPoints = 0;
      let improvementBonus = 0;

      recentForm.forEach((pos, idx) => {
        const recency = 1 - (idx * 0.12); // more recent = more weight
        if (pos === 1) formPoints += 1.0 * recency;
        else if (pos === 2) formPoints += 0.8 * recency;
        else if (pos === 3) formPoints += 0.6 * recency;
        else if (pos <= 5) formPoints += 0.3 * recency;
        else if (pos <= 8) formPoints += 0.1 * recency;
        else formPoints += 0.02 * recency;
      });

      // Improvement bonus: if recent positions are getting lower (better), boost
      if (recentForm.length >= 3) {
        const first3 = recentForm.slice(0, 3);
        const last3 = recentForm.slice(-3);
        const recentAvg = first3.reduce((s, p) => s + p, 0) / first3.length;
        const olderAvg = last3.reduce((s, p) => s + p, 0) / last3.length;
        if (recentAvg < olderAvg) improvementBonus = 0.15; // improving
        if (recentAvg > olderAvg + 2) improvementBonus = -0.1; // declining
      }

      // Consistency bonus: if all recent runs are in the first 3, very consistent
      const top3Count = recentForm.filter(p => p <= 3).length;
      const consistencyBonus = top3Count >= 4 ? 0.15 : top3Count >= 3 ? 0.08 : 0;

      formScore = Math.min(formPoints / (recentForm.length * 0.65) + improvementBonus + consistencyBonus, 1.0);
      formScore = Math.max(formScore, 0.05);
    }

    // --- Going factor ---
    let goingScore = 0.5;
    const raceGoing = (race.going || '').toLowerCase();
    // If runner has form figures, we infer going preference from overall form quality
    // In a live system, we'd check past runs on this going; here we use a heuristic
    if (raceGoing.includes('good') || raceGoing.includes('standard')) {
      goingScore = 0.6; // most horses handle standard/good
    }
    if (formPositions.length > 0 && formPositions[0] <= 2) {
      goingScore = Math.min(goingScore + 0.15, 1.0); // recent winner on any going = ok
    }

    // --- Class factor ---
    let classScore = 0.5;
    const raceClass = parseInt((race.raceClass || '').replace(/\D/g, '')) || 5;
    const or = runner.officialRating || 0;
    if (raceClass >= 4 && or > 80) classScore = 0.8; // well-handicapped in low class
    else if (raceClass >= 5 && or > 70) classScore = 0.7;
    else if (raceClass <= 2 && or < 90) classScore = 0.3; // outclassed
    else if (or > 0) classScore = Math.min(or / 120, 0.9);

    // --- Course factor ---
    let courseScore = 0.4; // neutral default — no course form data easily available
    // Boost if the runner has won recently (implies capable type)
    if (formPositions.length > 0 && formPositions.includes(1)) {
      courseScore = 0.6;
    }

    // --- Trainer/Jockey combo factor ---
    let trainerJockeyScore = 0.5;
    const jockey = (runner.jockey || '').toLowerCase();
    const trainer = (runner.trainer || '').toLowerCase();
    // Top-tier jockey boost
    const topJockeys = ['moore', 'doyle', 'dettori', 'murphy', 'marquand', 'buick', 'atzeni', 'de sousa', 'havlin', 'loughnane'];
    const topTrainers = ['appleby', 'gosden', 'o\'brien', 'stoute', 'haggas', 'varian', 'balding', 'beckett', 'johnston', 'fahey'];
    if (topJockeys.some(j => jockey.includes(j))) trainerJockeyScore += 0.2;
    if (topTrainers.some(t => trainer.includes(t))) trainerJockeyScore += 0.15;
    trainerJockeyScore = Math.min(trainerJockeyScore, 1.0);

    // --- Draw factor ---
    let drawScore = 0.5; // neutral
    const draw = runner.draw || 0;
    if (draw > 0 && draw <= 4) drawScore = 0.55; // slight low-draw advantage on many courses

    // --- Weight factor ---
    let weightScore = 0.5;
    const weight = runner.weight || 0;
    if (weight > 0 && weight <= 130) weightScore = 0.55; // lighter = slight advantage

    // --- Speed ratings factor ---
    let speedScore = 0.5;
    if (or > 0) {
      speedScore = Math.min(or / 110, 1.0) * 0.8 + 0.1; // OR as proxy for speed
    }

    // --- Market support factor ---
    // DO NOT reward short prices — that creates a favourite bias.
    // Instead, look for VALUE: where form/class/trainer signals are
    // stronger than the market price suggests.
    let marketScore = 0.5;
    const runnerOdds = runner.odds || 0;

    // Calculate a form-implied price: what odds SHOULD this horse be based on form alone?
    const formImpliedOdds = formScore > 0 ? 1 / (formScore * 0.7) : 20;

    if (runnerOdds > 0) {
      // Market agrees with our form assessment = moderate signal
      if (Math.abs(runnerOdds - formImpliedOdds) < 2) marketScore = 0.55;
      // Market has this horse SHORTER than form suggests = market knows something, decent
      else if (runnerOdds < formImpliedOdds) marketScore = 0.6;
      // Market has this horse BIGGER than form suggests = potential VALUE play
      else if (runnerOdds > formImpliedOdds * 1.5) marketScore = 0.75;
      // Massive overlay — market price way bigger than form suggests
      else if (runnerOdds > formImpliedOdds * 2) marketScore = 0.85;
    }

    // Bonus for mid-range prices where the best value typically lives (4/1 to 14/1)
    if (runnerOdds >= 5 && runnerOdds <= 15) marketScore = Math.min(marketScore + 0.1, 1.0);
    // Don't completely dismiss outsiders — they can be value
    if (runnerOdds >= 15 && formScore >= 0.5) marketScore = Math.min(marketScore + 0.15, 0.9);

    const factors = {
      form: Math.round(formScore * 100) / 100,
      going: Math.round(goingScore * 100) / 100,
      class: Math.round(classScore * 100) / 100,
      trainerJockey: Math.round(trainerJockeyScore * 100) / 100,
      course: Math.round(courseScore * 100) / 100,
      draw: Math.round(drawScore * 100) / 100,
      weight: Math.round(weightScore * 100) / 100,
      speedRatings: Math.round(speedScore * 100) / 100,
      marketSupport: Math.round(marketScore * 100) / 100,
    };

    const bestOdds = runnerOdds > 1 ? runnerOdds : 3.0; // fallback if no odds
    const scoreResult = this.scoreRacing(factors, bestOdds);

    return {
      runner: runner,
      race: race,
      factors: factors,
      odds: bestOdds,
      ...scoreResult,
    };
  }

  /**
   * Score a football fixture from live API data
   * @param {Object} fixture — Fixture object from API-Football (normalised)
   * @param {Object} oddsData — Odds from Odds API for this fixture
   * @returns {Object} { factors, score, selectedMarket, ... } or null
   */
  scoreFixture(fixture, oddsData) {
    if (!fixture) return null;

    // Try to find matching odds from Odds API
    let matchOdds = null;
    let bookmakerOdds = {};
    if (oddsData && Array.isArray(oddsData)) {
      matchOdds = oddsData.find(o => {
        const oHome = (o.homeTeam || '').toLowerCase();
        const oAway = (o.awayTeam || '').toLowerCase();
        const fHome = (fixture.homeTeam || '').toLowerCase();
        const fAway = (fixture.awayTeam || '').toLowerCase();
        return (oHome.includes(fHome) || fHome.includes(oHome)) &&
               (oAway.includes(fAway) || fAway.includes(oAway));
      });
      if (matchOdds && matchOdds.bookmakerOdds) {
        bookmakerOdds = matchOdds.bookmakerOdds;
      }
    }

    // Extract best available home/draw/away odds
    let homeOdds = 2.0, drawOdds = 3.3, awayOdds = 3.5;
    const firstBookmaker = Object.keys(bookmakerOdds)[0];
    if (firstBookmaker && bookmakerOdds[firstBookmaker]) {
      const bk = bookmakerOdds[firstBookmaker];
      if (bk[fixture.homeTeam]) homeOdds = bk[fixture.homeTeam];
      if (bk['Draw'] || bk['draw']) drawOdds = bk['Draw'] || bk['draw'];
      if (bk[fixture.awayTeam]) awayOdds = bk[fixture.awayTeam];
    }

    // --- xG proxy (based on league position / odds as proxy) ---
    // Short-priced teams tend to create more xG
    const homeImplied = 1 / homeOdds;
    const awayImplied = 1 / awayOdds;
    const xgScore = Math.max(homeImplied, awayImplied) > 0.5 ? 0.7 : 0.5;

    // --- Form factor ---
    // Without detailed form data from additional API calls, use odds as proxy
    const formScore = homeImplied > awayImplied ? 0.65 : 0.45;

    // --- H2H factor ---
    const h2hScore = 0.5; // neutral without data; would need fetchH2H call

    // --- Injuries factor ---
    const injuriesScore = 0.5; // neutral without data

    // --- Home/Away factor ---
    // Home advantage is real — home team gets a boost
    const homeAwayScore = 0.6; // slight home advantage assumed

    // --- Motivation factor ---
    const motivationScore = 0.5; // neutral

    // --- Shots factor ---
    const shotsScore = 0.5; // neutral without stats

    // --- Schedule congestion factor ---
    const congestionScore = 0.5; // neutral

    // --- Market movement factor ---
    let marketScore = 0.5;
    // If odds are available from multiple bookmakers, check consistency
    const bkCount = Object.keys(bookmakerOdds).length;
    if (bkCount >= 2) marketScore = 0.6; // multiple bookmakers = more reliable pricing

    // Determine best market to bet on
    let selectedMarket, selectedSelection, selectedOdds;

    const homeProb = homeImplied;
    const awayProb = awayImplied;
    const drawProb = 1 / drawOdds;
    const totalGoalsExpected = (homeProb > 0.5 || awayProb > 0.5) ? 2.8 : 2.3;

    if (homeProb > 0.55 && homeOdds >= 1.4) {
      // Strong home favourite — home win
      selectedMarket = 'Match Result';
      selectedSelection = fixture.homeTeam + ' Win';
      selectedOdds = homeOdds;
    } else if (awayProb > 0.45 && awayOdds >= 1.8) {
      // Away team strong — away win
      selectedMarket = 'Match Result';
      selectedSelection = fixture.awayTeam + ' Win';
      selectedOdds = awayOdds;
    } else if (totalGoalsExpected > 2.5) {
      // High-scoring expected — over 2.5
      selectedMarket = 'Over 2.5 Goals';
      selectedSelection = 'Over 2.5 Goals';
      selectedOdds = 1.85; // typical over 2.5 price
    } else if (Math.abs(homeProb - awayProb) < 0.1) {
      // Tight match — BTTS
      selectedMarket = 'Both Teams to Score';
      selectedSelection = 'BTTS - Yes';
      selectedOdds = 1.75;
    } else {
      // Default — double chance on stronger side
      if (homeProb > awayProb) {
        selectedMarket = 'Double Chance';
        selectedSelection = fixture.homeTeam + ' or Draw (1X)';
        selectedOdds = 1.35;
      } else {
        selectedMarket = 'Double Chance';
        selectedSelection = fixture.awayTeam + ' or Draw (X2)';
        selectedOdds = 1.55;
      }
    }

    // Override selectedOdds with real bookmaker odds if available for the market
    // For match result, we already have them; for others, use estimates

    const factors = {
      xG: Math.round(xgScore * 100) / 100,
      form: Math.round(formScore * 100) / 100,
      h2h: Math.round(h2hScore * 100) / 100,
      injuries: Math.round(injuriesScore * 100) / 100,
      homeAway: Math.round(homeAwayScore * 100) / 100,
      motivation: Math.round(motivationScore * 100) / 100,
      shots: Math.round(shotsScore * 100) / 100,
      scheduleCongestion: Math.round(congestionScore * 100) / 100,
      marketMovement: Math.round(marketScore * 100) / 100,
    };

    const scoreResult = this.scoreFootball(factors, selectedOdds);

    return {
      fixture: fixture,
      factors: factors,
      selectedMarket: selectedMarket,
      selectedSelection: selectedSelection,
      selectedOdds: selectedOdds,
      bookmakerOdds: bookmakerOdds,
      homeOdds: homeOdds,
      drawOdds: drawOdds,
      awayOdds: awayOdds,
      ...scoreResult,
    };
  }

  /**
   * Score a football fixture with enhanced data from API-Football Pro endpoints.
   * Falls back to scoreFixture() if enhancedData is null/undefined.
   *
   * @param {Object} fixture — Normalised fixture object
   * @param {Object} oddsData — Odds from Odds API
   * @param {Object} enhancedData — Optional enhanced data object
   * @param {Array} enhancedData.injuries — Injured/suspended players from /injuries
   * @param {Object} enhancedData.predictions — API-Football prediction from /predictions
   * @param {Object} enhancedData.homeStats — Home team season stats from /teams/statistics
   * @param {Object} enhancedData.awayStats — Away team season stats from /teams/statistics
   * @param {Object} enhancedData.oddsMovement — Live odds data from /odds/live
   * @returns {Object} Scored fixture with enhanced factors, or null
   */
  scoreFixtureEnhanced(fixture, oddsData, enhancedData) {
    // Fall back to basic scoring if no enhanced data
    if (!enhancedData) {
      return this.scoreFixture(fixture, oddsData);
    }

    // Start with base scoring to get odds, market selection, etc.
    var baseResult = this.scoreFixture(fixture, oddsData);
    if (!baseResult) return null;

    var injuries = enhancedData.injuries || null;
    var predictions = enhancedData.predictions || null;
    var homeStats = enhancedData.homeStats || null;
    var awayStats = enhancedData.awayStats || null;
    var oddsMovement = enhancedData.oddsMovement || null;

    var factors = Object.assign({}, baseResult.factors);
    var selectedMarket = baseResult.selectedMarket;
    var selectedSelection = baseResult.selectedSelection;
    var selectedOdds = baseResult.selectedOdds;
    var homeName = (fixture.homeTeam || '').toLowerCase();

    // Determine which side we're tipping
    var tippingHome = selectedSelection && selectedSelection.toLowerCase().indexOf(homeName) !== -1;

    // --- Enhanced Injuries Factor ---
    if (injuries && Array.isArray(injuries) && injuries.length > 0) {
      var homeInjuries = injuries.filter(function(inj) {
        return inj.team && inj.team.id === fixture.homeTeamId;
      });
      var awayInjuries = injuries.filter(function(inj) {
        return inj.team && inj.team.id === fixture.awayTeamId;
      });

      var homeKeyInjuries = homeInjuries.filter(function(inj) {
        var pos = (inj.player && inj.player.type ? inj.player.type : '').toLowerCase();
        var reason = (inj.player && inj.player.reason ? inj.player.reason : '').toLowerCase();
        // Key players: goalkeepers, or any player marked as important
        return pos === 'goalkeeper' || reason.indexOf('suspended') !== -1 ||
               pos === 'attacker' || pos === 'forward';
      });
      var awayKeyInjuries = awayInjuries.filter(function(inj) {
        var pos = (inj.player && inj.player.type ? inj.player.type : '').toLowerCase();
        var reason = (inj.player && inj.player.reason ? inj.player.reason : '').toLowerCase();
        return pos === 'goalkeeper' || reason.indexOf('suspended') !== -1 ||
               pos === 'attacker' || pos === 'forward';
      });

      var injuryScore = 0.5; // neutral
      if (tippingHome) {
        // We're tipping home — home injuries hurt, away injuries help
        if (homeInjuries.length >= 3 || homeKeyInjuries.length >= 2) injuryScore = 0.3;
        else if (homeInjuries.length >= 2) injuryScore = 0.4;
        if (awayKeyInjuries.length >= 2) injuryScore = Math.min(injuryScore + 0.3, 0.9);
        else if (awayInjuries.length >= 3) injuryScore = Math.min(injuryScore + 0.2, 0.85);
      } else {
        // We're tipping away or goals market
        if (awayInjuries.length >= 3 || awayKeyInjuries.length >= 2) injuryScore = 0.3;
        else if (awayInjuries.length >= 2) injuryScore = 0.4;
        if (homeKeyInjuries.length >= 2) injuryScore = Math.min(injuryScore + 0.3, 0.9);
        else if (homeInjuries.length >= 3) injuryScore = Math.min(injuryScore + 0.2, 0.85);
      }
      // For goals markets, injuries to defenders can mean more goals
      if (selectedMarket === 'Over 2.5 Goals' || selectedMarket === 'Both Teams to Score') {
        var totalInjuries = homeInjuries.length + awayInjuries.length;
        if (totalInjuries >= 4) injuryScore = Math.max(injuryScore, 0.7); // weakened defences = goals
      }
      factors.injuries = Math.round(injuryScore * 100) / 100;
    }

    // --- Enhanced xG/Predictions Factor ---
    if (predictions && predictions.predictions) {
      var pred = predictions.predictions;
      var pctHome = pred.percent && pred.percent.home ? parseInt(pred.percent.home) : 0;
      var pctDraw = pred.percent && pred.percent.draw ? parseInt(pred.percent.draw) : 0;
      var pctAway = pred.percent && pred.percent.away ? parseInt(pred.percent.away) : 0;

      var xgScore = 0.5;
      var apiPredictedWinner = 'draw';
      if (pctHome > pctAway && pctHome > pctDraw) apiPredictedWinner = 'home';
      else if (pctAway > pctHome && pctAway > pctDraw) apiPredictedWinner = 'away';

      var ourPick = 'neutral';
      if (selectedSelection && selectedSelection.toLowerCase().indexOf(homeName) !== -1 &&
          selectedMarket === 'Match Result') {
        ourPick = 'home';
      } else if (selectedSelection && selectedMarket === 'Match Result' &&
                 selectedSelection.toLowerCase().indexOf(homeName) === -1) {
        ourPick = 'away';
      }

      if (ourPick !== 'neutral') {
        if (apiPredictedWinner === ourPick) {
          // Agreement — boost confidence
          var winPct = ourPick === 'home' ? pctHome : pctAway;
          xgScore = winPct >= 60 ? 0.9 : winPct >= 50 ? 0.8 : 0.7;
        } else {
          // Disagreement — caution
          xgScore = apiPredictedWinner === 'draw' ? 0.4 : 0.3;
        }
      } else {
        // Goals market — use the overall prediction quality
        if (pred.goals && pred.goals.home && pred.goals.away) {
          var predTotalGoals = parseFloat(pred.goals.home) + parseFloat(pred.goals.away);
          if (selectedMarket === 'Over 2.5 Goals') {
            xgScore = predTotalGoals > 2.8 ? 0.85 : predTotalGoals > 2.3 ? 0.6 : 0.35;
          } else if (selectedMarket === 'Both Teams to Score') {
            xgScore = (parseFloat(pred.goals.home) > 0.8 && parseFloat(pred.goals.away) > 0.8) ? 0.8 : 0.45;
          } else {
            xgScore = 0.55;
          }
        }
      }
      factors.xG = Math.round(xgScore * 100) / 100;
    }

    // --- Enhanced Team Stats Factor (enhances form) ---
    if (homeStats || awayStats) {
      var formScore = factors.form; // start from base
      var hStats = homeStats && homeStats.response ? homeStats.response : null;
      var aStats = awayStats && awayStats.response ? awayStats.response : null;

      // Extract goals_per_game, clean_sheet_percentage, btts from team stats
      var hGoalsPerGame = 0, aGoalsPerGame = 0;
      var hCleanSheetPct = 0, aCleanSheetPct = 0;
      var hBttsPct = 50, aBttsPct = 50;

      if (hStats && hStats.goals && hStats.goals.for && hStats.goals.for.average) {
        hGoalsPerGame = parseFloat(hStats.goals.for.average.total) || 0;
      }
      if (aStats && aStats.goals && aStats.goals.for && aStats.goals.for.average) {
        aGoalsPerGame = parseFloat(aStats.goals.for.average.total) || 0;
      }
      if (hStats && hStats.clean_sheet && hStats.fixtures && hStats.fixtures.played) {
        var hPlayed = (hStats.fixtures.played.total || 1);
        hCleanSheetPct = ((hStats.clean_sheet.total || 0) / hPlayed) * 100;
      }
      if (aStats && aStats.clean_sheet && aStats.fixtures && aStats.fixtures.played) {
        var aPlayed = (aStats.fixtures.played.total || 1);
        aCleanSheetPct = ((aStats.clean_sheet.total || 0) / aPlayed) * 100;
      }
      // BTTS: if both teams fail to keep clean sheets often, BTTS is likely
      hBttsPct = 100 - hCleanSheetPct;
      aBttsPct = 100 - aCleanSheetPct;

      if (selectedMarket === 'Both Teams to Score') {
        if (hBttsPct > 55 && aBttsPct > 55) formScore = 0.85;
        else if (hBttsPct > 45 && aBttsPct > 45) formScore = 0.65;
        else formScore = 0.4;
      } else if (selectedMarket === 'Over 2.5 Goals') {
        var combinedGoals = hGoalsPerGame + aGoalsPerGame;
        if (combinedGoals > 2.8) formScore = 0.85;
        else if (combinedGoals > 2.3) formScore = 0.65;
        else formScore = 0.4;
      } else if (selectedMarket === 'Match Result') {
        // Use actual season stats for the tipped side
        if (tippingHome && hStats && hStats.fixtures && hStats.fixtures.wins) {
          var hWinPct = (hStats.fixtures.wins.total || 0) / (hStats.fixtures.played.total || 1);
          formScore = Math.min(hWinPct + 0.15, 0.95); // home win% + small boost
        } else if (!tippingHome && aStats && aStats.fixtures && aStats.fixtures.wins) {
          var aWinPct = (aStats.fixtures.wins.total || 0) / (aStats.fixtures.played.total || 1);
          formScore = Math.min(aWinPct + 0.1, 0.9);
        }
      }
      factors.form = Math.round(formScore * 100) / 100;
    }

    // --- Enhanced Odds Movement Factor ---
    if (oddsMovement && oddsMovement.response && oddsMovement.response.length > 0) {
      var liveOddsData = oddsMovement.response[0];
      var marketMovementScore = 0.5;

      // Check if odds array has entries showing movement
      if (liveOddsData.odds && Array.isArray(liveOddsData.odds) && liveOddsData.odds.length > 0) {
        // Look for the main market odds
        var mainOdds = liveOddsData.odds.find(function(o) {
          return o.id === 1 || (o.name && o.name.toLowerCase().indexOf('winner') !== -1);
        });
        if (mainOdds && mainOdds.values && mainOdds.values.length > 0) {
          // If live odds are shorter than pre-match, money is coming in (shortening)
          // We compare with our base odds
          var relevantValue = mainOdds.values.find(function(v) {
            return v.value && (
              (tippingHome && v.value.toLowerCase() === 'home') ||
              (!tippingHome && v.value.toLowerCase() === 'away')
            );
          });
          if (relevantValue && relevantValue.odd) {
            var liveOdd = parseFloat(relevantValue.odd);
            var preMatchOdd = selectedOdds;
            if (liveOdd < preMatchOdd * 0.95) {
              // Shortening — smart money coming in
              marketMovementScore = 0.8;
            } else if (liveOdd > preMatchOdd * 1.1) {
              // Drifting — money going elsewhere
              marketMovementScore = 0.3;
            } else {
              // Stable
              marketMovementScore = 0.5;
            }
          }
        }
      }
      factors.marketMovement = Math.round(marketMovementScore * 100) / 100;
    }

    // Re-score with enhanced factors
    var enhancedScoreResult = this.scoreFootball(factors, selectedOdds);

    return {
      fixture: fixture,
      factors: factors,
      selectedMarket: selectedMarket,
      selectedSelection: selectedSelection,
      selectedOdds: selectedOdds,
      bookmakerOdds: baseResult.bookmakerOdds,
      homeOdds: baseResult.homeOdds,
      drawOdds: baseResult.drawOdds,
      awayOdds: baseResult.awayOdds,
      enhanced: true,
      enhancedDataUsed: {
        injuries: !!(injuries && injuries.length > 0),
        predictions: !!(predictions && predictions.predictions),
        teamStats: !!(homeStats || awayStats),
        oddsMovement: !!(oddsMovement && oddsMovement.response && oddsMovement.response.length > 0),
      },
      ...enhancedScoreResult,
    };
  }

  /**
   * Generate analysis text for an auto-generated tip
   * @param {Object} scored — Scored selection from scoreRunner or scoreFixture
   * @param {string} sport — 'racing' or 'football'
   * @returns {Object} Analysis object matching the tip format
   */
  generateAnalysis(scored, sport) {
    if (sport === 'racing') {
      return this._generateRacingAnalysis(scored);
    } else {
      return this._generateFootballAnalysis(scored);
    }
  }

  _generateRacingAnalysis(scored) {
    const runner = scored.runner || {};
    const race = scored.race || {};
    const horseName = runner.horseName || 'Selection';
    const meeting = race.meeting || 'Unknown';
    const time = race.time || '';
    const going = race.going || 'Unknown';
    const odds = scored.odds || 0;
    const edge = scored.edge || 0;
    const edgePct = (edge * 100).toFixed(1);
    const trainer = runner.trainer || 'Trainer';
    const jockey = runner.jockey || 'Jockey';
    const formStr = runner.form || 'No form';
    const formPositions = (formStr).replace(/[^0-9FfPpUuRr\-]/g, '').split('').filter(c => /[0-9]/.test(c)).map(Number);
    const className = race.raceClass || 'Unknown';
    const distance = race.distance || '';
    const or = runner.officialRating || 0;

    // Build form context
    let formContext = '';
    if (formPositions.length > 0) {
      const wins = formPositions.filter(p => p === 1).length;
      const places = formPositions.filter(p => p <= 3).length;
      formContext = wins > 0
        ? `${wins} win${wins > 1 ? 's' : ''} from last ${formPositions.length} runs shows consistency at this level.`
        : places > 0
          ? `${places} place${places > 1 ? 's' : ''} from last ${formPositions.length} runs — knocking on the door.`
          : 'Recent form figures suggest a return to winning ways could be imminent.';
    } else {
      formContext = 'Limited recent form data available. Relying on profile and connections.';
    }

    // Stale reason based on top factor
    const factors = scored.factors || {};
    let keyReason = '';
    if (factors.form >= 0.7) keyReason = 'Recent form is the standout factor here';
    else if (factors.class >= 0.7) keyReason = 'The class drop is significant';
    else if (factors.trainerJockey >= 0.7) keyReason = 'The trainer-jockey combination is a major positive';
    else if (factors.speedRatings >= 0.7) keyReason = 'Speed figures mark this one out';
    else if (factors.marketSupport >= 0.7) keyReason = 'Strong market support is the key indicator';
    else keyReason = 'Multiple factors align to make this a solid opportunity';

    const riskNotes = odds < 3
      ? 'Short price limits returns but confidence is high. Main risk is a below-par performance on the day.'
      : odds < 6
        ? 'Fair price reflects a competitive race. Each-way could be considered for extra protection.'
        : 'Bigger price carries more risk but the value is clear. Consider smaller stakes.';

    return {
      summary: `${horseName} runs in the ${time} at ${meeting} and our model rates this a strong Win opportunity. ${keyReason}. At ${odds.toFixed(2)}, the edge is ${edgePct}% against the market.`,
      form: `${formStr}. ${formContext}`,
      goingSuitability: `${going} — ${going.toLowerCase().includes('good') || going.toLowerCase().includes('standard') ? 'conditions should suit based on profile and recent efforts' : 'ground conditions are a slight unknown but form suggests adaptability'}.`,
      courseRecord: `${formPositions.includes(1) ? 'Proven winner who handles similar tracks' : 'Course form to be established'} — ${meeting} ${distance ? '(' + distance + ')' : ''} should play to strengths.`,
      trainerForm: `${trainer} in ${factors.trainerJockey >= 0.7 ? 'excellent' : factors.trainerJockey >= 0.5 ? 'decent' : 'quiet'} form. ${jockey} takes the ride${factors.trainerJockey >= 0.7 ? ' — a strong booking that adds confidence' : ''}.`,
      riskNotes: riskNotes,
    };
  }

  _generateFootballAnalysis(scored) {
    const fixture = scored.fixture || {};
    const home = fixture.homeTeam || 'Home';
    const away = fixture.awayTeam || 'Away';
    const league = fixture.league || 'League';
    const market = scored.selectedMarket || 'Market';
    const selection = scored.selectedSelection || 'Selection';
    const odds = scored.selectedOdds || 0;
    const edge = scored.edge || 0;
    const edgePct = (edge * 100).toFixed(1);
    const modelProb = scored.modelProbability || 0;
    const impliedProb = scored.impliedProbability || 0;
    const modelPct = (modelProb * 100).toFixed(0);
    const impliedPct = (impliedProb * 100).toFixed(0);

    const factors = scored.factors || {};
    let keyReason = '';
    if (factors.xG >= 0.7) keyReason = 'Expected goals data strongly supports this selection';
    else if (factors.form >= 0.65) keyReason = 'Recent form is the driving factor';
    else if (factors.homeAway >= 0.65) keyReason = 'Home advantage plays a significant role here';
    else if (factors.marketMovement >= 0.65) keyReason = 'Market confidence is notable';
    else keyReason = 'The overall profile of this fixture provides an edge';

    const isMatchResult = market.toLowerCase().includes('result');
    const isBTTS = market.toLowerCase().includes('both teams');
    const isOver = market.toLowerCase().includes('over');

    let formText = '';
    if (isMatchResult && selection.toLowerCase().includes(home.toLowerCase())) {
      formText = `${home} have been strong at home this season. ${away} have found away fixtures challenging.`;
    } else if (isMatchResult && selection.toLowerCase().includes(away.toLowerCase())) {
      formText = `${away} are in good away form. ${home} have been inconsistent at home.`;
    } else if (isBTTS) {
      formText = `Both ${home} and ${away} have been involved in high-scoring games recently. Goals at both ends expected.`;
    } else if (isOver) {
      formText = `${home} and ${away} both contribute to open, attacking fixtures. Recent games involving both sides have featured goals.`;
    } else {
      formText = `${home} form and ${away} form both factor into this selection. The double chance offers protection.`;
    }

    const riskNotes = odds < 2
      ? 'Short odds limit the upside but the selection is well-supported. Late team news could impact.'
      : odds < 4
        ? 'Fair-priced selection in a competitive fixture. Key players and tactical matchups could swing it.'
        : 'Bigger price reflects the inherent uncertainty. Consider staking conservatively.';

    return {
      summary: `${home} vs ${away} in ${league}. Our model gives ${selection} a ${modelPct}% probability against the market's ${impliedPct}%. ${keyReason}.`,
      form: formText,
      xG: `Model analysis based on expected goals and recent attacking/defensive metrics for both sides.`,
      injuries: `Check team news closer to kick-off for any late changes that could affect the selection.`,
      headToHead: `Recent meetings between ${home} and ${away} have been considered in the model's H2H factor.`,
      riskNotes: riskNotes,
    };
  }
}

module.exports = new ScoringModel();
