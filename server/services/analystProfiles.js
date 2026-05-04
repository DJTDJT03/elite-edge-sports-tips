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

  clocker: {
    name: 'The Clocker',
    specialty: 'Deep Racing Intelligence',
    description: 'Racing-only specialist. Reads between the lines — trainer intent, equipment changes, pace analysis, stable form.',

    racingWeightModifiers: {
      form: 1.1,
      speedRatings: 1.2,
      class: 1.3,          // +30% class (understands when a horse is being placed to win)
      going: 1.5,          // +50% going (going specialist — knows which horses transform on their preferred surface)
      trainerJockey: 1.5,  // +50% trainer/jockey (reads trainer intent: first-time headgear, booking changes, yard form)
      course: 1.4,         // +40% course (track configuration specialists — left-handed, undulating, stiff finishes)
      draw: 1.3,           // +30% draw (knows which courses have draw bias on specific ground)
      weight: 1.2,         // +20% weight (identifies well-handicapped types)
      marketSupport: 0.5,  // -50% market (often finds value BEFORE the market wakes up)
    },

    // Football: not used — racing only analyst
    footballWeightModifiers: {
      xG: 1.0, form: 1.0, h2h: 1.0, injuries: 1.0, homeAway: 1.0,
      motivation: 1.0, shots: 1.0, scheduleCongestion: 1.0, marketMovement: 1.0,
    },

    preferredMarkets: {
      racing: ['Win', 'Each-Way'],
      football: [],
    },

    // Covers the full odds spectrum — finds value at any price
    oddsRange: { min: 2.0, max: 25.0 },

    aiPromptStyle: 'You are a deep racing analyst. Focus on the details casual punters miss: trainer intent (first-time headgear, equipment changes, stable form over last 14 days, jockey bookings), pace scenario (who makes the running, will the pace suit closers or front-runners), trip suitability (stepping up/down in distance, pedigree for the trip), course configuration (left/right-handed, undulating/flat, stiff/easy finish), and going expertise (which horses have dramatically better form on today\'s ground). Reference specific form figures, trainer strike rates, and course stats. Be authoritative and detailed — this is expert-level analysis that justifies a premium subscription.',
  },

  tactician: {
    name: 'The Tactician',
    specialty: 'Deep Football Intelligence',
    description: 'Football-only specialist. Reads manager intent, tactical setups, motivation, and referee tendencies before the game starts.',

    // Racing: not used — football only analyst
    racingWeightModifiers: {
      form: 1.0, speedRatings: 1.0, class: 1.0, going: 1.0, trainerJockey: 1.0,
      course: 1.0, draw: 1.0, weight: 1.0, marketSupport: 1.0,
    },

    footballWeightModifiers: {
      xG: 1.4,               // +40% xG (deep shot quality analysis, not just the headline number)
      form: 1.1,
      h2h: 1.3,              // +30% H2H (historical patterns between these exact teams)
      injuries: 1.5,          // +50% injuries (key player absence is the biggest market inefficiency)
      homeAway: 1.3,          // +30% home/away (fortress records, poor travellers)
      motivation: 1.5,        // +50% motivation (relegation battles, title deciders, dead rubbers)
      shots: 1.2,             // +20% shots (chance creation quality)
      scheduleCongestion: 1.4, // +40% congestion (midweek European sides, rotation risk)
      marketMovement: 0.5,    // -50% market (finds value before the market adjusts)
    },

    preferredMarkets: {
      racing: [],
      football: ['Match Result', 'Both Teams to Score', 'Over/Under', 'Asian Handicap'],
    },

    oddsRange: { min: 1.5, max: 12.0 },

    aiPromptStyle: 'You are a deep football analyst. Focus on tactical and contextual angles the casual punter misses: manager press conference quotes and team news, expected lineup and formation changes, injury/suspension impact on team structure (not just quality), fixture congestion and rotation risk, motivation context (what is at stake for each side), referee tendencies (cards per game, penalties awarded), head-to-head tactical patterns, and xG quality (shot locations, big chances, not just volume). Reference specific stats, quotes, and tactical setups. Be authoritative — this is expert-level preview analysis.',
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
  var runner = scored.runner || {};

  // THE CLOCKER — racing-only deep intelligence specialist
  // Gets assignments when trainer intent or course/going expertise is the key angle
  if (sport === 'racing') {
    // First-time headgear / equipment change — trainer is making a deliberate move
    var headgear = runner.headgear || '';
    var hasEquipmentChange = headgear && (headgear.indexOf('1') !== -1 || headgear.indexOf('first') !== -1);
    if (hasEquipmentChange) return 'clocker';

    // Going specialist — horse has dramatically better form on today's ground
    if (factors.going && factors.going >= 0.85) return 'clocker';

    // Course specialist with strong course form
    if (factors.course && factors.course >= 0.8 && factors.trainerJockey && factors.trainerJockey >= 0.7) return 'clocker';

    // Well-handicapped + trainer/jockey booking signals intent
    if (factors.weight && factors.weight >= 0.75 && factors.class && factors.class >= 0.7) return 'clocker';

    // Strong draw bias play (specific courses where draw is crucial)
    if (factors.draw && factors.draw >= 0.85) return 'clocker';
  }

  // THE TACTICIAN — football-only deep intelligence specialist
  if (sport === 'football') {
    // Injury-driven plays — key player absence changes the market
    if (factors.injuries && factors.injuries >= 0.8) return 'tactician';

    // Motivation plays — relegation, title, derby, nothing to play for
    if (factors.motivation && factors.motivation >= 0.75) return 'tactician';

    // Schedule congestion — midweek European sides, rotation risk
    if (factors.scheduleCongestion && factors.scheduleCongestion >= 0.8) return 'tactician';

    // Strong xG + H2H combination — tactical pattern play
    if (factors.xG && factors.xG >= 0.75 && factors.h2h && factors.h2h >= 0.65) return 'tactician';

    // Home/away specialist — fortress record or terrible travellers
    if (factors.homeAway && factors.homeAway >= 0.85) return 'tactician';
  }

  // The Scout gets big-price value plays and class droppers
  if (odds >= 5.0) return 'scout';
  if (factors.class && factors.class >= 0.8 && odds >= 3.0) return 'scout';

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
