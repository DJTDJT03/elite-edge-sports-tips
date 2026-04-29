'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var filter = require('../server/services/perplexity/citationFilter');
var fixtures = require('./fixtures/sonar-responses');

// =========================================================================
// isDomainAllowed
// =========================================================================

test('isDomainAllowed — racing allowed domains', function() {
  assert.equal(filter.isDomainAllowed('https://www.racingpost.com/news/article', 'racing'), true);
  assert.equal(filter.isDomainAllowed('https://www.sportinglife.com/racing/tips', 'racing'), true);
  assert.equal(filter.isDomainAllowed('https://www.attheraces.com/live', 'racing'), true);
  assert.equal(filter.isDomainAllowed('https://www.britishhorseracing.com/rules', 'racing'), true);
  assert.equal(filter.isDomainAllowed('https://www.bbc.co.uk/sport/horse-racing/article', 'racing'), true);
});

test('isDomainAllowed — racing disallowed domains', function() {
  assert.equal(filter.isDomainAllowed('https://www.timeform.com/premium', 'racing'), false);
  assert.equal(filter.isDomainAllowed('https://www.theathletic.com/racing', 'racing'), false);
  assert.equal(filter.isDomainAllowed('https://www.fakebettingtips.xyz/tips', 'racing'), false);
  assert.equal(filter.isDomainAllowed('https://www.google.com', 'racing'), false);
});

test('isDomainAllowed — football allowed domains', function() {
  assert.equal(filter.isDomainAllowed('https://www.bbc.co.uk/sport/football/article', 'football'), true);
  assert.equal(filter.isDomainAllowed('https://www.skysports.com/football/news', 'football'), true);
  assert.equal(filter.isDomainAllowed('https://www.guardian.com/football/match-preview', 'football'), true);
  assert.equal(filter.isDomainAllowed('https://www.premierleague.com/news', 'football'), true);
  assert.equal(filter.isDomainAllowed('https://www.transfermarkt.com/player', 'football'), true);
});

test('isDomainAllowed — football disallowed domains', function() {
  assert.equal(filter.isDomainAllowed('https://www.theathletic.com/football', 'football'), false);
  assert.equal(filter.isDomainAllowed('https://www.randomtipster.com/tips', 'football'), false);
});

test('isDomainAllowed — edge cases', function() {
  assert.equal(filter.isDomainAllowed('', 'racing'), false);
  assert.equal(filter.isDomainAllowed(null, 'racing'), false);
  assert.equal(filter.isDomainAllowed('not-a-url', 'racing'), false);
  assert.equal(filter.isDomainAllowed(123, 'racing'), false);
});

// =========================================================================
// filterCitations
// =========================================================================

test('filterCitations — success fixture, all valid', function() {
  var cites = fixtures.success.citations.map(function(url, i) { return { url: url, index: i }; });
  var result = filter.filterCitations(cites, 'racing');
  assert.equal(result.valid.length, 3);
  assert.equal(result.dropped.length, 0);
});

test('filterCitations — paywall fixture, all dropped', function() {
  var cites = fixtures.paywallOnly.citations.map(function(url, i) { return { url: url, index: i }; });
  var result = filter.filterCitations(cites, 'racing');
  assert.equal(result.valid.length, 0);
  assert.equal(result.dropped.length, 2);
  assert.equal(result.dropped[0].reason, 'domain_not_allowed');
});

test('filterCitations — hallucinated domain, dropped', function() {
  var cites = fixtures.hallucinatedDomain.citations.map(function(url, i) { return { url: url, index: i }; });
  var result = filter.filterCitations(cites, 'racing');
  assert.equal(result.valid.length, 0);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0].reason, 'domain_not_allowed');
});

test('filterCitations — mixed domains, 2 valid 1 dropped', function() {
  var cites = fixtures.mixedDomains.citations.map(function(url, i) { return { url: url, index: i }; });
  var result = filter.filterCitations(cites, 'football');
  assert.equal(result.valid.length, 2);  // bbc + skysports
  assert.equal(result.dropped.length, 1); // randomtipster
});

