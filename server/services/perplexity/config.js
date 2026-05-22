/**
 * Perplexity Sonar — Configuration constants
 *
 * Pricing (as of April 2026, docs.perplexity.ai):
 *   Sonar:     $1/$1 per 1M tokens + $5-$12 per 1K requests (by context size)
 *   Sonar Pro: $3/$15 per 1M tokens + $6-$14 per 1K requests
 *
 * We use sonar (not pro) for all three call sites.
 */

'use strict';

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
var API_ENDPOINT = 'https://api.perplexity.ai/chat/completions';
var DEFAULT_MODEL = 'sonar';
var TIMEOUT_MS = 8000;
var MAX_RETRIES = 2; // total attempts = MAX_RETRIES + 1 = 3

// ---------------------------------------------------------------------------
// Stale claim threshold: (timeout * (retries + 1)) + 5s, minimum 30s
// ---------------------------------------------------------------------------
var STALE_THRESHOLD_MS = Math.max((TIMEOUT_MS * (MAX_RETRIES + 1)) + 5000, 30000);

// ---------------------------------------------------------------------------
// Latency budget — hard cutoff for parallel enrichment batch
// ---------------------------------------------------------------------------
var ENRICHMENT_BUDGET_MS = 30000; // 30s budget — allows deeper research per tip

// ---------------------------------------------------------------------------
// Cost rates (Sonar model, per-token)
// ---------------------------------------------------------------------------
var COST_PER_M_INPUT = 1.0;   // $1 per 1M input tokens
var COST_PER_M_OUTPUT = 1.0;  // $1 per 1M output tokens
// Request fee varies by context size; we read it from the response when available.
// Fallback estimate for budgeting: $0.005 per request (low context).
var DEFAULT_REQUEST_FEE = 0.005;

// ---------------------------------------------------------------------------
// Spend caps
// ---------------------------------------------------------------------------
var DAILY_CAP_USD = 10.00;  // Pro plan — room for 100+ searches/day
var PER_TIP_CAP_USD = 0.50; // Allow deep multi-signal research per tip

// ---------------------------------------------------------------------------
// Suppression — derived from ledger, not stored separately
// ---------------------------------------------------------------------------
var SUPPRESSION_WINDOW_MINUTES = 30;
var SUPPRESSION_FAILURE_THRESHOLD = 3;   // consecutive failures to suppress
var SUPPRESSION_RATE_LIMIT_THRESHOLD = 3; // rate limits in window to suppress

// ---------------------------------------------------------------------------
// Cache TTLs (seconds) by volatility class
// ---------------------------------------------------------------------------
var TTL_HIGH = 1800;      // 30 min — going updates, non-runners, team news
var TTL_MEDIUM = 21600;   // 6 hours — stable form, trainer streaks
var TTL_LOW = 86400;      // 24 hours — course characteristics, H2H history

// ---------------------------------------------------------------------------
// Citation domain allowlists
// ---------------------------------------------------------------------------
var RACING_DOMAINS = [
  'racingpost.com',
  'sportinglife.com',
  'attheraces.com',
  'britishhorseracing.com',
  'racinguk.com',
  'skysports.com/racing',
  'bbc.co.uk/sport/horse-racing',
];

// Racecourse official sites (wildcard match: *.racecourse.co.uk)
var RACING_WILDCARD_PATTERNS = [
  /\.racecourse\.co\.uk$/i,
];

var FOOTBALL_DOMAINS = [
  'bbc.co.uk/sport',
  'skysports.com',
  'guardian.com/football',
  'telegraph.co.uk/football',
  'transfermarkt.com',
  'premierleague.com',
  'efl.com',
  'flashscore.com',
  'whoscored.com',
  'soccerway.com',
];

var FOOTBALL_WILDCARD_PATTERNS = [];

// ---------------------------------------------------------------------------
// Token budgets per call site
// ---------------------------------------------------------------------------
var TOKEN_BUDGET = {
  'per-tip-racing':   { maxInput: 800, maxOutput: 800 },
  'per-tip-clocker':    { maxInput: 1000, maxOutput: 1200 },  // Larger budget for deep research
  'per-tip-tactician': { maxInput: 1000, maxOutput: 1200 },  // Larger budget for deep research
  'per-tip-worldcup':  { maxInput: 1200, maxOutput: 1500 },  // World Cup deep preview — 12 signals
  'per-tip-football':  { maxInput: 800, maxOutput: 600 },
  'bulletin':         { maxInput: 1000, maxOutput: 800 },
  'replay':           { maxInput: 600, maxOutput: 500 },
  'odds-explainer':   { maxInput: 600, maxOutput: 300 },
};

// Temperature per call site: 0 for structured JSON, 0.3 for prose
var TEMPERATURE = {
  'per-tip-racing':   0,
  'per-tip-clocker':    0,
  'per-tip-tactician': 0,
  'per-tip-worldcup':  0,
  'per-tip-football':  0,
  'bulletin':         0.3,
  'replay':           0.3,
  'odds-explainer':   0.3,
};

module.exports = {
  API_ENDPOINT: API_ENDPOINT,
  DEFAULT_MODEL: DEFAULT_MODEL,
  TIMEOUT_MS: TIMEOUT_MS,
  MAX_RETRIES: MAX_RETRIES,
  STALE_THRESHOLD_MS: STALE_THRESHOLD_MS,
  ENRICHMENT_BUDGET_MS: ENRICHMENT_BUDGET_MS,
  COST_PER_M_INPUT: COST_PER_M_INPUT,
  COST_PER_M_OUTPUT: COST_PER_M_OUTPUT,
  DEFAULT_REQUEST_FEE: DEFAULT_REQUEST_FEE,
  DAILY_CAP_USD: DAILY_CAP_USD,
  PER_TIP_CAP_USD: PER_TIP_CAP_USD,
  SUPPRESSION_WINDOW_MINUTES: SUPPRESSION_WINDOW_MINUTES,
  SUPPRESSION_FAILURE_THRESHOLD: SUPPRESSION_FAILURE_THRESHOLD,
  SUPPRESSION_RATE_LIMIT_THRESHOLD: SUPPRESSION_RATE_LIMIT_THRESHOLD,
  TTL_HIGH: TTL_HIGH,
  TTL_MEDIUM: TTL_MEDIUM,
  TTL_LOW: TTL_LOW,
  RACING_DOMAINS: RACING_DOMAINS,
  RACING_WILDCARD_PATTERNS: RACING_WILDCARD_PATTERNS,
  FOOTBALL_DOMAINS: FOOTBALL_DOMAINS,
  FOOTBALL_WILDCARD_PATTERNS: FOOTBALL_WILDCARD_PATTERNS,
  TOKEN_BUDGET: TOKEN_BUDGET,
  TEMPERATURE: TEMPERATURE,
};
