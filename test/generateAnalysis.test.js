'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var scoringModel = require('../server/services/scoringModel');

// =========================================================================
// Helpers — minimal scored objects
// =========================================================================

function racingScored(overrides) {
  return Object.assign({
    runner: { horseName: 'Test Horse', trainer: 'J. Trainer', jockey: 'R. Jockey', form: '12311', officialRating: 120 },
    race: { meeting: 'Newbury', time: '14:30', going: 'Good to Firm', distance: '2m 4f', raceClass: 'Class 2' },
    odds: 4.5,
    edge: 0.08,
    modelProbability: 0.30,
    impliedProbability: 0.22,
    confidence: 7,
    valueRating: 'Strong',
    staking: '1 unit',
    riskLevel: 'Medium',
    factors: { form: 0.75, going: 0.6, class: 0.5, trainerJockey: 0.7, course: 0.4, draw: 0.3, weight: 0.3, speedRatings: 0.5, marketSupport: 0.6 },
  }, overrides || {});
}

function footballScored(overrides) {
  return Object.assign({
    fixture: { homeTeam: 'Arsenal', awayTeam: 'Chelsea', league: 'Premier League', kickoff: '15:00', venue: 'Emirates' },
    selectedMarket: 'Both Teams to Score',
    selectedSelection: 'BTTS Yes',
    selectedOdds: 1.85,
    edge: 0.05,
    modelProbability: 0.58,
    impliedProbability: 0.54,
    confidence: 7,
    valueRating: 'Fair',
    staking: '1 unit',
    riskLevel: 'Medium',
    factors: { xG: 0.7, form: 0.6, homeAway: 0.5, injuries: 0.4, h2h: 0.5, motivation: 0.4, shots: 0.5, schedule: 0.3, marketMovement: 0.5 },
  }, overrides || {});
}

// =========================================================================
// Racing — no enrichment (template-only)
// =========================================================================

test('racing — no enrichment produces all template fields', function() {
  var analysis = scoringModel.generateAnalysis(racingScored(), 'racing');
  assert.ok(analysis.summary.indexOf('Test Horse') !== -1);
  assert.ok(analysis.summary.indexOf('Newbury') !== -1);
  assert.ok(analysis.summary.indexOf('8.0%') !== -1); // edge
  assert.ok(analysis.form.indexOf('12311') !== -1);
  assert.ok(analysis.goingSuitability.indexOf('Good to Firm') !== -1);
  assert.ok(analysis.courseRecord.indexOf('Newbury') !== -1);
  assert.ok(analysis.trainerForm.indexOf('J. Trainer') !== -1);
  assert.ok(analysis.riskNotes.length > 0);
});

test('racing — no enrichment, goingSuitability uses template default', function() {
  var analysis = scoringModel.generateAnalysis(racingScored(), 'racing');
  assert.ok(analysis.goingSuitability.indexOf('conditions should suit') !== -1);
});

// =========================================================================
// Racing — all 7 signals present
// =========================================================================

test('racing — all 7 enrichment signals woven inline', function() {
  var signals = {
    going_update: { value: 'Clerk reports Good to Soft after 6mm rain overnight.', citation_index: 0 },
    non_runner: { value: 'Market leader Starlight Express withdrawn (vet).', citation_index: 1 },
    stable_form: { value: 'Henderson 4 from 9 this week, well above seasonal rate.', citation_index: 2 },
    headgear_change: { value: 'First-time cheekpieces applied.', citation_index: 3 },
    jockey_change: { value: 'Original jockey replaced by D. Skelton Jr.', citation_index: 4 },
    course_report: { value: 'Course walking Good in places, softer on far side.', citation_index: 5 },
    rail_movement: { value: 'Fresh rail, 3 yards off inside from 2f pole.', citation_index: 6 },
  };

  var analysis = scoringModel.generateAnalysis(racingScored(), 'racing', signals);

  // going_update woven into goingSuitability
  assert.ok(analysis.goingSuitability.indexOf('Clerk reports Good to Soft') !== -1);
  assert.ok(analysis.goingSuitability.indexOf('Official going:') !== -1);

  // course_report also woven into goingSuitability
  assert.ok(analysis.goingSuitability.indexOf('Course walking Good in places') !== -1);

  // stable_form woven into form
  assert.ok(analysis.form.indexOf('Henderson 4 from 9') !== -1);

  // non_runner woven into summary
  assert.ok(analysis.summary.indexOf('Starlight Express withdrawn') !== -1);

  // headgear_change woven into summary
  assert.ok(analysis.summary.indexOf('First-time cheekpieces') !== -1);

  // jockey_change woven into trainerForm
  assert.ok(analysis.trainerForm.indexOf('D. Skelton Jr') !== -1);

  // rail_movement woven into courseRecord
  assert.ok(analysis.courseRecord.indexOf('3 yards off inside') !== -1);
});

// =========================================================================
// Racing — signal with odd punctuation (no double-period, no double-space)
// =========================================================================

