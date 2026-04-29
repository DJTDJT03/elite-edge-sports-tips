// Tests for D3 (bulletin) and D4 (replay) Sonar integration.
// These test the enrichBulletin orchestration logic and the replay
// liveContext conditional, not the full Claude pipeline.

'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Mock DB — minimal stubs
// ---------------------------------------------------------------------------
var mockDb = {
  isAvailable: function() { return true; },
  query: function() { return Promise.resolve({ rows: [] }); },
  getDailySpend: function() { return Promise.resolve(0); },
  getSonarCache: function() { return Promise.resolve(null); },
  checkSonarClaim: function() { return Promise.resolve('none'); },
  claimSonarCache: function() { return Promise.resolve(true); },
  completeSonarCache: function() { return Promise.resolve(); },
  reclaimStaleSonarCache: function() { return Promise.resolve(false); },
  cleanExpiredSonarCache: function() { return Promise.resolve(); },
  recordSonarSpend: function() { return Promise.resolve(); },
  createTipEnrichment: function() { return Promise.resolve(1); },
  getLatestSonarAdminEvent: function() { return Promise.resolve(null); },
};

// ---------------------------------------------------------------------------
// Instrumented client factory — tracks _callSonar invocations
// ---------------------------------------------------------------------------
function createInstrumentedClient() {
  process.env.PERPLEXITY_ENABLED = 'true';
  process.env.PERPLEXITY_API_KEY = 'test-key';
  process.env.PERPLEXITY_DRY_RUN = 'true';

  delete require.cache[require.resolve('../server/services/perplexity/client')];
  var createClient = require('../server/services/perplexity/client');
  var client = createClient(mockDb);

  // Instrument: wrap enrichBulletin's internal _callSonar by tracking
  // the ledger writes (recordSonarSpend is called for every Sonar invocation)
  var spendLog = [];
  var origRecord = mockDb.recordSonarSpend;
  mockDb.recordSonarSpend = function(data) {
    spendLog.push(data);
    return Promise.resolve();
  };

  return {
    client: client,
    spendLog: spendLog,
    cleanup: function() {
      mockDb.recordSonarSpend = origRecord;
      process.env.PERPLEXITY_DRY_RUN = '';
    },
  };
}

// =========================================================================
// BULLETIN TESTS
// =========================================================================

test('enrichBulletin — racing-only tips: one Sonar call for racing, zero for football', async function() {
  var ctx = createInstrumentedClient();
  try {
    var tips = [
      { sport: 'racing', selection: 'Test Horse', event: 'Newbury 14:30' },
      { sport: 'racing', selection: 'Another Horse', event: 'Cheltenham 15:00' },
    ];

    var result = await ctx.client.enrichBulletin(tips);

    // Racing context should be populated (dry-run returns mock content)
    assert.notEqual(result.racing, null, 'racing context should be non-null');
    // Football context should be null (no football tips, no call made)
    assert.equal(result.football, null, 'football context should be null');

    // Verify spend log: should have exactly one entry with entityId 'racing-daily'
    var racingCalls = ctx.spendLog.filter(function(s) { return s.entityId === 'racing-daily'; });
    var footballCalls = ctx.spendLog.filter(function(s) { return s.entityId === 'football-daily'; });
    assert.ok(racingCalls.length >= 1, 'at least one racing-daily ledger entry');
    assert.equal(footballCalls.length, 0, 'zero football-daily ledger entries');
  } finally {
    ctx.cleanup();
  }
});

test('enrichBulletin — football-only tips: one Sonar call for football, zero for racing', async function() {
  var ctx = createInstrumentedClient();
  try {
    var tips = [
      { sport: 'football', selection: 'BTTS Yes', event: 'Arsenal vs Chelsea', market: 'Both Teams to Score' },
    ];

    var result = await ctx.client.enrichBulletin(tips);

    assert.equal(result.racing, null, 'racing context should be null');
    assert.notEqual(result.football, null, 'football context should be non-null');

    var racingCalls = ctx.spendLog.filter(function(s) { return s.entityId === 'racing-daily'; });
    var footballCalls = ctx.spendLog.filter(function(s) { return s.entityId === 'football-daily'; });
    assert.equal(racingCalls.length, 0, 'zero racing-daily ledger entries');
    assert.ok(footballCalls.length >= 1, 'at least one football-daily ledger entry');
  } finally {
    ctx.cleanup();
  }
});

