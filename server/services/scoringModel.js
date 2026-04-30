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
  scoreRunner(runner, race, oddsData, weatherData) {
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

    // --- Weather adjustment to going factor ---
    var weatherDrawAdjust = 0; // applied to draw factor later
    if (weatherData) {
      try {
        // Rain forecast — going likely to soften
        if (weatherData.rain > 0 || (weatherData.description && weatherData.description.indexOf('rain') !== -1)) {
          var hasWins = formPositions.length > 0 && formPositions.includes(1);
          // Runner with good form + rain = likely handles soft ground
          if (hasWins && formScore >= 0.5) {
            goingScore = Math.min(goingScore + 0.2, 1.0);
          } else if (formScore < 0.35) {
            goingScore = Math.max(goingScore - 0.2, 0.05);
          }
        }

        // Strong wind (>20mph) affects sprint races — reduce draw advantage
        if (weatherData.windSpeed > 20) {
          var distStr = (race.distance || '').toLowerCase();
          var isSprint = distStr.indexOf('5f') !== -1 || distStr.indexOf('6f') !== -1;
          if (isSprint) {
            weatherDrawAdjust = -0.05;
          }
        }

        // Extreme cold — going may be harder than advertised
        if (weatherData.temp < 5) {
          if (raceGoing.indexOf('soft') !== -1 || raceGoing.indexOf('heavy') !== -1) {
            goingScore = Math.min(goingScore + 0.05, 1.0);
          }
        }
      } catch (weatherErr) {
        // Non-fatal — ignore weather adjustment errors
      }
    }

    // --- Class factor (enhanced with class movement detection) ---
    let classScore = 0.5;
    const raceClass = parseInt((race.raceClass || '').replace(/\D/g, '')) || 5;
    const or = runner.officialRating || 0;

    // Basic OR vs class check
    if (raceClass >= 4 && or > 80) classScore = 0.8;
    else if (raceClass >= 5 && or > 70) classScore = 0.7;
    else if (raceClass <= 2 && or < 90) classScore = 0.3;
    else if (or > 0) classScore = Math.min(or / 120, 0.9);

    // Class drop detection — horse dropping in class is a strong signal
    if (runner.formDetails && runner.formDetails.length > 0) {
      var lastRaceClass = null;
      for (var ci = 0; ci < runner.formDetails.length; ci++) {
        if (runner.formDetails[ci] && runner.formDetails[ci].raceClass) {
          lastRaceClass = parseInt((runner.formDetails[ci].raceClass || '').replace(/\D/g, '')) || null;
          break;
        }
      }
      if (lastRaceClass && lastRaceClass < raceClass) {
        // Dropping in class — significant advantage
        var classDrop = raceClass - lastRaceClass;
        classScore = Math.min(classScore + classDrop * 0.1, 0.95);
      } else if (lastRaceClass && lastRaceClass > raceClass) {
        // Rising in class — tougher competition
        var classRise = lastRaceClass - raceClass;
        classScore = Math.max(classScore - classRise * 0.08, 0.2);
      }
    }

    // --- Course & Distance factor — has the horse won at this course over this distance? ---
    let courseScore = 0.4; // neutral default
    var courseName = (race.meeting || race.course || '').toLowerCase();
    var raceDistance = (race.distance || '').toLowerCase();

    // Check detailed form for course wins and course & distance wins
    if (runner.formDetails && Array.isArray(runner.formDetails)) {
      var courseWins = 0;
      var cdWins = 0; // Course AND Distance wins
      runner.formDetails.forEach(function(f) {
        if (!f) return;
        var fCourse = (f.course || '').toLowerCase();
        var fDist = (f.distance || '').toLowerCase();
        var fPos = parseInt(f.position) || 99;
        if (fCourse.indexOf(courseName) !== -1 || courseName.indexOf(fCourse) !== -1) {
          if (fPos === 1) courseWins++;
          if (fPos <= 3) courseScore += 0.05;
          if ((fDist.indexOf(raceDistance) !== -1 || raceDistance.indexOf(fDist) !== -1) && fPos === 1) {
            cdWins++;
          }
        }
      });
      if (cdWins > 0) courseScore = Math.min(0.9, 0.6 + cdWins * 0.15); // C&D winner = strong
      else if (courseWins > 0) courseScore = Math.min(0.8, 0.5 + courseWins * 0.1);
    }

    // If no form details available, use simple form positions
    if (formPositions.length > 0 && formPositions.includes(1)) {
      courseScore = Math.max(courseScore, 0.6);
    }

    // --- Trainer/Jockey combo factor ---
    let trainerJockeyScore = 0.5;
    const jockey = (runner.jockey || '').toLowerCase();
    const trainer = (runner.trainer || '').toLowerCase();

    // Top-tier jockeys (expanded list covering flat and jumps)
    const topJockeys = ['moore', 'doyle', 'dettori', 'murphy', 'marquand', 'buick', 'atzeni', 'de sousa', 'havlin', 'loughnane', 'kingscote', 'turner', 'egan', 'sheehan', 'cobden', 'skelton', 'townend', 'blackmore'];
    const topTrainers = ['appleby', 'gosden', 'o\'brien', 'stoute', 'haggas', 'varian', 'balding', 'beckett', 'johnston', 'fahey', 'mullins', 'henderson', 'nicholls', 'skelton', 'tizzard', 'hobbs', 'williams'];

    // Known elite combinations (trainer-jockey pairs that consistently outperform)
    var eliteCombos = [
      ['appleby', 'buick'], ['gosden', 'dettori'], ['gosden', 'doyle'],
      ['o\'brien', 'moore'], ['haggas', 'marquand'], ['varian', 'egan'],
      ['mullins', 'townend'], ['henderson', 'cobden'], ['nicholls', 'cobden'],
      ['skelton', 'skelton'], ['balding', 'doyle'], ['balding', 'murphy']
    ];

    if (topJockeys.some(j => jockey.includes(j))) trainerJockeyScore += 0.15;
    if (topTrainers.some(t => trainer.includes(t))) trainerJockeyScore += 0.12;

    // Elite combo bonus — these pairs win at a higher rate together
    var isEliteCombo = eliteCombos.some(function(combo) {
      return trainer.indexOf(combo[0]) !== -1 && jockey.indexOf(combo[1]) !== -1;
    });
    if (isEliteCombo) trainerJockeyScore += 0.15;

    trainerJockeyScore = Math.min(trainerJockeyScore, 1.0);

    // --- Draw factor ---
    let drawScore = 0.5; // neutral
    const draw = runner.draw || 0;
    if (draw > 0 && draw <= 4) drawScore = 0.55; // slight low-draw advantage on many courses
    // Apply weather-based draw adjustment (wind affects draw advantage in sprints)
    if (weatherDrawAdjust !== 0) {
      drawScore = Math.max(drawScore + weatherDrawAdjust, 0.1);
    }

    // --- Weight factor ---
    let weightScore = 0.5;
    const weight = runner.weight || 0;
    if (weight > 0 && weight <= 130) weightScore = 0.55; // lighter = slight advantage

    // --- Days Since Last Run factor ---
    // Fresh horses (14-30 days) tend to outperform
    // Very fresh (7-14 days) = good if form is strong
    // Long absence (60+ days) = fitness concern
    // Quick turnaround (<7 days) = possible fatigue
    var freshnessScore = 0.5;
    var lastRunDate = null;

    // Try to get last run date from form details or recent form
    if (runner.formDetails && runner.formDetails.length > 0 && runner.formDetails[0].date) {
      lastRunDate = new Date(runner.formDetails[0].date);
    } else if (runner.lastRun) {
      lastRunDate = new Date(runner.lastRun);
    }

    if (lastRunDate && !isNaN(lastRunDate.getTime())) {
      var daysSinceRun = Math.round((new Date() - lastRunDate) / (1000 * 60 * 60 * 24));
      if (daysSinceRun >= 14 && daysSinceRun <= 30) freshnessScore = 0.7; // Optimal freshness
      else if (daysSinceRun >= 7 && daysSinceRun < 14) freshnessScore = 0.6; // Quick but fine
      else if (daysSinceRun > 30 && daysSinceRun <= 60) freshnessScore = 0.45; // Needs a run?
      else if (daysSinceRun > 60 && daysSinceRun <= 120) freshnessScore = 0.35; // Long absence
      else if (daysSinceRun > 120) freshnessScore = 0.25; // Very long absence
      else if (daysSinceRun < 7) freshnessScore = 0.4; // Quick turnaround risk
    }

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

    // Freshness modifier — adjusts total score by up to ±10%
    var freshnessModifier = 1.0 + (freshnessScore - 0.5) * 0.2; // 0.5 = no change, 0.7 = +4%, 0.25 = -5%
    var adjustedModelProb = Math.min(Math.max(scoreResult.modelProbability * freshnessModifier, 0.02), 0.95);
    var adjustedEdge = adjustedModelProb - scoreResult.impliedProbability;
    var adjustedConfidence = this.calculateConfidence(adjustedEdge, Object.values(factors).filter(function(v) { return v >= 0.6; }).length);

    return {
      runner: runner,
      race: race,
      factors: factors,
      odds: bestOdds,
      ...scoreResult,
      modelProbability: Math.round(adjustedModelProb * 1000) / 1000,
      edge: Math.round(adjustedEdge * 1000) / 1000,
      confidence: adjustedConfidence,
      valueRating: this.getValueRating(adjustedEdge),
      staking: this.calculateStake(adjustedConfidence, adjustedEdge, bestOdds),
      freshnessScore: Math.round(freshnessScore * 100) / 100,
    };
  }

  /**
   * Score a racing runner with multi-bookmaker market intelligence.
   * Uses data from 40+ UK bookmakers via The Odds API to detect:
   * - Market consensus (average price across all bookmakers)
   * - Best available price (value for the subscriber)
   * - Price movement (steamer/drifter detection)
   * - Market confidence (tight spread = bookmakers agree)
   * - Value edge (how much better is the best price vs average)
   *
   * Falls back to basic scoreRunner() when no market data available.
   *
   * @param {Object} runner — Runner object from Racing API (normalised)
   * @param {Object} race — Race object from Racing API (normalised)
   * @param {Object} oddsData — Optional odds data from Odds API
   * @param {Object} marketData — Multi-bookmaker intelligence for this runner:
   *   - bestPrice {number} — best available price across all bookmakers
   *   - averagePrice {number} — market consensus price
   *   - worstPrice {number} — worst price on offer
   *   - priceSpread {number} — best - worst (tight = confident market)
   *   - spreadPct {number} — spread as % of worst price
   *   - bookmakerCount {number} — how many bookmakers are pricing this runner
   *   - bestBookmaker {string} — which bookmaker has the best price
   *   - marketRank {number} — 1 = market favourite
   *   - marketConfidence {string} — 'very high', 'high', 'medium', 'low'
   *   - movement {Object} — from OddsMovementTracker: direction, percentChange, signal
   * @param {Object} weatherData — Optional weather data
   * @returns {Object} Scored result with market-enhanced factors, or null
   */
  scoreRunnerEnhanced(runner, race, oddsData, marketData, weatherData) {
    // Fall back to basic scoring if no market data
    if (!marketData) {
      return this.scoreRunner(runner, race, oddsData, weatherData);
    }

    // Start with base scoring
    var baseResult = this.scoreRunner(runner, race, oddsData, weatherData);
    if (!baseResult) return null;

    var factors = Object.assign({}, baseResult.factors);
    var bestPrice = marketData.bestPrice || 0;
    var avgPrice = marketData.averagePrice || 0;
    var priceSpread = marketData.priceSpread || 0;
    var spreadPct = marketData.spreadPct || 100;
    var bookmakerCount = marketData.bookmakerCount || 0;
    var marketRank = marketData.marketRank || 0;
    var marketConfidence = marketData.marketConfidence || 'low';
    var movement = marketData.movement || {};
    var priceMovement = movement.direction || 'stable';

    // --- Multi-Bookmaker Market Support Factor ---
    var marketScore = 0.5;

    // Market confidence from bookmaker agreement
    if (marketConfidence === 'very high') {
      // 8+ bookmakers, <10% spread — market is very sure about this price
      marketScore = 0.7;
    } else if (marketConfidence === 'high') {
      marketScore = 0.6;
    } else if (marketConfidence === 'medium') {
      marketScore = 0.5;
    } else {
      // Low confidence — few bookmakers or wide spread
      marketScore = 0.4;
    }

    // Price movement signals (from OddsMovementTracker)
    if (movement.isGamble) {
      // 15%+ shortening — serious money, strongest signal
      marketScore = Math.max(marketScore, 0.85);
    } else if (movement.isSteamMove) {
      // 8%+ shortening — steamer, strong signal
      marketScore = Math.max(marketScore, 0.75);
    } else if (priceMovement === 'shortening') {
      // Mild shortening — positive
      marketScore = Math.min(marketScore + 0.1, 0.8);
    } else if (movement.isDrift) {
      // 12%+ drifting — market losing confidence
      marketScore = Math.min(marketScore - 0.2, 0.35);
    } else if (priceMovement === 'drifting') {
      // Mild drift — slight negative
      marketScore = Math.max(marketScore - 0.1, 0.3);
    }

    // Market rank bonus — market favourite gets a boost
    if (marketRank === 1) {
      marketScore = Math.min(marketScore + 0.08, 1.0);
    } else if (marketRank === 2) {
      marketScore = Math.min(marketScore + 0.04, 1.0);
    }

    // Bookmaker count bonus — more bookmakers pricing = more liquid market
    if (bookmakerCount >= 10) {
      marketScore = Math.min(marketScore + 0.05, 1.0);
    }

    factors.marketSupport = Math.round(marketScore * 100) / 100;
    factors.bookmakerCount = bookmakerCount;
    factors.priceMovement = priceMovement;
    factors.marketConfidence = marketConfidence;

    // Use best available bookmaker price as odds
    var bestOdds = baseResult.odds;
    if (bestPrice > 1) {
      bestOdds = bestPrice; // Always use best available price for subscriber value
    }

    // Calculate value edge: how much better is best price vs market average?
    var valueEdge = 0;
    if (bestPrice > 0 && avgPrice > 0) {
      valueEdge = ((bestPrice - avgPrice) / avgPrice) * 100;
    }

    // Re-score with enhanced factors
    var enhancedScoreResult = this.scoreRacing(factors, bestOdds);

    return {
      runner: runner,
      race: race,
      factors: factors,
      odds: bestOdds,
      enhanced: true,
      marketIntelligence: {
        bestPrice: Math.round(bestPrice * 100) / 100,
        bestBookmaker: marketData.bestBookmaker || '',
        averagePrice: Math.round(avgPrice * 100) / 100,
        worstPrice: Math.round((marketData.worstPrice || 0) * 100) / 100,
        priceSpread: Math.round(priceSpread * 100) / 100,
        bookmakerCount: bookmakerCount,
        marketRank: marketRank,
        marketConfidence: marketConfidence,
        valueEdge: Math.round(valueEdge * 10) / 10,
        movement: {
          direction: priceMovement,
          percentChange: movement.percentChange || 0,
          signal: movement.signal || 'neutral',
          signalStrength: movement.signalStrength || 'neutral',
        },
      },
      ...enhancedScoreResult,
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

    // --- Home/Away factor (enhanced with actual home/away records) ---
    var homeAwayScore = 0.6; // default home advantage

    // If we have standings data with home/away splits, use it
    if (fixture.homePosition && fixture.awayPosition) {
      // Team higher in table at home = stronger home advantage
      if (fixture.homePosition <= 6) homeAwayScore = 0.7; // Top 6 at home = strong
      if (fixture.homePosition <= 3) homeAwayScore = 0.75;
      if (fixture.homePosition >= 15) homeAwayScore = 0.45; // Bottom half at home = weak
    }

    // Use actual home/away records if available from standings
    if (fixture.homeRecord) {
      // homeRecord format: "10W 3D 2L" or similar
      var homeWins = parseInt((fixture.homeRecord.match(/(\d+)W/) || [])[1]) || 0;
      var homePlayed = (fixture.homeRecord.match(/\d+/g) || []).reduce(function(s, n) { return s + parseInt(n); }, 0);
      if (homePlayed > 0) {
        var homeWinRate = homeWins / homePlayed;
        homeAwayScore = 0.4 + homeWinRate * 0.4; // Scale 0.4 to 0.8
      }
    }
    if (fixture.awayRecord) {
      var awayWins = parseInt((fixture.awayRecord.match(/(\d+)W/) || [])[1]) || 0;
      var awayPlayed = (fixture.awayRecord.match(/\d+/g) || []).reduce(function(s, n) { return s + parseInt(n); }, 0);
      if (awayPlayed > 0) {
        var awayWinRate = awayWins / awayPlayed;
        // Strong away form reduces home advantage
        if (awayWinRate > 0.5) homeAwayScore -= 0.1;
        if (awayWinRate > 0.6) homeAwayScore -= 0.05;
      }
    }
    homeAwayScore = Math.max(0.3, Math.min(homeAwayScore, 0.85));

    // --- Motivation factor ---
    const motivationScore = 0.5; // neutral

    // --- Schedule congestion factor ---
    const congestionScore = 0.5; // neutral

    // --- Market movement factor ---
    let marketScore = 0.5;
    // If odds are available from multiple bookmakers, check consistency
    const bkCount = Object.keys(bookmakerOdds).length;
    if (bkCount >= 2) marketScore = 0.6; // multiple bookmakers = more reliable pricing

    // --- Market confidence — how tightly bookmakers agree ---
    // Wide spread = uncertain market = easier to find value
    // Tight spread = confident market = harder to beat
    var marketConfidence = 0.5;
    if (bookmakerOdds && Object.keys(bookmakerOdds).length >= 3) {
      var allPrices = [];
      for (var bk in bookmakerOdds) {
        var homePrice = bookmakerOdds[bk][fixture.homeTeam];
        if (homePrice) allPrices.push(homePrice);
      }
      if (allPrices.length >= 3) {
        var maxPrice = Math.max.apply(null, allPrices);
        var minPrice = Math.min.apply(null, allPrices);
        var spread = (maxPrice - minPrice) / minPrice;
        // Wide spread = uncertain market = potential value
        if (spread > 0.15) marketConfidence = 0.7; // 15%+ spread = uncertain
        if (spread > 0.25) marketConfidence = 0.8; // 25%+ spread = very uncertain
        if (spread < 0.05) marketConfidence = 0.3; // <5% spread = very confident market, hard to beat
      }
    }

    // --- In-play performance from recent matches — shots, possession indicate attacking intent ---
    var shotsScore = 0.5;
    if (fixture.homeStats && fixture.homeStats.shots) {
      var homeShotsPerGame = fixture.homeStats.shots.on || 0;
      var awayShotsPerGame = fixture.awayStats ? (fixture.awayStats.shots.on || 0) : 0;
      if (homeShotsPerGame > 5) shotsScore += 0.1; // High shot count = attacking team
      if (awayShotsPerGame > 5) shotsScore += 0.05; // Both teams attacking = goals likely
    }

    // --- Referee factor — strict refs = more goals/cards likely ---
    var refScore = 0.5; // neutral default
    var strictRefs = ['michael oliver', 'anthony taylor', 'paul tierney', 'stuart attwell', 'simon hooper', 'robert jones'];
    var lenientRefs = ['chris kavanagh', 'john brooks', 'darren england'];
    var refName = (fixture._referee || '').toLowerCase();
    if (strictRefs.some(function(r) { return refName.indexOf(r) !== -1; })) refScore = 0.65;
    if (lenientRefs.some(function(r) { return refName.indexOf(r) !== -1; })) refScore = 0.4;

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

    // Apply referee modifier — strict refs boost goals/BTTS markets by 5-10%
    var isGoalsMarket = selectedMarket === 'Over 2.5 Goals' || selectedMarket === 'Both Teams to Score';
    if (isGoalsMarket && refScore > 0.5) {
      var refBoost = (refScore - 0.5) * 0.5; // 0.65 ref => 0.075 boost (~7.5%)
      factors.xG = Math.min(Math.round((factors.xG + refBoost) * 100) / 100, 1.0);
      factors.form = Math.min(Math.round((factors.form + refBoost * 0.5) * 100) / 100, 1.0);
    } else if (isGoalsMarket && refScore < 0.5) {
      var refDampen = (0.5 - refScore) * 0.3; // lenient ref dampens goals expectation
      factors.xG = Math.max(Math.round((factors.xG - refDampen) * 100) / 100, 0.05);
    }

    const scoreResult = this.scoreFootball(factors, selectedOdds);

    // Apply market confidence to edge — wider bookmaker spread = more likely our edge is real
    var adjustedEdge = scoreResult.edge;
    if (marketConfidence > 0.5) {
      adjustedEdge = scoreResult.edge * (1 + (marketConfidence - 0.5) * 0.3); // up to ~9% boost
    } else if (marketConfidence < 0.5) {
      adjustedEdge = scoreResult.edge * (1 - (0.5 - marketConfidence) * 0.2); // up to ~4% reduction
    }

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
      referee: fixture._referee || null,
      marketConfidence: Math.round(marketConfidence * 100) / 100,
      ...scoreResult,
      edge: Math.round(adjustedEdge * 1000) / 1000,
      valueRating: this.getValueRating(adjustedEdge),
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
   * @param {Object} enhancedData.exchangeData — Betfair exchange data (optional)
   * @param {number} enhancedData.exchangeData.tradedVolume — Total GBP matched
   * @param {number} enhancedData.exchangeData.backPrice — Best back price
   * @param {number} enhancedData.exchangeData.layPrice — Best lay price
   * @param {string} enhancedData.exchangeData.priceMovement — 'shortening', 'drifting', 'stable'
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
    var exchangeData = enhancedData.exchangeData || null;

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

    // --- Betfair Exchange Factor ---
    // Real exchange data: traded volume + price movement = professional money signal
    if (exchangeData && exchangeData.tradedVolume > 0) {
      var exVolume = exchangeData.tradedVolume || 0;
      var exMovement = exchangeData.priceMovement || 'stable';
      var exSpread = exchangeData.spread || 0;
      var exBackPrice = exchangeData.backPrice || 0;
      var exSpreadPct = exBackPrice > 0 ? (exSpread / exBackPrice) * 100 : 100;

      var exchangeFactor = 0.5;
      var exHighVolume = exVolume > 10000; // Football markets are typically higher volume
      var exLowVolume = exVolume < 2000;

      if (exHighVolume && exMovement === 'shortening') {
        // Heavy professional money on this outcome — very strong signal
        exchangeFactor = 0.85;
      } else if (exHighVolume && exMovement === 'stable') {
        // Market confident at current price
        exchangeFactor = 0.7;
      } else if (exHighVolume && exMovement === 'drifting') {
        // Volume but price going out — smart money may be on other side
        exchangeFactor = 0.4;
      } else if (exLowVolume && exMovement === 'drifting') {
        // Market not interested
        exchangeFactor = 0.3;
      } else if (exMovement === 'shortening') {
        exchangeFactor = 0.65;
      } else if (exMovement === 'drifting') {
        exchangeFactor = 0.35;
      }

      // Tight spread bonus
      if (exSpreadPct < 2 && exBackPrice > 0) {
        exchangeFactor = Math.min(exchangeFactor + 0.05, 1.0);
      }

      factors.exchangeSupport = Math.round(exchangeFactor * 100) / 100;
      // Also boost/dampen market movement factor based on exchange data alignment
      if (factors.marketMovement && exchangeFactor > 0.6) {
        factors.marketMovement = Math.min(Math.round((factors.marketMovement + 0.1) * 100) / 100, 1.0);
      }
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
        exchangeData: !!(exchangeData && exchangeData.tradedVolume > 0),
      },
      exchangeSummary: exchangeData ? {
        tradedVolume: exchangeData.tradedVolume,
        backPrice: exchangeData.backPrice,
        layPrice: exchangeData.layPrice,
        spread: exchangeData.spread,
        priceMovement: exchangeData.priceMovement,
      } : null,
      ...enhancedScoreResult,
    };
  }

  /**
   * Generate analysis text for an auto-generated tip
   * @param {Object} scored — Scored selection from scoreRunner or scoreFixture
   * @param {string} sport — 'racing' or 'football'
   * @returns {Object} Analysis object matching the tip format
   */
  /**
   * Generate analysis text for a scored candidate.
   * @param {object} scored - Scored candidate
   * @param {string} sport - 'racing' or 'football'
   * @param {object} [enrichment] - Optional Perplexity enrichment signals (grounded).
   *   Racing: {going_update, non_runner, stable_form, headgear_change, jockey_change, course_report, rail_movement}
   *   Football: {team_news, tactical_change, rotation_risk, motivation_context, manager_comments, injury_update}
   *   Each signal is {value: string, citation_index: number}. Woven inline into template fields.
   */
  generateAnalysis(scored, sport, enrichment) {
    if (sport === 'racing') {
      return this._generateRacingAnalysis(scored, enrichment);
    } else if (sport === 'basketball') {
      return this._generateBasketballAnalysis(scored, enrichment);
    } else if (sport === 'rugby') {
      return this._generateRugbyAnalysis(scored, enrichment);
    } else if (sport === 'american-football') {
      return this._generateNFLAnalysis(scored, enrichment);
    } else {
      return this._generateFootballAnalysis(scored, enrichment);
    }
  }

  /**
   * Score an NBA game for a specific market.
   *
   * @param {object} game - Normalised game from basketballData
   * @param {object} homeStats - Team stats for home team
   * @param {object} awayStats - Team stats for away team
   * @param {Array} standings - League standings
   * @param {Array} h2h - Head to head results
   * @param {object} odds - Odds data {home, away, over, under}
   * @returns {object|null} Scored selection
   */
  scoreBasketballGame(game, homeStats, awayStats, standings, h2h, odds) {
    if (!game || !game.homeTeam || !game.awayTeam) return null;

    var factors = {};

    // 1. Form (25%) — recent win/loss record
    var homeForm = homeStats ? (homeStats.wins / Math.max(homeStats.games, 1)) : 0.5;
    var awayForm = awayStats ? (awayStats.wins / Math.max(awayStats.games, 1)) : 0.5;
    factors.form = Math.min(Math.max(homeForm, awayForm), 1.0);

    // 2. Home/Away advantage (15%) — NBA home court is ~60% win rate
    var homeWinPct = homeStats ? (homeStats.wins / Math.max(homeStats.games, 1)) : 0.5;
    factors.homeAway = Math.min(homeWinPct * 1.2, 1.0);

    // 3. Points scored (20%) — offensive strength
    var homePPG = homeStats && homeStats.pointsFor ? parseFloat(homeStats.pointsFor.average) || 105 : 105;
    var awayPPG = awayStats && awayStats.pointsFor ? parseFloat(awayStats.pointsFor.average) || 105 : 105;
    var avgPPG = (homePPG + awayPPG) / 2;
    factors.offence = Math.min(avgPPG / 120, 1.0); // 120 PPG is elite

    // 4. Points allowed (15%) — defensive strength
    var homePA = homeStats && homeStats.pointsAgainst ? parseFloat(homeStats.pointsAgainst.average) || 108 : 108;
    var awayPA = awayStats && awayStats.pointsAgainst ? parseFloat(awayStats.pointsAgainst.average) || 108 : 108;
    factors.defence = Math.min(1 - (Math.min(homePA, awayPA) / 130), 1.0);

    // 5. H2H (10%)
    if (h2h && h2h.length > 0) {
      var homeH2HWins = h2h.filter(function(g) {
        return (g.homeTeam === game.homeTeam && g.homeScore > g.awayScore) ||
               (g.awayTeam === game.homeTeam && g.awayScore > g.homeScore);
      }).length;
      factors.h2h = h2h.length > 0 ? homeH2HWins / h2h.length : 0.5;
    } else {
      factors.h2h = 0.5;
    }

    // 6. Standings position (15%) — conference ranking
    var homeStanding = standings ? standings.find(function(s) { return s.team === game.homeTeam; }) : null;
    var awayStanding = standings ? standings.find(function(s) { return s.team === game.awayTeam; }) : null;
    var homeRank = homeStanding ? homeStanding.winPct : 0.5;
    var awayRank = awayStanding ? awayStanding.winPct : 0.5;
    factors.standings = Math.max(homeRank, awayRank);

    // Weighted composite score
    var weights = { form: 0.25, homeAway: 0.15, offence: 0.20, defence: 0.15, h2h: 0.10, standings: 0.15 };
    var composite = 0;
    for (var key in weights) {
      composite += (factors[key] || 0.5) * weights[key];
    }

    // Determine best market
    var markets = [];
    var expectedTotal = homePPG + awayPPG;

    // Match winner
    if (homeForm > awayForm + 0.1 && homeRank > awayRank) {
      var homeOdds = odds && odds.home ? parseFloat(odds.home) : 0;
      if (homeOdds >= 1.8) {
        var homeImplied = homeOdds > 0 ? 1 / homeOdds : 0.5;
        markets.push({ market: 'Match Winner', selection: game.homeTeam, odds: homeOdds, modelProb: composite, impliedProb: homeImplied });
      }
    } else if (awayForm > homeForm + 0.1) {
      var awayOdds = odds && odds.away ? parseFloat(odds.away) : 0;
      if (awayOdds >= 1.8) {
        var awayImplied = awayOdds > 0 ? 1 / awayOdds : 0.5;
        markets.push({ market: 'Match Winner', selection: game.awayTeam, odds: awayOdds, modelProb: 1 - composite, impliedProb: awayImplied });
      }
    }

    // Over/Under totals
    if (expectedTotal > 220) {
      var overOdds = odds && odds.over ? parseFloat(odds.over) : 0;
      if (overOdds >= 1.8) {
        var overProb = Math.min((expectedTotal - 210) / 30, 0.75);
        var overImplied = overOdds > 0 ? 1 / overOdds : 0.5;
        markets.push({ market: 'Over 220.5 Points', selection: 'Over 220.5', odds: overOdds, modelProb: overProb, impliedProb: overImplied });
      }
    } else if (expectedTotal < 210) {
      var underOdds = odds && odds.under ? parseFloat(odds.under) : 0;
      if (underOdds >= 1.8) {
        var underProb = Math.min((220 - expectedTotal) / 30, 0.75);
        var underImplied = underOdds > 0 ? 1 / underOdds : 0.5;
        markets.push({ market: 'Under 220.5 Points', selection: 'Under 220.5', odds: underOdds, modelProb: underProb, impliedProb: underImplied });
      }
    }

    if (markets.length === 0) return null;

    // Pick market with best edge
    markets.forEach(function(m) {
      m.edge = m.modelProb - m.impliedProb;
    });
    markets.sort(function(a, b) { return b.edge - a.edge; });
    var best = markets[0];

    if (best.edge < 0.02) return null; // Not enough edge

    var confidence = Math.min(Math.round(composite * 10), 10);
    if (confidence < 6) confidence = 6;

    var staking = best.odds < 2.5 ? '1.5 units' : best.odds < 4 ? '1 unit' : '0.75 units';
    var riskLevel = best.odds < 2.5 ? 'Low' : best.odds < 4 ? 'Medium' : 'High';
    var valueRating = best.edge >= 0.10 ? 'Strong' : best.edge >= 0.05 ? 'Fair' : 'Slight';

    return {
      fixture: game,
      selectedMarket: best.market,
      selectedSelection: best.selection,
      selectedOdds: best.odds,
      modelProbability: best.modelProb,
      impliedProbability: best.impliedProb,
      edge: best.edge,
      confidence: confidence,
      valueRating: valueRating,
      staking: staking,
      riskLevel: riskLevel,
      factors: factors,
      homeStats: homeStats,
      awayStats: awayStats,
      expectedTotal: expectedTotal,
    };
  }

  _generateRacingAnalysis(scored, enrichment) {
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
    const sig = enrichment || {};
    // Helper: get trimmed signal value or empty string
    const sv = (key) => sig[key] ? sig[key].value.trim() : '';

    // Build form context — weave stable_form signal if available
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
    if (sig.stable_form) {
      formContext += ' ' + sv('stable_form');
    }

    // Key reason based on top factor
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

    // Going suitability — weave going_update and course_report signals inline
    let goingText = `${going} — ${going.toLowerCase().includes('good') || going.toLowerCase().includes('standard') ? 'conditions should suit based on profile and recent efforts' : 'ground conditions are a slight unknown but form suggests adaptability'}.`;
    if (sig.going_update) {
      goingText = `Official going: ${going}. ${sv('going_update')} Suitability assessment adjusted accordingly.`;
    }
    if (sig.course_report) {
      goingText += ' ' + sv('course_report');
    }

    // Course record — weave rail_movement signal inline
    let courseText = `${formPositions.includes(1) ? 'Proven winner who handles similar tracks' : 'Course form to be established'} — ${meeting} ${distance ? '(' + distance + ')' : ''} should play to strengths.`;
    if (sig.rail_movement) {
      courseText += ' ' + sv('rail_movement');
    }

    // Trainer form — weave jockey_change signal inline
    let trainerText = `${trainer} in ${factors.trainerJockey >= 0.7 ? 'excellent' : factors.trainerJockey >= 0.5 ? 'decent' : 'quiet'} form. ${jockey} takes the ride${factors.trainerJockey >= 0.7 ? ' — a strong booking that adds confidence' : ''}.`;
    if (sig.jockey_change) {
      trainerText += ' Note: ' + sv('jockey_change');
    }

    // Summary — weave non_runner and headgear_change into summary
    let summaryExtra = '';
    if (sig.non_runner) summaryExtra += ' ' + sv('non_runner');
    if (sig.headgear_change) summaryExtra += ' ' + sv('headgear_change');

    return {
      summary: `${horseName} runs in the ${time} at ${meeting} and our model rates this a strong Win opportunity. ${keyReason}. At ${odds.toFixed(2)}, the edge is ${edgePct}% against the market.${summaryExtra}`,
      form: `${formStr}. ${formContext}`,
      goingSuitability: goingText,
      courseRecord: courseText,
      trainerForm: trainerText,
      riskNotes: riskNotes,
    };
  }

  _generateFootballAnalysis(scored, enrichment) {
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
    const sig = enrichment || {};
    const sv = (key) => sig[key] ? sig[key].value.trim() : '';

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
    // Weave motivation_context inline into form text
    if (sig.motivation_context) {
      formText += ' ' + sv('motivation_context');
    }

    const riskNotes = odds < 2
      ? 'Short odds limit the upside but the selection is well-supported. Late team news could impact.'
      : odds < 4
        ? 'Fair-priced selection in a competitive fixture. Key players and tactical matchups could swing it.'
        : 'Bigger price reflects the inherent uncertainty. Consider staking conservatively.';

    // Weave injury_update + team_news into injuries field
    let injuryText = 'Check team news closer to kick-off for any late changes that could affect the selection.';
    if (sig.team_news) {
      injuryText = sv('team_news');
    }
    if (sig.injury_update) {
      injuryText += ' ' + sv('injury_update');
    }

    // Weave tactical_change + rotation_risk into summary extra
    let summaryExtra = '';
    if (sig.tactical_change) summaryExtra += ' ' + sv('tactical_change');
    if (sig.rotation_risk) summaryExtra += ' ' + sv('rotation_risk');

    // Weave manager_comments into H2H field (contextual, not statistical)
    let h2hText = `Recent meetings between ${home} and ${away} have been considered in the model's H2H factor.`;
    if (sig.manager_comments) {
      h2hText += ' ' + sv('manager_comments');
    }

    return {
      summary: `${home} vs ${away} in ${league}. Our model gives ${selection} a ${modelPct}% probability against the market's ${impliedPct}%. ${keyReason}.${summaryExtra}`,
      form: formText,
      xG: `Model analysis based on expected goals and recent attacking/defensive metrics for both sides.`,
      injuries: injuryText,
      headToHead: h2hText,
      riskNotes: riskNotes,
    };
  }
  _generateBasketballAnalysis(scored, enrichment) {
    const fixture = scored.fixture || {};
    const home = fixture.homeTeam || 'Home';
    const away = fixture.awayTeam || 'Away';
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
    const expectedTotal = scored.expectedTotal || 0;
    const homeStats = scored.homeStats || {};
    const awayStats = scored.awayStats || {};
    const sig = enrichment || {};
    const sv = (key) => sig[key] ? sig[key].value.trim() : '';

    let keyReason = '';
    if (factors.offence >= 0.7) keyReason = 'Offensive output is the standout factor';
    else if (factors.form >= 0.7) keyReason = 'Recent form drives this selection';
    else if (factors.standings >= 0.7) keyReason = 'Conference positioning makes the difference';
    else if (factors.homeAway >= 0.7) keyReason = 'Home court advantage is significant here';
    else keyReason = 'Multiple factors align to provide an edge';

    const isMatchWinner = market.toLowerCase().includes('winner');
    const isOver = market.toLowerCase().includes('over');
    const isUnder = market.toLowerCase().includes('under');

    let formText = '';
    const homePPG = homeStats.pointsFor ? parseFloat(homeStats.pointsFor.average) || 0 : 0;
    const awayPPG = awayStats.pointsFor ? parseFloat(awayStats.pointsFor.average) || 0 : 0;
    const homePA = homeStats.pointsAgainst ? parseFloat(homeStats.pointsAgainst.average) || 0 : 0;
    const awayPA = awayStats.pointsAgainst ? parseFloat(awayStats.pointsAgainst.average) || 0 : 0;

    if (isMatchWinner) {
      formText = `${home} averaging ${homePPG.toFixed(1)} PPG, conceding ${homePA.toFixed(1)}. ${away} averaging ${awayPPG.toFixed(1)} PPG, conceding ${awayPA.toFixed(1)}.`;
    } else if (isOver || isUnder) {
      formText = `Combined expected total of ${expectedTotal.toFixed(0)} points. ${home} averaging ${homePPG.toFixed(1)} PPG and ${away} averaging ${awayPPG.toFixed(1)} PPG. ${isOver ? 'Both offences support the over.' : 'Defensive matchup favours the under.'}`;
    } else {
      formText = `${home} and ${away} both bring strong records into this matchup.`;
    }

    if (sig.team_news) formText += ' ' + sv('team_news');

    const riskNotes = odds < 2
      ? 'Short price reflects the favourite status. Main risk is an off night or load management.'
      : odds < 3.5
        ? 'Fair price for a competitive matchup. Rest days and back-to-back scheduling could be a factor.'
        : 'Bigger price carries more risk but the value is clear based on our model.';

    return {
      summary: `${home} vs ${away} in the NBA. Our model gives ${selection} a ${modelPct}% probability against the market's ${impliedPct}%. ${keyReason}. Edge: ${edgePct}%.`,
      form: formText,
      offence: `${home}: ${homePPG.toFixed(1)} PPG | ${away}: ${awayPPG.toFixed(1)} PPG. Combined expected total: ${expectedTotal.toFixed(0)} points.`,
      defence: `${home} conceding ${homePA.toFixed(1)} PPG | ${away} conceding ${awayPA.toFixed(1)} PPG.`,
      headToHead: `Recent meetings between ${home} and ${away} factored into H2H analysis.`,
      riskNotes: riskNotes,
    };
  }

  /**
   * Score a rugby league game.
   * Similar structure to football — form, home/away, H2H, standings.
   */
  scoreRugbyGame(game, homeStats, awayStats, standings, h2h, odds) {
    if (!game || !game.homeTeam || !game.awayTeam) return null;

    var factors = {};

    // 1. Form (25%)
    var homeStanding = standings ? standings.find(function(s) { return s.team === game.homeTeam; }) : null;
    var awayStanding = standings ? standings.find(function(s) { return s.team === game.awayTeam; }) : null;
    var homeWinRate = homeStanding && homeStanding.played > 0 ? homeStanding.wins / homeStanding.played : 0.5;
    var awayWinRate = awayStanding && awayStanding.played > 0 ? awayStanding.wins / awayStanding.played : 0.5;
    factors.form = Math.max(homeWinRate, awayWinRate);

    // 2. Home advantage (20%) — rugby league home advantage is significant
    factors.homeAway = Math.min(homeWinRate * 1.15, 1.0);

    // 3. Standings position (20%)
    var homePos = homeStanding ? homeStanding.position : 8;
    var awayPos = awayStanding ? awayStanding.position : 8;
    factors.standings = Math.min(1 - (Math.min(homePos, awayPos) / 16), 1.0);

    // 4. Points scoring (15%)
    var homePF = homeStanding ? homeStanding.pointsFor : 0;
    var awayPF = awayStanding ? awayStanding.pointsFor : 0;
    var homePlayed = homeStanding ? homeStanding.played : 1;
    var awayPlayed = awayStanding ? awayStanding.played : 1;
    var homePPG = homePlayed > 0 ? homePF / homePlayed : 20;
    var awayPPG = awayPlayed > 0 ? awayPF / awayPlayed : 20;
    factors.offence = Math.min((homePPG + awayPPG) / 60, 1.0);

    // 5. Defence (10%)
    var homePA = homeStanding ? homeStanding.pointsAgainst : 0;
    var awayPA = awayStanding ? awayStanding.pointsAgainst : 0;
    var homePAG = homePlayed > 0 ? homePA / homePlayed : 20;
    var awayPAG = awayPlayed > 0 ? awayPA / awayPlayed : 20;
    factors.defence = Math.min(1 - (Math.min(homePAG, awayPAG) / 40), 1.0);

    // 6. H2H (10%)
    if (h2h && h2h.length > 0) {
      var homeH2HWins = h2h.filter(function(g) {
        return (g.homeTeam === game.homeTeam && g.homeScore > g.awayScore) ||
               (g.awayTeam === game.homeTeam && g.awayScore > g.homeScore);
      }).length;
      factors.h2h = h2h.length > 0 ? homeH2HWins / h2h.length : 0.5;
    } else {
      factors.h2h = 0.5;
    }

    // Weighted composite
    var weights = { form: 0.25, homeAway: 0.20, standings: 0.20, offence: 0.15, defence: 0.10, h2h: 0.10 };
    var composite = 0;
    for (var key in weights) {
      composite += (factors[key] || 0.5) * weights[key];
    }

    // Markets
    var markets = [];
    var expectedTotal = homePPG + awayPPG;

    // Match winner (handicap-adjusted rugby league)
    if (homeWinRate > awayWinRate + 0.1) {
      var homeOdds = odds && odds.home ? parseFloat(odds.home) : 0;
      if (homeOdds >= 1.8) {
        var homeImplied = homeOdds > 0 ? 1 / homeOdds : 0.5;
        markets.push({ market: 'Match Winner', selection: game.homeTeam, odds: homeOdds, modelProb: composite, impliedProb: homeImplied });
      }
    } else if (awayWinRate > homeWinRate + 0.1) {
      var awayOdds = odds && odds.away ? parseFloat(odds.away) : 0;
      if (awayOdds >= 1.8) {
        var awayImplied = awayOdds > 0 ? 1 / awayOdds : 0.5;
        markets.push({ market: 'Match Winner', selection: game.awayTeam, odds: awayOdds, modelProb: 1 - composite, impliedProb: awayImplied });
      }
    }

    // Over/Under total points
    if (expectedTotal > 44) {
      var overOdds = odds && odds.over ? parseFloat(odds.over) : 0;
      if (overOdds >= 1.8) {
        var overProb = Math.min((expectedTotal - 38) / 20, 0.75);
        var overImplied = overOdds > 0 ? 1 / overOdds : 0.5;
        markets.push({ market: 'Over 42.5 Points', selection: 'Over 42.5', odds: overOdds, modelProb: overProb, impliedProb: overImplied });
      }
    } else if (expectedTotal < 38) {
      var underOdds = odds && odds.under ? parseFloat(odds.under) : 0;
      if (underOdds >= 1.8) {
        var underProb = Math.min((44 - expectedTotal) / 20, 0.75);
        var underImplied = underOdds > 0 ? 1 / underOdds : 0.5;
        markets.push({ market: 'Under 42.5 Points', selection: 'Under 42.5', odds: underOdds, modelProb: underProb, impliedProb: underImplied });
      }
    }

    if (markets.length === 0) return null;

    markets.forEach(function(m) { m.edge = m.modelProb - m.impliedProb; });
    markets.sort(function(a, b) { return b.edge - a.edge; });
    var best = markets[0];

    if (best.edge < 0.03) return null;

    var confidence = Math.min(Math.round(composite * 10), 10);
    if (confidence < 6) confidence = 6;

    return {
      fixture: game,
      selectedMarket: best.market,
      selectedSelection: best.selection,
      selectedOdds: best.odds,
      modelProbability: best.modelProb,
      impliedProbability: best.impliedProb,
      edge: best.edge,
      confidence: confidence,
      valueRating: best.edge >= 0.10 ? 'Strong' : best.edge >= 0.05 ? 'Fair' : 'Slight',
      staking: best.odds < 2.5 ? '1.5 units' : best.odds < 4 ? '1 unit' : '0.75 units',
      riskLevel: best.odds < 2.5 ? 'Low' : best.odds < 4 ? 'Medium' : 'High',
      factors: factors,
      expectedTotal: expectedTotal,
    };
  }

  /**
   * Score an NFL game. Spread/totals focused.
   */
  scoreNFLGame(game, standings, h2h, odds) {
    if (!game || !game.homeTeam || !game.awayTeam) return null;

    var factors = {};
    var homeStanding = standings ? standings.find(function(s) { return s.team === game.homeTeam; }) : null;
    var awayStanding = standings ? standings.find(function(s) { return s.team === game.awayTeam; }) : null;

    // 1. Form/Record (25%)
    var homeWinPct = homeStanding ? homeStanding.winPct : 0.5;
    var awayWinPct = awayStanding ? awayStanding.winPct : 0.5;
    factors.form = Math.max(homeWinPct, awayWinPct);

    // 2. Home field (20%) — NFL home advantage ~57%
    factors.homeAway = Math.min(homeWinPct * 1.1, 1.0);

    // 3. Standings (20%)
    var homePos = homeStanding ? homeStanding.position : 16;
    var awayPos = awayStanding ? awayStanding.position : 16;
    factors.standings = Math.min(1 - (Math.min(homePos, awayPos) / 32), 1.0);

    // 4. Scoring (15%)
    var homePlayed = homeStanding ? homeStanding.played : 1;
    var awayPlayed = awayStanding ? awayStanding.played : 1;
    var homePPG = homeStanding && homePlayed > 0 ? homeStanding.pointsFor / homePlayed : 22;
    var awayPPG = awayStanding && awayPlayed > 0 ? awayStanding.pointsFor / awayPlayed : 22;
    factors.offence = Math.min((homePPG + awayPPG) / 55, 1.0);

    // 5. Defence (10%)
    var homePA = homeStanding && homePlayed > 0 ? homeStanding.pointsAgainst / homePlayed : 22;
    var awayPA = awayStanding && awayPlayed > 0 ? awayStanding.pointsAgainst / awayPlayed : 22;
    factors.defence = Math.min(1 - (Math.min(homePA, awayPA) / 35), 1.0);

    // 6. H2H (10%)
    if (h2h && h2h.length > 0) {
      var homeH2HWins = h2h.filter(function(g) {
        return (g.homeTeam === game.homeTeam && g.homeScore > g.awayScore) ||
               (g.awayTeam === game.homeTeam && g.awayScore > g.homeScore);
      }).length;
      factors.h2h = h2h.length > 0 ? homeH2HWins / h2h.length : 0.5;
    } else {
      factors.h2h = 0.5;
    }

    var weights = { form: 0.25, homeAway: 0.20, standings: 0.20, offence: 0.15, defence: 0.10, h2h: 0.10 };
    var composite = 0;
    for (var key in weights) { composite += (factors[key] || 0.5) * weights[key]; }

    var markets = [];
    var expectedTotal = homePPG + awayPPG;

    // Match winner (moneyline)
    if (homeWinPct > awayWinPct + 0.1) {
      var homeOdds = odds && odds.home ? parseFloat(odds.home) : 0;
      if (homeOdds >= 1.8) {
        markets.push({ market: 'Moneyline', selection: game.homeTeam, odds: homeOdds, modelProb: composite, impliedProb: homeOdds > 0 ? 1 / homeOdds : 0.5 });
      }
    } else if (awayWinPct > homeWinPct + 0.1) {
      var awayOdds = odds && odds.away ? parseFloat(odds.away) : 0;
      if (awayOdds >= 1.8) {
        markets.push({ market: 'Moneyline', selection: game.awayTeam, odds: awayOdds, modelProb: 1 - composite, impliedProb: awayOdds > 0 ? 1 / awayOdds : 0.5 });
      }
    }

    // Over/Under total points
    if (expectedTotal > 47) {
      var overOdds = odds && odds.over ? parseFloat(odds.over) : 0;
      if (overOdds >= 1.8) {
        var overProb = Math.min((expectedTotal - 43) / 15, 0.70);
        markets.push({ market: 'Over 45.5 Points', selection: 'Over 45.5', odds: overOdds, modelProb: overProb, impliedProb: overOdds > 0 ? 1 / overOdds : 0.5 });
      }
    } else if (expectedTotal < 41) {
      var underOdds = odds && odds.under ? parseFloat(odds.under) : 0;
      if (underOdds >= 1.8) {
        var underProb = Math.min((47 - expectedTotal) / 15, 0.70);
        markets.push({ market: 'Under 45.5 Points', selection: 'Under 45.5', odds: underOdds, modelProb: underProb, impliedProb: underOdds > 0 ? 1 / underOdds : 0.5 });
      }
    }

    if (markets.length === 0) return null;
    markets.forEach(function(m) { m.edge = m.modelProb - m.impliedProb; });
    markets.sort(function(a, b) { return b.edge - a.edge; });
    var best = markets[0];
    if (best.edge < 0.03) return null;

    var confidence = Math.min(Math.round(composite * 10), 10);
    if (confidence < 6) confidence = 6;

    return {
      fixture: game,
      selectedMarket: best.market,
      selectedSelection: best.selection,
      selectedOdds: best.odds,
      modelProbability: best.modelProb,
      impliedProbability: best.impliedProb,
      edge: best.edge,
      confidence: confidence,
      valueRating: best.edge >= 0.10 ? 'Strong' : best.edge >= 0.05 ? 'Fair' : 'Slight',
      staking: best.odds < 2.5 ? '1.5 units' : '1 unit',
      riskLevel: best.odds < 2.5 ? 'Low' : 'Medium',
      factors: factors,
      expectedTotal: expectedTotal,
    };
  }

  _generateNFLAnalysis(scored, enrichment) {
    const fixture = scored.fixture || {};
    const home = fixture.homeTeam || 'Home';
    const away = fixture.awayTeam || 'Away';
    const market = scored.selectedMarket || 'Market';
    const selection = scored.selectedSelection || 'Selection';
    const odds = scored.selectedOdds || 0;
    const edge = scored.edge || 0;
    const edgePct = (edge * 100).toFixed(1);
    const modelPct = ((scored.modelProbability || 0) * 100).toFixed(0);
    const impliedPct = ((scored.impliedProbability || 0) * 100).toFixed(0);
    const expectedTotal = scored.expectedTotal || 0;
    const factors = scored.factors || {};
    const sig = enrichment || {};
    const sv = (key) => sig[key] ? sig[key].value.trim() : '';

    let keyReason = '';
    if (factors.form >= 0.7) keyReason = 'Season record drives this pick';
    else if (factors.homeAway >= 0.7) keyReason = 'Home field advantage is the key factor';
    else if (factors.standings >= 0.7) keyReason = 'Division standings support the selection';
    else keyReason = 'Balanced edge across multiple factors';

    let formText = market.toLowerCase().includes('moneyline')
      ? `${home} host ${away} in Week ${fixture.week || '?'} of the NFL season. ${keyReason}.`
      : `Combined expected total of ${expectedTotal.toFixed(0)} points. ${home} and ${away} both factor into the ${market.toLowerCase().includes('over') ? 'over' : 'under'} play.`;

    if (sig.team_news) formText += ' ' + sv('team_news');

    return {
      summary: `${home} vs ${away} — NFL. Our model gives ${selection} a ${modelPct}% probability vs the market's ${impliedPct}%. ${keyReason}. Edge: ${edgePct}%.`,
      form: formText,
      standings: 'Division standings and win-loss records factored into the model.',
      headToHead: `Recent matchups between ${home} and ${away} considered.`,
      riskNotes: odds < 2.5 ? 'Favoured selection — main risk is an upset or key injury.' : 'Competitive matchup — line value identified by the model.',
    };
  }

  _generateRugbyAnalysis(scored, enrichment) {
    const fixture = scored.fixture || {};
    const home = fixture.homeTeam || 'Home';
    const away = fixture.awayTeam || 'Away';
    const league = fixture.league || 'Super League';
    const market = scored.selectedMarket || 'Market';
    const selection = scored.selectedSelection || 'Selection';
    const odds = scored.selectedOdds || 0;
    const edge = scored.edge || 0;
    const edgePct = (edge * 100).toFixed(1);
    const modelProb = scored.modelProbability || 0;
    const impliedProb = scored.impliedProbability || 0;
    const modelPct = (modelProb * 100).toFixed(0);
    const impliedPct = (impliedProb * 100).toFixed(0);
    const expectedTotal = scored.expectedTotal || 0;
    const factors = scored.factors || {};
    const sig = enrichment || {};
    const sv = (key) => sig[key] ? sig[key].value.trim() : '';

    let keyReason = '';
    if (factors.form >= 0.7) keyReason = 'Recent form is the standout factor';
    else if (factors.homeAway >= 0.7) keyReason = 'Home advantage is significant in this fixture';
    else if (factors.standings >= 0.7) keyReason = 'League position makes the difference';
    else keyReason = 'Multiple factors align for this selection';

    const isMatchWinner = market.toLowerCase().includes('winner');
    const isOver = market.toLowerCase().includes('over');

    let formText = '';
    if (isMatchWinner) {
      formText = `${home} host ${away} in ${league}. `;
      if (factors.form >= 0.6) formText += `Strong recent form from the selection.`;
      else formText += `Both sides have been competitive this season.`;
    } else if (isOver) {
      formText = `Expected total of ${expectedTotal.toFixed(0)} points based on both teams\' scoring and defensive records. ${home} and ${away} have been involved in high-scoring fixtures.`;
    } else {
      formText = `Defensive matchup expected between ${home} and ${away}. Points could be at a premium.`;
    }

    if (sig.team_news) formText += ' ' + sv('team_news');

    const riskNotes = odds < 2
      ? 'Short price reflects clear favourite status. Key risk: complacency or squad rotation.'
      : odds < 3.5
        ? 'Competitive price for a close fixture. Conditions and team selection could be decisive.'
        : 'Bigger price carries risk but the model identifies value here.';

    return {
      summary: `${home} vs ${away} in ${league}. Our model gives ${selection} a ${modelPct}% probability against the market's ${impliedPct}%. ${keyReason}. Edge: ${edgePct}%.`,
      form: formText,
      standings: `League positions factored in. Both teams\' home/away records and recent results analysed.`,
      headToHead: `Recent meetings between ${home} and ${away} have been considered.`,
      riskNotes: riskNotes,
    };
  }
}

module.exports = new ScoringModel();