test('racing — signal ending with period does not produce double period', function() {
  var signals = {
    stable_form: { value: 'Trainer 3 from 8 this week.', citation_index: 0 },
  };
  var analysis = scoringModel.generateAnalysis(racingScored(), 'racing', signals);
  // The form field ends with formContext + ' ' + signal.value
  // formContext already ends with '.', signal also ends with '.'
  // This produces "...at this level. Trainer 3 from 8 this week." — single period between sentences, which is correct.
  // What we're checking is no ".." (double period)
  assert.ok(analysis.form.indexOf('..') === -1, 'no double periods in form: ' + analysis.form);
});

test('racing — signal with leading space does not produce double space', function() {
  var signals = {
    going_update: { value: ' Watered overnight, now Good to Soft.', citation_index: 0 },
  };
  var analysis = scoringModel.generateAnalysis(racingScored(), 'racing', signals);
  // The goingSuitability field should not have double spaces
  assert.ok(analysis.goingSuitability.indexOf('  ') === -1, 'no double spaces: ' + analysis.goingSuitability);
});

// =========================================================================
// Football — no enrichment (template-only)
// =========================================================================

test('football — no enrichment produces all template fields', function() {
  var analysis = scoringModel.generateAnalysis(footballScored(), 'football');
  assert.ok(analysis.summary.indexOf('Arsenal') !== -1);
  assert.ok(analysis.summary.indexOf('Chelsea') !== -1);
  assert.ok(analysis.summary.indexOf('58%') !== -1); // model prob
  assert.ok(analysis.form.indexOf('high-scoring') !== -1); // BTTS default
  assert.ok(analysis.injuries.indexOf('Check team news') !== -1); // default placeholder
  assert.ok(analysis.headToHead.indexOf('Recent meetings') !== -1);
  assert.ok(analysis.riskNotes.length > 0);
});

// =========================================================================
// Football — team_news replaces default placeholder
// =========================================================================

test('football — team_news replaces injuries placeholder', function() {
  var signals = {
    team_news: { value: 'Saka confirmed fit to start, Havertz on bench.', citation_index: 0 },
  };
  var analysis = scoringModel.generateAnalysis(footballScored(), 'football', signals);
  // Default "Check team news" should be replaced
  assert.ok(analysis.injuries.indexOf('Check team news') === -1, 'placeholder should be replaced');
  assert.ok(analysis.injuries.indexOf('Saka confirmed fit') !== -1);
});

// =========================================================================
// Football — motivation_context and manager_comments both present
// =========================================================================

test('football — motivation_context in form, manager_comments in h2h, no collision', function() {
  var signals = {
    motivation_context: { value: 'Arsenal need a win to clinch top 4.', citation_index: 0 },
    manager_comments: { value: 'Arteta: "We treat every game as a final now."', citation_index: 1 },
  };
  var analysis = scoringModel.generateAnalysis(footballScored(), 'football', signals);

  // motivation_context woven into form
  assert.ok(analysis.form.indexOf('Arsenal need a win to clinch top 4') !== -1);

  // manager_comments woven into headToHead
  assert.ok(analysis.headToHead.indexOf('Arteta:') !== -1);
  assert.ok(analysis.headToHead.indexOf('every game as a final') !== -1);

  // They should be in different fields, not colliding in the same one
  assert.ok(analysis.form.indexOf('Arteta:') === -1, 'manager_comments should not be in form');
  assert.ok(analysis.headToHead.indexOf('clinch top 4') === -1, 'motivation should not be in h2h');
});

// =========================================================================
// Football — tactical_change and rotation_risk both in summary
// =========================================================================

test('football — tactical_change and rotation_risk both appended to summary', function() {
  var signals = {
    tactical_change: { value: 'Switching to 3-5-2 formation.', citation_index: 0 },
    rotation_risk: { value: 'Expected to rest 4 players for CL semifinal midweek.', citation_index: 1 },
  };
  var analysis = scoringModel.generateAnalysis(footballScored(), 'football', signals);

  assert.ok(analysis.summary.indexOf('3-5-2 formation') !== -1);
  assert.ok(analysis.summary.indexOf('rest 4 players') !== -1);
  // Both in summary, but the base summary content is still there
  assert.ok(analysis.summary.indexOf('Arsenal vs Chelsea') !== -1);
});

// =========================================================================
// Football — injury_update appended to team_news
// =========================================================================

test('football — injury_update appends to team_news when both present', function() {
  var signals = {
    team_news: { value: 'Saka starts, Odegaard on bench.', citation_index: 0 },
    injury_update: { value: 'Rice picked up a knock in training — late fitness test.', citation_index: 1 },
  };
  var analysis = scoringModel.generateAnalysis(footballScored(), 'football', signals);

  assert.ok(analysis.injuries.indexOf('Saka starts') !== -1);
  assert.ok(analysis.injuries.indexOf('Rice picked up a knock') !== -1);
  // Both in same field
  assert.ok(analysis.injuries.indexOf('Check team news') === -1, 'placeholder replaced');
});
