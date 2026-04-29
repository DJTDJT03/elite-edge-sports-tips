'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var ql = require('../server/services/perplexity/qualityLoop');

// =========================================================================
// computeVerdict — 5-tier logic
// =========================================================================

test('verdict — |clvDelta| < 0.5 → Inconclusive', function() {
  assert.equal(ql.computeVerdict(0.3, 5.0, true), 'Inconclusive');
  assert.equal(ql.computeVerdict(-0.4, -2.0, true), 'Inconclusive');
  assert.equal(ql.computeVerdict(0.0, 0.0, true), 'Inconclusive');
  assert.equal(ql.computeVerdict(0.49, 10.0, true), 'Inconclusive');
});

test('verdict — clvDelta > 0.5 AND roiDelta > 0 → Earning its keep', function() {
  assert.equal(ql.computeVerdict(2.0, 5.0, true), 'Earning its keep');
  assert.equal(ql.computeVerdict(0.51, 0.01, true), 'Earning its keep');
});

test('verdict — clvDelta > 0.5 AND roiDelta <= 0 → Mixed signal', function() {
  assert.equal(ql.computeVerdict(2.0, -1.0, true), 'Mixed signal');
  assert.equal(ql.computeVerdict(1.5, 0.0, true), 'Mixed signal');
});

test('verdict — clvDelta < -0.5 AND roiDelta < 0 → No benefit', function() {
  assert.equal(ql.computeVerdict(-1.0, -3.0, true), 'No benefit — consider disabling');
  assert.equal(ql.computeVerdict(-0.51, -0.01, true), 'No benefit — consider disabling');
});

test('verdict — clvDelta < -0.5 AND roiDelta > 0 → Mixed signal', function() {
  assert.equal(ql.computeVerdict(-1.0, 2.0, true), 'Mixed signal');
});

test('verdict — insufficient sample overrides everything', function() {
  assert.equal(ql.computeVerdict(5.0, 10.0, false), 'Insufficient data');
  assert.equal(ql.computeVerdict(-5.0, -10.0, false), 'Insufficient data');
  assert.equal(ql.computeVerdict(0.0, 0.0, false), 'Insufficient data');
});

// =========================================================================
// Boundary cases
// =========================================================================

test('verdict — exactly 0.5 clvDelta is NOT inconclusive', function() {
  // 0.5 is not < 0.5, so it falls through to the directional check
  assert.equal(ql.computeVerdict(0.5, 1.0, true), 'Earning its keep');
  assert.equal(ql.computeVerdict(-0.5, -1.0, true), 'No benefit — consider disabling');
});

test('verdict — clvDelta 0.5 with roi 0 → Mixed (roi flat)', function() {
  assert.equal(ql.computeVerdict(0.5, 0.0, true), 'Mixed signal');
});

test('verdict — exactly -0.5 clvDelta with positive roi → Mixed', function() {
  assert.equal(ql.computeVerdict(-0.5, 1.0, true), 'Mixed signal');
});

test('verdict — negative clvDelta with roi exactly 0 → Mixed (not No benefit)', function() {
  assert.equal(ql.computeVerdict(-2.0, 0.0, true), 'Mixed signal');
});

// =========================================================================
// Constants exported correctly
// =========================================================================

test('constants — MIN_SAMPLE_SIZE and INCONCLUSIVE_THRESHOLD exported', function() {
  assert.equal(ql.MIN_SAMPLE_SIZE, 10);
  assert.equal(ql.INCONCLUSIVE_THRESHOLD, 0.5);
});
