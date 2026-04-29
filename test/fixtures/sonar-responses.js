/**
 * Test fixtures for Sonar response processing.
 * Used by citationFilter and signalSchema tests.
 */
'use strict';

// 1. SUCCESS — 3 signals, 3 valid citations from allowed domains
exports.success = {
  content: {
    signals: {
      going_update: { value: 'Going changed to Good to Soft after overnight rain', citation_index: 0 },
      stable_form: { value: 'Trainer has 3 winners from last 8 runners this week', citation_index: 1 },
      non_runner: { value: 'Market leader withdrawn, reshuffles top of market', citation_index: 2 },
    },
  },
  citations: [
    'https://www.racingpost.com/news/going-update-newbury',
    'https://www.sportinglife.com/racing/trainer-form',
    'https://www.attheraces.com/non-runners-today',
  ],
};

// 2. ZERO CITATIONS — 2 signals but no citations at all
exports.zeroCitations = {
  content: {
    signals: {
      going_update: { value: 'Reportedly riding softer than official going', citation_index: null },
      headgear_change: { value: 'First-time cheekpieces applied', citation_index: null },
    },
  },
  citations: [],
};

// 3. PAYWALL ONLY — 2 signals citing only paywalled/disallowed domains
exports.paywallOnly = {
  content: {
    signals: {
      stable_form: { value: 'Yard in excellent form', citation_index: 0 },
      trainer_booking_change: { value: 'Top jockey booked late', citation_index: 1 },
    },
  },
  citations: [
    'https://www.timeform.com/horse-racing/premium-content',
    'https://www.theathletic.com/racing-insider',
  ],
};

// 4. HALLUCINATED DOMAIN — 1 signal citing a completely fake domain
exports.hallucinatedDomain = {
  content: {
    signals: {
      going_update: { value: 'Track waterlogged', citation_index: 0 },
    },
  },
  citations: [
    'https://www.fakebettingtips.xyz/secret-intel',
  ],
};

// 5. PARTIAL EXTRACTION — 4 signals, 2 with valid citations, 2 without
exports.partialExtraction = {
  content: {
    signals: {
      going_update: { value: 'Good to Firm officially, but course reports suggest softer', citation_index: 0 },
      stable_form: { value: 'Trainer 5 from 12 this month', citation_index: 1 },
      headgear_change: { value: 'First-time blinkers', citation_index: null },
      rail_movement: { value: 'Fresh rail, far side bias expected', citation_index: null },
    },
  },
  citations: [
    'https://www.racingpost.com/going-reports',
    'https://www.sportinglife.com/racing/stats',
  ],
};

// 6. GARBAGE RESPONSE — not valid JSON / wrong shape entirely
exports.garbageResponse = {
  content: 'I could not find any relevant information about this race.',
  citations: [],
};

// 7. FOOTBALL SUCCESS — valid football signals
exports.footballSuccess = {
  content: {
    signals: {
      team_news: { value: 'Key striker ruled out with hamstring injury', citation_index: 0 },
      rotation_risk: { value: 'Manager confirmed rotation for midweek cup game', citation_index: 1 },
      motivation_context: { value: 'Must-win for relegation survival', citation_index: 0 },
    },
  },
  citations: [
    'https://www.bbc.co.uk/sport/football/team-news-arsenal',
    'https://www.skysports.com/football/news/rotation-preview',
  ],
};

// 8. MIXED DOMAINS — some valid, some not
exports.mixedDomains = {
  content: {
    signals: {
      team_news: { value: 'Lineup confirmed', citation_index: 0 },
      tactical_change: { value: 'Switching to 3-5-2', citation_index: 1 },
      injury_update: { value: 'Midfielder back in training', citation_index: 2 },
    },
  },
  citations: [
    'https://www.bbc.co.uk/sport/football/lineups',
    'https://www.randomtipster.com/tactics',
    'https://www.skysports.com/football/injury-news',
  ],
};
