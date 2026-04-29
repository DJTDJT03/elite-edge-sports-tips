/**
 * Perplexity Sonar — Signal Schema Validators (PURE)
 *
 * No DB, no API calls, no side effects.
 * Validates and extracts structured signals from Sonar response content.
 * Unknown fields are silently dropped (forward-compatible).
 * Each present field must be {value: string, citation_index: number|null}.
 */

'use strict';

// ---------------------------------------------------------------------------
// Known signal keys per sport
// ---------------------------------------------------------------------------
var RACING_SIGNALS = [
  'going_update',
  'non_runner',
  'stable_form',
  'headgear_change',
  'trainer_booking_change',
  'course_report',
  'rail_movement',
];

var FOOTBALL_SIGNALS = [
  'team_news',
  'tactical_change',
  'rotation_risk',
  'motivation_context',
  'manager_comments',
  'injury_update',
];

// ---------------------------------------------------------------------------
// Validate a single signal field
// ---------------------------------------------------------------------------
function isValidSignalField(field) {
  if (!field || typeof field !== 'object') return false;
  if (typeof field.value !== 'string' || field.value.length === 0) return false;
  if (field.value.length > 500) return false; // sanity cap
  if (field.citation_index !== null && field.citation_index !== undefined &&
      typeof field.citation_index !== 'number') return false;
  return true;
}

/**
 * Validate and extract structured signals from parsed Sonar response.
 *
 * @param {object} raw - Parsed JSON object from Sonar response content
 * @param {string} sport - 'racing' or 'football'
 * @returns {{signals: object, valid: boolean, errors: string[]}}
 *   signals: only known, valid fields (others dropped)
 *   valid: true if at least one signal extracted without error
 *   errors: list of validation issues (for logging/debugging)
 */
function extractSignals(raw, sport) {
  var errors = [];
  var signals = {};

  if (!raw || typeof raw !== 'object') {
    return { signals: {}, valid: false, errors: ['Response is not an object'] };
  }

  // If Sonar wraps signals inside a 'signals' key, unwrap it
  var source = raw.signals && typeof raw.signals === 'object' ? raw.signals : raw;

  var allowedKeys = sport === 'racing' ? RACING_SIGNALS : FOOTBALL_SIGNALS;

  for (var i = 0; i < allowedKeys.length; i++) {
    var key = allowedKeys[i];
    if (source[key] === undefined || source[key] === null) continue;

    if (isValidSignalField(source[key])) {
      signals[key] = {
        value: String(source[key].value).trim(),
        citation_index: (typeof source[key].citation_index === 'number')
          ? source[key].citation_index : null,
      };
    } else if (typeof source[key] === 'string' && source[key].length > 0) {
      // Tolerate plain string values (no citation_index) — treat as ungrounded
      signals[key] = { value: source[key].trim(), citation_index: null };
      errors.push(key + ': plain string, no citation_index');
    } else {
      errors.push(key + ': invalid shape');
    }
  }

  // Count unknown keys for logging
  var sourceKeys = Object.keys(source);
  for (var j = 0; j < sourceKeys.length; j++) {
    if (allowedKeys.indexOf(sourceKeys[j]) === -1 && sourceKeys[j] !== 'summary') {
      errors.push('unknown key dropped: ' + sourceKeys[j]);
    }
  }

  return {
    signals: signals,
    valid: Object.keys(signals).length > 0,
    errors: errors,
  };
}

module.exports = {
  extractSignals: extractSignals,
  RACING_SIGNALS: RACING_SIGNALS,
  FOOTBALL_SIGNALS: FOOTBALL_SIGNALS,
};
