/**
 * Perplexity Sonar — Citation Grounding Filter (PURE)
 *
 * No DB, no API calls, no side effects.
 * All functions: (input) -> output.
 *
 * Rules (updated per user feedback):
 *   - Zero citations in entire response -> lowQuality: true (store all signals for quality loop)
 *   - Specific signal without supporting citation -> drop that signal only
 *   - Citation from domain not in allowlist -> drop that citation (and any signal depending on it)
 *   - If >50% of signals dropped -> lowQuality: true
 */

'use strict';

var config = require('./config');

// ---------------------------------------------------------------------------
// Domain matching
// ---------------------------------------------------------------------------

/**
 * Check if a URL's domain is in the allowlist for a sport.
 * @param {string} url
 * @param {string} sport - 'racing' or 'football'
 * @returns {boolean}
 */
function isDomainAllowed(url, sport) {
  if (!url || typeof url !== 'string') return false;

  var hostname;
  try {
    // Extract hostname from URL
    var match = url.match(/^https?:\/\/(?:www\.)?([^\/\?#]+)/i);
    hostname = match ? match[1].toLowerCase() : '';
  } catch (e) {
    return false;
  }
  if (!hostname) return false;

  var domains = sport === 'racing' ? config.RACING_DOMAINS : config.FOOTBALL_DOMAINS;
  var wildcards = sport === 'racing' ? config.RACING_WILDCARD_PATTERNS : config.FOOTBALL_WILDCARD_PATTERNS;

  // Exact domain match (allows subdomain matching: 'bbc.co.uk/sport' matches 'bbc.co.uk/sport/football')
  for (var i = 0; i < domains.length; i++) {
    var domain = domains[i].toLowerCase();
    // If domain contains a path (e.g. 'bbc.co.uk/sport'), check hostname + first path segment
    if (domain.indexOf('/') !== -1) {
      var domainParts = domain.split('/');
      var domainHost = domainParts[0];
      var domainPath = '/' + domainParts.slice(1).join('/');
      if ((hostname === domainHost || hostname.indexOf('.' + domainHost) !== -1) &&
          url.toLowerCase().indexOf(domainPath) !== -1) {
        return true;
      }
    } else {
      if (hostname === domain || hostname.indexOf('.' + domain) !== -1) {
        return true;
      }
    }
  }

  // Wildcard patterns
  for (var w = 0; w < wildcards.length; w++) {
    if (wildcards[w].test(hostname)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Citation filtering
// ---------------------------------------------------------------------------

/**
 * Filter citations against the domain allowlist.
 *
 * @param {Array} citations - [{url: string, text?: string, index?: number}]
 * @param {string} sport - 'racing' | 'football'
 * @returns {{valid: Array, dropped: Array}}
 *   valid: citations with allowed domains (original index preserved)
 *   dropped: citations with disallowed domains + reason
 */
function filterCitations(citations, sport) {
  var valid = [];
  var dropped = [];

  if (!Array.isArray(citations)) return { valid: [], dropped: [] };

  for (var i = 0; i < citations.length; i++) {
    var c = citations[i];
    if (!c || !c.url) {
      dropped.push({ index: i, url: null, reason: 'missing_url' });
      continue;
    }
    if (isDomainAllowed(c.url, sport)) {
      valid.push({ index: i, url: c.url, text: c.text || '' });
    } else {
      dropped.push({ index: i, url: c.url, reason: 'domain_not_allowed' });
    }
  }

  return { valid: valid, dropped: dropped };
}

// ---------------------------------------------------------------------------
// Signal grounding
// ---------------------------------------------------------------------------

/**
 * Ground extracted signals against valid citations.
 * Signals with citation_index pointing to a dropped/missing citation are dropped.
 * Signals with citation_index = null are dropped (ungrounded).
 *
 * @param {object} signals - {key: {value, citation_index}}
 * @param {Array} validCitations - from filterCitations().valid
 * @returns {{grounded: object, dropped: Array}}
 *   grounded: signals that have a valid citation backing them
 *   dropped: [{key, value, reason}]
 */
function groundSignals(signals, validCitations) {
  var grounded = {};
  var dropped = [];

  if (!signals || typeof signals !== 'object') return { grounded: {}, dropped: [] };

  var validIndexes = {};
  for (var v = 0; v < validCitations.length; v++) {
    validIndexes[validCitations[v].index] = true;
  }

  var keys = Object.keys(signals);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var sig = signals[key];
    if (!sig || !sig.value) {
      dropped.push({ key: key, value: '', reason: 'empty_value' });
      continue;
    }
    if (sig.citation_index === null || sig.citation_index === undefined) {
      dropped.push({ key: key, value: sig.value, reason: 'no_citation' });
      continue;
    }
    if (!validIndexes[sig.citation_index]) {
      dropped.push({ key: key, value: sig.value, reason: 'citation_dropped' });
      continue;
    }
    grounded[key] = sig;
  }

  return { grounded: grounded, dropped: dropped };
}

// ---------------------------------------------------------------------------
// Quality assessment
// ---------------------------------------------------------------------------

/**
 * Determine enrichment quality level.
 *
 * @param {object} params
 * @param {number} params.totalSignals - signals before grounding
 * @param {number} params.groundedCount - signals that survived grounding
 * @param {number} params.droppedCount - signals dropped during grounding
 * @param {number} params.validCitationCount - citations that passed domain filter
 * @param {number} params.totalCitations - citations before filtering
 * @returns {{lowQuality: boolean, reason: string|null}}
 */
function assessQuality(params) {
  var total = params.totalSignals || 0;
  var grounded = params.groundedCount || 0;
  var validCitations = params.validCitationCount || 0;
  var totalCitations = params.totalCitations || 0;

  // Zero citations in entire response -> low quality
  if (totalCitations === 0) {
    return { lowQuality: true, reason: 'zero_citations_in_response' };
  }

  // All citations filtered out (paywalled/disallowed domains only)
  if (totalCitations > 0 && validCitations === 0) {
    return { lowQuality: true, reason: 'all_citations_disallowed' };
  }

  // No signals extracted at all
  if (total === 0) {
    return { lowQuality: true, reason: 'no_signals_extracted' };
  }

  // >50% of signals dropped
  if (total > 0 && grounded < total * 0.5) {
    return { lowQuality: true, reason: 'majority_signals_dropped' };
  }

  return { lowQuality: false, reason: null };
}

module.exports = {
  isDomainAllowed: isDomainAllowed,
  filterCitations: filterCitations,
  groundSignals: groundSignals,
  assessQuality: assessQuality,
};
