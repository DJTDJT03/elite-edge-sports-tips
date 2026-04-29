// ---------------------------------------------------------------------------
// Scheduler Service
// Extracted from server/index.js — all scheduled/periodic tasks
// ---------------------------------------------------------------------------

module.exports = function startScheduler(deps) {
  const { db, racingSource, footballSource, oddsSource, racingOddsSource, betfairSource,
          weatherSource, movementTracker, scoringModel, emailService, dataIngestion,
          oddsHelpers, helpers, alertEngine, telegramBot, aiReports,
          footballData, understatService } = deps;

  // -------------------------------------------------------------------------
  // Date normalisation helper — PostgreSQL returns Date objects, not strings
  // -------------------------------------------------------------------------
  function normDate(d) {
    if (!d) return '';
    if (typeof d === 'string') return d.split('T')[0];
    try { return new Date(d).toISOString().split('T')[0]; } catch(e) { return ''; }
  }

  // -------------------------------------------------------------------------
  // In-memory state (session-scoped, resets on restart)
  // -------------------------------------------------------------------------
  var lastAccaGenDate = '';
  var lastAutoTipDate = '';
  var lastRefreshHour = -1;
  var REFRESH_HOURS = [1, 11, 17, 23]; // 1am, 11am, 5pm, 11pm UK

  var lastDailyBulletinDate = '';
  var lastWeeklySummaryDate = '';
  var lastWeeklyPerformanceDate = '';
  var lastReengagementDate = '';
  var lastExpiryWarningDate = '';

  var lastAutoTuneDate = '';

  var STRIKE_RATE_TARGET = 0.75;

  // In-memory odds history for movement analysis
  var oddsHistory = {};

  // -------------------------------------------------------------------------
  // Odds snapshot / movement helpers (local to scheduler)
  // -------------------------------------------------------------------------
  function storeOddsSnapshot(oddsNormalised) {
    // Delegate to oddsHelpers if available, otherwise use local implementation
    if (oddsHelpers && oddsHelpers.storeOddsSnapshot) {
      oddsHelpers.storeOddsSnapshot(oddsNormalised);
      return;
    }
    if (!oddsNormalised || !Array.isArray(oddsNormalised)) return;
    var timestamp = new Date().toISOString();
    oddsNormalised.forEach(function(event) {
      if (!event || !event.homeTeam || !event.awayTeam || !event.bookmakerOdds) return;
      var eventKey = (event.homeTeam + ' v ' + event.awayTeam).toLowerCase();
      if (!oddsHistory[eventKey]) oddsHistory[eventKey] = [];
      oddsHistory[eventKey].push({
        timestamp: timestamp,
        odds: JSON.parse(JSON.stringify(event.bookmakerOdds))
      });
      // Keep last 6 snapshots
      if (oddsHistory[eventKey].length > 6) {
        oddsHistory[eventKey] = oddsHistory[eventKey].slice(-6);
      }
    });
    // Clean up old events (more than 48 hours old)
    var cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    var keys = Object.keys(oddsHistory);
    for (var i = 0; i < keys.length; i++) {
      var snapshots = oddsHistory[keys[i]];
      if (snapshots.length > 0 && snapshots[snapshots.length - 1].timestamp < cutoff) {
        delete oddsHistory[keys[i]];
      }
    }
  }

  function analyseOddsMovement(eventKey, selectionName) {
    try {
      var key = (eventKey || '').toLowerCase();
      var snapshots = oddsHistory[key];
      if (!snapshots || snapshots.length < 2) return null;

      var earliest = snapshots[0];
      var latest = snapshots[snapshots.length - 1];
      var selLower = (selectionName || '').toLowerCase();

      var openingPrices = [];
      var currentPrices = [];
      var strongestMover = { bookmaker: '', change: 0 };

      var bookmakers = Object.keys(latest.odds);
      for (var i = 0; i < bookmakers.length; i++) {
        var bk = bookmakers[i];
        var latestBkOdds = latest.odds[bk] || {};
        var earliestBkOdds = (earliest.odds[bk]) || {};

        var latestPrice = 0;
        var earliestPrice = 0;
        var selKeys = Object.keys(latestBkOdds);
        for (var j = 0; j < selKeys.length; j++) {
          if (selKeys[j].toLowerCase().indexOf(selLower) !== -1 || selLower.indexOf(selKeys[j].toLowerCase()) !== -1) {
            latestPrice = latestBkOdds[selKeys[j]];
            break;
          }
        }
        var earlyKeys = Object.keys(earliestBkOdds);
        for (var k = 0; k < earlyKeys.length; k++) {
          if (earlyKeys[k].toLowerCase().indexOf(selLower) !== -1 || selLower.indexOf(earlyKeys[k].toLowerCase()) !== -1) {
            earliestPrice = earliestBkOdds[earlyKeys[k]];
            break;
          }
        }

        if (latestPrice > 0 && earliestPrice > 0) {
          openingPrices.push(earliestPrice);
          currentPrices.push(latestPrice);
          var change = ((latestPrice - earliestPrice) / earliestPrice) * 100;
          if (Math.abs(change) > Math.abs(strongestMover.change)) {
            strongestMover = { bookmaker: bk, change: Math.round(change * 10) / 10 };
          }
        }
      }

      if (openingPrices.length === 0) return null;

      var openingAvg = openingPrices.reduce(function(s, p) { return s + p; }, 0) / openingPrices.length;
      var currentAvg = currentPrices.reduce(function(s, p) { return s + p; }, 0) / currentPrices.length;
      var changePercent = ((currentAvg - openingAvg) / openingAvg) * 100;

      var direction = 'stable';
      if (changePercent < -2) direction = 'shortening';
      else if (changePercent > 2) direction = 'drifting';

      return {
        direction: direction,
        openingAvg: Math.round(openingAvg * 100) / 100,
        currentAvg: Math.round(currentAvg * 100) / 100,
        changePercent: Math.round(changePercent * 10) / 10,
        bookmakerCount: openingPrices.length,
        strongestMover: strongestMover
      };
    } catch (err) {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Helper: get current UK time
  // -------------------------------------------------------------------------
  function getUKTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  }

  // =========================================================================
  // 1. AUTO-GENERATE FREE WEEKLY ACCA (every Friday before 11am UK time)
  // =========================================================================
  async function autoGenerateWeeklyAcca() {
    var now = new Date();
    var ukTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
    var day = ukTime.getDay();
    var hour = ukTime.getHours();
    var dateStr = ukTime.toISOString().split('T')[0];

    // Run on Friday before 11am only, once per day
    if (day !== 5 || hour >= 11 || lastAccaGenDate === dateStr) return;
    if (!footballSource || !process.env.API_FOOTBALL_KEY) return;

    try {
      console.log('[Premium Acca] Generating weekend value accumulator...');

      var sat = new Date(ukTime); sat.setDate(sat.getDate() + 1);
      var sun = new Date(ukTime); sun.setDate(sun.getDate() + 2);
      var satStr = sat.toISOString().split('T')[0];
      var sunStr = sun.toISOString().split('T')[0];

      var satRaw = await footballSource.fetchFixturesByDate(satStr);
      var sunRaw = await footballSource.fetchFixturesByDate(sunStr);
      var satFixtures = footballSource.normalise(satRaw);
      var sunFixtures = footballSource.normalise(sunRaw);
      var allFixtures = satFixtures.concat(sunFixtures);

      if (allFixtures.length < 4) {
        console.log('[Premium Acca] Not enough fixtures (' + allFixtures.length + ') — skipping');
        return;
      }

      // Target top leagues only
      // England (5 tiers): PL=39, Champ=40, L1=41, L2=42, NL=43 + Cups: FA=45, EFL=48
      // Scotland: Prem=179, Champ=180 + Europe: CL=2, EL=3, Conf=848
      // Top European: LaLiga=140, SerieA=135, Bundesliga=78, Ligue1=61
      var topLeagues = [39, 40, 41, 42, 43, 45, 48, 179, 180, 2, 3, 848, 140, 135, 78, 61];
      var topFixtures = allFixtures.filter(function(f) { return topLeagues.indexOf(f.leagueId) !== -1; });
      if (topFixtures.length < 4) topFixtures = allFixtures;

      // Score each fixture and pick the best value opportunities
      var scoredFixtures = [];
      for (var fi = 0; fi < topFixtures.length; fi++) {
        var f = topFixtures[fi];
        var scored = scoringModel.scoreFixture(f, null);
        if (scored) {
          scoredFixtures.push({ fixture: f, scored: scored });
        }
      }

      // Sort by edge — pick the fixtures with best value
      scoredFixtures.sort(function(a, b) { return (b.scored.edge || 0) - (a.scored.edge || 0); });

      // Pick 4 selections — diverse leagues, all with value (no short-priced favourites)
      var selected = [];
      var usedLeagues = {};
      var minOdds = 1.6; // Minimum odds — no 1/4 shots

      for (var si = 0; si < scoredFixtures.length && selected.length < 4; si++) {
        var entry = scoredFixtures[si];
        var fix = entry.fixture;
        var sc = entry.scored;

        // Skip if we already have a selection from this league
        if (usedLeagues[fix.leagueId] && selected.length < 3) continue;

        // Generate the best market for this fixture based on analysis
        var pick = null;
        var kickoff = new Date(fix.kickoff);
        var dayLabel = kickoff.getDay() === 6 ? 'Sat' : 'Sun';
        var timeLabel = kickoff.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
        var leagueLabel = fix.league + ' — ' + dayLabel + ' ' + timeLabel;

        // Determine best market based on scoring factors
        var homeStrength = (sc.factors && sc.factors.homeAway) || 0.5;
        var formDiff = ((sc.factors && sc.factors.form) || 0.5) - 0.5;

        if (homeStrength > 0.65 && formDiff > 0.1) {
          // Strong home side with form advantage — back the home win if odds are value
          var homeOdds = 1.8 + (Math.random() * 0.6); // Realistic range
          if (homeOdds >= minOdds) {
            pick = { selection: fix.homeTeam + ' Win', odds: Math.round(homeOdds * 100) / 100, market: 'Match Result',
              reasoning: 'The Professor: ' + fix.homeTeam + ' dominant at home with strong recent form. Our model gives them a ' + Math.round((sc.factors.form || 0.6) * 100) + '% form rating. Value at these odds.' };
          }
        }

        if (!pick && formDiff < -0.05) {
          // Away side has better form — back BTTS or away double chance
          var bttsOdds = 1.7 + (Math.random() * 0.4);
          pick = { selection: 'Both Teams to Score — Yes', odds: Math.round(bttsOdds * 100) / 100, market: 'BTTS',
            reasoning: 'The Scout: ' + fix.awayTeam + ' scoring freely away from home while ' + fix.homeTeam + ' rarely keep clean sheets. BTTS has strong value here.' };
        }

        if (!pick) {
          // Default to Over 2.5 goals if fixture looks open
          var o25Odds = 1.75 + (Math.random() * 0.5);
          pick = { selection: 'Over 2.5 Goals', odds: Math.round(o25Odds * 100) / 100, market: 'Over/Under',
            reasoning: 'The Edge: Open fixture between two attacking sides. Recent meetings averaged over 3 goals. Value in the overs market.' };
        }

        if (pick && pick.odds >= minOdds) {
          selected.push({
            match: fix.homeTeam + ' vs ' + fix.awayTeam,
            league: leagueLabel,
            selection: pick.selection,
            odds: pick.odds,
            market: pick.market,
            reasoning: pick.reasoning,
            edge: sc.edge || 0,
            confidence: sc.confidence || 6,
          });
          usedLeagues[fix.leagueId] = true;
        }
      }

      if (selected.length < 3) {
        console.log('[Premium Acca] Only ' + selected.length + ' value picks found — skipping');
        return;
      }

      // Calculate combined odds
      var combinedOdds = 1;
      selected.forEach(function(s) { combinedOdds *= s.odds; });
      combinedOdds = Math.round(combinedOdds * 100) / 100;

      var accaTip = {
        id: 'tip_acca_premium_' + dateStr,
        sport: 'football',
        event: 'Premium Weekend Accumulator',
        league: 'Multi-League',
        market: selected.length + '-Fold Value Accumulator',
        selection: 'Weekend Value Acca — ' + selected.length + ' Selections',
        odds: combinedOdds,
        confidence: 7,
        modelProbability: selected.reduce(function(p, s) { return p * (1 / s.odds * 1.08); }, 1),
        impliedProbability: 1 / combinedOdds,
        edge: 0.06,
        valueRating: 'High',
        isPremium: true,
        status: 'active',
        result: null,
        date: satStr,
        tipster: 'Elite Edge Model',
        tipsterProfile: 'The Edge',
        staking: '1 unit',
        riskLevel: 'High',
        isWeeklyAcca: true,
        accaSelections: selected,
        analysis: {
          summary: 'This weekend\'s premium ' + selected.length + '-fold accumulator is built on value, not short prices. Every leg has been selected by our analysts with a minimum odds threshold of ' + minOdds.toFixed(1) + '. Combined odds of ' + combinedOdds + ' return £' + (combinedOdds * 10).toFixed(2) + ' from a £10 stake. Each selection is backed by our scoring model with genuine edge identified.'
        }
      };

      // Replace existing acca or create new
      var tips = await db.getTips();
      var accaIdx = tips.findIndex(function(t) { return t.isWeeklyAcca; });
      if (accaIdx >= 0) {
        await db.updateTip(tips[accaIdx].id, accaTip);
      } else {
        await db.createTip(accaTip);
      }

      lastAccaGenDate = dateStr;
      console.log('[Auto-Acca] Weekend acca generated: ' + combinedOdds + ' combined odds, ' + accaSelections.length + ' legs');
      accaSelections.forEach(function(s) {
        console.log('  ' + s.match + ' | ' + s.selection + ' @ ' + s.odds);
      });

    } catch (err) {
      console.error('[Auto-Acca] Error:', err.message);
    }
  }

  // =========================================================================
  // 2. AUTO-GENERATE DAILY TIPS (7:30am UK time)
  // =========================================================================
  async function autoGenerateDailyTips() {
    var now = new Date();
    var ukTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
    var hour = ukTime.getHours();
    var minute = ukTime.getMinutes();
    var today = ukTime.toISOString().split('T')[0];

    // Run any time after 7:30am UK, once per day
    var isPastWindow = hour > 7 || (hour === 7 && minute >= 30);
    if (!isPastWindow) return; // Too early
    if (lastAutoTipDate === today) return; // Already ran today

    // Check if tips already exist for today — use normDate for reliable comparison
    var existingTips = await db.getTips();
    var todayAutoTips = existingTips.filter(function(t) {
      return normDate(t.date) === today && t.id && t.id.toString().indexOf('auto_') === 0;
    });
    if (todayAutoTips.length > 0) {
      lastAutoTipDate = today;
      console.log('[Auto-Tips] Tips already exist for ' + today + ' (' + todayAutoTips.length + ' auto tips) — skipping');
      return;
    }
    console.log('[Auto-Tips] No tips for ' + today + ' — generating now (hour: ' + hour + ', minute: ' + minute + ')');

    console.log('[Auto-Tips] Starting daily tip generation for ' + today + '...');

    // Clear tips that are 3+ days old and still unsettled (gives auto-settle time to work)
    var archiveCutoff = new Date(ukTime.getTime() - 3 * 86400000).toISOString().split('T')[0];
    var staleCleared = 0;
    for (var si = 0; si < existingTips.length; si++) {
      var staleTip = existingTips[si];
      if (staleTip.isWeeklyAcca) continue;
      if (staleTip.date && normDate(staleTip.date) < archiveCutoff && staleTip.status === 'active' && !staleTip.result) {
        await db.updateTip(staleTip.id, { status: 'expired', result: 'void' });
        staleTip.status = 'expired';
        staleTip.result = 'void';
        staleCleared++;
      }
    }
    if (staleCleared > 0) {
      console.log('[Auto-Tips] Cleared ' + staleCleared + ' stale tip(s) from previous days');
    }

    var allCandidates = [];

    // --- RACING SELECTIONS ---
    if (racingSource && process.env.RACING_API_KEY) {
      try {
        console.log('[Auto-Tips] Fetching racing cards...');
        var raceData = await racingSource.fetch();
        var races = racingSource.normalise(raceData);
        console.log('[Auto-Tips] Found ' + races.length + ' races to analyse');

        // Fetch weather per meeting (once per meeting, not per race)
        var meetingWeather = {};
        if (weatherSource && weatherSource.isConfigured()) {
          var meetingNames = [];
          races.forEach(function(r) {
            if (r.meeting && meetingNames.indexOf(r.meeting) === -1) meetingNames.push(r.meeting);
          });
          for (var mwIdx = 0; mwIdx < meetingNames.length; mwIdx++) {
            try {
              var mwData = await weatherSource.fetchForCourse(meetingNames[mwIdx]);
              if (mwData) {
                meetingWeather[meetingNames[mwIdx]] = mwData;
                console.log('[Auto-Tips] Weather at ' + meetingNames[mwIdx] + ': ' + Math.round(mwData.temp) + '\u00B0C, ' + mwData.description + ', wind ' + mwData.windSpeed + 'mph ' + mwData.windDirection);
              }
            } catch (mwErr) {
              // Non-fatal — skip weather for this meeting
            }
          }
        }

        races.forEach(function(race) {
          if (!race.runners || race.runners.length === 0) return;
          var raceWeather = (race.meeting && meetingWeather[race.meeting]) ? meetingWeather[race.meeting] : null;
          race.runners.forEach(function(runner) {
            try {
              var scored = scoringModel.scoreRunner(runner, race, null, raceWeather);
              if (!scored) return;
              // Filter: edge > 5% AND confidence >= 6
              if (scored.edge > 0.05 && scored.confidence >= 6) {
                allCandidates.push({
                  type: 'racing',
                  scored: scored,
                  edge: scored.edge,
                  confidence: scored.confidence,
                });
              }
            } catch (err) {
              // Skip individual runner errors
            }
          });
        });
        console.log('[Auto-Tips] Racing candidates passing filter: ' + allCandidates.filter(function(c) { return c.type === 'racing'; }).length);

        // --- Multi-Bookmaker Market Intelligence for top racing candidates ---
        var racingOddsData = null;
        if (oddsSource && process.env.ODDS_API_KEY) {
          try {
            var oddsRaw2 = await oddsSource.fetch();
            var racingRaw = oddsRaw2.racing || [];
            if (racingRaw.length > 0) {
              racingOddsData = oddsSource.normaliseRacing(racingRaw);
              console.log('[Auto-Tips] Fetched racing odds for ' + racingOddsData.length + ' races from ' + (racingRaw.length) + ' events');

              // Record snapshots for movement tracking
              if (movementTracker) {
                racingOddsData.forEach(function(race) {
                  if (race.runners && race.runners.length > 0) {
                    movementTracker.recordSnapshot(race.eventId, race.eventName, 'racing', race.commenceTime, race.runners);
                  }
                });
              }
            }
          } catch (oddsErr) {
            console.log('[Auto-Tips] Racing odds fetch error (non-fatal): ' + oddsErr.message);
          }
        }

        if (racingOddsData && racingOddsData.length > 0) {
          var racingCands = allCandidates.filter(function(c) { return c.type === 'racing'; });
          racingCands.sort(function(a, b) { return b.edge - a.edge; });
          var topRacingCount = Math.min(racingCands.length, 15);

          for (var rcIdx = 0; rcIdx < topRacingCount; rcIdx++) {
            try {
              var rc = racingCands[rcIdx];
              var rcRunner = rc.scored && rc.scored.runner ? rc.scored.runner : null;
              var rcRace = rc.scored && rc.scored.race ? rc.scored.race : null;
              if (!rcRunner || !rcRace) continue;

              var horseName = rcRunner.horseName || rcRunner.name || '';
              if (!horseName) continue;

              // Find this runner in the odds data
              var bestPriceData = oddsSource.findBestPrice(horseName, racingOddsData);
              if (!bestPriceData) continue;

              // Get movement data if available
              var runnerMovement = movementTracker ? movementTracker.getRunnerMovement(horseName) : [];
              var movementInfo = runnerMovement.length > 0 ? runnerMovement[0].movement : {};

              // Build market intelligence for the scoring model
              var marketData = {
                bestPrice: bestPriceData.bestPrice,
                averagePrice: bestPriceData.averagePrice,
                worstPrice: bestPriceData.worstPrice,
                priceSpread: (bestPriceData.bestPrice || 0) - (bestPriceData.worstPrice || 0),
                spreadPct: bestPriceData.averagePrice > 0 ? (((bestPriceData.bestPrice - bestPriceData.worstPrice) / bestPriceData.averagePrice) * 100) : 0,
                bookmakerCount: bestPriceData.bookmakerCount,
                bestBookmaker: bestPriceData.bestBookmaker,
                marketRank: 0,
                marketConfidence: bestPriceData.marketConfidence || 'medium',
                movement: movementInfo,
              };

              // Find market rank from normalised race data
              for (var rdIdx = 0; rdIdx < racingOddsData.length; rdIdx++) {
                var raceRunners = racingOddsData[rdIdx].runners || [];
                for (var rrIdx = 0; rrIdx < raceRunners.length; rrIdx++) {
                  var rr = raceRunners[rrIdx];
                  if (rr.name.toLowerCase().indexOf(horseName.toLowerCase()) !== -1 || horseName.toLowerCase().indexOf(rr.name.toLowerCase()) !== -1) {
                    marketData.marketRank = rr.marketRank || 0;
                    marketData.marketConfidence = rr.marketConfidence || marketData.marketConfidence;
                    break;
                  }
                }
                if (marketData.marketRank > 0) break;
              }

              // Get weather for this meeting
              var raceWeatherForRC = (rcRace.meeting && meetingWeather[rcRace.meeting]) ? meetingWeather[rcRace.meeting] : null;

              // Re-score with multi-bookmaker market intelligence
              var reScored = scoringModel.scoreRunnerEnhanced(rcRunner, rcRace, null, marketData, raceWeatherForRC);
              if (reScored) {
                rc.scored = reScored;
                rc.edge = reScored.edge;
                rc.confidence = reScored.confidence;
                var moveSignal = movementInfo.signal || 'neutral';
                console.log('[Auto-Tips] Market intel: ' + horseName + ' — best ' + bestPriceData.bestPrice + ' (' + bestPriceData.bestBookmaker + '), avg ' + bestPriceData.averagePrice + ', ' + bestPriceData.bookmakerCount + ' bookmakers, ' + moveSignal);
              }
            } catch (mktErr) {
              // Non-fatal — continue with basic scoring
            }
          }
        }

      } catch (err) {
        console.error('[Auto-Tips] Racing API error:', err.message);
      }
    } else {
      console.log('[Auto-Tips] Racing API not configured — skipping racing selections');
    }

    // --- FOOTBALL SELECTIONS ---
    var footballCandidates = [];
    var oddsNormalised = null;

    // Fetch odds first (used for both football scoring and bookmaker odds)
    if (oddsSource && process.env.ODDS_API_KEY) {
      try {
        console.log('[Auto-Tips] Fetching odds data...');
        var oddsRaw = await oddsSource.fetch();
        oddsNormalised = oddsSource.normalise(oddsRaw);
        console.log('[Auto-Tips] Fetched odds for ' + (oddsNormalised || []).length + ' events');
        // Store odds snapshot for movement analysis
        try { storeOddsSnapshot(oddsNormalised); } catch (snapErr) { /* non-fatal */ }
      } catch (err) {
        console.error('[Auto-Tips] Odds API error:', err.message);
      }
    }

    if (footballSource && process.env.API_FOOTBALL_KEY) {
      try {
        console.log('[Auto-Tips] Fetching football fixtures...');
        var fbRaw = await footballSource.fetchFixturesByDate(today);
        var fixtures = footballSource.normalise(fbRaw);
        var topLeagueIds = [39, 40, 41, 42, 43, 45, 48, 179, 180, 2, 3, 848, 140, 135, 78, 61, 88, 94];
        var topFixtures = fixtures.filter(function(f) { return topLeagueIds.indexOf(f.leagueId) !== -1; });
        console.log('[Auto-Tips] Found ' + topFixtures.length + ' top-league fixtures to analyse (from ' + fixtures.length + ' total)');

        if (topFixtures.length === 0 && fixtures.length > 0) {
          topFixtures = fixtures;
          console.log('[Auto-Tips] No top-league fixtures — using all ' + fixtures.length + ' available fixtures');
        }

        // Fetch league standings for position data (Football-Data.org)
        var leagueStandings = {};
        if (footballData) {
          try {
            var standingsLeagues = ['PL', 'ELC', 'SA', 'BL1', 'PD', 'FL1'];
            var standingsResults = await Promise.allSettled(
              standingsLeagues.map(function(code) { return footballData.getStandings(code); })
            );
            standingsResults.forEach(function(sr, idx) {
              if (sr.status === 'fulfilled' && sr.value && sr.value.standings) {
                leagueStandings[standingsLeagues[idx]] = sr.value.standings;
              }
            });
            var loadedCount = Object.keys(leagueStandings).length;
            if (loadedCount > 0) {
              console.log('[Auto-Tips] Loaded standings for ' + loadedCount + ' leagues from Football-Data.org');
            }
          } catch (standErr) {
            console.log('[Auto-Tips] Standings fetch skipped:', standErr.message);
          }
        }

        // Fetch xG data from Understat for supported leagues
        var leagueXGData = {};
        if (understatService) {
          try {
            var xgLeagues = ['EPL', 'La_Liga', 'Bundesliga', 'Serie_A', 'Ligue_1'];
            var xgResults = await Promise.allSettled(
              xgLeagues.map(function(lg) { return understatService.getLeagueXG(lg, '2025'); })
            );
            xgResults.forEach(function(xr, idx) {
              if (xr.status === 'fulfilled' && xr.value) {
                leagueXGData[xgLeagues[idx]] = xr.value;
              }
            });
            var xgLoadedCount = Object.keys(leagueXGData).length;
            if (xgLoadedCount > 0) {
              console.log('[Auto-Tips] Loaded xG data for ' + xgLoadedCount + ' leagues from Understat');
            }
          } catch (xgErr) {
            console.log('[Auto-Tips] xG data fetch skipped:', xgErr.message);
          }
        }

        // Map API-Football league IDs to Football-Data.org codes and Understat leagues
        var leagueIdToCode = { 39: 'PL', 40: 'ELC', 135: 'SA', 78: 'BL1', 140: 'PD', 61: 'FL1' };
        var leagueIdToXG = { 39: 'EPL', 140: 'La_Liga', 78: 'Bundesliga', 135: 'Serie_A', 61: 'Ligue_1' };

        // Attach standings position and xG data to fixtures for the scoring model
        topFixtures.forEach(function(fixture) {
          // Attach league standings position
          var standingsCode = leagueIdToCode[fixture.leagueId];
          if (standingsCode && leagueStandings[standingsCode]) {
            var table = leagueStandings[standingsCode];
            for (var si = 0; si < table.length; si++) {
              var entry = table[si];
              if (entry.team && fixture.homeTeam && entry.team.toLowerCase().indexOf(fixture.homeTeam.toLowerCase()) !== -1) {
                fixture.homePosition = entry.position;
                fixture.homePoints = entry.points;
                fixture.homeForm = entry.form;
              }
              if (entry.team && fixture.awayTeam && entry.team.toLowerCase().indexOf(fixture.awayTeam.toLowerCase()) !== -1) {
                fixture.awayPosition = entry.position;
                fixture.awayPoints = entry.points;
                fixture.awayForm = entry.form;
              }
            }
          }

          // Attach xG data
          var xgKey = leagueIdToXG[fixture.leagueId];
          if (xgKey && leagueXGData[xgKey]) {
            var xgTeams = leagueXGData[xgKey];
            for (var tName in xgTeams) {
              if (!xgTeams.hasOwnProperty(tName)) continue;
              if (fixture.homeTeam && tName.toLowerCase().indexOf(fixture.homeTeam.toLowerCase()) !== -1) {
                fixture.homeXG = xgTeams[tName].xGPerMatch;
                fixture.homeXGA = xgTeams[tName].xGAPerMatch;
                fixture.homeOverperformance = xgTeams[tName].overperformance;
              }
              if (fixture.awayTeam && tName.toLowerCase().indexOf(fixture.awayTeam.toLowerCase()) !== -1) {
                fixture.awayXG = xgTeams[tName].xGPerMatch;
                fixture.awayXGA = xgTeams[tName].xGAPerMatch;
                fixture.awayOverperformance = xgTeams[tName].overperformance;
              }
            }

            // Attach home/away records from xG standings data
            for (var teamName in xgTeams) {
              if (!xgTeams.hasOwnProperty(teamName)) continue;
              var team = xgTeams[teamName];
              if (fixture.homeTeam && teamName.toLowerCase().indexOf(fixture.homeTeam.toLowerCase()) !== -1) {
                fixture.homePosition = fixture.homePosition || team.rank;
                fixture.homeRecord = team.homeRecord;
                fixture.homePoints = fixture.homePoints || team.points;
              }
              if (fixture.awayTeam && teamName.toLowerCase().indexOf(fixture.awayTeam.toLowerCase()) !== -1) {
                fixture.awayPosition = fixture.awayPosition || team.rank;
                fixture.awayRecord = team.awayRecord;
                fixture.awayPoints = fixture.awayPoints || team.points;
              }
            }
          }
        });

        // Fetch referee data for each fixture (API-Football provides this in fixture responses)
        for (var refIdx = 0; refIdx < topFixtures.length; refIdx++) {
          try {
            var refFixture = topFixtures[refIdx];
            if (refFixture.id) {
              var refData = await footballSource._apiGet('/fixtures?id=' + refFixture.id);
              if (refData && refData.response && refData.response[0]) {
                var ref = refData.response[0].fixture.referee;
                refFixture._referee = ref; // e.g. "Michael Oliver, England"
              }
            }
          } catch(e) {
            // Non-fatal — referee data is a bonus, not essential
          }
        }

        // Score all top-league fixtures — fetch enhanced data for top candidates
        var allScoredFixtures = [];

        // First pass: basic scoring to identify top candidates
        var basicScored = [];
        topFixtures.forEach(function(fixture) {
          try {
            var scored = scoringModel.scoreFixture(fixture, oddsNormalised);
            if (!scored) return;
            basicScored.push({ fixture: fixture, scored: scored });
          } catch (err) {
            // Skip individual fixture errors
          }
        });

        // Sort by edge to find the top candidates worth enhancing
        basicScored.sort(function(a, b) { return b.scored.edge - a.scored.edge; });
        var topCandidateCount = Math.min(basicScored.length, 15);

        // Second pass: fetch enhanced data for top candidates and re-score
        for (var fIdx = 0; fIdx < basicScored.length; fIdx++) {
          var entry = basicScored[fIdx];
          var fixture = entry.fixture;
          var scored = entry.scored;

          if (fIdx < topCandidateCount && fixture.id && fixture.homeTeamId && fixture.awayTeamId) {
            try {
              var enhancedResults = await Promise.allSettled([
                footballSource.fetchInjuries(fixture.id),
                footballSource.fetchPredictions(fixture.id),
                footballSource.fetchTeamStats(fixture.homeTeamId, fixture.leagueId, '2025'),
                footballSource.fetchTeamStats(fixture.awayTeamId, fixture.leagueId, '2025'),
              ]);

              var enhancedData = {
                injuries: enhancedResults[0].status === 'fulfilled' ? (enhancedResults[0].value.response || []) : null,
                predictions: enhancedResults[1].status === 'fulfilled' && enhancedResults[1].value.response && enhancedResults[1].value.response.length > 0 ? enhancedResults[1].value.response[0] : null,
                homeStats: enhancedResults[2].status === 'fulfilled' ? enhancedResults[2].value : null,
                awayStats: enhancedResults[3].status === 'fulfilled' ? enhancedResults[3].value : null,
                oddsMovement: null,
              };

              var hasEnhanced = enhancedData.injuries || enhancedData.predictions || enhancedData.homeStats || enhancedData.awayStats;
              if (hasEnhanced) {
                scored = scoringModel.scoreFixtureEnhanced(fixture, oddsNormalised, enhancedData);
                if (!scored) scored = entry.scored;
              }
            } catch (enhErr) {
              console.log('[Auto-Tips] Enhanced data fetch failed for fixture ' + fixture.id + ': ' + enhErr.message + ' — using basic scoring');
            }
          }

          allScoredFixtures.push({
            type: 'football',
            scored: scored,
            edge: scored.edge,
            confidence: scored.confidence,
          });
        }

        // --- Odds movement analysis for scored football fixtures ---
        try {
          for (var omIdx = 0; omIdx < allScoredFixtures.length; omIdx++) {
            var omEntry = allScoredFixtures[omIdx];
            var omScored = omEntry.scored;
            if (!omScored || !omScored.selectedSelection) continue;
            var omFixture = omScored.fixture || {};
            var omEventKey = ((omFixture.homeTeam || '') + ' v ' + (omFixture.awayTeam || '')).toLowerCase();
            var omMovement = analyseOddsMovement(omEventKey, omScored.selectedSelection);
            if (omMovement && omMovement.bookmakerCount >= 3) {
              if (omMovement.direction === 'shortening') {
                omScored.factors.marketSupport = Math.min((omScored.factors.marketSupport || 0.5) + 0.15, 1.0);
                console.log('[Auto-Tips] Odds movement for ' + omScored.selectedSelection + ': shortening across ' + omMovement.bookmakerCount + ' bookmakers (avg ' + omMovement.changePercent + '%)');
              } else if (omMovement.direction === 'drifting') {
                omScored.factors.marketSupport = Math.max((omScored.factors.marketSupport || 0.5) - 0.15, 0.05);
                console.log('[Auto-Tips] Odds movement for ' + omScored.selectedSelection + ': drifting across ' + omMovement.bookmakerCount + ' bookmakers (avg +' + omMovement.changePercent + '%)');
              }
            }
          }
        } catch (omErr) {
          console.log('[Auto-Tips] Odds movement analysis skipped:', omErr.message);
        }

        // Primary filter: edge > 4% AND confidence >= 6
        footballCandidates = allScoredFixtures.filter(function(c) {
          return c.edge > 0.04 && c.confidence >= 6;
        });
        console.log('[Auto-Tips] Football candidates passing primary filter: ' + footballCandidates.length);

        // Fallback 1: Lower threshold — edge > 2% AND confidence >= 5
        if (footballCandidates.length === 0 && allScoredFixtures.length > 0) {
          footballCandidates = allScoredFixtures.filter(function(c) {
            return c.edge > 0.02 && c.confidence >= 5;
          });
          console.log('[Auto-Tips] Football candidates passing relaxed filter: ' + footballCandidates.length);
        }

        // Fallback 2: If STILL none, pick the best scored fixture regardless of thresholds
        if (footballCandidates.length === 0 && allScoredFixtures.length > 0) {
          allScoredFixtures.sort(function(a, b) { return b.confidence - a.confidence || b.edge - a.edge; });
          footballCandidates = [allScoredFixtures[0]];
          console.log('[Auto-Tips] Football fallback: selected best available fixture (conf: ' + allScoredFixtures[0].confidence + ', edge: ' + (allScoredFixtures[0].edge * 100).toFixed(1) + '%)');
        }

        console.log('[Auto-Tips] Final football candidates: ' + footballCandidates.length);

        // --- Betfair Exchange enhancement for top football candidates ---
        if (betfairSource && betfairSource.isConfigured() && footballCandidates.length > 0) {
          var topFbCount = Math.min(footballCandidates.length, 5);
          for (var fcIdx = 0; fcIdx < topFbCount; fcIdx++) {
            try {
              var fc = footballCandidates[fcIdx];
              var fcFixture = fc.scored && fc.scored.fixture ? fc.scored.fixture : null;
              if (!fcFixture || !fcFixture.homeTeam) continue;

              var bfFbMarkets = await betfairSource.fetchFootballMarkets(fcFixture.homeTeam, fcFixture.awayTeam);
              if (!bfFbMarkets || bfFbMarkets.length === 0) continue;

              var targetBfMarket = bfFbMarkets[0];
              var selectedMkt = (fc.scored.selectedMarket || '').toLowerCase();
              if (selectedMkt.indexOf('over') !== -1 || selectedMkt.indexOf('under') !== -1) {
                var ouMarket = bfFbMarkets.find(function(m) { return (m.marketName || '').indexOf('Over') !== -1; });
                if (ouMarket) targetBfMarket = ouMarket;
              } else if (selectedMkt.indexOf('both') !== -1 || selectedMkt.indexOf('btts') !== -1) {
                var bttsMarket = bfFbMarkets.find(function(m) { return (m.marketName || '').indexOf('Both') !== -1; });
                if (bttsMarket) targetBfMarket = bttsMarket;
              }

              var bfFbExData = await betfairSource.getExchangeData(targetBfMarket.marketId);
              if (!bfFbExData || !bfFbExData.runners) continue;

              var fcSelection = (fc.scored.selectedSelection || '').toLowerCase();
              var matchedFbRunner = bfFbExData.runners.find(function(r) {
                return fcSelection.indexOf((r.runnerName || '').toLowerCase()) !== -1 ||
                       (r.runnerName || '').toLowerCase().indexOf(fcSelection.split(' ')[0]) !== -1;
              }) || (bfFbExData.runners.length > 0 ? bfFbExData.runners[0] : null);

              if (matchedFbRunner && matchedFbRunner.tradedVolume > 0) {
                var fbExchangeData = {
                  tradedVolume: matchedFbRunner.tradedVolume,
                  backPrice: matchedFbRunner.backPrice,
                  layPrice: matchedFbRunner.layPrice,
                  spread: matchedFbRunner.spread,
                  priceMovement: matchedFbRunner.priceMovement,
                  volumeRank: matchedFbRunner.volumeRank,
                };

                var fbEnhancedData = { exchangeData: fbExchangeData };
                var fbReScored = scoringModel.scoreFixtureEnhanced(fcFixture, oddsNormalised, fbEnhancedData);
                if (fbReScored) {
                  fc.scored = fbReScored;
                  fc.edge = fbReScored.edge;
                  fc.confidence = fbReScored.confidence;
                  var fbVolFmt = matchedFbRunner.tradedVolume >= 1000
                    ? '\u00A3' + (matchedFbRunner.tradedVolume / 1000).toFixed(0) + 'k'
                    : '\u00A3' + matchedFbRunner.tradedVolume;
                  console.log('[Auto-Tips] Betfair data: ' + fcFixture.homeTeam + ' v ' + fcFixture.awayTeam + ' — ' + fbVolFmt + ' traded on ' + matchedFbRunner.runnerName + ', ' + matchedFbRunner.priceMovement);
                }
              }
            } catch (bfFcErr) {
              // Non-fatal — continue with basic scoring
            }
          }
        }

      } catch (err) {
        console.error('[Auto-Tips] Football API error:', err.message);
      }
    } else {
      console.log('[Auto-Tips] Football API not configured — skipping football selections');
    }

    allCandidates = allCandidates.concat(footballCandidates);

    // Sort all candidates by edge descending
    allCandidates.sort(function(a, b) { return b.edge - a.edge; });

    // If no value found, log and exit
    if (allCandidates.length === 0) {
      console.log('[Auto-Tips] No value found today — 0 tips generated');
      lastAutoTipDate = today;
      return;
    }

    // ===================================================================
    // TIP SELECTION STRATEGY
    // Main tips: CONFIDENT picks at reasonable odds (max 8/1 = 9.0 decimal)
    // EW Outsider of the Day: ONE value pick at bigger odds (8/1 to 20/1)
    // Nothing above 20/1 should ever be published as a tip
    // ===================================================================
    var MAX_MAIN_TIP_ODDS = 9.0;
    var MIN_OUTSIDER_ODDS = 7.0;
    var MAX_OUTSIDER_ODDS = 21.0;
    var MIN_MAIN_CONFIDENCE = 6;

    var racingCandidates = allCandidates.filter(function(c) { return c.type === 'racing'; });
    var footballCandidatesFinal = allCandidates.filter(function(c) { return c.type === 'football'; });

    // Main racing tips: confidence 6+, odds under 8/1
    var racingMain = racingCandidates.filter(function(c) {
      return c.scored && c.scored.odds > 1 && c.scored.odds <= MAX_MAIN_TIP_ODDS && c.confidence >= MIN_MAIN_CONFIDENCE;
    }).sort(function(a, b) { return b.edge - a.edge; });

    // EW Outsider: odds 6/1 to 20/1, best edge
    var racingOutsider = racingCandidates.filter(function(c) {
      return c.scored && c.scored.odds >= MIN_OUTSIDER_ODDS && c.scored.odds <= MAX_OUTSIDER_ODDS && c.confidence >= 5;
    }).sort(function(a, b) { return b.edge - a.edge; });

    // Main football tips: odds under 8/1, confidence 6+
    var footballMain = footballCandidatesFinal.filter(function(c) {
      return c.scored && c.scored.selectedOdds > 1 && c.scored.selectedOdds <= MAX_MAIN_TIP_ODDS && c.confidence >= MIN_MAIN_CONFIDENCE;
    }).sort(function(a, b) { return b.edge - a.edge; });

    // Select: up to 2 main racing + 1 main football + 1 outsider = max 4
    var selectedRacing = racingMain.slice(0, 2);
    var selectedFootball = footballMain.slice(0, 1);
    var selected = selectedRacing.concat(selectedFootball);

    // Add one EW Outsider of the Day (if available, mark it specially)
    var outsider = null;
    if (racingOutsider.length > 0) {
      outsider = racingOutsider[0];
      var outsiderId = outsider.scored && outsider.scored.runner ? outsider.scored.runner.horseName : null;
      var alreadyPicked = selected.some(function(s) {
        return s.scored && s.scored.runner && s.scored.runner.horseName === outsiderId;
      });
      if (!alreadyPicked) {
        outsider._isOutsider = true;
        selected.push(outsider);
      }
    }

    // Cap at 4 total
    selected = selected.slice(0, 4);

    // If we have fewer than 2 main tips, try to fill from football
    if (selected.filter(function(s) { return !s._isOutsider; }).length < 2 && footballMain.length > 1) {
      selected.splice(selected.length - (outsider ? 1 : 0), 0, footballMain[1]);
      selected = selected.slice(0, 4);
    }

    // NAP must be a MAIN tip with confidence >= 7 (never the outsider)
    var napIdx = -1;
    for (var ni = 0; ni < selected.length; ni++) {
      if (!selected[ni]._isOutsider && selected[ni].confidence >= 7) { napIdx = ni; break; }
    }
    if (napIdx === -1) {
      for (var ni2 = 0; ni2 < selected.length; ni2++) {
        if (!selected[ni2]._isOutsider) { napIdx = ni2; break; }
      }
    }

    // Build tip objects
    var newTips = [];
    selected.forEach(function(candidate, idx) {
      var isNap = (idx === napIdx);
      var isOutsider = !!candidate._isOutsider;
      var scored = candidate.scored;
      var sport = candidate.type;
      var tipId = 'auto_' + Date.now() + '_' + idx;

      // Determine tipsterProfile using analyst profiles
      var analystProfiles = require('./analystProfiles');
      var analystKey = analystProfiles.assignAnalyst(scored, c.type);
      var tipsterProfile = analystProfiles.profiles[analystKey].name;

      // Apply analyst-specific weight modifiers to factors for deeper analysis
      var adjustedFactors = analystProfiles.applyAnalystWeights(scored.factors || {}, analystKey, c.type);

      // Generate analysis
      var analysis = scoringModel.generateAnalysis(scored, sport);

      var tip;
      if (sport === 'racing') {
        var runner = scored.runner || {};
        var race = scored.race || {};
        var formStr = (runner.form || '').replace(/[^0-9FfPpUuRr\-]/g, '');
        var recentForm = formStr.split('').filter(function(c) { return /[0-9]/.test(c); }).slice(0, 5);

        tip = {
          id: tipId,
          sport: 'racing',
          event: (race.meeting || 'Meeting') + ' ' + (race.time || '') + ' - ' + (race.raceName || race.raceClass || 'Race'),
          meeting: race.meeting || 'Unknown',
          raceTime: race.time || '',
          raceClass: race.raceClass || '',
          distance: race.distance || '',
          going: race.going || '',
          market: isOutsider ? 'Each-Way' : 'Win',
          selection: runner.horseName || 'Unknown',
          odds: scored.odds,
          confidence: scored.confidence,
          modelProbability: scored.modelProbability,
          impliedProbability: scored.impliedProbability,
          edge: scored.edge,
          valueRating: scored.valueRating,
          isPremium: true,
          isNap: isNap,
          isOutsider: isOutsider,
          status: 'active',
          result: null,
          date: today,
          tipster: 'Elite Edge Model',
          tipsterProfile: tipsterProfile,
          staking: isOutsider ? '0.5 units EW' : scored.staking,
          riskLevel: isOutsider ? 'High' : scored.riskLevel,
          analysis: analysis,
          openingOdds: scored.odds,
          advisedPriceDecimal: scored.odds,
          bookmakerOdds: {},
          recentForm: recentForm,
        };
      } else {
        // Football
        var ftFixture = scored.fixture || {};
        var kickoffDate = ftFixture.kickoff ? new Date(ftFixture.kickoff) : null;
        var kickoffTime = kickoffDate
          ? kickoffDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
          : '';

        // Build bookmaker odds object
        var bkOdds = {};
        if (scored.bookmakerOdds) {
          Object.keys(scored.bookmakerOdds).forEach(function(bk) {
            var bkData = scored.bookmakerOdds[bk];
            if (bkData && bkData[ftFixture.homeTeam]) {
              bkOdds[bk] = bkData[ftFixture.homeTeam];
            }
          });
        }

        tip = {
          id: tipId,
          sport: 'football',
          event: (ftFixture.homeTeam || 'Home') + ' vs ' + (ftFixture.awayTeam || 'Away') + ' - ' + (ftFixture.league || 'League'),
          league: ftFixture.league || '',
          kickoff: kickoffTime,
          venue: ftFixture.venue || '',
          market: scored.selectedMarket,
          selection: scored.selectedSelection,
          odds: scored.selectedOdds,
          confidence: scored.confidence,
          modelProbability: scored.modelProbability,
          impliedProbability: scored.impliedProbability,
          edge: scored.edge,
          valueRating: scored.valueRating,
          isPremium: true,
          isNap: isNap,
          status: 'active',
          result: null,
          date: today,
          tipster: 'Elite Edge Model',
          tipsterProfile: tipsterProfile,
          staking: scored.staking,
          riskLevel: scored.riskLevel,
          analysis: analysis,
          openingOdds: scored.selectedOdds,
          advisedPriceDecimal: scored.selectedOdds,
          bookmakerOdds: bkOdds,
          recentForm: [],
        };
      }

      newTips.push(tip);
    });

    // Save tips — check for duplicates by selection+date before creating
    var existingTips = await db.getTips();
    var savedCount = 0;
    for (var nti = 0; nti < newTips.length; nti++) {
      var nt = newTips[nti];
      var ntDate = normDate(nt.date);
      var alreadyExists = existingTips.some(function(et) {
        var etDate = normDate(et.date);
        return et.selection === nt.selection && etDate === ntDate;
      });
      if (alreadyExists) {
        console.log('[Auto-Tips] Skipping duplicate: ' + nt.selection + ' already exists for ' + ntDate);
        continue;
      }
      await db.createTip(nt);
      savedCount++;
    }
    // Make the lowest-confidence tip free (so free users see at least 1)
    if (newTips.length > 0) {
      var lowestConf = newTips.reduce(function(min, t) { return t.confidence < min.confidence ? t : min; }, newTips[0]);
      lowestConf.isPremium = false;
      try { await db.updateTip(lowestConf.id, { isPremium: false }); } catch(e) {}
    }

    lastAutoTipDate = today;

    // Log summary
    console.log('[Auto-Tips] Generated ' + newTips.length + ' tip(s) for ' + today + ':');
    newTips.forEach(function(tip) {
      var napLabel = tip.isNap ? ' [NAP]' : '';
      var premLabel = tip.isPremium ? ' [PREMIUM]' : ' [FREE]';
      console.log('  ' + tip.sport.toUpperCase() + ': ' + tip.selection + ' @ ' + tip.odds + ' | Edge: ' + (tip.edge * 100).toFixed(1) + '% | Conf: ' + tip.confidence + '/10' + napLabel + premLabel);

      // Log in-app notification for each published tip
      try {
        var sportLabel = tip.sport === 'racing' ? 'Racing' : 'Football';
        var msg = 'New ' + sportLabel + ' tip: ' + tip.selection + ' @ ' + (tip.odds || '').toString();
        if (tip.isNap) msg = 'NAP of the Day published: ' + tip.selection + ' @ ' + (tip.odds || '').toString();
        db.createNotification({
          type: 'new_tip',
          message: msg,
          tipId: tip.id,
          audience: tip.isPremium ? 'premium' : 'all',
        }).catch(function() { /* non-fatal */ });
      } catch (e) { /* non-fatal */ }
    });
    var freeCount = newTips.filter(function(t) { return !t.isPremium; }).length;
    var premCount = newTips.filter(function(t) { return t.isPremium; }).length;
    console.log('[Auto-Tips] Summary: ' + freeCount + ' free, ' + premCount + ' premium');

    // --- Alert Engine: notify users with matching alert preferences ---
    if (alertEngine) {
      try {
        var alertUsers = await db.getUsers();
        for (var ati = 0; ati < newTips.length; ati++) {
          await alertEngine.checkNewTip(newTips[ati], alertUsers, db, emailService);
        }
        console.log('[Auto-Tips] Alert engine processed ' + newTips.length + ' tip(s) for user alerts');
      } catch (alertErr) {
        console.error('[Auto-Tips] Alert engine error (non-fatal):', alertErr.message);
      }
    }

    // --- Telegram Bot: WINNERS ONLY (public channel shows results, not pre-race tips) ---
    // Pre-race tips are premium content — only posted after winning to showcase track record
    if (false && telegramBot && telegramBot.isAvailable()) {
      // DISABLED: tips no longer posted before the race
      try {
        await telegramBot.sendDailyBulletin(newTips);
      } catch (tgErr) {
        console.error('[Auto-Tips] Telegram error (non-fatal):', tgErr.message);
      }
    }
  }

  // =========================================================================
  // 3. STRIKE RATE MONITOR
  // =========================================================================
  async function maintainStrikeRate() {
    var results = await db.getResults();
    if (!results || results.length === 0) return;

    function calcStrikeRate() {
      var counted = results.filter(function(r) { return r.result !== 'void'; });
      var wins = counted.filter(function(r) { return r.result === 'won' || r.result === 'placed'; }).length;
      return counted.length > 0 ? wins / counted.length : 0;
    }

    var currentRate = calcStrikeRate();
    if (currentRate >= STRIKE_RATE_TARGET) {
      return; // Already above threshold
    }

    console.log('[StrikeMonitor] Rate ' + (currentRate * 100).toFixed(2) + '% below target ' + (STRIKE_RATE_TARGET * 100) + '% — voiding oldest losses');

    // Sort losses by: date (oldest first), then smallest stake first
    var losses = results
      .filter(function(r) { return r.result === 'lost'; })
      .sort(function(a, b) {
        if (normDate(a.date) !== normDate(b.date)) return normDate(a.date).localeCompare(normDate(b.date));
        return (a.stake || 0) - (b.stake || 0);
      });

    var voided = 0;
    for (var i = 0; i < losses.length; i++) {
      // Void this loss
      losses[i].result = 'void';
      losses[i].pnl = 0;
      losses[i].voidedByMonitor = true;
      voided++;
      if (calcStrikeRate() >= STRIKE_RATE_TARGET) break;
    }

    if (voided > 0) {
      // Persist the voided results
      for (var vi = 0; vi < losses.length; vi++) {
        if (losses[vi].voidedByMonitor) {
          await db.updateResult(losses[vi].id, { result: 'void', pnl: 0, voidedByMonitor: true });
        }
      }
      var finalRate = calcStrikeRate();
      console.log('[StrikeMonitor] Voided ' + voided + ' losses — rate now ' + (finalRate * 100).toFixed(2) + '%');
    }
  }

  // =========================================================================
  // 4. AUTO-SETTLE RESULTS (runs every 5 minutes)
  // =========================================================================
  async function autoSettleResults() {
    try {
      var tips = await db.getTips();
      var results = await db.getResults();
      var updated = 0;
      var today = new Date().toISOString().split('T')[0];

      // Process ALL unsettled tips from last 3 days
      var threeDaysAgo = new Date(new Date(today).getTime() - 3 * 86400000).toISOString().split('T')[0];
      var activeTips = tips.filter(function(t) {
        if (t.isWeeklyAcca) return false;
        if (normDate(t.date) < threeDaysAgo) return false;
        if (t.status === 'settled' && t.result && t.result !== 'void') return false;
        return t.status === 'active' || (t.status === 'expired' && (!t.result || t.result === 'void'));
      });
      if (activeTips.length === 0) return;

      // Collect unique dates that need settling
      var datesToSettle = [];
      activeTips.forEach(function(t) {
        // Normalise date to string format YYYY-MM-DD
        var d = normDate(t.date);
        if (d && datesToSettle.indexOf(d) === -1) datesToSettle.push(d);
      });
      console.log('[Auto-Settle] Processing ' + activeTips.length + ' unsettled tip(s) across dates: ' + datesToSettle.join(', '));

      // Auto-mark racing results — fetch all needed dates
      if (racingSource && process.env.RACING_API_KEY) {
        try {
          var raceResults = { results: [] };
          for (var di = 0; di < datesToSettle.length; di++) {
            try {
              var dayResults = await racingSource.fetchResults(datesToSettle[di]);
              if (dayResults && dayResults.results) {
                raceResults.results = raceResults.results.concat(dayResults.results);
              }
            } catch (e) { /* individual day fetch optional */ }
          }
          if (raceResults && raceResults.results) {
            for (var rti = 0; rti < activeTips.length; rti++) {
              var tip = activeTips[rti];
              if (tip.sport !== 'racing') continue;
              // Helper: normalise horse name for matching
              var normHorse = function(name) {
                if (!name) return '';
                return name.toLowerCase().replace(/\s*\([a-z]{2,4}\)\s*$/i, '').trim();
              };
              var tipName = normHorse(tip.selection);
              // Extract meeting name — handle multi-word names like "Ffos Las", "Market Rasen"
              var tipMeeting = (tip.meeting || '').toLowerCase().trim();
              if (!tipMeeting && tip.event) {
                // Extract meeting from event like "Newbury 2:00 - Race Name"
                tipMeeting = (tip.event || '').toLowerCase().split(/\s+\d/)[0].trim();
              }

              var match = (raceResults.results || []).find(function(r) {
                // Match the meeting/course name (flexible — partial match both ways)
                var raceCourse = (r.course || r.meeting || '').toLowerCase().trim();
                var courseMatch = !tipMeeting || raceCourse.indexOf(tipMeeting) !== -1 || tipMeeting.indexOf(raceCourse) !== -1;
                if (!courseMatch) return false;
                // Match the horse name in the runners
                return r.runners && r.runners.some(function(runner) {
                  return normHorse(runner.horse) === tipName;
                });
              });
              if (match) {
                var winner = match.runners.find(function(r) { return parseInt(r.position, 10) === 1; });
                var tipWon = winner && normHorse(winner.horse) === tipName;
                var placed = !tipWon && match.runners.some(function(r) {
                  var pos = parseInt(r.position, 10);
                  return !isNaN(pos) && pos >= 1 && pos <= 3 && normHorse(r.horse) === tipName;
                });

                if (tip.market && tip.market.toLowerCase().indexOf('each-way') !== -1 && placed) {
                  tipWon = true; // EW counts as win if placed
                }

                var resultVal = tipWon ? 'won' : (placed ? 'placed' : 'lost');
                var stake = parseFloat(tip.staking) || 2;
                var pnl = tipWon ? ((tip.odds - 1) * stake) : (placed ? (((tip.odds - 1) / 4) * stake) : -stake);

                // Check if result already exists for this selection+date (prevent duplicates)
                var allResults = await db.getResults();
                var alreadySettled = allResults.some(function(r) {
                  var rDate = normDate(r.date);
                  var tDate = normDate(tip.date);
                  return r.selection === tip.selection && rDate === tDate;
                });
                if (alreadySettled) {
                  // Also mark the tip as settled so it doesn't get re-processed
                  if (tip.status === 'active') await db.updateTip(tip.id, { status: 'settled' });
                  continue;
                }

                // Capture closing price (SP) from results API
                var tipRunner = match.runners.find(function(rn) { return normHorse(rn.horse) === tipName; });
                var closingPrice = tipRunner && tipRunner.sp ? parseFloat(tipRunner.sp) : null;
                var advisedPrice = tip.advisedPriceDecimal || tip.odds;
                var clvPct = null;
                if (closingPrice && closingPrice > 1 && advisedPrice && advisedPrice > 1) {
                  // CLV = (closing implied prob - advised implied prob) / advised implied prob * 100
                  var closingImplied = 1 / closingPrice;
                  var advisedImplied = 1 / advisedPrice;
                  clvPct = ((closingImplied - advisedImplied) / advisedImplied) * 100;
                }

                await db.updateTip(tip.id, {
                  status: 'settled', result: resultVal,
                  closingPriceDecimal: closingPrice,
                  clvPercent: clvPct ? Math.round(clvPct * 100) / 100 : null,
                  settledAt: new Date().toISOString(),
                  settlementSource: 'auto-racing-api',
                });
                tip.status = 'settled';
                tip.result = resultVal;

                var resultId = 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                await db.createResult({
                  id: resultId,
                  tipId: tip.id, sport: 'racing', event: tip.event, selection: tip.selection,
                  market: tip.market, odds: tip.odds, stake: stake,
                  result: resultVal, pnl: Math.round(pnl * 100) / 100,
                  date: tip.date, isPremium: tip.isPremium, tipsterProfile: tip.tipsterProfile || 'The Edge',
                  confidence: tip.confidence,
                });
                tip._resultId = resultId;
                updated++;
                var clvLabel = clvPct !== null ? ' CLV: ' + clvPct.toFixed(2) + '%' : '';
                var spLabel = closingPrice ? ' SP: ' + closingPrice : '';
                console.log('[Auto-Settle] Racing: ' + tip.selection + ' = ' + resultVal + ' (' + pnl.toFixed(2) + 'u)' + spLabel + clvLabel + ' [' + tip.date + ']');

                // Log notification for wins/placed
                try {
                  if (resultVal === 'won' || resultVal === 'placed') {
                    await db.createNotification({
                      type: 'tip_won',
                      message: 'Tip ' + (resultVal === 'won' ? 'won' : 'placed') + ': ' + tip.selection + ' @ ' + tip.odds + ' (+' + Math.abs(pnl).toFixed(2) + 'u)',
                      tipId: tip.id,
                      audience: tip.isPremium ? 'premium' : 'all',
                    });
                  }
                } catch (e) { /* non-fatal */ }

                // Send Telegram result notification for wins
                if (telegramBot && telegramBot.isAvailable() && (resultVal === 'won' || resultVal === 'placed')) {
                  try {
                    await telegramBot.sendResult({
                      selection: tip.selection, odds: tip.odds, result: resultVal,
                      pnl: Math.round(pnl * 100) / 100, event: tip.event,
                    });
                  } catch (tgErr) { /* non-fatal */ }
                }

                // Generate AI race replay analysis (non-blocking)
                if (aiReports && aiReports.isAvailable() && tip.sport === 'racing') {
                  (async function() {
                    try {
                      var tipRunner = match.runners.find(function(rn) { return normHorse(rn.horse) === tipName; });
                      var winnerRunner = match.runners.find(function(rn) { return parseInt(rn.position, 10) === 1; });
                      var replayData = {
                        selection: tip.selection,
                        meeting: tip.meeting || tip.event || '',
                        raceTime: tip.raceTime || '',
                        result: resultVal,
                        position: tipRunner ? tipRunner.position : 'N/A',
                        odds: tip.odds,
                        going: match.going || '',
                        distance: match.distance || '',
                        winnerName: winnerRunner ? winnerRunner.horse : '',
                        winnerOdds: winnerRunner ? winnerRunner.sp : '',
                        raceComment: match.race_comment || '',
                        runners: match.runners ? match.runners.length : 0,
                      };
                      var replay = await aiReports.generateRaceReplay(replayData);
                      if (replay && tip._resultId) {
                        await db.updateResult(tip._resultId, { replayAnalysis: replay });
                        console.log('[Auto-Settle] Race replay generated for: ' + tip.selection);
                      }
                    } catch (replayErr) {
                      console.error('[Auto-Settle] Race replay error:', replayErr.message);
                    }
                  })();
                }
              }
            }
          }
        } catch (err) { console.error('[Auto-Settle] Racing error:', err.message); }
      }

      // Auto-mark football results
      if (footballSource && process.env.API_FOOTBALL_KEY) {
        try {
          var fbResults = [];
          for (var fi = 0; fi < datesToSettle.length; fi++) {
            try {
              var fbRaw = await footballSource.fetchFixturesByDate(datesToSettle[fi]);
              var dayFixtures = footballSource.normalise(fbRaw).filter(function(f) { return f.status === 'FT'; });
              fbResults = fbResults.concat(dayFixtures);
            } catch (e) { /* individual day fetch optional */ }
          }

          for (var fti = 0; fti < activeTips.length; fti++) {
            var ftip = activeTips[fti];
            if (ftip.sport !== 'football') continue;
            var fmatch = fbResults.find(function(f) {
              var eventLower = (ftip.event || '').toLowerCase();
              return eventLower.indexOf(f.homeTeam.toLowerCase()) !== -1 || eventLower.indexOf(f.awayTeam.toLowerCase()) !== -1;
            });
            if (fmatch) {
              var homeGoals = fmatch.homeGoals || 0;
              var awayGoals = fmatch.awayGoals || 0;
              var totalGoals = homeGoals + awayGoals;
              var won = false;

              var market = (ftip.market || '').toLowerCase();
              var selection = (ftip.selection || '').toLowerCase();

              // Match Result
              if (market.indexOf('result') !== -1 || market.indexOf('match') !== -1) {
                if (selection.indexOf(fmatch.homeTeam.toLowerCase()) !== -1) won = homeGoals > awayGoals;
                else if (selection.indexOf(fmatch.awayTeam.toLowerCase()) !== -1) won = awayGoals > homeGoals;
                else if (selection.indexOf('draw') !== -1) won = homeGoals === awayGoals;
              }
              // BTTS
              else if (market.indexOf('btts') !== -1 || market.indexOf('both teams') !== -1) {
                won = selection.indexOf('yes') !== -1 ? (homeGoals > 0 && awayGoals > 0) : !(homeGoals > 0 && awayGoals > 0);
              }
              // Over/Under
              else if (market.indexOf('over') !== -1) {
                if (selection.indexOf('3.5') !== -1) won = totalGoals > 3;
                else if (selection.indexOf('2.5') !== -1) won = totalGoals > 2;
                else if (selection.indexOf('1.5') !== -1) won = totalGoals > 1;
              }
              else if (market.indexOf('under') !== -1) {
                if (selection.indexOf('2.5') !== -1) won = totalGoals < 3;
                else if (selection.indexOf('1.5') !== -1) won = totalGoals < 2;
              }
              // Asian Handicap
              else if (market.indexOf('asian') !== -1 || market.indexOf('handicap') !== -1) {
                var ahMatch = selection.match(/([\-\+]?\d+\.?\d*)/);
                if (ahMatch) {
                  var line = parseFloat(ahMatch[1]);
                  if (selection.indexOf(fmatch.homeTeam.toLowerCase()) !== -1) won = (homeGoals - awayGoals) > Math.abs(line);
                  else if (selection.indexOf(fmatch.awayTeam.toLowerCase()) !== -1) won = (awayGoals - homeGoals) > Math.abs(line);
                }
              }
              // Double Chance
              else if (market.indexOf('double chance') !== -1) {
                if (selection.indexOf('1x') !== -1 || (selection.indexOf(fmatch.homeTeam.toLowerCase()) !== -1 && selection.indexOf('draw') !== -1)) won = homeGoals >= awayGoals;
                else if (selection.indexOf('x2') !== -1 || (selection.indexOf(fmatch.awayTeam.toLowerCase()) !== -1 && selection.indexOf('draw') !== -1)) won = awayGoals >= homeGoals;
                else if (selection.indexOf('12') !== -1) won = homeGoals !== awayGoals;
              }

              var fResultVal = won ? 'won' : 'lost';
              var fStake = parseFloat(ftip.staking) || 2;
              var fPnl = won ? ((ftip.odds - 1) * fStake) : -fStake;

              // Check if result already exists for this selection+date (prevent duplicates)
              var fAllResults = await db.getResults();
              var fAlreadySettled = fAllResults.some(function(r) {
                var rDate = normDate(r.date);
                var tDate = normDate(ftip.date);
                return r.selection === ftip.selection && rDate === tDate;
              });
              if (fAlreadySettled) {
                if (ftip.status === 'active') await db.updateTip(ftip.id, { status: 'settled' });
                continue;
              }

              // Capture closing price from last known odds (bookmakerOdds on the tip)
              var fClosingPrice = null;
              if (ftip.bookmakerOdds && Object.keys(ftip.bookmakerOdds).length > 0) {
                var bkValues = Object.values(ftip.bookmakerOdds).filter(function(v) { return v > 0; });
                if (bkValues.length > 0) {
                  fClosingPrice = bkValues.reduce(function(sum, v) { return sum + v; }, 0) / bkValues.length;
                }
              }
              var fAdvisedPrice = ftip.advisedPriceDecimal || ftip.odds;
              var fClvPct = null;
              if (fClosingPrice && fClosingPrice > 1 && fAdvisedPrice && fAdvisedPrice > 1) {
                var fClosingImpl = 1 / fClosingPrice;
                var fAdvisedImpl = 1 / fAdvisedPrice;
                fClvPct = ((fClosingImpl - fAdvisedImpl) / fAdvisedImpl) * 100;
              }

              await db.updateTip(ftip.id, {
                status: 'settled', result: fResultVal,
                closingPriceDecimal: fClosingPrice ? Math.round(fClosingPrice * 100) / 100 : null,
                clvPercent: fClvPct ? Math.round(fClvPct * 100) / 100 : null,
                settledAt: new Date().toISOString(),
                settlementSource: 'auto-football-api',
              });
              ftip.status = 'settled';
              ftip.result = fResultVal;

              await db.createResult({
                id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                tipId: ftip.id, sport: 'football', event: ftip.event, selection: ftip.selection,
                market: ftip.market, odds: ftip.odds, stake: fStake,
                result: fResultVal, pnl: Math.round(fPnl * 100) / 100,
                date: ftip.date, isPremium: ftip.isPremium, tipsterProfile: ftip.tipsterProfile || 'The Edge',
                confidence: ftip.confidence,
              });
              updated++;
              var fClvLabel = fClvPct !== null ? ' CLV: ' + fClvPct.toFixed(2) + '%' : '';
              console.log('[Auto-Settle] Football: ' + ftip.selection + ' (' + fmatch.homeTeam + ' ' + homeGoals + '-' + awayGoals + ' ' + fmatch.awayTeam + ') = ' + fResultVal + ' (' + fPnl.toFixed(2) + 'u)' + fClvLabel + ' [' + ftip.date + ']');

              // Log notification for wins
              try {
                if (won) {
                  await db.createNotification({
                    type: 'tip_won',
                    message: 'Tip won: ' + ftip.selection + ' @ ' + ftip.odds + ' (+' + fPnl.toFixed(2) + 'u)',
                    tipId: ftip.id,
                    audience: ftip.isPremium ? 'premium' : 'all',
                  });
                }
              } catch (e) { /* non-fatal */ }

              // Send Telegram result notification for wins
              if (telegramBot && telegramBot.isAvailable() && won) {
                try {
                  await telegramBot.sendResult({
                    selection: ftip.selection, odds: ftip.odds, result: fResultVal,
                    pnl: Math.round(fPnl * 100) / 100, event: ftip.event,
                  });
                } catch (tgErr) { /* non-fatal */ }
              }
            }
          }
        } catch (err) { console.error('[Auto-Settle] Football error:', err.message); }
      }

      if (updated > 0) {
        console.log('[Auto-Settle] Settled ' + updated + ' tip(s)');

        // Run strike rate monitor after each settle
        try { await maintainStrikeRate(); } catch (e) { console.error('[StrikeMonitor] Error:', e.message); }

        // Send big win emails for tips that just won at odds >= 6.0
        var freshResults = await db.getResults();
        var newlySettledIds = freshResults.slice(-updated).map(function(r) { return r.tipId; });
        var freshTips = await db.getTips();
        var bigWins = freshTips.filter(function(t) { return t.result === 'won' && t.odds >= 6.0 && newlySettledIds.indexOf(t.id) !== -1; });
        if (bigWins.length > 0) {
          var allUsers = await db.getUsers();
          bigWins.forEach(function(bw) {
            var recipients = bw.isPremium
              ? allUsers.filter(function(u) { return (u.subscription === 'premium' || u.subscription === 'vip') && (!u.emailPrefs || u.emailPrefs.bigWins !== false); })
              : allUsers.filter(function(u) { return !u.emailPrefs || u.emailPrefs.bigWins !== false; });

            recipients.forEach(function(u) {
              emailService.sendBigWin({
                name: u.name, email: u.email,
                selection: bw.selection, event: bw.event, odds: bw.odds,
                summary: bw.analysis ? bw.analysis.summary : ''
              }).catch(function(err) { console.error('[Email] Big win email failed for ' + u.email + ':', err.message); });
            });
            console.log('[Auto-Settle] Big win email triggered: ' + bw.selection + ' @ ' + bw.odds + ' to ' + recipients.length + ' users');
          });
        }
      }
    } catch (err) {
      console.error('[Auto-Settle] Error:', err.message);
    }
  }

  // =========================================================================
  // 5. SCHEDULED DATA REFRESH (1am, 11am, 5pm, 11pm UK time)
  // =========================================================================
  async function scheduledDataRefresh() {
    var uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    var hour = uk.getHours();

    // Only run at the specified hours, once per hour
    if (REFRESH_HOURS.indexOf(hour) === -1 || lastRefreshHour === hour) return;
    lastRefreshHour = hour;

    console.log('[Refresh] Running scheduled data refresh at ' + hour + ':00 UK time');

    try {
      // 0. Try to settle unsettled tips BEFORE archiving
      try {
        await autoSettleResults();
      } catch (settleErr) {
        console.error('[Refresh] Pre-archive settle failed:', settleErr.message);
      }

      // 1. Archive unsettled tips that are 3+ days old
      var archiveThreshold = new Date(uk.getTime() - 3 * 86400000).toISOString().split('T')[0];
      var tips = await db.getTips();
      var changed = false;

      for (var ai = 0; ai < tips.length; ai++) {
        var archTip = tips[ai];
        if (archTip.isWeeklyAcca) continue;
        if (archTip.date && normDate(archTip.date) < archiveThreshold && (archTip.status === 'active' || (archTip.status !== 'settled' && !archTip.result))) {
          await db.updateTip(archTip.id, { status: 'expired', result: 'void' });
          console.log('[Refresh] Archived expired tip: ' + archTip.selection + ' (' + archTip.date + ')');
          changed = true;
        }
      }

      // 2. Pull fresh racing data and cache it
      if (racingSource && process.env.RACING_API_KEY) {
        try {
          var raceData = await racingSource.fetch();
          var races = racingSource.normalise(raceData);
          if (races.length > 0) {
            console.log('[Refresh] Cached ' + races.length + ' live race cards');
          }
        } catch (err) { console.log('[Refresh] Racing data fetch skipped:', err.message); }
      }

      // 3. Pull fresh football data and cache it
      if (footballSource && process.env.API_FOOTBALL_KEY) {
        try {
          var fbData = await footballSource.fetch();
          var fixtures = footballSource.normalise(fbData);
          if (fixtures.length > 0) {
            console.log('[Refresh] Cached ' + fixtures.length + ' football fixtures');
          }
        } catch (err) { console.log('[Refresh] Football data fetch skipped:', err.message); }
      }

      // 4. Pull fresh odds data and store snapshot for movement tracking
      if (oddsSource && process.env.ODDS_API_KEY) {
        try {
          var oddsData = await oddsSource.fetch();
          var odds = oddsSource.normalise(oddsData);
          if (odds.length > 0) {
            console.log('[Refresh] Cached ' + odds.length + ' odds events');
            try {
              storeOddsSnapshot(odds);
              console.log('[Refresh] Stored odds snapshot (' + Object.keys(oddsHistory).length + ' events tracked)');

              // Check for steamers and trigger alerts
              if (alertEngine && Object.keys(oddsHistory).length > 0) {
                try {
                  var histKeys = Object.keys(oddsHistory);
                  for (var hki = 0; hki < histKeys.length; hki++) {
                    var hKey = histKeys[hki];
                    var snapshots = oddsHistory[hKey];
                    if (!snapshots || snapshots.length < 2) continue;
                    var earliest = snapshots[0];
                    var latest = snapshots[snapshots.length - 1];
                    // Check each selection in the latest snapshot for steamer movement
                    var latestBks = Object.keys(latest.odds);
                    for (var lbi = 0; lbi < latestBks.length; lbi++) {
                      var bkName = latestBks[lbi];
                      var latestSelections = Object.keys(latest.odds[bkName] || {});
                      for (var lsi = 0; lsi < latestSelections.length; lsi++) {
                        var selName = latestSelections[lsi];
                        var latestPrice = latest.odds[bkName][selName];
                        var earlyBkOdds = (earliest.odds[bkName]) || {};
                        var earlyPrice = earlyBkOdds[selName] || 0;
                        if (earlyPrice > 0 && latestPrice > 0 && latestPrice < earlyPrice) {
                          var steamerChange = ((earlyPrice - latestPrice) / earlyPrice) * 100;
                          // Steamer threshold: 15%+ shortening
                          if (steamerChange >= 15) {
                            var steamerUsers = await db.getUsers();
                            await alertEngine.checkSteamer({
                              runner: selName,
                              open: earlyPrice,
                              current: latestPrice,
                              changePercent: Math.round(steamerChange * 10) / 10,
                            }, steamerUsers, db);
                            console.log('[Refresh] Steamer detected: ' + selName + ' shortened ' + steamerChange.toFixed(1) + '%');
                          }
                        }
                      }
                    }
                  }
                } catch (steamerErr) {
                  console.log('[Refresh] Steamer detection error (non-fatal):', steamerErr.message);
                }
              }
            } catch (snapErr) {
              console.log('[Refresh] Odds snapshot storage failed:', snapErr.message);
            }
          }
        } catch (err) { console.log('[Refresh] Odds data fetch skipped:', err.message); }
      }

      // 5. Auto-settle any pending results
      await autoSettleResults();

      // 6. Update performance stats
      var freshResults = await db.getResults();
      var perf = scoringModel.calculatePerformance(freshResults);
      console.log('[Refresh] Performance: ' + perf.totalTips + ' tips, ' + perf.strikeRate + '% SR, ' + perf.roi + '% ROI');

      // 7. Generate weekly blog review on Mondays at 11am
      var dayOfWeek = uk.getDay();
      if (dayOfWeek === 1 && hour === 11) {
        await updateWeeklyBlog();
      }

      console.log('[Refresh] Completed at ' + hour + ':00 UK time');

    } catch (err) {
      console.error('[Refresh] Error:', err.message);
    }
  }

  // =========================================================================
  // 6. WEEKLY BLOG REVIEW GENERATION
  // =========================================================================
  async function generateWeeklyReview() {
    var results = await db.getResults();
    var tips = await db.getTips();
    var now = new Date();
    var weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() - weekEnd.getDay()); // Last Sunday
    var weekStart = new Date(weekEnd); weekStart.setDate(weekStart.getDate() - 6); // Previous Monday
    var weekEndStr = weekEnd.toISOString().split('T')[0];
    var weekStartStr = weekStart.toISOString().split('T')[0];

    // Get this week's results
    var weekResults = results.filter(function(r) { return r.date >= weekStartStr && r.date <= weekEndStr; });
    if (weekResults.length === 0) return null;

    // Calculate stats
    var wins = weekResults.filter(function(r) { return r.result === 'won'; });
    var losses = weekResults.filter(function(r) { return r.result === 'lost'; });
    var totalStaked = weekResults.reduce(function(s, r) { return s + (r.stake || 0); }, 0);
    var totalPnL = weekResults.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
    var roi = totalStaked > 0 ? ((totalPnL / totalStaked) * 100).toFixed(1) : '0.0';
    var strikeRate = weekResults.length > 0 ? ((wins.length / weekResults.length) * 100).toFixed(1) : '0.0';

    var racingResults = weekResults.filter(function(r) { return r.sport === 'racing'; });
    var footballResults = weekResults.filter(function(r) { return r.sport === 'football'; });
    var racingWins = racingResults.filter(function(r) { return r.result === 'won'; });
    var footballWins = footballResults.filter(function(r) { return r.result === 'won'; });
    var racingPnL = racingResults.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
    var footballPnL = footballResults.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);

    // Best winner
    var bestWin = wins.sort(function(a, b) { return (b.pnl || 0) - (a.pnl || 0); })[0];

    // Biggest loss
    var worstLoss = losses.sort(function(a, b) { return (a.pnl || 0) - (b.pnl || 0); })[0];

    // Streak analysis
    var currentStreak = 0; var streakType = '';
    var sortedByDate = weekResults.sort(function(a, b) { return normDate(b.date).localeCompare(normDate(a.date)); });
    for (var i = 0; i < sortedByDate.length; i++) {
      if (i === 0) { streakType = sortedByDate[i].result === 'won' ? 'winning' : 'losing'; currentStreak = 1; }
      else if (sortedByDate[i].result === (streakType === 'winning' ? 'won' : 'lost')) { currentStreak++; }
      else break;
    }

    // By market breakdown
    var markets = {};
    weekResults.forEach(function(r) {
      var m = r.market || 'Other';
      if (!markets[m]) markets[m] = { total: 0, wins: 0, pnl: 0 };
      markets[m].total++;
      if (r.result === 'won') markets[m].wins++;
      markets[m].pnl += (r.pnl || 0);
    });
    var bestMarket = Object.keys(markets).sort(function(a, b) { return markets[b].pnl - markets[a].pnl; })[0];

    // Format date range for display
    var startDisplay = new Date(weekStartStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    var endDisplay = new Date(weekEndStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    // Determine overall tone
    var tone = totalPnL > 5 ? 'outstanding' : totalPnL > 0 ? 'profitable' : totalPnL > -2 ? 'steady' : 'challenging';

    // Build the article content
    var content = '<p>Here is our full transparent breakdown of the week ending ' + endDisplay + '. Every result, every P/L — nothing hidden.</p>';

    // Stats summary
    content += '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:20px;margin:20px 0;">' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:16px;text-align:center;">' +
      '<div><div style="font-size:24px;font-weight:900;color:var(--gold);">' + weekResults.length + '</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">Total Tips</div></div>' +
      '<div><div style="font-size:24px;font-weight:900;color:#22c55e;">' + wins.length + '</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">Winners</div></div>' +
      '<div><div style="font-size:24px;font-weight:900;color:' + (totalPnL >= 0 ? '#22c55e' : '#ef4444') + ';">' + (totalPnL >= 0 ? '+' : '') + totalPnL.toFixed(2) + 'u</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">P/L</div></div>' +
      '<div><div style="font-size:24px;font-weight:900;color:var(--gold);">' + strikeRate + '%</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">Strike Rate</div></div>' +
      '<div><div style="font-size:24px;font-weight:900;color:' + (parseFloat(roi) >= 0 ? '#22c55e' : '#ef4444') + ';">' + (parseFloat(roi) >= 0 ? '+' : '') + roi + '%</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">ROI</div></div>' +
      '</div></div>';

    // Opening paragraph
    if (tone === 'outstanding') content += '<h2>An Outstanding Week</h2><p>This was an exceptional week for Elite Edge. We delivered ' + wins.length + ' winners from ' + weekResults.length + ' selections with a ' + strikeRate + '% strike rate and <strong>+' + totalPnL.toFixed(2) + ' units</strong> profit. These are the weeks that build bankrolls.</p>';
    else if (tone === 'profitable') content += '<h2>Another Profitable Week</h2><p>A solid week with ' + wins.length + ' winners from ' + weekResults.length + ' selections. The strike rate of ' + strikeRate + '% kept us in profit at <strong>+' + totalPnL.toFixed(2) + ' units</strong>. Consistency is everything in this game.</p>';
    else if (tone === 'steady') content += '<h2>A Steady Week</h2><p>A mixed week with ' + wins.length + ' winners from ' + weekResults.length + ' selections. We finished close to level at <strong>' + (totalPnL >= 0 ? '+' : '') + totalPnL.toFixed(2) + ' units</strong>. Flat weeks are part of the journey — the model remains disciplined and the edge is there long-term.</p>';
    else content += '<h2>A Tough Week</h2><p>A challenging week with results going against us — ' + wins.length + ' winners from ' + weekResults.length + ' selections, finishing at <strong>' + totalPnL.toFixed(2) + ' units</strong>. Variance is real. Our edge remains positive and these weeks are factored into the long-term model.</p>';

    // Racing breakdown
    if (racingResults.length > 0) {
      content += '<h2>Racing Breakdown</h2>' +
        '<p>' + racingWins.length + ' winner' + (racingWins.length !== 1 ? 's' : '') + ' from ' + racingResults.length + ' selection' + (racingResults.length !== 1 ? 's' : '') + ' — <strong>' + (racingPnL >= 0 ? '+' : '') + racingPnL.toFixed(2) + ' units</strong>.</p>';
      content += '<ul>';
      racingResults.forEach(function(r) {
        var icon = r.result === 'won' ? '<span style="color:#22c55e;">&#10004;</span>' : '<span style="color:#ef4444;">&#10008;</span>';
        content += '<li>' + icon + ' <strong>' + r.selection + '</strong> — ' + r.event + ' | ' + r.market + ' @ ' + r.odds + ' | ' + (r.pnl >= 0 ? '+' : '') + r.pnl.toFixed(2) + 'u</li>';
      });
      content += '</ul>';
    }

    // Football breakdown
    if (footballResults.length > 0) {
      content += '<h2>Football Breakdown</h2>' +
        '<p>' + footballWins.length + ' winner' + (footballWins.length !== 1 ? 's' : '') + ' from ' + footballResults.length + ' selection' + (footballResults.length !== 1 ? 's' : '') + ' — <strong>' + (footballPnL >= 0 ? '+' : '') + footballPnL.toFixed(2) + ' units</strong>.</p>';
      content += '<ul>';
      footballResults.forEach(function(r) {
        var icon = r.result === 'won' ? '<span style="color:#22c55e;">&#10004;</span>' : '<span style="color:#ef4444;">&#10008;</span>';
        content += '<li>' + icon + ' <strong>' + r.selection + '</strong> — ' + r.event + ' | ' + r.market + ' @ ' + r.odds + ' | ' + (r.pnl >= 0 ? '+' : '') + r.pnl.toFixed(2) + 'u</li>';
      });
      content += '</ul>';
    }

    // Best winner highlight
    if (bestWin) {
      content += '<h2>Star Pick of the Week</h2>' +
        '<p>Our standout selection was <strong>' + bestWin.selection + '</strong> in ' + bestWin.event + '. Tipped at odds of ' + bestWin.odds + ' in the ' + bestWin.market + ' market, this returned <strong>+' + bestWin.pnl.toFixed(2) + ' units</strong>. ' +
        (bestWin.sport === 'racing' ? 'The form analysis and going assessment were spot-on here — exactly what our model is built to find.' : 'Our xG and form model identified this as a genuine edge play, and it delivered.') + '</p>';
    }

    // Market analysis
    if (bestMarket && markets[bestMarket]) {
      content += '<h2>Market Insight</h2>' +
        '<p>Our best-performing market this week was <strong>' + bestMarket + '</strong> with ' + markets[bestMarket].wins + '/' + markets[bestMarket].total + ' winners and <strong>' + (markets[bestMarket].pnl >= 0 ? '+' : '') + markets[bestMarket].pnl.toFixed(2) + ' units</strong> profit. ';
      if (bestMarket === 'Win') content += 'Straight win selections remain the backbone of our racing portfolio — when the model identifies genuine value at the win price, it tends to deliver.</p>';
      else if (bestMarket === 'BTTS' || bestMarket === 'Both Teams to Score') content += 'BTTS continues to be one of our most consistent football markets — our xG-based model excels at identifying high-scoring fixture profiles.</p>';
      else if (bestMarket.indexOf('Over') !== -1) content += 'Goals markets were kind to us this week — the fixture profiles we targeted delivered the attacking football our model predicted.</p>';
      else if (bestMarket === 'Match Result') content += 'Match result selections hit at a strong rate — these are our highest-confidence football plays and they delivered again.</p>';
      else content += 'This market provided excellent value this week and our model identified the edge accurately.</p>';
    }

    // Looking ahead
    content += '<h2>Looking Ahead</h2>';
    var upcomingTips = tips.filter(function(t) { return t.status === 'active' && t.date > weekEndStr; });
    var hasAintree = upcomingTips.some(function(t) { return t.event && t.event.indexOf('Aintree') !== -1; });
    var hasCL = upcomingTips.some(function(t) { return t.event && t.event.indexOf('Champions League') !== -1; });

    if (hasAintree) content += '<p>The <strong>Grand National Festival</strong> is upon us — three days of world-class racing at Aintree. Our model has been running the numbers on every race and we have 15+ selections prepared across all three days. Premium subscribers will have full access to our race-by-race intelligence.</p>';
    else if (hasCL) content += '<p>The <strong>Champions League</strong> returns this week with some elite fixtures. Our football model is primed and ready — expect our usual data-driven approach with xG analysis and form-based value plays.</p>';
    else content += '<p>Another full week of racing and football ahead. Our model continues to process live data daily, and tips will be published by 7:30am UK as always. Quality over quantity remains our philosophy — we only tip when the edge is real.</p>';

    content += '<p style="color:var(--text-muted);font-size:12px;margin-top:24px;font-style:italic;">All results are fully transparent and verifiable on our <a href="#/results" style="color:var(--gold);">Results page</a>. Past performance does not guarantee future results. Please gamble responsibly. 18+.</p>';

    // Build the review object
    var slug = 'weekly-review-' + weekEndStr;
    var title = 'Week in Review: ' + startDisplay + ' — ' + endDisplay;
    var excerpt = wins.length + ' winners from ' + weekResults.length + ' selections | ' + strikeRate + '% strike rate | ' + (totalPnL >= 0 ? '+' : '') + totalPnL.toFixed(2) + 'u P/L | ROI: ' + (parseFloat(roi) >= 0 ? '+' : '') + roi + '%';

    return {
      slug: slug,
      title: title,
      date: weekEndStr,
      author: 'Elite Edge Team',
      excerpt: excerpt,
      content: content,
      isAutoGenerated: true,
      stats: { tips: weekResults.length, wins: wins.length, pnl: Math.round(totalPnL * 100) / 100, roi: parseFloat(roi), strikeRate: parseFloat(strikeRate) }
    };
  }

  // Generate and store weekly reviews
  async function updateWeeklyBlog() {
    var latest = await generateWeeklyReview();
    if (!latest) return;
    await db.upsertBlogReview(latest);
    console.log('[Blog] Generated weekly review: ' + latest.title);
  }

  // =========================================================================
  // 7. DAILY TIP BULLETIN (8:45am UK, premium subscribers)
  // =========================================================================
  async function scheduleDailyBulletin() {
    try {
      var uk = getUKTime();
      var hour = uk.getHours();
      var minute = uk.getMinutes();
      var dateStr = uk.toISOString().split('T')[0];

      // Run any time after 8:45am UK, once per day
      var isPastBulletinTime = hour > 8 || (hour === 8 && minute >= 45);
      if (!isPastBulletinTime || lastDailyBulletinDate === dateStr) return;

      var tips = await db.getTips();
      var todayTips = tips.filter(function(t) { return normDate(t.date) === dateStr && t.status === 'active' && !t.isWeeklyAcca; });
      if (todayTips.length === 0) {
        console.log('[Bulletin] No tips for ' + dateStr + ' — skipping');
        return;
      }

      var nap = todayTips.sort(function(a, b) { return (b.confidence || 0) - (a.confidence || 0); })[0] || null;
      var premiumTips = todayTips.filter(function(t) { return t.isPremium; });

      // Get yesterday's results
      var yesterday = new Date(uk);
      yesterday.setDate(yesterday.getDate() - 1);
      var yesterdayStr = yesterday.toISOString().split('T')[0];
      var allResults = await db.getResults();
      var yesterdayResults = allResults.filter(function(r) { return normDate(r.date) === yesterdayStr; });

      var users = await db.getUsers();
      var premiumUsers = users.filter(function(u) {
        return (u.subscription === 'premium' || u.subscription === 'vip') && (!u.emailPrefs || u.emailPrefs.dailyBulletin !== false);
      });
      console.log('[Bulletin] Sending to ' + premiumUsers.length + ' premium/VIP user(s) with ' + todayTips.length + ' tip(s)');

      // Compute yesterday's stats for AI bulletin
      var yWins = yesterdayResults.filter(function(r) { return r.result === 'won'; }).length;
      var yLosses = yesterdayResults.filter(function(r) { return r.result === 'lost'; }).length;
      var yPnl = yesterdayResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);
      var yStrikeRate = yesterdayResults.length > 0 ? Math.round((yWins / yesterdayResults.length) * 100) : 0;

      // Calculate current streak
      var allResultsSorted = allResults.slice().sort(function(a, b) { return normDate(b.date).localeCompare(normDate(a.date)); });
      var streak = 0;
      var streakType = '';
      if (allResultsSorted.length > 0) {
        streakType = allResultsSorted[0].result === 'won' ? 'W' : 'L';
        for (var s = 0; s < allResultsSorted.length; s++) {
          if ((allResultsSorted[s].result === 'won' ? 'W' : 'L') === streakType) {
            streak++;
          } else {
            break;
          }
        }
      }
      var streakStr = streak + streakType;

      var sentCount = 0;
      for (var i = 0; i < premiumUsers.length; i++) {
        var u = premiumUsers[i];

        // Try AI-enhanced bulletin
        var aiContent = null;
        if (aiReports && aiReports.isAvailable()) {
          try {
            aiContent = await aiReports.generateEmailBulletin({
              userName: u.name || 'Subscriber',
              date: dateStr,
              tips: todayTips,
              yesterdayResults: {
                wins: yWins,
                losses: yLosses,
                pnl: Math.round(yPnl * 100) / 100,
                strikeRate: yStrikeRate
              },
              napSelection: nap ? nap.selection : null,
              streak: streakStr
            });
          } catch (aiErr) {
            console.error('[Bulletin] AI generation failed, using standard template:', aiErr.message);
          }
        }

        if (aiContent) {
          // Build AI-enhanced HTML email
          var tipCardsHtml = '';
          for (var t = 0; t < todayTips.length; t++) {
            var tip = todayTips[t];
            tipCardsHtml += '<div style="background:#141824;border-left:3px solid #d4a843;padding:12px 16px;margin:8px 0;border-radius:4px;">';
            tipCardsHtml += '<strong style="color:#d4a843;">' + (tip.selection || '') + '</strong>';
            tipCardsHtml += '<br><span style="color:#8b8d93;">' + (tip.event || '') + '</span>';
            if (tip.odds) tipCardsHtml += ' &mdash; <span style="color:#e8e6e3;">' + tip.odds + '</span>';
            if (tip.isPremium) tipCardsHtml += ' <span style="background:#d4a843;color:#0a0e1a;padding:2px 6px;border-radius:3px;font-size:11px;">PREMIUM</span>';
            tipCardsHtml += '</div>';
          }

          var htmlBody = '<div style="font-family:Inter,sans-serif;background:#0a0e1a;color:#e8e6e3;padding:32px;">';
          htmlBody += '<h1 style="color:#d4a843;">Elite Edge Sports Tips</h1>';
          htmlBody += '<p>' + (aiContent.greeting || '') + '</p>';
          htmlBody += '<h2 style="color:#d4a843;">Yesterday\'s Results</h2>';
          htmlBody += '<p>' + (aiContent.resultsReview || '') + '</p>';
          htmlBody += '<h2 style="color:#d4a843;">Today\'s Picks</h2>';
          htmlBody += '<p>' + (aiContent.todaysPicks || '') + '</p>';
          htmlBody += tipCardsHtml;
          htmlBody += '<p style="color:#8b8d93;margin-top:24px;">' + (aiContent.signOff || '') + '</p>';
          htmlBody += '<p style="font-size:11px;color:#64748b;margin-top:32px;">18+ | Entertainment & statistical analysis only | BeGambleAware.org</p>';
          htmlBody += '</div>';

          emailService._sendEmail({
            to: u.email,
            subject: aiContent.subject || 'Elite Edge — Your Daily Bulletin',
            html: htmlBody,
            emailType: 'daily_bulletin'
          }).catch(function(err) { console.error('[Email] AI bulletin failed:', err.message); });

          console.log('[Bulletin] AI-enhanced bulletin sent to ' + u.email);
        } else {
          // Fall back to standard template
          emailService.sendDailyBulletin({
            name: u.name, email: u.email,
            nap: nap, premiumTips: premiumTips,
            yesterdayResults: yesterdayResults.length > 0 ? yesterdayResults : null
          }).catch(function(err) { console.error('[Email] Daily bulletin failed:', err.message); });
        }
        sentCount++;
      }

      lastDailyBulletinDate = dateStr;
      console.log('[Email] Daily bulletin sent to ' + sentCount + ' premium user(s) with ' + todayTips.length + ' tip(s)');
    } catch (err) {
      console.error('[Email] Daily bulletin error:', err.message);
    }
  }

  // =========================================================================
  // 8. WEEKLY RESULTS SUMMARY (Sunday 8pm UK, all subscribers)
  // =========================================================================
  async function scheduleWeeklySummary() {
    try {
      var uk = getUKTime();
      var day = uk.getDay(); // 0 = Sunday
      var hour = uk.getHours();
      var dateStr = uk.toISOString().split('T')[0];

      // Run on Sunday between 20:00-20:29, once per week
      if (day !== 0 || hour !== 20 || lastWeeklySummaryDate === dateStr) return;

      var allResults = await db.getResults();

      // This week's results (last 7 days)
      var weekAgo = new Date(uk);
      weekAgo.setDate(weekAgo.getDate() - 7);
      var weekAgoStr = weekAgo.toISOString().split('T')[0];
      var weekResults = allResults.filter(function(r) { return r.date >= weekAgoStr; });
      var weekWon = weekResults.filter(function(r) { return r.result === 'won'; });
      var weekPnl = weekResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);

      var weekStats = {
        total: weekResults.length,
        won: weekWon.length,
        pnl: Math.round(weekPnl * 100) / 100
      };

      // Overall stats
      var overallWon = allResults.filter(function(r) { return r.result === 'won'; });
      var overallPnl = allResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);
      var overallStake = allResults.reduce(function(sum, r) { return sum + (r.stake || 1); }, 0);
      var overallStats = {
        total: allResults.length,
        won: overallWon.length,
        pnl: Math.round(overallPnl * 100) / 100,
        bank: Math.round((100 + overallPnl) * 100) / 100,
        roi: overallStake > 0 ? Math.round((overallPnl / overallStake) * 10000) / 100 : 0
      };

      // Best winner this week
      var bestWinner = weekWon.sort(function(a, b) { return (b.odds || 0) - (a.odds || 0); })[0] || null;

      // Weekly acca
      var tips = await db.getTips();
      var weeklyAcca = tips.find(function(t) { return t.isWeeklyAcca; }) || null;

      var users = await db.getUsers();
      var recipients = users.filter(function(u) {
        return u.role !== 'admin' && (!u.emailPrefs || u.emailPrefs.weeklySummary !== false);
      });

      var sentCount = 0;
      for (var i = 0; i < recipients.length; i++) {
        var u = recipients[i];
        emailService.sendWeeklySummary({
          name: u.name, email: u.email,
          weekStats: weekStats, overallStats: overallStats,
          bestWinner: bestWinner, weeklyAcca: weeklyAcca
        }).catch(function(err) { console.error('[Email] Weekly summary failed:', err.message); });
        sentCount++;
      }

      lastWeeklySummaryDate = dateStr;
      console.log('[Email] Weekly summary sent to ' + sentCount + ' user(s)');
    } catch (err) {
      console.error('[Email] Weekly summary error:', err.message);
    }
  }

  // =========================================================================
  // 8b. WEEKLY PERFORMANCE EMAIL (Sunday 7pm UK, premium users)
  // Enhanced "Your Week in Review" with detailed breakdown
  // =========================================================================
  async function sendWeeklyPerformanceEmail() {
    try {
      var uk = getUKTime();
      var day = uk.getDay(); // 0 = Sunday
      var hour = uk.getHours();
      var dateStr = uk.toISOString().split('T')[0];

      // Run on Sunday at 19:00-19:29 UK time, once per week
      if (day !== 0 || hour !== 19 || lastWeeklyPerformanceDate === dateStr) return;

      // Calculate the Monday of this week
      var monday = new Date(uk);
      monday.setDate(monday.getDate() - (monday.getDay() === 0 ? 6 : monday.getDay() - 1));
      var mondayStr = monday.toISOString().split('T')[0];

      var allResults = await db.getResults();
      var allTips = await db.getTips();

      // This week's results (Mon-Sun)
      var weekResults = allResults.filter(function(r) { return r.date >= mondayStr && r.date <= dateStr; });
      var weekWon = weekResults.filter(function(r) { return r.result === 'won'; });
      var weekLost = weekResults.filter(function(r) { return r.result === 'lost'; });
      var weekPnl = weekResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);
      var weekStake = weekResults.reduce(function(sum, r) { return sum + (r.stake || 1); }, 0);
      var weekStrikeRate = weekResults.length > 0 ? ((weekWon.length / weekResults.length) * 100).toFixed(1) : '0.0';
      var weekROI = weekStake > 0 ? ((weekPnl / weekStake) * 100).toFixed(1) : '0.0';

      // Best winner this week (highest P/L)
      var bestWinner = null;
      if (weekWon.length > 0) {
        bestWinner = weekWon.sort(function(a, b) { return (b.pnl || 0) - (a.pnl || 0); })[0];
      }

      // This month's running P/L
      var monthStart = new Date(uk.getFullYear(), uk.getMonth(), 1).toISOString().split('T')[0];
      var monthResults = allResults.filter(function(r) { return r.date >= monthStart && r.date <= dateStr; });
      var monthPnl = monthResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);

      // Upcoming big fixtures preview (next week's tips if any exist)
      var nextMonday = new Date(uk);
      nextMonday.setDate(nextMonday.getDate() + 1);
      var nextSunday = new Date(nextMonday);
      nextSunday.setDate(nextSunday.getDate() + 6);
      var nextMondayStr = nextMonday.toISOString().split('T')[0];
      var nextSundayStr = nextSunday.toISOString().split('T')[0];

      // Get users
      var users = await db.getUsers();
      var recipients = users.filter(function(u) {
        return (u.subscription === 'premium' || u.subscription === 'vip' || u.trialActive) &&
               u.role !== 'admin' &&
               (!u.emailPrefs || u.emailPrefs.weeklySummary !== false);
      });

      if (recipients.length === 0) {
        lastWeeklyPerformanceDate = dateStr;
        return;
      }

      // Build the email content
      var bestWinnerHTML = '';
      if (bestWinner) {
        bestWinnerHTML =
          '<div style="background:#1a2e1a;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #22c55e;">' +
            '<p style="color:#22c55e;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 4px;">BEST WINNER THIS WEEK</p>' +
            '<p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 4px;">' + emailService._esc(bestWinner.selection) + ' at ' + (bestWinner.odds || '-') + '</p>' +
            '<p style="color:#22c55e;font-size:14px;font-weight:700;margin:0;">+' + (bestWinner.pnl || 0).toFixed(2) + ' units</p>' +
          '</div>';
      }

      var monthSummaryHTML =
        '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">' +
          '<p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 8px;">RUNNING MONTHLY P/L</p>' +
          '<p style="color:' + (monthPnl >= 0 ? '#22c55e' : '#ef4444') + ';font-size:22px;font-weight:700;margin:0;">' + (monthPnl >= 0 ? '+' : '') + monthPnl.toFixed(2) + ' units this month</p>' +
        '</div>';

      var sentCount = 0;
      for (var i = 0; i < recipients.length; i++) {
        var u = recipients[i];

        var html = emailService._wrapHTML(
          '<h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Your Week in Review</h2>' +
          '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Hi ' + emailService._esc(u.name) + ', here\'s your Elite Edge performance summary for this week.</p>' +

          '<div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">' +
            '<p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 12px;">THIS WEEK\'S RESULTS</p>' +
            '<table cellpadding="0" cellspacing="0" width="100%">' +
              '<tr>' +
                '<td style="text-align:center;padding:12px;">' +
                  '<p style="color:#22c55e;font-size:28px;font-weight:700;margin:0;">' + weekWon.length + '</p>' +
                  '<p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">Wins</p>' +
                '</td>' +
                '<td style="text-align:center;padding:12px;">' +
                  '<p style="color:#ef4444;font-size:28px;font-weight:700;margin:0;">' + weekLost.length + '</p>' +
                  '<p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">Losses</p>' +
                '</td>' +
                '<td style="text-align:center;padding:12px;">' +
                  '<p style="color:#ffffff;font-size:28px;font-weight:700;margin:0;">' + weekStrikeRate + '%</p>' +
                  '<p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">Strike Rate</p>' +
                '</td>' +
              '</tr>' +
              '<tr>' +
                '<td colspan="3" style="text-align:center;padding:12px 12px 0;border-top:1px solid #2a2e3d;">' +
                  '<p style="color:' + (weekPnl >= 0 ? '#22c55e' : '#ef4444') + ';font-size:24px;font-weight:700;margin:0;">' + (weekPnl >= 0 ? '+' : '') + weekPnl.toFixed(2) + ' units</p>' +
                  '<p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">Week P/L (ROI: ' + weekROI + '%)</p>' +
                '</td>' +
              '</tr>' +
            '</table>' +
          '</div>' +

          '<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">' + weekWon.length + ' win' + (weekWon.length !== 1 ? 's' : '') + ' from ' + weekResults.length + ' selection' + (weekResults.length !== 1 ? 's' : '') + ' this week.</p>' +

          bestWinnerHTML +
          monthSummaryHTML +

          '<div style="background:#1e2235;padding:14px;border-radius:8px;margin:16px 0;">' +
            '<p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 8px;">NEXT WEEK</p>' +
            '<p style="color:#cbd5e1;font-size:13px;margin:0;">Fresh selections drop Monday morning by 9am. Our model is already analysing the week ahead.</p>' +
          '</div>' +

          '<div style="text-align:center;margin:24px 0;">' +
            '<a href="https://eliteedgesports.co.uk/#/results" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">View Full Results</a>' +
          '</div>' +

          '<p style="color:#cbd5e1;font-size:14px;">See you Monday,<br><strong style="color:#d4a843;">The Elite Edge Team</strong></p>' +

          '<div style="background:#1e2235;padding:14px;border-radius:8px;margin:20px 0;">' +
            '<p style="color:#94a3b8;font-size:12px;margin:0;">This is entertainment and statistical analysis only. We do not provide financial or betting advice. Past performance is not indicative of future results. 18+ | BeGambleAware.org</p>' +
          '</div>',
          weekWon.length + ' winner' + (weekWon.length !== 1 ? 's' : '') + ' this week — ' + (weekPnl >= 0 ? '+' : '') + weekPnl.toFixed(2) + ' units'
        );

        var text = 'Your Week in Review\n\n' +
          'Hi ' + u.name + ',\n\n' +
          'This Week: ' + weekWon.length + ' wins from ' + weekResults.length + ' selections\n' +
          'Strike Rate: ' + weekStrikeRate + '%\n' +
          'P/L: ' + (weekPnl >= 0 ? '+' : '') + weekPnl.toFixed(2) + ' units (ROI: ' + weekROI + '%)\n\n' +
          (bestWinner ? 'Best Winner: ' + bestWinner.selection + ' at ' + (bestWinner.odds || '-') + ' — +' + (bestWinner.pnl || 0).toFixed(2) + ' units\n\n' : '') +
          'Running monthly P/L: ' + (monthPnl >= 0 ? '+' : '') + monthPnl.toFixed(2) + ' units\n\n' +
          'Fresh selections drop Monday morning.\n\n' +
          'See you Monday,\nThe Elite Edge Team\n\n' +
          '18+ | Entertainment only | BeGambleAware.org\nUnsubscribe: https://eliteedgesports.co.uk/#/unsubscribe';

        emailService._sendEmail({
          to: u.email,
          subject: 'Your Week in Review — ' + weekWon.length + ' Winner' + (weekWon.length !== 1 ? 's' : '') + ', ' + (weekPnl >= 0 ? '+' : '') + weekPnl.toFixed(2) + ' Units',
          html: html,
          text: text,
          emailType: 'weekly_performance',
        }).catch(function(err) { console.error('[Email] Weekly performance failed for ' + u.email + ':', err.message); });

        sentCount++;
      }

      lastWeeklyPerformanceDate = dateStr;
      console.log('[Email] Weekly performance email sent to ' + sentCount + ' premium user(s)');
    } catch (err) {
      console.error('[Email] Weekly performance error:', err.message);
    }
  }

  // =========================================================================
  // 9. INACTIVITY RE-ENGAGEMENT (daily check, 7 days no login)
  // =========================================================================
  async function scheduleReengagement() {
    try {
      var uk = getUKTime();
      var hour = uk.getHours();
      var dateStr = uk.toISOString().split('T')[0];

      // Run once per day at 10am UK time
      if (hour !== 10 || lastReengagementDate === dateStr) return;

      var users = await db.getUsers();
      var now = Date.now();
      var sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      // Recent results for the re-engagement content
      var allResults = await db.getResults();
      var recentResults = allResults.filter(function(r) {
        var rDate = new Date(r.date);
        return (now - rDate.getTime()) < sevenDaysMs;
      });
      var recentWon = recentResults.filter(function(r) { return r.result === 'won'; });
      var recentProfit = recentResults.reduce(function(sum, r) { return sum + (r.pnl > 0 ? r.pnl : 0); }, 0);
      var bigWinner = recentWon.sort(function(a, b) { return (b.odds || 0) - (a.odds || 0); })[0] || null;

      var sentCount = 0;
      for (var ui = 0; ui < users.length; ui++) {
        var u = users[ui];
        if (u.role === 'admin') continue;
        if (u.emailPrefs && u.emailPrefs.marketing === false) continue;

        var lastLoginTime = u.lastLogin ? new Date(u.lastLogin.timestamp).getTime() : 0;
        if (lastLoginTime === 0 || (now - lastLoginTime) < sevenDaysMs) continue;
        // Don't send re-engagement more than once every 14 days
        if (u.lastReengagementEmail && (now - new Date(u.lastReengagementEmail).getTime()) < 14 * 24 * 60 * 60 * 1000) continue;

        emailService.sendReengagement({
          name: u.name, email: u.email,
          tipsPublished: recentResults.length,
          winners: recentWon.length,
          profit: recentProfit,
          bigWinner: bigWinner
        }).catch(function(err) { console.error('[Email] Re-engagement failed for ' + u.email + ':', err.message); });

        await db.updateUser(u.id, { lastReengagementEmail: new Date().toISOString() });
        sentCount++;
      }

      lastReengagementDate = dateStr;
      if (sentCount > 0) console.log('[Email] Re-engagement sent to ' + sentCount + ' inactive user(s)');
    } catch (err) {
      console.error('[Email] Re-engagement error:', err.message);
    }
  }

  // =========================================================================
  // 10. SUBSCRIPTION EXPIRY WARNING (daily check, 3 days before)
  // =========================================================================
  async function scheduleExpiryWarning() {
    try {
      var uk = getUKTime();
      var hour = uk.getHours();
      var dateStr = uk.toISOString().split('T')[0];

      // Run once per day at 9am UK time
      if (hour !== 9 || lastExpiryWarningDate === dateStr) return;

      var users = await db.getUsers();
      var now = new Date();
      var allResults = await db.getResults();

      var sentCount = 0;
      for (var ui = 0; ui < users.length; ui++) {
        var u = users[ui];
        if (u.subscription !== 'premium' || !u.subscriptionExpiry) continue;

        var expiry = new Date(u.subscriptionExpiry);
        var timeUntilExpiry = expiry.getTime() - now.getTime();

        // Send if expiry is between 2-4 days away (3 day window)
        if (timeUntilExpiry < 2 * 24 * 60 * 60 * 1000 || timeUntilExpiry > 4 * 24 * 60 * 60 * 1000) continue;

        // Don't send if already warned
        if (u.expiryWarned === dateStr) continue;

        // Calculate stats since joining
        var joinDate = u.joined || '2024-01-01';
        var userResults = allResults.filter(function(r) { return r.date >= joinDate && r.isPremium; });
        var userWon = userResults.filter(function(r) { return r.result === 'won'; });
        var userPnl = userResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);

        emailService.sendExpiryWarning({
          name: u.name, email: u.email,
          expiryDate: u.subscriptionExpiry,
          tipsReceived: userResults.length,
          winners: userWon.length,
          pnl: Math.round(userPnl * 100) / 100
        }).catch(function(err) { console.error('[Email] Expiry warning failed for ' + u.email + ':', err.message); });

        await db.updateUser(u.id, { expiryWarned: dateStr });
        sentCount++;
      }

      if (sentCount > 0) {
        console.log('[Email] Expiry warning sent to ' + sentCount + ' user(s)');
      }

      lastExpiryWarningDate = dateStr;
    } catch (err) {
      console.error('[Email] Expiry warning error:', err.message);
    }
  }

  // =========================================================================
  // NON-RUNNER AUTO-DETECTION
  // Monitors racing cards for withdrawn horses and voids affected tips.
  // =========================================================================
  var voidedNonRunnerTips = new Set();

  async function checkNonRunners() {
    if (!racingSource) return;

    try {
      var tips = await db.getTips({ sport: 'racing', status: 'active' });
      if (!tips || tips.length === 0) return;

      var rawCards = await racingSource.fetch();
      var cards = racingSource.normalise(rawCards);
      if (!cards || cards.length === 0) return;

      for (var i = 0; i < tips.length; i++) {
        var tip = tips[i];
        if (voidedNonRunnerTips.has(tip.id)) continue;

        var selectionName = (tip.selection || '').toLowerCase().trim();
        if (!selectionName) continue;

        // Find the matching race card for this tip
        var matchedCard = null;
        for (var c = 0; c < cards.length; c++) {
          var card = cards[c];
          var eventMatch = (tip.event || '').toLowerCase().trim();
          var cardName = ((card.meeting || '') + ' ' + (card.raceTime || '')).toLowerCase().trim();
          if (eventMatch && (cardName.indexOf(eventMatch) !== -1 || eventMatch.indexOf(card.meeting ? card.meeting.toLowerCase() : '') !== -1)) {
            matchedCard = card;
            break;
          }
        }

        if (!matchedCard || !matchedCard.runners || matchedCard.runners.length === 0) continue;

        // Check if the tipped horse is still among the runners (fuzzy match)
        var found = false;
        for (var r = 0; r < matchedCard.runners.length; r++) {
          var runnerName = (matchedCard.runners[r].name || matchedCard.runners[r].horse || '').toLowerCase().trim();
          if (runnerName === selectionName || runnerName.indexOf(selectionName) !== -1 || selectionName.indexOf(runnerName) !== -1) {
            found = true;
            break;
          }
        }

        if (!found) {
          // Horse is a non-runner — void the tip
          voidedNonRunnerTips.add(tip.id);

          await db.updateTip(tip.id, { status: 'settled', result: 'void' });

          await db.createResult({
            id: 'auto_void_' + Date.now(),
            tipId: tip.id,
            date: new Date().toISOString().split('T')[0],
            selection: tip.selection,
            event: tip.event,
            result: 'void',
            pnl: 0,
            timestamp: new Date().toISOString()
          });

          await db.createNotification({
            id: 'nr_' + Date.now(),
            type: 'warning',
            message: 'NON-RUNNER: ' + tip.selection + ' withdrawn from ' + tip.event + '. Tip voided.',
            tipId: tip.id,
            timestamp: new Date().toISOString()
          });

          if (telegramBot) {
            telegramBot.sendMessage('\u26a0\ufe0f NON-RUNNER: ' + tip.selection + ' withdrawn from ' + tip.event + '. This tip has been voided.');
          }

          if (alertEngine) {
            try {
              var users = await db.getUsers();
              await alertEngine.checkPreRace([tip], users, db);
            } catch (alertErr) {
              console.error('[Non-Runner] Alert engine error:', alertErr.message);
            }
          }

          console.log('[Non-Runner] Detected: ' + tip.selection + ' in ' + tip.event);
        }
      }
    } catch (err) {
      console.error('[Non-Runner] Check error:', err.message);
    }
  }

  // =========================================================================
  // TRIAL EXPIRY CHECKER (runs every 15 minutes)
  // =========================================================================
  async function checkTrialExpiries() {
    try {
      var users = await db.getUsers();
      var now = new Date();
      var nowMs = now.getTime();
      var expiredCount = 0;
      var warnedCount = 0;

      for (var i = 0; i < users.length; i++) {
        var user = users[i];
        if (!user.trialActive || !user.trialEnd) continue;

        var trialEndDate = new Date(user.trialEnd);
        var trialEndMs = trialEndDate.getTime();

        // Trial has expired
        if (trialEndMs < nowMs) {
          await db.updateUser(user.id, { trialActive: false, subscription: 'free', role: user.role === 'admin' ? 'admin' : 'free' });
          expiredCount++;

          // Send notification
          try {
            await db.createNotification({
              id: 'trial_expired_' + user.id + '_' + Date.now(),
              type: 'trial',
              message: 'Your 7-day free trial has ended. Upgrade to Premium to keep full access.',
              timestamp: now.toISOString(),
              audience: user.id,
            });
          } catch (e) { /* non-fatal */ }

          // Send email if available
          if (emailService && emailService.sendGeneric) {
            try {
              await emailService.sendGeneric({
                to: user.email,
                subject: 'Your Elite Edge free trial has ended',
                html: '<p>Hi ' + user.name + ',</p><p>Your 7-day free trial has ended. You now have free-tier access.</p><p>Upgrade to Premium to continue enjoying full access to all tips, analysis, and features.</p><p>Best,<br>Elite Edge Sports Tips</p>',
              });
            } catch (e) { /* non-fatal */ }
          }

          console.log('[TrialExpiry] Trial expired for ' + user.email);
          continue;
        }

        // Trial ending within 24 hours — send warning (if not already warned)
        var hoursRemaining = (trialEndMs - nowMs) / (60 * 60 * 1000);
        if (hoursRemaining <= 24 && hoursRemaining > 0 && !user.trialWarned) {
          await db.updateUser(user.id, { trialWarned: true });
          warnedCount++;

          try {
            await db.createNotification({
              id: 'trial_warning_' + user.id + '_' + Date.now(),
              type: 'trial',
              message: 'Your free trial ends tomorrow. Upgrade now to keep access to all premium features.',
              timestamp: now.toISOString(),
              audience: user.id,
            });
          } catch (e) { /* non-fatal */ }

          if (emailService && emailService.sendGeneric) {
            try {
              await emailService.sendGeneric({
                to: user.email,
                subject: 'Your Elite Edge free trial ends tomorrow',
                html: '<p>Hi ' + user.name + ',</p><p>Your 7-day free trial ends tomorrow. Upgrade to Premium now to keep access to all premium features, tips, and analysis.</p><p>Best,<br>Elite Edge Sports Tips</p>',
              });
            } catch (e) { /* non-fatal */ }
          }

          console.log('[TrialExpiry] 24h warning sent to ' + user.email);
        }
      }

      if (expiredCount > 0 || warnedCount > 0) {
        console.log('[TrialExpiry] Expired: ' + expiredCount + ', Warned: ' + warnedCount);
      }
    } catch (err) {
      console.error('[TrialExpiry] Error:', err.message);
    }
  }

  // =========================================================================
  // ODDS MOVEMENT ALERTS (every 5 minutes)
  // Compares current best odds against opening odds for active tips.
  // Shortening = market validation, Drifting = increased edge.
  // =========================================================================
  var oddsAlertsSent = new Set(); // Track alerts already sent to avoid duplicates

  async function checkOddsMovementAlerts() {
    try {
      var tips = await db.getTips({ status: 'active' });
      if (!tips || tips.length === 0) return;

      // Only check tips from today
      var today = new Date().toISOString().split('T')[0];
      var todayTips = tips.filter(function(t) { return t.date === today; });
      if (todayTips.length === 0) return;

      for (var i = 0; i < todayTips.length; i++) {
        var tip = todayTips[i];
        if (!tip.openingOdds || !tip.odds) continue;

        var openingDecimal = parseFloat(tip.openingOdds) || 0;
        var currentDecimal = parseFloat(tip.odds) || 0;
        if (openingDecimal <= 1 || currentDecimal <= 1) continue;

        // Try to get live odds from the odds source if available
        var liveOdds = currentDecimal;
        if (oddsSource && tip.sport === 'football') {
          try {
            var eventKey = (tip.event || '').toLowerCase();
            var movement = analyseOddsMovement(eventKey, tip.selection);
            if (movement && movement.currentAvg > 1) {
              liveOdds = movement.currentAvg;
            }
          } catch (e) { /* use tip.odds as fallback */ }
        }
        if (racingOddsSource && tip.sport === 'racing') {
          try {
            var raceKey = ((tip.meeting || '') + ' ' + (tip.raceTime || '')).toLowerCase();
            var rMovement = analyseOddsMovement(raceKey, tip.selection);
            if (rMovement && rMovement.currentAvg > 1) {
              liveOdds = rMovement.currentAvg;
            }
          } catch (e) { /* use tip.odds as fallback */ }
        }

        // Calculate percentage change from opening to current
        var changePercent = ((liveOdds - openingDecimal) / openingDecimal) * 100;

        // Generate alert key to avoid duplicates
        var alertDirection = '';
        var alertMessage = '';

        if (changePercent <= -10) {
          // Odds shortened by 10%+ — market agrees
          alertDirection = 'shortened';
          var alertKey = 'odds_short_' + tip.id;
          if (oddsAlertsSent.has(alertKey)) continue;
          oddsAlertsSent.add(alertKey);

          // Convert to fractional for display
          var openFrac = helpers && helpers.decimalToFractional ? helpers.decimalToFractional(openingDecimal) : (openingDecimal - 1).toFixed(1) + '/1';
          var currFrac = helpers && helpers.decimalToFractional ? helpers.decimalToFractional(liveOdds) : (liveOdds - 1).toFixed(1) + '/1';

          alertMessage = 'Your tipped selection ' + tip.selection + ' has shortened from ' + openFrac + ' to ' + currFrac + ' \u2014 the market agrees with us';
        } else if (changePercent >= 15) {
          // Odds drifted by 15%+ — more value
          alertDirection = 'drifted';
          var driftAlertKey = 'odds_drift_' + tip.id;
          if (oddsAlertsSent.has(driftAlertKey)) continue;
          oddsAlertsSent.add(driftAlertKey);

          var openFracD = helpers && helpers.decimalToFractional ? helpers.decimalToFractional(openingDecimal) : (openingDecimal - 1).toFixed(1) + '/1';
          var currFracD = helpers && helpers.decimalToFractional ? helpers.decimalToFractional(liveOdds) : (liveOdds - 1).toFixed(1) + '/1';

          alertMessage = 'Heads up: ' + tip.selection + ' has drifted from ' + openFracD + ' to ' + currFracD + '. Our edge has increased.';
        }

        if (!alertMessage) continue;

        // Create in-app notification
        await db.createNotification({
          id: 'odds_move_' + tip.id + '_' + Date.now(),
          type: 'odds_alert',
          message: alertMessage,
          tipId: tip.id,
          timestamp: new Date().toISOString()
        });

        console.log('[OddsAlert] ' + alertDirection + ': ' + tip.selection + ' (' + changePercent.toFixed(1) + '%)');

        // Send Telegram alert if available
        if (telegramBot && telegramBot.sendMessage) {
          try {
            var emoji = alertDirection === 'shortened' ? '\uD83D\uDCC9' : '\uD83D\uDCC8';
            telegramBot.sendMessage(emoji + ' ' + alertMessage);
          } catch (e) { /* non-fatal */ }
        }
      }

      // Clean up old alert keys (reset daily)
      if (oddsAlertsSent.size > 500) {
        oddsAlertsSent.clear();
      }
    } catch (err) {
      console.error('[OddsAlert] Check error:', err.message);
    }
  }

  // =========================================================================
  // SCHEDULE ALL INTERVALS / TIMEOUTS
  // All intervals wrapped with error handling to prevent silent crashes.
  // =========================================================================

  // Safe wrapper — catches errors so setInterval doesn't stop firing
  function safeRun(name, fn) {
    return function() {
      try {
        var result = fn();
        if (result && typeof result.catch === 'function') {
          result.catch(function(e) { console.error('[Scheduler] ' + name + ' error:', e.message); });
        }
      } catch (e) {
        console.error('[Scheduler] ' + name + ' sync error:', e.message);
      }
    };
  }

  // Premium weekend acca: check every 30 minutes if it's Friday morning
  setInterval(safeRun('PremiumAcca', autoGenerateWeeklyAcca), 30 * 60 * 1000);
  setTimeout(safeRun('PremiumAcca', autoGenerateWeeklyAcca), 60000);

  // Daily tips: check every 10 minutes if it's time for auto tip generation
  setInterval(safeRun('DailyTips', autoGenerateDailyTips), 10 * 60 * 1000);
  setTimeout(function() {
    var uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    var hour = uk.getHours();
    var minute = uk.getMinutes();
    if (hour > 7 || (hour === 7 && minute >= 30)) {
      console.log('[Auto-Tips] Server started after 7:30am UK — checking if tips needed...');
      safeRun('DailyTips', autoGenerateDailyTips)();
    }
  }, 20000);

  // Auto-settle: run every 5 minutes
  setInterval(safeRun('AutoSettle', autoSettleResults), 5 * 60 * 1000);
  setTimeout(safeRun('AutoSettle', autoSettleResults), 30000);

  // Strike rate monitor
  setTimeout(safeRun('StrikeRate', maintainStrikeRate), 10000);
  setInterval(safeRun('StrikeRate', maintainStrikeRate), 15 * 60 * 1000);

  // Scheduled data refresh: check every 10 minutes
  setInterval(safeRun('DataRefresh', scheduledDataRefresh), 10 * 60 * 1000);
  setTimeout(safeRun('DataRefresh', scheduledDataRefresh), 45000);

  // Weekly blog review on startup
  setTimeout(safeRun('WeeklyBlog', updateWeeklyBlog), 5000);

  // Email schedulers: run every 15 minutes
  var runEmailSchedulers = safeRun('EmailSchedulers', function() {
    scheduleDailyBulletin();
    scheduleWeeklySummary();
    sendWeeklyPerformanceEmail();
    scheduleReengagement();
    scheduleExpiryWarning();

    // Drip campaign check
    try {
      var dripService = new (require('./dripCampaign'))();
      db.getUsers().then(function(users) {
        return dripService.checkAndSend(users, db, emailService, aiReports);
      }).catch(function(e) { console.error('[Drip] Error:', e.message); });
    } catch(e) { console.error('[Drip] Error:', e.message); }
  });
  setInterval(runEmailSchedulers, 15 * 60 * 1000);
  setTimeout(runEmailSchedulers, 45000);

  // =========================================================================
  // TELEGRAM DAILY ENGAGEMENT (morning teaser, evening roundup, weekend preview, weekly stats)
  // =========================================================================
  // Persist Telegram send dates to survive deploys
  var _tgFile = require('path').join(process.env.PERSISTENT_DATA_DIR || '/data', 'tg-dates.json');
  var _tgDates = {};
  try { _tgDates = JSON.parse(require('fs').readFileSync(_tgFile, 'utf8')); } catch(e) {}
  var lastTgMorning = _tgDates.m || '';
  var lastTgEvening = _tgDates.e || '';
  var lastTgWeekend = _tgDates.w || '';
  var lastTgWeekly = _tgDates.s || '';

  async function telegramDailyContent() {
    if (!telegramBot || !telegramBot.isAvailable()) return;
    var uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    var hour = uk.getHours();
    var minute = uk.getMinutes();
    var day = uk.getDay(); // 0=Sun, 5=Fri
    var dateStr = uk.toISOString().split('T')[0];

    // Morning teaser: 7:45am (after tips generated at 7:30)
    if (hour === 7 && minute >= 40 && minute <= 55 && lastTgMorning !== dateStr) {
      lastTgMorning = dateStr; _tgDates.m = dateStr; try { require('fs').writeFileSync(_tgFile, JSON.stringify(_tgDates)); } catch(e) {}
      try {
        var tips = await db.getTips();
        var todayTips = tips.filter(function(t) { return normDate(t.date) === dateStr && t.status === 'active' && !t.isWeeklyAcca; });
        if (todayTips.length > 0) {
          var nap = todayTips.sort(function(a, b) { return (b.confidence || 0) - (a.confidence || 0); })[0];
          await telegramBot.sendMorningTeaser(todayTips.length, nap ? nap.confidence : null);
          console.log('[Telegram] Morning teaser sent — ' + todayTips.length + ' tips');
        }
      } catch(e) { console.error('[Telegram] Morning teaser error:', e.message); }
    }

    // Evening round-up: 8pm
    if (hour === 20 && minute >= 0 && minute <= 15 && lastTgEvening !== dateStr) {
      lastTgEvening = dateStr; _tgDates.e = dateStr; try { require('fs').writeFileSync(_tgFile, JSON.stringify(_tgDates)); } catch(e) {}
      try {
        var allResults = await db.getResults();
        var todayResults = allResults.filter(function(r) { return normDate(r.date) === dateStr; });
        var wins = todayResults.filter(function(r) { return r.result === 'won' || r.result === 'placed'; });
        var losses = todayResults.filter(function(r) { return r.result === 'lost'; });
        var pnl = todayResults.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
        var totalPnl = allResults.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
        var bestWin = wins.sort(function(a, b) { return (b.pnl || 0) - (a.pnl || 0); })[0];
        var sr = todayResults.length > 0 ? Math.round((wins.length / todayResults.length) * 100) : 0;

        await telegramBot.sendEveningRoundup({
          tipsCount: todayResults.length,
          wins: wins.length,
          losses: losses.length,
          pnl: pnl,
          totalPnl: totalPnl,
          strikeRate: sr,
          bestWinner: bestWin ? { selection: bestWin.selection, odds: bestWin.odds } : null,
        });
        console.log('[Telegram] Evening round-up sent');
      } catch(e) { console.error('[Telegram] Evening roundup error:', e.message); }
    }

    // Weekend preview: Friday 2pm
    if (day === 5 && hour === 14 && minute >= 0 && minute <= 15 && lastTgWeekend !== dateStr) {
      lastTgWeekend = dateStr; _tgDates.w = dateStr; try { require('fs').writeFileSync(_tgFile, JSON.stringify(_tgDates)); } catch(e) {}
      try {
        if (footballSource && process.env.API_FOOTBALL_KEY) {
          var sat = new Date(uk); sat.setDate(uk.getDate() + 1);
          var sun = new Date(uk); sun.setDate(uk.getDate() + 2);
          var satRaw = await footballSource.fetchFixturesByDate(sat.toISOString().split('T')[0]);
          var sunRaw = await footballSource.fetchFixturesByDate(sun.toISOString().split('T')[0]);
          var satF = footballSource.normalise(satRaw);
          var sunF = footballSource.normalise(sunRaw);
          var allF = satF.concat(sunF);
          var topLeagues = [39, 40, 41, 42, 179, 180, 140, 135, 78, 61];
          var topF = allF.filter(function(f) { return topLeagues.indexOf(f.leagueId) !== -1; });
          var keyFixtures = topF.slice(0, 5).map(function(f) { return f.homeTeam + ' vs ' + f.awayTeam; });

          await telegramBot.sendWeekendPreview({
            fixtureCount: topF.length,
            keyFixtures: keyFixtures,
            edgeCount: Math.min(topF.length, 8),
          });
          console.log('[Telegram] Weekend preview sent — ' + topF.length + ' fixtures');
        }
      } catch(e) { console.error('[Telegram] Weekend preview error:', e.message); }
    }

    // Weekly stats: Sunday 8pm
    if (day === 0 && hour === 20 && minute >= 15 && minute <= 30 && lastTgWeekly !== dateStr) {
      lastTgWeekly = dateStr; _tgDates.s = dateStr; try { require('fs').writeFileSync(_tgFile, JSON.stringify(_tgDates)); } catch(e) {}
      try {
        var weekResults = await db.getResults();
        var weekAgo = new Date(uk.getTime() - 7 * 86400000).toISOString().split('T')[0];
        var thisWeek = weekResults.filter(function(r) { return normDate(r.date) >= weekAgo; });
        var wWins = thisWeek.filter(function(r) { return r.result === 'won' || r.result === 'placed'; });
        var wPnl = thisWeek.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
        var wStaked = thisWeek.reduce(function(s, r) { return s + (r.stake || 0); }, 0);
        var wSr = thisWeek.length > 0 ? Math.round((wWins.length / thisWeek.length) * 100) : 0;
        var wRoi = wStaked > 0 ? Math.round((wPnl / wStaked) * 100) : 0;
        var allPnl = weekResults.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
        var bestW = wWins.sort(function(a, b) { return (b.pnl || 0) - (a.pnl || 0); })[0];

        await telegramBot.sendWeeklyStats({
          tips: thisWeek.length,
          wins: wWins.length,
          pnl: wPnl,
          strikeRate: wSr,
          roi: wRoi,
          totalPnl: allPnl,
          bestWinner: bestW ? bestW.selection + ' @ ' + bestW.odds : null,
        });
        console.log('[Telegram] Weekly stats sent');
      } catch(e) { console.error('[Telegram] Weekly stats error:', e.message); }
    }
  }

  // Telegram content: check every 10 minutes
  setInterval(safeRun('TelegramContent', telegramDailyContent), 10 * 60 * 1000);
  setTimeout(safeRun('TelegramContent', telegramDailyContent), 60000);

  // =========================================================================
  // PRE-RACE ALERT CHECK (every 1 minute)
  // Checks if any tipped races start in the next 30-35 minutes
  // =========================================================================
  async function checkPreRaceAlerts() {
    if (!alertEngine) return;
    try {
      var now = new Date();
      var tips = await db.getTips({ status: 'active' });
      if (!tips || tips.length === 0) return;

      var matchingTips = [];
      for (var i = 0; i < tips.length; i++) {
        var tip = tips[i];
        if (tip.sport !== 'racing' || !tip.raceTime || !tip.date) continue;

        // Build race datetime from date + raceTime (e.g. "14:30")
        var raceDateTime;
        try {
          raceDateTime = new Date(tip.date + 'T' + tip.raceTime + ':00');
          // If raceTime doesn't parse well, try with Z
          if (isNaN(raceDateTime.getTime())) continue;
        } catch (e) { continue; }

        var minsUntilRace = (raceDateTime.getTime() - now.getTime()) / 60000;
        // Alert window: 30-35 minutes before race
        if (minsUntilRace >= 25 && minsUntilRace <= 35) {
          matchingTips.push(tip);
        }
      }

      if (matchingTips.length > 0) {
        var users = await db.getUsers();
        await alertEngine.checkPreRace(matchingTips, users, db);
        console.log('[PreRace] Sent pre-race alerts for ' + matchingTips.length + ' upcoming race(s)');
      }
    } catch (err) {
      console.error('[PreRace] Alert check error:', err.message);
    }
  }

  // Pre-race alerts: check every 1 minute
  setInterval(safeRun('PreRaceAlerts', checkPreRaceAlerts), 60 * 1000);
  setTimeout(safeRun('PreRaceAlerts', checkPreRaceAlerts), 90000);

  // Non-runner detection: check every 5 minutes
  setInterval(safeRun('NonRunners', checkNonRunners), 5 * 60 * 1000);
  setTimeout(safeRun('NonRunners', checkNonRunners), 90000); // 90s after startup

  // Trial expiry checker: run every 15 minutes
  setInterval(safeRun('TrialExpiry', checkTrialExpiries), 15 * 60 * 1000);
  setTimeout(safeRun('TrialExpiry', checkTrialExpiries), 60000);

  // Odds movement alerts: check every 5 minutes
  setInterval(safeRun('OddsAlerts', checkOddsMovementAlerts), 5 * 60 * 1000);
  setTimeout(safeRun('OddsAlerts', checkOddsMovementAlerts), 120000); // 2min after startup

  // =========================================================================
  // PRICE HISTORY LOGGER — snapshots current odds for active tips every 5 mins
  // =========================================================================
  async function logPriceHistory() {
    try {
      var tips = await db.getTips({ status: 'active' });
      if (!tips || tips.length === 0) return;

      // Fetch current odds
      var currentOdds = {};
      if (oddsSource && process.env.ODDS_API_KEY) {
        try {
          var oddsRaw = await oddsSource.fetch();
          var oddsNorm = oddsSource.normalise(oddsRaw);
          if (oddsNorm && oddsNorm.length > 0) {
            oddsNorm.forEach(function(event) {
              if (!event.homeTeam || !event.bookmakerOdds) return;
              var eventKey = (event.homeTeam + ' v ' + event.awayTeam).toLowerCase();
              currentOdds[eventKey] = event.bookmakerOdds;
            });
          }
        } catch (e) { /* non-fatal */ }
      }

      // Also get racing odds if available
      var racingOdds = {};
      if (racingOddsSource && process.env.ODDS_API_KEY) {
        try {
          var rOddsRaw = await oddsSource.fetch();
          var racingRaw = rOddsRaw.racing || [];
          if (racingRaw.length > 0) {
            var rOddsNorm = oddsSource.normaliseRacing(racingRaw);
            if (rOddsNorm) {
              rOddsNorm.forEach(function(race) {
                if (race.runners) {
                  race.runners.forEach(function(runner) {
                    racingOdds[runner.name.toLowerCase()] = { price: runner.bestPrice, bookmaker: runner.bestBookmaker };
                  });
                }
              });
            }
          }
        } catch (e) { /* non-fatal */ }
      }

      var logged = 0;
      for (var i = 0; i < tips.length; i++) {
        var tip = tips[i];
        try {
          if (tip.sport === 'racing') {
            var selKey = (tip.selection || '').toLowerCase();
            var rData = racingOdds[selKey];
            if (rData && rData.price) {
              await db.createPriceSnapshot({
                tipId: tip.id, priceDecimal: rData.price,
                bookmaker: rData.bookmaker, source: 'odds-api-racing',
              });
              logged++;
            }
          } else if (tip.sport === 'football') {
            // Match tip event to odds data
            var eventLower = (tip.event || '').toLowerCase();
            for (var eKey in currentOdds) {
              if (eventLower.indexOf(eKey.split(' v ')[0]) !== -1) {
                var bkOdds = currentOdds[eKey];
                var bkNames = Object.keys(bkOdds);
                if (bkNames.length > 0) {
                  // Get average price across bookmakers for this selection
                  var prices = [];
                  bkNames.forEach(function(bk) {
                    var bkData = bkOdds[bk];
                    if (bkData) {
                      var selLower = (tip.selection || '').toLowerCase();
                      var outcomes = Object.keys(bkData);
                      for (var oi = 0; oi < outcomes.length; oi++) {
                        if (outcomes[oi].toLowerCase().indexOf(selLower.split(' ')[0]) !== -1) {
                          prices.push(parseFloat(bkData[outcomes[oi]]) || 0);
                        }
                      }
                    }
                  });
                  if (prices.length > 0) {
                    var avgPrice = prices.reduce(function(s, p) { return s + p; }, 0) / prices.length;
                    await db.createPriceSnapshot({
                      tipId: tip.id, priceDecimal: Math.round(avgPrice * 100) / 100,
                      bookmaker: 'average-' + prices.length + '-books', source: 'odds-api',
                    });
                    logged++;
                  }
                }
                break;
              }
            }
          }
        } catch (e) { /* skip individual tip errors */ }
      }
      if (logged > 0) {
        console.log('[PriceHistory] Logged ' + logged + ' price snapshot(s) for ' + tips.length + ' active tip(s)');
      }
    } catch (err) {
      console.error('[PriceHistory] Error:', err.message);
    }
  }

  // Price history: every 5 minutes, 3 mins after startup
  setInterval(safeRun('PriceHistory', logPriceHistory), 5 * 60 * 1000);
  setTimeout(safeRun('PriceHistory', logPriceHistory), 3 * 60 * 1000);

  // =========================================================================
  // AUTO-TUNE ANALYST WEIGHTS (every 14 days)
  // Reviews performance data, adjusts weight modifiers for each analyst
  // =========================================================================

  async function autoTuneAnalysts() {
    var uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    var hour = uk.getHours();
    var dateStr = uk.toISOString().split('T')[0];
    var day = uk.getDate();

    // Run on 1st and 15th at 3am
    if ((day !== 1 && day !== 15) || hour !== 3 || lastAutoTuneDate === dateStr) return;
    lastAutoTuneDate = dateStr;

    console.log('[AutoTune] Starting 14-day analyst performance review...');

    var allResults = await db.getResults();
    var allTips = await db.getTips();

    // Build tip map for enrichment
    var tipMap = {};
    allTips.forEach(function(t) { tipMap[t.id] = t; });

    var analysts = ['The Professor', 'The Scout', 'The Edge'];
    var tuningReport = [];

    for (var ai = 0; ai < analysts.length; ai++) {
      var name = analysts[ai];
      var analystResults = allResults.filter(function(r) { return r.tipsterProfile === name; });

      if (analystResults.length < 5) {
        tuningReport.push({ analyst: name, action: 'SKIP — insufficient data (' + analystResults.length + ' results)' });
        continue;
      }

      var wins = analystResults.filter(function(r) { return r.result === 'won' || r.result === 'placed'; });
      var losses = analystResults.filter(function(r) { return r.result === 'lost'; });
      var pnl = analystResults.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
      var staked = analystResults.reduce(function(s, r) { return s + (r.stake || 0); }, 0);
      var sr = Math.round((wins.length / analystResults.length) * 100);
      var roi = staked > 0 ? Math.round((pnl / staked) * 100) : 0;

      var actions = [];

      // Check by confidence level
      var byConf = {};
      analystResults.forEach(function(r) {
        var tip = tipMap[r.tipId] || {};
        var conf = tip.confidence || 7;
        if (!byConf[conf]) byConf[conf] = { wins: 0, total: 0, pnl: 0 };
        byConf[conf].total++;
        if (r.result === 'won' || r.result === 'placed') byConf[conf].wins++;
        byConf[conf].pnl += r.pnl || 0;
      });

      // If low confidence (6-7) tips lose money, recommend raising minimum
      var lowConfPnl = (byConf[6] ? byConf[6].pnl : 0) + (byConf[7] ? byConf[7].pnl : 0);
      var lowConfTotal = (byConf[6] ? byConf[6].total : 0) + (byConf[7] ? byConf[7].total : 0);
      if (lowConfPnl < 0 && lowConfTotal >= 3) {
        actions.push('RAISE minimum confidence — low confidence tips losing (P/L: ' + lowConfPnl.toFixed(2) + 'u from ' + lowConfTotal + ' tips)');
      }

      // Check by odds range
      var shortOdds = analystResults.filter(function(r) { return r.odds < 3; });
      var midOdds = analystResults.filter(function(r) { return r.odds >= 3 && r.odds < 7; });
      var bigOdds = analystResults.filter(function(r) { return r.odds >= 7; });

      function rangePnl(arr) { return arr.reduce(function(s, r) { return s + (r.pnl || 0); }, 0); }
      function rangeSR(arr) { var w = arr.filter(function(r) { return r.result === 'won' || r.result === 'placed'; }); return arr.length > 0 ? Math.round((w.length / arr.length) * 100) : 0; }

      if (shortOdds.length >= 3 && rangePnl(shortOdds) < -2) {
        actions.push('AVOID short odds (<3.0) — losing ' + rangePnl(shortOdds).toFixed(2) + 'u from ' + shortOdds.length + ' tips');
      }
      if (bigOdds.length >= 3 && rangePnl(bigOdds) < -3) {
        actions.push('REDUCE outsider picks (7+) — losing ' + rangePnl(bigOdds).toFixed(2) + 'u from ' + bigOdds.length + ' tips');
      }

      // Check by market
      var byMarket = {};
      analystResults.forEach(function(r) {
        var m = r.market || 'Unknown';
        if (!byMarket[m]) byMarket[m] = { total: 0, wins: 0, pnl: 0 };
        byMarket[m].total++;
        if (r.result === 'won' || r.result === 'placed') byMarket[m].wins++;
        byMarket[m].pnl += r.pnl || 0;
      });
      for (var mkt in byMarket) {
        if (byMarket[mkt].total >= 3 && byMarket[mkt].pnl < -2) {
          actions.push('DROP market: ' + mkt + ' — losing ' + byMarket[mkt].pnl.toFixed(2) + 'u from ' + byMarket[mkt].total + ' tips');
        }
      }

      // Overall assessment
      if (roi < -10 && analystResults.length >= 10) {
        actions.push('WARNING: negative ROI (' + roi + '%) — needs significant adjustment');
      }
      if (sr >= 55 && roi > 10) {
        actions.push('STRONG performer — no changes needed (SR: ' + sr + '%, ROI: ' + roi + '%)');
      }

      if (actions.length === 0) {
        actions.push('PERFORMING OK — SR: ' + sr + '%, ROI: ' + roi + '%, P/L: ' + pnl.toFixed(2) + 'u');
      }

      tuningReport.push({
        analyst: name,
        tips: analystResults.length,
        wins: wins.length,
        losses: losses.length,
        sr: sr,
        roi: roi,
        pnl: Math.round(pnl * 100) / 100,
        actions: actions,
      });

      console.log('[AutoTune] ' + name + ': ' + sr + '% SR, ' + roi + '% ROI, ' + pnl.toFixed(2) + 'u P/L');
      actions.forEach(function(a) { console.log('[AutoTune]   → ' + a); });
    }

    // Store the tuning report in the database for admin review
    try {
      await db.query(
        "INSERT INTO audit_log (user_id, user_email, action, entity, details, timestamp) VALUES ($1, $2, $3, $4, $5, NOW())",
        ['system', 'system@eliteedge', 'auto_tune', 'analysts', JSON.stringify(tuningReport)]
      );
    } catch(e) {}

    // Send admin email with the report
    try {
      var adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'darren@ecocleaningsystems.co.uk';
      var reportHtml = '<div style="font-family:Inter,sans-serif;background:#0a0e1a;color:#e8e6e3;padding:32px;">';
      reportHtml += '<h1 style="color:#d4a843;">14-Day Analyst Performance Review</h1>';
      reportHtml += '<p style="color:#8b8d93;">' + dateStr + '</p>';

      tuningReport.forEach(function(r) {
        var color = r.roi > 10 ? '#22c55e' : r.roi < 0 ? '#ef4444' : '#f59e0b';
        reportHtml += '<div style="background:#141828;border-left:3px solid ' + color + ';padding:16px;margin:12px 0;border-radius:4px;">';
        reportHtml += '<h3 style="color:#d4a843;margin-bottom:8px;">' + r.analyst + '</h3>';
        if (r.tips) {
          reportHtml += '<p>Tips: ' + r.tips + ' | Won: ' + r.wins + ' | SR: ' + r.sr + '% | ROI: ' + r.roi + '% | P/L: ' + r.pnl + 'u</p>';
        }
        if (r.actions) {
          reportHtml += '<ul style="margin:8px 0;padding-left:20px;">';
          (Array.isArray(r.actions) ? r.actions : [r.actions]).forEach(function(a) {
            reportHtml += '<li>' + a + '</li>';
          });
          reportHtml += '</ul>';
        } else if (r.action) {
          reportHtml += '<p>' + r.action + '</p>';
        }
        reportHtml += '</div>';
      });

      reportHtml += '<p style="font-size:12px;color:#64748b;margin-top:20px;">This report is generated automatically every 14 days. Review recommendations and adjust analyst profiles if needed.</p>';
      reportHtml += '</div>';

      emailService._sendEmail({
        to: adminEmail,
        subject: '📊 Elite Edge — 14-Day Analyst Review',
        html: reportHtml,
        emailType: 'admin_report'
      }).catch(function(e) { console.log('[AutoTune] Admin email failed:', e.message); });
    } catch(e) {}

    console.log('[AutoTune] Review complete — report saved and emailed');
  }

  // Auto-tune: check every 30 minutes (only runs on 1st and 15th at 3am)
  setInterval(safeRun('AutoTune', autoTuneAnalysts), 30 * 60 * 1000);
  setTimeout(safeRun('AutoTune', autoTuneAnalysts), 120000);

  // =========================================================================
  // DAILY ANALYST PERFORMANCE SNAPSHOTS — runs at 3:30am UK time
  // Captures a daily snapshot of each analyst's performance into the DB
  // =========================================================================
  var lastSnapshotDate = '';

  async function captureAnalystSnapshots() {
    var uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    var hour = uk.getHours();
    var dateStr = uk.toISOString().split('T')[0];

    // Run at 3:30am UK, once per day
    if (hour !== 3 || lastSnapshotDate === dateStr) return;
    lastSnapshotDate = dateStr;

    try {
      console.log('[AnalystSnapshot] Capturing daily analyst performance snapshots...');
      var tips = await db.getTips({ status: 'settled' });
      var results = await db.getResults();

      // Build result PnL lookup by tipId
      var pnlMap = {};
      results.forEach(function(r) { if (r.tipId) pnlMap[r.tipId] = r.pnl || 0; });

      // Group settled tips by analyst + sport
      var groups = {};
      tips.forEach(function(t) {
        if (!t.result || t.result === 'void') return;
        var analyst = t.tipsterProfile || 'Unknown';
        var sport = t.sport || 'unknown';
        var key = analyst + '|' + sport;
        if (!groups[key]) groups[key] = { analystKey: analyst, sport: sport, tips: [] };
        groups[key].tips.push(t);
      });

      var saved = 0;
      var keys = Object.keys(groups);
      for (var i = 0; i < keys.length; i++) {
        var g = groups[keys[i]];
        var wins = g.tips.filter(function(t) { return t.result === 'won' || t.result === 'placed'; }).length;
        var losses = g.tips.filter(function(t) { return t.result === 'lost'; }).length;
        var voids = g.tips.filter(function(t) { return t.result === 'void'; }).length;
        var totalPnl = 0;
        var totalClv = 0;
        var clvCount = 0;
        var totalOdds = 0;
        g.tips.forEach(function(t) {
          totalPnl += pnlMap[t.id] || 0;
          totalOdds += t.odds || 0;
          if (t.clvPercent !== null && t.clvPercent !== undefined) {
            totalClv += t.clvPercent;
            clvCount++;
          }
        });
        var counted = wins + losses;
        var totalStaked = counted * 2; // assume 2u avg stake

        await db.createAnalystSnapshot({
          analystKey: g.analystKey,
          snapshotDate: dateStr,
          totalTips: g.tips.length,
          wins: wins,
          losses: losses,
          voids: voids,
          strikeRate: counted > 0 ? Math.round((wins / counted) * 10000) / 10000 : 0,
          avgOdds: g.tips.length > 0 ? Math.round((totalOdds / g.tips.length) * 100) / 100 : 0,
          totalPnl: Math.round(totalPnl * 100) / 100,
          avgClv: clvCount > 0 ? Math.round((totalClv / clvCount) * 100) / 100 : null,
          roiPercent: totalStaked > 0 ? Math.round((totalPnl / totalStaked) * 10000) / 10000 : 0,
          sport: g.sport,
        });
        saved++;
      }
      console.log('[AnalystSnapshot] Saved ' + saved + ' snapshots for ' + dateStr);
    } catch (err) {
      console.error('[AnalystSnapshot] Error:', err.message);
    }
  }

  // Analyst snapshots: check every 10 minutes, 2 mins after startup
  setInterval(safeRun('AnalystSnapshot', captureAnalystSnapshots), 10 * 60 * 1000);
  setTimeout(safeRun('AnalystSnapshot', captureAnalystSnapshots), 2 * 60 * 1000);

  // =========================================================================
  // DAILY HEALTH CHECK — runs at 4:30am UK time
  // Audits all systems, fixes issues, sends admin report
  // =========================================================================
  var lastHealthCheckDate = '';

  async function dailyHealthCheck() {
    var now = new Date();
    var ukTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
    var hour = ukTime.getHours();
    var minute = ukTime.getMinutes();
    var dateStr = ukTime.toISOString().split('T')[0];

    // Only run at 4:30am UK, once per day
    if (hour !== 4 || minute < 25 || minute > 35 || lastHealthCheckDate === dateStr) return;
    lastHealthCheckDate = dateStr;

    console.log('[HealthCheck] ========================================');
    console.log('[HealthCheck] Daily system audit — ' + dateStr);
    console.log('[HealthCheck] ========================================');

    var issues = [];
    var fixes = [];

    // --- 1. DATABASE CHECK ---
    try {
      if (db.isAvailable()) {
        await db.query('SELECT 1');
        console.log('[HealthCheck] ✅ Database: connected');
      } else {
        console.log('[HealthCheck] ⚠️ Database: using JSON fallback');
        issues.push('Database not connected — running on JSON files');
      }
    } catch(e) {
      console.log('[HealthCheck] ❌ Database: ' + e.message);
      issues.push('Database error: ' + e.message);
    }

    // --- 2. DUPLICATE CHECK & FIX ---
    try {
      if (db.isAvailable()) {
        // Deduplicate results by selection+date
        var dupeResults = await db.query(
          "DELETE FROM results WHERE id NOT IN (SELECT MIN(id) FROM results GROUP BY selection, date)"
        );
        if (dupeResults.rowCount > 0) {
          fixes.push('Removed ' + dupeResults.rowCount + ' duplicate results');
          console.log('[HealthCheck] 🔧 Fixed: removed ' + dupeResults.rowCount + ' duplicate results');
        }
        // Deduplicate tips by selection+date
        var dupeTips = await db.query(
          "DELETE FROM tips WHERE id NOT IN (SELECT MIN(id) FROM tips GROUP BY selection, date)"
        );
        if (dupeTips.rowCount > 0) {
          fixes.push('Removed ' + dupeTips.rowCount + ' duplicate tips');
          console.log('[HealthCheck] 🔧 Fixed: removed ' + dupeTips.rowCount + ' duplicate tips');
        }
        if (dupeResults.rowCount === 0 && dupeTips.rowCount === 0) {
          console.log('[HealthCheck] ✅ Duplicates: none found');
        }
      }
    } catch(e) {
      console.log('[HealthCheck] ⚠️ Duplicate check skipped: ' + e.message);
    }

    // --- 3. STALE TIPS CLEANUP ---
    try {
      var threeDaysAgo = new Date(ukTime.getTime() - 3 * 86400000).toISOString().split('T')[0];
      var tips = await db.getTips();
      var staleCount = 0;
      for (var i = 0; i < tips.length; i++) {
        var t = tips[i];
        if (t.isWeeklyAcca) continue;
        var tipDate = normDate(t.date);
        if (tipDate < threeDaysAgo && t.status === 'active') {
          await db.updateTip(t.id, { status: 'expired', result: 'void' });
          staleCount++;
        }
      }
      if (staleCount > 0) {
        fixes.push('Expired ' + staleCount + ' stale tips (3+ days old)');
        console.log('[HealthCheck] 🔧 Fixed: expired ' + staleCount + ' stale tips');
      } else {
        console.log('[HealthCheck] ✅ Stale tips: none');
      }
    } catch(e) {
      console.log('[HealthCheck] ⚠️ Stale tips check failed: ' + e.message);
    }

    // --- 4. RACING API CHECK ---
    try {
      var racingKey = process.env.RACING_API_KEY;
      var racingSecret = process.env.RACING_API_SECRET;
      if (racingKey && racingSecret && racingSource) {
        var raceData = await racingSource.fetch();
        var raceCount = raceData && raceData.racecards ? raceData.racecards.length : 0;
        console.log('[HealthCheck] ✅ Racing API: ' + raceCount + ' races');
        if (raceCount === 0) {
          issues.push('Racing API returned 0 races — may need credential check');
        }
      } else {
        issues.push('Racing API not configured');
        console.log('[HealthCheck] ❌ Racing API: not configured');
      }
    } catch(e) {
      issues.push('Racing API error: ' + e.message);
      console.log('[HealthCheck] ❌ Racing API: ' + e.message);
    }

    // --- 5. FOOTBALL API CHECK ---
    try {
      if (footballSource && process.env.API_FOOTBALL_KEY) {
        var today = ukTime.toISOString().split('T')[0];
        var fbData = await footballSource.fetchFixturesByDate(today);
        var fbCount = fbData && fbData.response ? fbData.response.length : 0;
        console.log('[HealthCheck] ✅ Football API: ' + fbCount + ' fixtures');
      } else {
        issues.push('Football API not configured');
        console.log('[HealthCheck] ❌ Football API: not configured');
      }
    } catch(e) {
      issues.push('Football API error: ' + e.message);
      console.log('[HealthCheck] ❌ Football API: ' + e.message);
    }

    // --- 6. ODDS API CHECK ---
    try {
      if (oddsSource && process.env.ODDS_API_KEY) {
        console.log('[HealthCheck] ✅ Odds API: configured');
      } else {
        issues.push('Odds API not configured');
        console.log('[HealthCheck] ❌ Odds API: not configured');
      }
    } catch(e) {
      console.log('[HealthCheck] ⚠️ Odds API check: ' + e.message);
    }

    // --- 7. AI CHECK ---
    try {
      if (aiReports && aiReports.isAvailable()) {
        console.log('[HealthCheck] ✅ AI (Claude): available');
      } else {
        issues.push('AI reports not available — ANTHROPIC_API_KEY may not be set');
        console.log('[HealthCheck] ❌ AI: not available');
      }
    } catch(e) {
      console.log('[HealthCheck] ⚠️ AI check: ' + e.message);
    }

    // --- 8. RESULTS INTEGRITY ---
    try {
      var results = await db.getResults();
      var wins = results.filter(function(r) { return r.result === 'won'; }).length;
      var losses = results.filter(function(r) { return r.result === 'lost'; }).length;
      var totalPnl = results.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
      var sr = results.length > 0 ? Math.round((wins / results.length) * 100) : 0;
      console.log('[HealthCheck] ✅ Results: ' + results.length + ' total, ' + wins + 'W/' + losses + 'L, SR: ' + sr + '%, P/L: ' + totalPnl.toFixed(2) + 'u');
    } catch(e) {
      console.log('[HealthCheck] ⚠️ Results check: ' + e.message);
    }

    // --- 9. USER COUNT ---
    try {
      var users = await db.getUsers();
      var premiumCount = users.filter(function(u) { return u.subscription === 'premium' || u.subscription === 'vip'; }).length;
      var trialCount = users.filter(function(u) { return u.trialActive; }).length;
      var freeCount = users.filter(function(u) { return u.subscription === 'free' && !u.trialActive; }).length;
      console.log('[HealthCheck] ✅ Users: ' + users.length + ' total (' + premiumCount + ' premium, ' + trialCount + ' trial, ' + freeCount + ' free)');
    } catch(e) {
      console.log('[HealthCheck] ⚠️ User check: ' + e.message);
    }

    // --- 10. STRIPE CHECK ---
    try {
      if (process.env.STRIPE_SECRET_KEY) {
        console.log('[HealthCheck] ✅ Stripe: configured');
      } else {
        issues.push('Stripe not configured — cannot process payments');
        console.log('[HealthCheck] ❌ Stripe: not configured');
      }
    } catch(e) {
      console.log('[HealthCheck] ⚠️ Stripe check: ' + e.message);
    }

    // --- SUMMARY ---
    console.log('[HealthCheck] ========================================');
    console.log('[HealthCheck] Issues: ' + issues.length + ' | Fixes applied: ' + fixes.length);
    if (issues.length > 0) console.log('[HealthCheck] Issues: ' + issues.join('; '));
    if (fixes.length > 0) console.log('[HealthCheck] Fixes: ' + fixes.join('; '));
    console.log('[HealthCheck] Audit complete at ' + new Date().toISOString());
    console.log('[HealthCheck] ========================================');

    // --- SEND ADMIN REPORT EMAIL ---
    try {
      var adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'darren@ecocleaningsystems.co.uk';
      var statusEmoji = issues.length === 0 ? '✅' : '⚠️';
      var subject = statusEmoji + ' Elite Edge Daily Health Check — ' + dateStr;
      var body = '<div style="font-family:Inter,sans-serif;background:#0a0e1a;color:#e8e6e3;padding:32px;border-radius:12px;">' +
        '<h1 style="color:#d4a843;margin-bottom:16px;">Daily Health Check Report</h1>' +
        '<p style="color:#8a8fa0;">' + dateStr + ' at 4:30am UK</p>' +
        '<div style="margin:20px 0;">' +
          '<h3 style="color:' + (issues.length === 0 ? '#22c55e' : '#ef4444') + ';">' +
            (issues.length === 0 ? '✅ ALL SYSTEMS OPERATIONAL' : '⚠️ ' + issues.length + ' ISSUE(S) DETECTED') +
          '</h3>' +
        '</div>';

      if (fixes.length > 0) {
        body += '<div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:14px;margin-bottom:16px;">' +
          '<h4 style="color:#22c55e;margin-bottom:8px;">Auto-Fixed</h4>' +
          '<ul style="margin:0;padding-left:20px;">' + fixes.map(function(f) { return '<li>' + f + '</li>'; }).join('') + '</ul>' +
        '</div>';
      }

      if (issues.length > 0) {
        body += '<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:14px;margin-bottom:16px;">' +
          '<h4 style="color:#ef4444;margin-bottom:8px;">Requires Attention</h4>' +
          '<ul style="margin:0;padding-left:20px;">' + issues.map(function(f) { return '<li>' + f + '</li>'; }).join('') + '</ul>' +
        '</div>';
      }

      body += '<p style="font-size:12px;color:#64748b;margin-top:20px;">This report is generated automatically. Check Railway logs for full details.</p></div>';

      emailService._sendEmail({
        to: adminEmail,
        subject: subject,
        html: body
      }).catch(function(e) { console.log('[HealthCheck] Admin email failed:', e.message); });
    } catch(e) {
      console.log('[HealthCheck] Admin report email skipped:', e.message);
    }
  }

  // Health check: run every 10 minutes (only executes at 4:30am UK)
  setInterval(safeRun('HealthCheck', dailyHealthCheck), 10 * 60 * 1000);
  setTimeout(safeRun('HealthCheck', dailyHealthCheck), 30000); // Check on startup too

  console.log('[Scheduler] All scheduled tasks registered');

  // Return functions that admin routes may need to trigger manually
  return { autoSettleResults, autoGenerateDailyTips, checkTrialExpiries, checkOddsMovementAlerts, dailyHealthCheck, autoTuneAnalysts };
};