test('filterCitations — empty array', function() {
  var result = filter.filterCitations([], 'racing');
  assert.equal(result.valid.length, 0);
  assert.equal(result.dropped.length, 0);
});

test('filterCitations — null input', function() {
  var result = filter.filterCitations(null, 'racing');
  assert.equal(result.valid.length, 0);
});

// =========================================================================
// groundSignals
// =========================================================================

test('groundSignals — success fixture, all grounded', function() {
  var cites = fixtures.success.citations.map(function(url, i) { return { url: url, index: i }; });
  var validCites = filter.filterCitations(cites, 'racing').valid;
  var result = filter.groundSignals(fixtures.success.content.signals, validCites);
  assert.equal(Object.keys(result.grounded).length, 3);
  assert.equal(result.dropped.length, 0);
});

test('groundSignals — zero citations, all dropped (no_citation)', function() {
  var result = filter.groundSignals(fixtures.zeroCitations.content.signals, []);
  assert.equal(Object.keys(result.grounded).length, 0);
  assert.equal(result.dropped.length, 2);
  assert.equal(result.dropped[0].reason, 'no_citation');
});

test('groundSignals — paywall citations, all dropped (citation_dropped)', function() {
  var cites = fixtures.paywallOnly.citations.map(function(url, i) { return { url: url, index: i }; });
  var validCites = filter.filterCitations(cites, 'racing').valid; // empty
  var result = filter.groundSignals(fixtures.paywallOnly.content.signals, validCites);
  assert.equal(Object.keys(result.grounded).length, 0);
  assert.equal(result.dropped.length, 2);
  assert.equal(result.dropped[0].reason, 'citation_dropped');
});

test('groundSignals — partial extraction, 2 grounded 2 dropped', function() {
  var cites = fixtures.partialExtraction.citations.map(function(url, i) { return { url: url, index: i }; });
  var validCites = filter.filterCitations(cites, 'racing').valid;
  var result = filter.groundSignals(fixtures.partialExtraction.content.signals, validCites);
  assert.equal(Object.keys(result.grounded).length, 2);
  assert.equal(result.dropped.length, 2);
  // The dropped ones should be headgear_change and rail_movement (no citation)
  var droppedKeys = result.dropped.map(function(d) { return d.key; });
  assert.ok(droppedKeys.indexOf('headgear_change') !== -1);
  assert.ok(droppedKeys.indexOf('rail_movement') !== -1);
});

// =========================================================================
// assessQuality
// =========================================================================

test('assessQuality — success, not low quality', function() {
  var result = filter.assessQuality({ totalSignals: 3, groundedCount: 3, droppedCount: 0, validCitationCount: 3, totalCitations: 3 });
  assert.equal(result.lowQuality, false);
});

test('assessQuality — zero citations in response', function() {
  var result = filter.assessQuality({ totalSignals: 2, groundedCount: 0, droppedCount: 2, validCitationCount: 0, totalCitations: 0 });
  assert.equal(result.lowQuality, true);
  assert.equal(result.reason, 'zero_citations_in_response');
});

test('assessQuality — all citations disallowed', function() {
  var result = filter.assessQuality({ totalSignals: 2, groundedCount: 0, droppedCount: 2, validCitationCount: 0, totalCitations: 2 });
  assert.equal(result.lowQuality, true);
  assert.equal(result.reason, 'all_citations_disallowed');
});

test('assessQuality — majority signals dropped', function() {
  var result = filter.assessQuality({ totalSignals: 4, groundedCount: 1, droppedCount: 3, validCitationCount: 2, totalCitations: 2 });
  assert.equal(result.lowQuality, true);
  assert.equal(result.reason, 'majority_signals_dropped');
});

test('assessQuality — exactly 50% grounded is NOT low quality', function() {
  var result = filter.assessQuality({ totalSignals: 4, groundedCount: 2, droppedCount: 2, validCitationCount: 2, totalCitations: 3 });
  assert.equal(result.lowQuality, false);
});
