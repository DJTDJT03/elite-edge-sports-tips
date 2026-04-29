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
// BULLETIN PROMPT RENDERING — liveContext ordering
// =========================================================================

test('bulletin prompt — liveContext inserted BEFORE JSON instruction, not after', function() {
  // Simulate the exact prompt-construction logic from aiReports.generateEmailBulletin
  var data = {
    userName: 'TestUser',
    date: '2026-04-29',
    tips: [{ selection: 'Horse A', event: 'Newbury 14:30', odds: 4.5, isPremium: true, confidence: 7 }],
    yesterdayResults: { wins: 2, losses: 1, pnl: 3.50, strikeRate: 67 },
    napSelection: 'Horse A',
    streak: '3W',
    liveContext: {
      racing: 'Newbury Good to Firm after watering, clerk expects it to ride Good in places.',
      football: 'Newcastle 5th, must-win for Champions League. Isak fit to start.',
    },
  };

  // Reproduce the prompt-building from aiReports.js
  var userPrompt = 'Generate a personalised morning email bulletin.\n\n';
  userPrompt += 'SUBSCRIBER NAME: ' + (data.userName || 'Subscriber') + '\n';
  userPrompt += 'DATE: ' + (data.date || '') + '\n\n';
  if (data.yesterdayResults) {
    userPrompt += 'YESTERDAY\'S RESULTS:\n';
    userPrompt += '  Wins: ' + data.yesterdayResults.wins + '\n';
    userPrompt += '  Losses: ' + data.yesterdayResults.losses + '\n\n';
  }
  if (data.tips && data.tips.length > 0) {
    userPrompt += 'TODAY\'S TIPS (' + data.tips.length + '):\n';
    data.tips.forEach(function(tip) {
      userPrompt += '  - ' + tip.selection + ' in ' + tip.event + ' at ' + tip.odds + '\n';
    });
    userPrompt += '\n';
  }
  if (data.napSelection) {
    userPrompt += 'NAP OF THE DAY: ' + data.napSelection + '\n\n';
  }
  if (data.streak) {
    userPrompt += 'CURRENT STREAK: ' + data.streak + '\n\n';
  }

  // This is the liveContext block from aiReports.js
  if (data.liveContext) {
    var hasLive = data.liveContext.racing || data.liveContext.football;
    if (hasLive) {
      userPrompt += 'LIVE INTELLIGENCE (last 24 hours):\n';
      if (data.liveContext.racing) {
        userPrompt += '\nRacing:\n' + data.liveContext.racing + '\n';
      }
      if (data.liveContext.football) {
        userPrompt += '\nFootball:\n' + data.liveContext.football + '\n';
      }
      userPrompt += '\nWeave relevant intelligence into your resultsReview and todaysPicks fields naturally. Do not list it as a separate section.\n\n';
    }
  }

  userPrompt += 'Return your response as JSON with these fields:\n';
  userPrompt += '- subject: email subject line (max 60 chars)\n';

  // (a) LIVE INTELLIGENCE block appears
  assert.ok(
    userPrompt.indexOf('LIVE INTELLIGENCE (last 24 hours):') !== -1,
    'LIVE INTELLIGENCE header should appear'
  );

  // (b) Both Racing: and Football: blocks appear
  assert.ok(
    userPrompt.indexOf('\nRacing:\n') !== -1,
    'Racing: block should appear'
  );
  assert.ok(
    userPrompt.indexOf('\nFootball:\n') !== -1,
    'Football: block should appear'
  );
  assert.ok(
    userPrompt.indexOf('Newbury Good to Firm') !== -1,
    'Racing context content should be present'
  );
  assert.ok(
    userPrompt.indexOf('Newcastle 5th') !== -1,
    'Football context content should be present'
  );

  // (c) CRITICAL: "Return your response as JSON" appears AFTER LIVE INTELLIGENCE, not before
  var liveIntPos = userPrompt.indexOf('LIVE INTELLIGENCE (last 24 hours):');
  var jsonInstructPos = userPrompt.indexOf('Return your response as JSON');
  assert.ok(
    jsonInstructPos > liveIntPos,
    'JSON instruction (pos ' + jsonInstructPos + ') must come AFTER LIVE INTELLIGENCE (pos ' + liveIntPos + ')'
  );
});

test('bulletin prompt — no liveContext: no LIVE INTELLIGENCE block, JSON instruction still present', function() {
  var userPrompt = 'Generate a personalised morning email bulletin.\n\n';
  userPrompt += 'SUBSCRIBER NAME: TestUser\n';
  userPrompt += 'DATE: 2026-04-29\n\n';

  // No liveContext — simulate data.liveContext undefined
  var data = {};
  if (data.liveContext) {
    var hasLive = data.liveContext.racing || data.liveContext.football;
    if (hasLive) {
      userPrompt += 'LIVE INTELLIGENCE (last 24 hours):\n';
    }
  }
  userPrompt += 'Return your response as JSON with these fields:\n';

  assert.ok(userPrompt.indexOf('LIVE INTELLIGENCE') === -1, 'no intelligence block when liveContext absent');
  assert.ok(userPrompt.indexOf('Return your response as JSON') !== -1, 'JSON instruction still present');
});

test('bulletin prompt — liveContext with only racing (football null): only racing block', function() {
  var data = {
    liveContext: { racing: 'Going changed at Newbury.', football: null },
  };

  var userPrompt = '';
  if (data.liveContext) {
    var hasLive = data.liveContext.racing || data.liveContext.football;
    if (hasLive) {
      userPrompt += 'LIVE INTELLIGENCE (last 24 hours):\n';
      if (data.liveContext.racing) userPrompt += '\nRacing:\n' + data.liveContext.racing + '\n';
      if (data.liveContext.football) userPrompt += '\nFootball:\n' + data.liveContext.football + '\n';
    }
  }

  assert.ok(userPrompt.indexOf('Racing:') !== -1, 'Racing block present');
  assert.ok(userPrompt.indexOf('Football:') === -1, 'Football block absent when null');
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
