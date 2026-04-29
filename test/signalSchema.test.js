'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var schema = require('../server/services/perplexity/signalSchema');

// =========================================================================
// Racing signals — valid shapes
// =========================================================================

test('extractSignals — valid racing signals', function() {
  var raw = {
    signals: {
      going_update: { value: 'Good to Soft after rain', citation_index: 0 },
      stable_form: { value: 'Trainer 5 from 12', citation_index: 1 },
    },
  };
  var result = schema.extractSignals(raw, 'racing');
  assert.equal(result.valid, true);
  assert.equal(Object.keys(result.signals).length, 2);
  assert.equal(result.signals.going_update.value, 'Good to Soft after rain');
  assert.equal(result.signals.going_update.citation_index, 0);
});

test('extractSignals — all 7 racing keys accepted', function() {
  var raw = { signals: {} };
  schema.RACING_SIGNALS.forEach(function(key, i) {
    raw.signals[key] = { value: 'Test value for ' + key, citation_index: i };
  });
  var result = schema.extractSignals(raw, 'racing');
  assert.equal(result.valid, true);
  assert.equal(Object.keys(result.signals).length, 7);
});

test('extractSignals — unknown keys dropped silently', function() {
  var raw = {
    signals: {
      going_update: { value: 'Real signal', citation_index: 0 },
      secret_insider_info: { value: 'Should be dropped', citation_index: 0 },
      hacked_data: { value: 'Also dropped', citation_index: 0 },
    },
  };
  var result = schema.extractSignals(raw, 'racing');
  assert.equal(Object.keys(result.signals).length, 1);
  assert.ok(result.signals.going_update);
  assert.ok(!result.signals.secret_insider_info);
  assert.ok(result.errors.some(function(e) { return e.indexOf('unknown key dropped') !== -1; }));
});

test('extractSignals — plain string values tolerated with warning', function() {
  var raw = {
    signals: {
      going_update: 'Going changed to soft',
    },
  };
  var result = schema.extractSignals(raw, 'racing');
  assert.equal(result.valid, true);
  assert.equal(result.signals.going_update.value, 'Going changed to soft');
  assert.equal(result.signals.going_update.citation_index, null);
  assert.ok(result.errors.some(function(e) { return e.indexOf('plain string') !== -1; }));
});

// =========================================================================
// Football signals — valid shapes
// =========================================================================

test('extractSignals — valid football signals', function() {
  var raw = {
    signals: {
      team_news: { value: 'Striker ruled out', citation_index: 0 },
      rotation_risk: { value: 'Heavy rotation expected', citation_index: 1 },
    },
  };
  var result = schema.extractSignals(raw, 'football');
  assert.equal(result.valid, true);
  assert.equal(Object.keys(result.signals).length, 2);
});

test('extractSignals — all 6 football keys accepted', function() {
  var raw = { signals: {} };
  schema.FOOTBALL_SIGNALS.forEach(function(key, i) {
    raw.signals[key] = { value: 'Test ' + key, citation_index: i };
  });
  var result = schema.extractSignals(raw, 'football');
  assert.equal(Object.keys(result.signals).length, 6);
});

test('extractSignals — racing keys ignored for football', function() {
  var raw = {
    signals: {
      going_update: { value: 'This is a racing signal', citation_index: 0 },
      team_news: { value: 'This is a football signal', citation_index: 0 },
    },
  };
  var result = schema.extractSignals(raw, 'football');
  assert.equal(Object.keys(result.signals).length, 1);
  assert.ok(result.signals.team_news);
  assert.ok(!result.signals.going_update);
});

// =========================================================================
// Invalid shapes
// =========================================================================

test('extractSignals — null input', function() {
  var result = schema.extractSignals(null, 'racing');
  assert.equal(result.valid, false);
  assert.equal(result.errors[0], 'Response is not an object');
});

test('extractSignals — string input (garbage response)', function() {
  var result = schema.extractSignals('I could not find information', 'racing');
  assert.equal(result.valid, false);
});

test('extractSignals — empty object', function() {
  var result = schema.extractSignals({}, 'racing');
  assert.equal(result.valid, false);
  assert.equal(Object.keys(result.signals).length, 0);
});

test('extractSignals — signals with invalid field shapes', function() {
  var raw = {
    signals: {
      going_update: { value: '', citation_index: 0 }, // empty value
      stable_form: { value: 123, citation_index: 0 }, // non-string value
      non_runner: { value: 'Valid value', citation_index: 'not a number' }, // bad citation_index
    },
  };
  var result = schema.extractSignals(raw, 'racing');
  // going_update: empty value -> invalid
  // stable_form: non-string -> invalid
  // non_runner: bad citation_index but value is string -> still invalid per isValidSignalField
  assert.equal(Object.keys(result.signals).length, 0);
  assert.ok(result.errors.length >= 2);
});

test('extractSignals — value exceeding 500 char cap is rejected', function() {
  var longValue = 'x'.repeat(501);
  var raw = { signals: { going_update: { value: longValue, citation_index: 0 } } };
  var result = schema.extractSignals(raw, 'racing');
  assert.equal(Object.keys(result.signals).length, 0);
});

test('extractSignals — unwraps signals from top level (no signals key)', function() {
  var raw = {
    going_update: { value: 'Direct top-level', citation_index: 0 },
  };
  var result = schema.extractSignals(raw, 'racing');
  assert.equal(result.valid, true);
  assert.equal(result.signals.going_update.value, 'Direct top-level');
});