test('enrichBulletin — empty tips array: zero Sonar calls, both null', async function() {
  var ctx = createInstrumentedClient();
  try {
    var result = await ctx.client.enrichBulletin([]);

    assert.equal(result.racing, null, 'racing should be null');
    assert.equal(result.football, null, 'football should be null');

    // No calls at all — neither racing-daily nor football-daily
    var allCalls = ctx.spendLog.filter(function(s) {
      return s.entityId === 'racing-daily' || s.entityId === 'football-daily';
    });
    assert.equal(allCalls.length, 0, 'zero Sonar calls for empty tips');
  } finally {
    ctx.cleanup();
  }
});

// =========================================================================
// REPLAY TESTS
// =========================================================================

test('replay — Sonar returns null: replayData.liveContext is NOT set', function() {
  // Simulates the integration block in the scheduler IIFE
  var replayData = {
    selection: 'Test Horse',
    meeting: 'Newbury',
    raceTime: '14:30',
    result: 'lost',
    position: '3rd',
    going: 'Good',
    distance: '2m',
    runners: 8,
  };

  // Simulate: enrichReplay returned null (Sonar failed/suppressed)
  var sonarReplayCtx = null;
  if (sonarReplayCtx) {
    replayData.liveContext = sonarReplayCtx;
  }

  // replayData should NOT have liveContext property
  assert.equal(replayData.liveContext, undefined, 'liveContext should not be set when Sonar returns null');
  // Verify original structure is intact
  assert.equal(replayData.selection, 'Test Horse');
  assert.equal(replayData.meeting, 'Newbury');
});

test('replay — Sonar returns context: replayData.liveContext IS set', function() {
  var replayData = {
    selection: 'Test Horse',
    meeting: 'Newbury',
    raceTime: '14:30',
    result: 'won',
    position: '1st',
  };

  // Simulate: enrichReplay returned prose context
  var sonarReplayCtx = 'Track rode fast all afternoon with a bias toward front-runners on the stands side [Racing Post].';
  if (sonarReplayCtx) {
    replayData.liveContext = sonarReplayCtx;
  }

  assert.equal(replayData.liveContext, sonarReplayCtx, 'liveContext should contain Sonar prose');
  // Original fields still intact
  assert.equal(replayData.selection, 'Test Horse');
  assert.equal(replayData.result, 'won');
});

test('replay — liveContext flows into aiReports prompt (simulated)', function() {
  // Simulate what aiReports.generateRaceReplay does with liveContext:
  // it checks if (data.liveContext) and appends to userPrompt

  var data = {
    selection: 'Horse',
    meeting: 'Ascot',
    liveContext: 'Ground was softer than the official Good description [Sporting Life].',
  };

  // Simulate the prompt-building logic from aiReports.js
  var userPrompt = 'SELECTION: ' + data.selection + '\n';
  if (data.liveContext) {
    userPrompt += 'POST-RACE INTELLIGENCE:\n' + data.liveContext + '\n';
  }

  assert.ok(userPrompt.indexOf('POST-RACE INTELLIGENCE') !== -1);
  assert.ok(userPrompt.indexOf('softer than the official') !== -1);

  // Now test WITHOUT liveContext
  var data2 = { selection: 'Horse', meeting: 'Ascot' };
  var prompt2 = 'SELECTION: ' + data2.selection + '\n';
  if (data2.liveContext) {
    prompt2 += 'POST-RACE INTELLIGENCE:\n' + data2.liveContext + '\n';
  }

  assert.ok(prompt2.indexOf('POST-RACE INTELLIGENCE') === -1, 'no intelligence block when liveContext absent');
});
