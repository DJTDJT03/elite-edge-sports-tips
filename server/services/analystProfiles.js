/**
 * Elite Edge Analyst Profiles
 * Each analyst has a distinct approach, weighting preferences, and analysis style.
 */

var profiles = {
  professor: {
    name: 'The Professor',
    specialty: 'Data-Driven Analysis',
    description: 'Statistics-first approach. Trusts the numbers over narrative.',

    // Racing: weights form and speed ratings higher, cares less about market support
    racingWeightModifiers: {
      form: 1.3,        // +30% weight on form
      speedRatings: 1.4, // +40% weight on speed/OR
      class: 1.2,        // +20% weight on class
      going: 1.0,
      trainerJockey: 0.8, // -20% on trainer/jockey (data > reputation)
      course: 1.0,
      draw: 1.1,
      weight: 1.0,
      marketSupport: 0.7, // -30% on market (contrarian — finds value the market misses)
    },

    // Football: weights xG and shots highest
    footballWeightModifiers: {
      xG: 1.4,            // +40% on xG (his core metric)
      form: 1.0,
      h2h: 0.8,
      injuries: 1.2,
      homeAway: 0.9,
      motivation: 0.7,
      shots: 1.3,          // +30% on shots data
      scheduleCongestion: 1.1,
      marketMovement: 0.8,
    },

    // Preferred markets
    preferredMarkets: {
      racing: ['Win'],
      football: ['Match Result', 'Over 2.5 Goals'],
    },

    // Odds range preference (prefers shorter, more reliable)
    oddsRange: { min: 1.5, max: 5.0 },

    // AI analysis prompt addition
    aiPromptStyle: 'Focus heavily on statistical evidence: xG, shots on target, speed ratings, form figures. Reference specific numbers. Be clinical and precise. Avoid emotional language.',
  },

  scout: {
    name: 'The Scout',
    specialty: 'Value Hunter',
    description: 'Finds overlooked value at bigger prices. Eyes for an outsider.',

    racingWeightModifiers: {
      form: 0.9,
      speedRatings: 0.8,
      class: 1.3,         // +30% class (loves class droppers)
      going: 1.3,         // +30% going (specialist knowledge)
      trainerJockey: 1.2,  // trainer/jockey combos at bigger prices
      course: 1.4,         // +40% course form (track specialists)
      draw: 0.9,
      weight: 1.1,
      marketSupport: 0.6,  // -40% market (actively goes against the crowd)
    },

    footballWeightModifiers: {
      xG: 0.8,
      form: 1.2,
      h2h: 1.3,           // +30% H2H (historical patterns)
      injuries: 1.3,       // +30% injuries (spots when key player absence is underpriced)
      homeAway: 1.2,
      motivation: 1.4,     // +40% motivation (relegation battles, cup finals)
      shots: 0.8,
      scheduleCongestion: 1.3,
      marketMovement: 0.7,
    },

    preferredMarkets: {
      racing: ['Win', 'Each-Way'],
      football: ['Both Teams to Score', 'Double Chance'],
    },

    oddsRange: { min: 3.0, max: 20.0 },

    aiPromptStyle: 'Focus on value and angles the market has missed: class drops, course specialists, motivation, injuries, trainer intent. Be bold and opinionated. Explain WHY the price is wrong.',
  },

  edge: {
    name: 'The Edge',
    specialty: 'Balanced Analysis',
    description: 'Weighs all factors equally. Looks for the clearest overall edge.',

    racingWeightModifiers: {
      form: 1.0,
      speedRatings: 1.0,
      class: 1.0,
      going: 1.0,
      trainerJockey: 1.0,
      course: 1.0,
      draw: 1.0,
      weight: 1.0,
      marketSupport: 1.0,
    },

    footballWeightModifiers: {
      xG: 1.0,
      form: 1.0,
      h2h: 1.0,
      injuries: 1.0,
      homeAway: 1.0,
      motivation: 1.0,
      shots: 1.0,
      scheduleCongestion: 1.0,
      marketMovement: 1.0,
    },

    preferredMarkets: {
      racing: ['Win', 'Each-Way'],
      football: ['Match Result', 'Over 2.5 Goals', 'Both Teams to Score'],
    },

    oddsRange: { min: 2.0, max: 10.0 },

    aiPromptStyle: 'Balanced assessment considering all angles. Weigh up pros and cons fairly. Give a clear verdict with reasoning. Practical and measured tone.',
  },
};

/**
 * Apply analyst weight modifiers to a set of scored factors.
 * Returns adjusted factors with the analyst's bias applied.
 */
function applyAnalystWeights(factors, analyst, sport) {
  var profile = profiles[analyst] || profiles.edge;
  var modifiers = sport === 'racing' ? profile.racingWeightModifiers : profile.footballWeightModifiers;
  var adjusted = {};
  for (var key in factors) {
    var mod = modifiers[key] || 1.0;
    adjusted[key] = Math.min(Math.round(factors[key] * mod * 100) / 100, 1.0);
  }
  return adjusted;
}

/**
 * Determine which analyst is best suited for a selection
 * based on the characteristics of the tip.
 */
function assignAnalyst(scored, sport) {
  var odds = scored.odds || 3.0;
  var edge = scored.edge || 0;
  var factors = scored.factors || {};

  // The Scout gets big-price value plays and class droppers
  if (odds >= 5.0) return 'scout';
  if (factors.class && factors.class >= 0.8 && odds >= 3.0) return 'scout'; // class dropper
  if (sport === 'football' && factors.motivation && factors.motivation >= 0.7) return 'scout'; // motivation play

  // The Professor gets data-strong, shorter-priced selections
  if (odds <= 3.0 && factors.form && factors.form >= 0.7) return 'professor';
  if (sport === 'football' && factors.xG && factors.xG >= 0.7) return 'professor'; // strong xG
  if (factors.speedRatings && factors.speedRatings >= 0.7 && odds <= 4.0) return 'professor';

  // The Edge gets everything else — balanced middle-ground plays
  return 'edge';
}

/**
 * Get the AI prompt style for an analyst
 */
function getAnalystPromptStyle(analyst) {
  var profile = profiles[analyst] || profiles.edge;
  return profile.aiPromptStyle;
}

module.exports = {
  profiles: profiles,
  applyAnalystWeights: applyAnalystWeights,
  assignAnalyst: assignAnalyst,
  getAnalystPromptStyle: getAnalystPromptStyle,
};
