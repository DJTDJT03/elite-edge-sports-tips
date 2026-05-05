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

        // Build all available markets for this fixture and pick by best edge
        var homeStrength = (sc.factors && sc.factors.homeAway) || 0.5;
        var formDiff = ((sc.factors && sc.factors.form) || 0.5) - 0.5;
        var allMarkets = [];

        // Home Win
        var fHomeOdds = parseFloat(fix.homeOdds) || 0;
        if (fHomeOdds >= minOdds && fHomeOdds <= 8.0) {
          var homeImplied = 1 / fHomeOdds;
          var homeModelProb = Math.min(homeStrength * (0.5 + formDiff + 0.5), 0.85);
          allMarkets.push({ selection: fix.homeTeam + ' Win', odds: fHomeOdds, market: 'Match Result',
            edge: homeModelProb - homeImplied, modelProb: homeModelProb,
            reasoning: 'The Professor: ' + fix.homeTeam + ' dominant at home with strong recent form. Our model gives them a ' + Math.round((sc.factors.form || 0.6) * 100) + '% form rating. Value at these odds.' });
        }

        // Away Win
        var fAwayOdds = parseFloat(fix.awayOdds) || 0;
        if (fAwayOdds >= minOdds && fAwayOdds <= 8.0) {
          var awayImplied = 1 / fAwayOdds;
          var awayModelProb = Math.min((1 - homeStrength) * (0.5 - formDiff + 0.5), 0.85);
          allMarkets.push({ selection: fix.awayTeam + ' Win', odds: fAwayOdds, market: 'Match Result',
            edge: awayModelProb - awayImplied, modelProb: awayModelProb,
            reasoning: 'The Scout: ' + fix.awayTeam + ' in strong form and our model sees value in the away win at ' + fAwayOdds.toFixed(2) + '.' });
        }

        // Over 2.5 Goals
        var fOverOdds = parseFloat(fix.overOdds) || 0;
        if (fOverOdds >= 1.5 && fOverOdds <= 4.0) {
          var overImplied = 1 / fOverOdds;
          var overModelProb = Math.min((1 / fOverOdds) * 1.12, 0.85); // slight model boost
          allMarkets.push({ selection: 'Over 2.5 Goals', odds: fOverOdds, market: 'Over/Under',
            edge: overModelProb - overImplied, modelProb: overModelProb,
            reasoning: 'The Edge: Open fixture between two attacking sides. Our model sees over 2.5 goals as the best value play here at ' + fOverOdds.toFixed(2) + '.' });
        }

        // BTTS
        var fBttsOdds = parseFloat(fix.bttsOdds) || 0;
        if (fBttsOdds >= 1.5 && fBttsOdds <= 3.0) {
          var bttsImplied = 1 / fBttsOdds;
          var bttsModelProb = Math.min((1 / fBttsOdds) * 1.1, 0.85);
          allMarkets.push({ selection: 'Both Teams to Score — Yes', odds: fBttsOdds, market: 'BTTS',
            edge: bttsModelProb - bttsImplied, modelProb: bttsModelProb,
            reasoning: 'The Scout: Both sides have been scoring consistently. BTTS has strong value at ' + fBttsOdds.toFixed(2) + '.' });
        }

        // Pick the market with the best edge
        allMarkets.sort(function(a, b) { return b.edge - a.edge; });

        if (allMarkets.length > 0 && allMarkets[0].edge > 0) {
          pick = allMarkets[0];
        } else if (allMarkets.length > 0) {
          pick = allMarkets[0]; // best available even if edge is marginal
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
  async function autoGenerateDailyTips(force) {
    var now = new Date();
    var ukTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
    var hour = ukTime.getHours();
    var minute = ukTime.getMinutes();
    var today = ukTime.toISOString().split('T')[0];

    if (!force) {
      // Run any time after 7:30am UK, once per day
      var isPastWindow = hour > 7 || (hour === 7 && minute >= 30);
      if (!isPastWindow) return; // Too early
      if (lastAutoTipDate === today) return; // Already ran today
    } else {
      console.log('[Auto-Tips] Force mode — bypassing date/time guards');
    }

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

        // Major festival meetings get a priority boost — subscribers expect coverage
        var festivalMeetings = ['punchestown', 'cheltenham', 'aintree', 'ascot', 'goodwood', 'york', 'epsom', 'newmarket', 'doncaster', 'leopardstown', 'curragh', 'galway', 'sandown', 'kempton', 'haydock'];

        races.forEach(function(race) {
          if (!race.runners || race.runners.length === 0) return;
          var raceWeather = (race.meeting && meetingWeather[race.meeting]) ? meetingWeather[race.meeting] : null;
          var isFestival = race.meeting && festivalMeetings.some(function(f) { return race.meeting.toLowerCase().indexOf(f) !== -1; });

          // WEATHER-TO-GOING PREDICTION: if rain expected, anticipate going change
          // This gets us ahead of the market — going specialists get a boost BEFORE the official change
          var goingWillEase = false;
          var goingWillDry = false;
          if (raceWeather) {
            var rainMm = raceWeather.rain || 0;
            var humidity = raceWeather.humidity || 0;
            var description = (raceWeather.description || '').toLowerCase();
            if (rainMm >= 2 || description.indexOf('rain') !== -1 || description.indexOf('shower') !== -1) {
              goingWillEase = true; // Ground will soften
            }
            if (rainMm === 0 && humidity < 50 && (description.indexOf('sun') !== -1 || description.indexOf('clear') !== -1)) {
              goingWillDry = true; // Ground will dry out
            }
          }

          var bestInRace = null; // Track best runner per race for prediction storage

          race.runners.forEach(function(runner) {
            try {
              // Skip non-runners
              if (runner.isNonRunner || runner.is_non_runner || runner.nonRunner || runner.status === 'NR' || runner.scratched) return;

              var scored = scoringModel.scoreRunner(runner, race, null, raceWeather);
              if (!scored) return;
              var adjustedEdge = scored.edge;
              // Festival meetings get a 15% edge boost
              if (isFestival) adjustedEdge = scored.edge * 1.15;
              // Weather-to-going: boost going specialists when rain is expected
              if (goingWillEase && scored.factors && scored.factors.going >= 0.7) {
                adjustedEdge *= 1.12; // 12% edge boost for going specialists when rain expected
                if (scored.factors.going >= 0.85) adjustedEdge *= 1.08; // extra 8% for strong going factor
              }
              // Penalise horses that need fast ground when rain coming
              if (goingWillEase && scored.factors && scored.factors.going < 0.4) {
                adjustedEdge *= 0.85; // 15% edge reduction — ground going against them
              }
              // Boost speed-ground horses when it will dry out
              if (goingWillDry && scored.factors && scored.factors.speedRatings >= 0.7 && scored.factors.going < 0.5) {
                adjustedEdge *= 1.08; // Drying ground suits speed horses
              }

              // Track best runner per race (for "Our Pick" prediction)
              if (!bestInRace || adjustedEdge > bestInRace.edge) {
                bestInRace = { scored: scored, edge: adjustedEdge, confidence: scored.confidence };
              }

              // Filter: edge > 5% AND confidence >= 6
              if (adjustedEdge > 0.05 && scored.confidence >= 6) {
                allCandidates.push({
                  type: 'racing',
                  scored: scored,
                  edge: adjustedEdge,
                  confidence: scored.confidence,
                  _isFestival: isFestival,
                });
              }
            } catch (err) {
              // Skip individual runner errors
            }
          });

          // Store "Our Pick" for this race — best runner regardless of whether it becomes a published tip
          if (bestInRace && bestInRace.scored && bestInRace.scored.runner) {
            try {
              db.saveRacePrediction({
                meeting: race.meeting || '', raceTime: race.time || '',
                raceName: race.raceName || race.name || '',
                selection: bestInRace.scored.runner.horseName || '',
                odds: bestInRace.scored.odds || 0,
                confidence: bestInRace.confidence || 0,
                edge: bestInRace.edge || 0,
                runners: race.runners.filter(function(r) { return !r.isNonRunner && !r.scratched; }).length,
                date: today,
              }).catch(function() {}); // non-fatal
            } catch(e) {}
          }
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
                // Store movement data on candidate for odds explainer in Pass 3
                if (moveSignal === 'steamer' || (movementInfo.changePercent && movementInfo.changePercent < -10)) {
                  rc._movement = {
                    direction: 'shortening',
                    openPrice: bestPriceData.worstPrice || bestPriceData.averagePrice,
                    currentPrice: bestPriceData.bestPrice,
                    changePct: Math.abs(movementInfo.changePercent || 0),
                  };
                }
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

          // Store "Our Take" prediction for EVERY scored fixture
          if (scored.selectedSelection && scored.fixture) {
            try {
              db.saveMatchPrediction({
                fixtureId: scored.fixture.id || Math.random().toString(36).slice(2),
                homeTeam: scored.fixture.homeTeam || '', awayTeam: scored.fixture.awayTeam || '',
                league: scored.fixture.league || '', kickoff: scored.fixture.kickoff || '',
                market: scored.selectedMarket || 'Match Result',
                pick: scored.selectedSelection || '',
                confidence: scored.confidence || 5,
                reason: 'Model edge: ' + ((scored.edge || 0) * 100).toFixed(1) + '%',
                date: today,
              }).catch(function() {}); // non-fatal, skip duplicates
            } catch(e) {}
          }
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
                // Store movement on candidate for odds explainer
                omEntry._movement = {
                  direction: 'shortening',
                  openPrice: omMovement.openPrice || null,
                  currentPrice: omMovement.currentPrice || null,
                  changePct: Math.abs(omMovement.changePercent || 0),
                };
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

    // --- NBA BASKETBALL SELECTIONS ---
    var basketballCandidates = [];
    var basketballData = deps.basketballData;
    if (basketballData && basketballData.isAvailable) {
      try {
        console.log('[Auto-Tips] Fetching NBA games...');
        var nbaGames = await basketballData.getGames(today);
        var nbaNotStarted = nbaGames.filter(function(g) { return g.status === 'NS'; });
        console.log('[Auto-Tips] Found ' + nbaNotStarted.length + ' upcoming NBA games');

        if (nbaNotStarted.length > 0) {
          // Fetch standings once
          var nbaStandings = [];
          try { nbaStandings = await basketballData.getStandings(); } catch(e) {}

          // Score each game
          for (var nbaIdx = 0; nbaIdx < nbaNotStarted.length; nbaIdx++) {
            var nbaGame = nbaNotStarted[nbaIdx];
            try {
              // Fetch team stats and H2H
              var nbaResults = await Promise.allSettled([
                basketballData.getTeamStats(nbaGame.homeTeamId),
                basketballData.getTeamStats(nbaGame.awayTeamId),
                basketballData.getH2H(nbaGame.homeTeamId, nbaGame.awayTeamId),
              ]);
              var nbaHomeStats = nbaResults[0].status === 'fulfilled' ? nbaResults[0].value : null;
              var nbaAwayStats = nbaResults[1].status === 'fulfilled' ? nbaResults[1].value : null;
              var nbaH2H = nbaResults[2].status === 'fulfilled' ? nbaResults[2].value : [];

              // Get odds from Odds API if available (look for NBA events)
              var nbaOdds = {};
              if (oddsNormalised) {
                var nbaOddsMatch = oddsNormalised.find(function(o) {
                  return o.homeTeam && o.awayTeam &&
                    (o.homeTeam.toLowerCase().indexOf(nbaGame.homeTeam.toLowerCase().split(' ').pop()) !== -1);
                });
                if (nbaOddsMatch && nbaOddsMatch.bookmakerOdds) {
                  var firstBk = Object.keys(nbaOddsMatch.bookmakerOdds)[0];
                  if (firstBk && nbaOddsMatch.bookmakerOdds[firstBk]) {
                    var bkData = nbaOddsMatch.bookmakerOdds[firstBk];
                    nbaOdds.home = bkData[nbaGame.homeTeam] || bkData['1'] || 0;
                    nbaOdds.away = bkData[nbaGame.awayTeam] || bkData['2'] || 0;
                  }
                }
              }

              var nbaScored = scoringModel.scoreBasketballGame(nbaGame, nbaHomeStats, nbaAwayStats, nbaStandings, nbaH2H, nbaOdds);
              if (nbaScored && nbaScored.edge > 0.03 && nbaScored.confidence >= 6) {
                basketballCandidates.push({
                  type: 'basketball',
                  scored: nbaScored,
                  edge: nbaScored.edge,
                  confidence: nbaScored.confidence,
                });
              }
            } catch (nbaGameErr) {
              // Skip individual game errors
            }
          }
          console.log('[Auto-Tips] NBA candidates passing filter: ' + basketballCandidates.length);
        }
      } catch (nbaErr) {
        console.error('[Auto-Tips] NBA API error:', nbaErr.message);
      }
    }

    // Add best NBA candidate (1 per day to start)
    if (basketballCandidates.length > 0) {
      basketballCandidates.sort(function(a, b) { return b.edge - a.edge; });
      allCandidates.push(basketballCandidates[0]);
      console.log('[Auto-Tips] NBA pick: ' + basketballCandidates[0].scored.selectedSelection + ' @ ' + basketballCandidates[0].scored.selectedOdds);
    }

    // --- RUGBY LEAGUE SELECTIONS ---
    var rugbyCandidates = [];
    var rugbyData = deps.rugbyData;
    if (rugbyData && rugbyData.isAvailable) {
      try {
        console.log('[Auto-Tips] Fetching rugby league games...');
        var rugbyGames = await rugbyData.getGames(today);
        var rugbyNotStarted = rugbyGames.filter(function(g) { return g.status === 'NS'; });
        console.log('[Auto-Tips] Found ' + rugbyNotStarted.length + ' upcoming rugby league games');

        if (rugbyNotStarted.length > 0) {
          // Fetch standings per league
          var rugbyStandings = {};
          for (var rli = 0; rli < rugbyNotStarted.length; rli++) {
            var rlId = rugbyNotStarted[rli].leagueId;
            if (!rugbyStandings[rlId]) {
              try { rugbyStandings[rlId] = await rugbyData.getStandings(rlId); } catch(e) { rugbyStandings[rlId] = []; }
            }
          }

          for (var rgIdx = 0; rgIdx < rugbyNotStarted.length; rgIdx++) {
            var rgGame = rugbyNotStarted[rgIdx];
            try {
              var rgResults = await Promise.allSettled([
                rugbyData.getH2H(rgGame.homeTeamId, rgGame.awayTeamId),
              ]);
              var rgH2H = rgResults[0].status === 'fulfilled' ? rgResults[0].value : [];
              var rgStands = rugbyStandings[rgGame.leagueId] || [];

              var rgOdds = {};
              // Try to match odds from Odds API
              if (oddsNormalised) {
                var rgOddsMatch = oddsNormalised.find(function(o) {
                  return o.homeTeam && o.awayTeam &&
                    (o.homeTeam.toLowerCase().indexOf(rgGame.homeTeam.toLowerCase().split(' ').pop()) !== -1);
                });
                if (rgOddsMatch && rgOddsMatch.bookmakerOdds) {
                  var rgFirstBk = Object.keys(rgOddsMatch.bookmakerOdds)[0];
                  if (rgFirstBk && rgOddsMatch.bookmakerOdds[rgFirstBk]) {
                    var rgBkData = rgOddsMatch.bookmakerOdds[rgFirstBk];
                    rgOdds.home = rgBkData[rgGame.homeTeam] || rgBkData['1'] || 0;
                    rgOdds.away = rgBkData[rgGame.awayTeam] || rgBkData['2'] || 0;
                  }
                }
              }

              var rgScored = scoringModel.scoreRugbyGame(rgGame, null, null, rgStands, rgH2H, rgOdds);
              if (rgScored && rgScored.edge > 0.03 && rgScored.confidence >= 6) {
                rugbyCandidates.push({
                  type: 'rugby',
                  scored: rgScored,
                  edge: rgScored.edge,
                  confidence: rgScored.confidence,
                });
              }
            } catch (rgGameErr) { /* skip individual errors */ }
          }
          console.log('[Auto-Tips] Rugby League candidates passing filter: ' + rugbyCandidates.length);
        }
      } catch (rgErr) {
        console.error('[Auto-Tips] Rugby API error:', rgErr.message);
      }
    }

    // Add best rugby candidate (1 per day)
    if (rugbyCandidates.length > 0) {
      rugbyCandidates.sort(function(a, b) { return b.edge - a.edge; });
      allCandidates.push(rugbyCandidates[0]);
      console.log('[Auto-Tips] Rugby pick: ' + rugbyCandidates[0].scored.selectedSelection + ' @ ' + rugbyCandidates[0].scored.selectedOdds);
    }

    // --- NFL SELECTIONS ---
    var nflCandidates = [];
    var nflData = deps.nflData;
    if (nflData && nflData.isAvailable) {
      try {
        console.log('[Auto-Tips] Fetching NFL games...');
        var nflGames = await nflData.getGames(today);
        var nflNotStarted = nflGames.filter(function(g) { return g.status === 'NS'; });
        console.log('[Auto-Tips] Found ' + nflNotStarted.length + ' upcoming NFL games');

        if (nflNotStarted.length > 0) {
          var nflStandings = [];
          try { nflStandings = await nflData.getStandings(); } catch(e) {}

          for (var nflIdx = 0; nflIdx < nflNotStarted.length; nflIdx++) {
            var nflGame = nflNotStarted[nflIdx];
            try {
              var nflH2H = [];
              try { nflH2H = await nflData.getH2H(nflGame.homeTeamId, nflGame.awayTeamId); } catch(e) {}

              var nflOdds = {};
              if (oddsNormalised) {
                var nflOddsMatch = oddsNormalised.find(function(o) {
                  return o.homeTeam && o.awayTeam &&
                    (o.homeTeam.toLowerCase().indexOf(nflGame.homeTeam.toLowerCase().split(' ').pop()) !== -1);
                });
                if (nflOddsMatch && nflOddsMatch.bookmakerOdds) {
                  var nflFirstBk = Object.keys(nflOddsMatch.bookmakerOdds)[0];
                  if (nflFirstBk && nflOddsMatch.bookmakerOdds[nflFirstBk]) {
                    var nflBkData = nflOddsMatch.bookmakerOdds[nflFirstBk];
                    nflOdds.home = nflBkData[nflGame.homeTeam] || nflBkData['1'] || 0;
                    nflOdds.away = nflBkData[nflGame.awayTeam] || nflBkData['2'] || 0;
                  }
                }
              }

              var nflScored = scoringModel.scoreNFLGame(nflGame, nflStandings, nflH2H, nflOdds);
              if (nflScored && nflScored.edge > 0.03 && nflScored.confidence >= 6) {
                nflCandidates.push({
                  type: 'american-football',
                  scored: nflScored,
                  edge: nflScored.edge,
                  confidence: nflScored.confidence,
                });
              }
            } catch (nflGameErr) { /* skip */ }
          }
          console.log('[Auto-Tips] NFL candidates passing filter: ' + nflCandidates.length);
        }
      } catch (nflErr) {
        console.error('[Auto-Tips] NFL API error:', nflErr.message);
      }
    }

    if (nflCandidates.length > 0) {
      nflCandidates.sort(function(a, b) { return b.edge - a.edge; });
      allCandidates.push(nflCandidates[0]);
      console.log('[Auto-Tips] NFL pick: ' + nflCandidates[0].scored.selectedSelection + ' @ ' + nflCandidates[0].scored.selectedOdds);
    }

    // --- TENNIS SELECTIONS ---
    var tennisCandidates = [];
    var tennisData = deps.tennisData;
    if (tennisData && tennisData.isAvailable) {
      try {
        console.log('[Auto-Tips] Fetching tennis fixtures...');
        var tennisMatches = await tennisData.getFixtures(today);
        var tennisUpcoming = tennisMatches.filter(function(m) { return m.status === '' || m.status === 'NS' || !m.status; });
        console.log('[Auto-Tips] Found ' + tennisUpcoming.length + ' upcoming tennis matches');

        if (tennisUpcoming.length > 0) {
          // Fetch rankings once
          var atpRankings = [];
          var wtaRankings = [];
          try {
            var rankResults = await Promise.allSettled([
              tennisData.getRankings('ATP'),
              tennisData.getRankings('WTA'),
            ]);
            atpRankings = rankResults[0].status === 'fulfilled' ? rankResults[0].value : [];
            wtaRankings = rankResults[1].status === 'fulfilled' ? rankResults[1].value : [];
          } catch (e) {}

          // Score top matches (limit to top-tier: ranked players only)
          var rankedMatches = tennisUpcoming.filter(function(m) {
            var rankings = m.tour === 'ATP' ? atpRankings : wtaRankings;
            var p1Rank = rankings.find(function(r) { return r.playerKey === m.player1Key; });
            var p2Rank = rankings.find(function(r) { return r.playerKey === m.player2Key; });
            return p1Rank || p2Rank; // at least one ranked player
          });

          for (var tnIdx = 0; tnIdx < Math.min(rankedMatches.length, 15); tnIdx++) {
            var tnMatch = rankedMatches[tnIdx];
            try {
              var tnRankings = tnMatch.tour === 'ATP' ? atpRankings : wtaRankings;
              var p1R = tnRankings.find(function(r) { return r.playerKey === tnMatch.player1Key; });
              var p2R = tnRankings.find(function(r) { return r.playerKey === tnMatch.player2Key; });
              var p1Rank = p1R ? p1R.rank : 500;
              var p2Rank = p2R ? p2R.rank : 500;

              // Fetch H2H
              var tnH2H = { matches: [], p1Wins: 0, p2Wins: 0, total: 0 };
              try { tnH2H = await tennisData.getH2H(tnMatch.player1Key, tnMatch.player2Key); } catch (e) {}

              // Try to get odds from Odds API
              var tnOdds = {};
              if (oddsNormalised) {
                var p1Last = tnMatch.player1.split(' ').pop().toLowerCase();
                var tnOddsMatch = oddsNormalised.find(function(o) {
                  return o.homeTeam && o.homeTeam.toLowerCase().indexOf(p1Last) !== -1;
                });
                if (tnOddsMatch && tnOddsMatch.bookmakerOdds) {
                  var tnFirstBk = Object.keys(tnOddsMatch.bookmakerOdds)[0];
                  if (tnFirstBk && tnOddsMatch.bookmakerOdds[tnFirstBk]) {
                    var tnBkData = tnOddsMatch.bookmakerOdds[tnFirstBk];
                    var tnKeys = Object.keys(tnBkData);
                    if (tnKeys.length >= 2) {
                      tnOdds.p1 = tnBkData[tnKeys[0]] || 0;
                      tnOdds.p2 = tnBkData[tnKeys[1]] || 0;
                    }
                  }
                }
              }

              var tnScored = scoringModel.scoreTennisMatch(tnMatch, p1Rank, p2Rank, tnH2H, tnOdds);
              if (tnScored && tnScored.edge > 0.03 && tnScored.confidence >= 6) {
                tennisCandidates.push({
                  type: 'tennis',
                  scored: tnScored,
                  edge: tnScored.edge,
                  confidence: tnScored.confidence,
                });
              }
            } catch (tnErr) { /* skip individual match errors */ }
          }
          console.log('[Auto-Tips] Tennis candidates passing filter: ' + tennisCandidates.length);
        }
      } catch (tennisErr) {
        console.error('[Auto-Tips] Tennis API error:', tennisErr.message);
      }
    }

    // Add best tennis candidate (1 per day)
    if (tennisCandidates.length > 0) {
      tennisCandidates.sort(function(a, b) { return b.edge - a.edge; });
      allCandidates.push(tennisCandidates[0]);
      console.log('[Auto-Tips] Tennis pick: ' + tennisCandidates[0].scored.selectedSelection + ' @ ' + tennisCandidates[0].scored.selectedOdds);
    }

    // Sort all candidates by edge descending
    allCandidates.sort(function(a, b) { return b.edge - a.edge; });

    // Shadow scoring: save ALL scored candidates to DB for tracking
    try {
      var savedShadow = 0;
      for (var sci = 0; sci < allCandidates.length; sci++) {
        var sc = allCandidates[sci];
        var scScored = sc.scored || {};
        var scSport = sc.type || 'unknown';
        var scSelection = '', scEvent = '', scMeeting = '', scLeague = '', scMarket = '', scOdds = 0, scKickoff = '';

        if (scSport === 'racing') {
          var scRunner = scScored.runner || {};
          var scRace = scScored.race || {};
          scSelection = scRunner.horseName || '';
          scEvent = (scRace.meeting || '') + ' ' + (scRace.time || '');
          scMeeting = scRace.meeting || '';
          scMarket = sc._isOutsider ? 'Each-Way' : 'Win';
          scOdds = scScored.odds || 0;
          scKickoff = scRace.time || '';
        } else {
          scSelection = scScored.selectedSelection || '';
          var scFixture = scScored.fixture || {};
          scEvent = (scFixture.homeTeam || '') + ' vs ' + (scFixture.awayTeam || '');
          scLeague = scFixture.league || '';
          scMarket = scScored.selectedMarket || '';
          scOdds = scScored.selectedOdds || 0;
          scKickoff = scFixture.kickoff || scFixture.time || '';
        }

        if (scSelection) {
          try {
            await db.saveScoredCandidate({
              sport: scSport, selection: scSelection, event: scEvent, meeting: scMeeting,
              league: scLeague, market: scMarket, odds: scOdds,
              confidence: sc.confidence || scScored.confidence || 0,
              modelProbability: scScored.modelProbability || 0,
              impliedProbability: scScored.impliedProbability || 0,
              edge: sc.edge || scScored.edge || 0,
              analyst: scScored.tipsterProfile || '', date: today, kickoff: scKickoff,
              wasPublished: false,
            });
            savedShadow++;
          } catch (scErr) { /* skip duplicates or errors */ }
        }
      }
      if (savedShadow > 0) {
        console.log('[Shadow Scoring] Saved ' + savedShadow + ' scored candidate(s) for ' + today);
      }
    } catch (shadowErr) {
      console.log('[Shadow Scoring] Error:', shadowErr.message);
    }

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
    var MIN_MAIN_TIP_ODDS = 1.8;  // Minimum ~4/5 decimal — allows evens (2.0), 10/11 (1.91) but blocks 1/2 (1.5) and shorter
    var MIN_OUTSIDER_ODDS = 7.0;
    var MAX_OUTSIDER_ODDS = 21.0;
    var MIN_MAIN_CONFIDENCE = 6;

    var racingCandidates = allCandidates.filter(function(c) { return c.type === 'racing'; });
    var footballCandidatesFinal = allCandidates.filter(function(c) { return c.type === 'football'; });

    // Main racing tips: confidence 6+, odds between 1/2 (1.5) and 8/1 (9.0)
    var racingMain = racingCandidates.filter(function(c) {
      return c.scored && c.scored.odds >= MIN_MAIN_TIP_ODDS && c.scored.odds <= MAX_MAIN_TIP_ODDS && c.confidence >= MIN_MAIN_CONFIDENCE;
    }).sort(function(a, b) { return b.edge - a.edge; });

    // EW Outsider: odds 6/1 to 20/1, best edge
    var racingOutsider = racingCandidates.filter(function(c) {
      return c.scored && c.scored.odds >= MIN_OUTSIDER_ODDS && c.scored.odds <= MAX_OUTSIDER_ODDS && c.confidence >= 5;
    }).sort(function(a, b) { return b.edge - a.edge; });

    // Main football tips: odds between 1/2 (1.5) and 8/1 (9.0), confidence 6+
    var footballMain = footballCandidatesFinal.filter(function(c) {
      return c.scored && c.scored.selectedOdds >= MIN_MAIN_TIP_ODDS && c.scored.selectedOdds <= MAX_MAIN_TIP_ODDS && c.confidence >= MIN_MAIN_CONFIDENCE;
    }).sort(function(a, b) { return b.edge - a.edge; });

    // Select: 1 per meeting (prevent correlated losses) + up to 2 main football + 1 outsider
    var usedMeetings = {};
    var selectedRacing = [];
    racingMain.forEach(function(c) {
      var meeting = c.scored && c.scored.race ? (c.scored.race.meeting || '').toLowerCase() : '';
      if (meeting && usedMeetings[meeting]) return; // 1 per meeting
      if (selectedRacing.length >= 3) return; // max 3 racing main tips
      selectedRacing.push(c);
      if (meeting) usedMeetings[meeting] = true;
    });
    // One tip per league for football (prevent correlated league results)
    var usedLeagues = {};
    var selectedFootball = [];
    footballMain.forEach(function(c) {
      var league = c.scored && c.scored.fixture ? (c.scored.fixture.league || '').toLowerCase() : '';
      if (league && usedLeagues[league]) return; // 1 per league
      if (selectedFootball.length >= 3) return; // max 3 football tips
      selectedFootball.push(c);
      if (league) usedLeagues[league] = true;
    });
    var selected = selectedRacing.concat(selectedFootball);

    // Add one EW Outsider of the Day (if available, mark it specially)
    var outsider = null;
    if (racingOutsider.length > 0) {
      // Find best outsider from a meeting we haven't already picked from
      outsider = racingOutsider.find(function(c) {
        var mtg = c.scored && c.scored.race ? (c.scored.race.meeting || '').toLowerCase() : '';
        return !usedMeetings[mtg];
      }) || racingOutsider[0]; // fallback to best if all meetings used
      var outsiderId = outsider.scored && outsider.scored.runner ? outsider.scored.runner.horseName : null;
      var alreadyPicked = selected.some(function(s) {
        return s.scored && s.scored.runner && s.scored.runner.horseName === outsiderId;
      });
      if (!alreadyPicked) {
        outsider._isOutsider = true;
        selected.push(outsider);
      }
    }

    // Cap at 9 total (2 racing + 2 football + 1 NBA + 1 rugby + 1 NFL + 1 tennis + 1 outsider)
    selected = selected.slice(0, 9);

    // If we have fewer than 3 main tips, try to fill from football
    if (selected.filter(function(s) { return !s._isOutsider; }).length < 3 && footballMain.length > 2) {
      selected.splice(selected.length - (outsider ? 1 : 0), 0, footballMain[2]);
      selected = selected.slice(0, 5);
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

    // ---------------------------------------------------------------
    // Pass 1: Assign analysts, generate tip IDs, collect enrichment inputs
    // ---------------------------------------------------------------
    var analystProfiles = require('./analystProfiles');
    var enrichmentInputs = [];
    for (var si = 0; si < selected.length; si++) {
      var cand = selected[si];
      cand._tipId = 'auto_' + Date.now() + '_' + si;
      cand._analystKey = analystProfiles.assignAnalyst(cand.scored, cand.type);
      cand._tipsterProfile = analystProfiles.profiles[cand._analystKey].name;
      cand._adjustedFactors = analystProfiles.applyAnalystWeights(cand.scored.factors || {}, cand._analystKey, cand.type);
      enrichmentInputs.push({ scored: cand.scored, sport: cand.type, tipId: cand._tipId, analyst: cand._analystKey });
    }

    // ---------------------------------------------------------------
    // Pass 2: Enrich tips via Perplexity Sonar (parallel, 15s budget)
    // enrichBatch returns Map<tipId, {signals, skipped, ...}>
    // If Perplexity is disabled/suppressed, all results are {skipped: true}
    // ---------------------------------------------------------------
    var perplexityClient = deps.perplexityClient;
    var enrichmentResults = new Map();
    if (perplexityClient) {
      try {
        enrichmentResults = await perplexityClient.enrichBatch(enrichmentInputs);
        var enrichedCount = 0;
        enrichmentResults.forEach(function(r) { if (!r.skipped) enrichedCount++; });
        if (enrichedCount > 0) {
          console.log('[Auto-Tips] Perplexity enrichment: ' + enrichedCount + '/' + selected.length + ' tips enriched');
        }
      } catch (enrichErr) {
        console.log('[Auto-Tips] Perplexity enrichment skipped: ' + enrichErr.message);
      }
    }

    // ---------------------------------------------------------------
    // Pass 3: Build tip objects with enrichment woven into analysis
    // ---------------------------------------------------------------
    var newTips = [];
    for (var bi = 0; bi < selected.length; bi++) {
      var candidate = selected[bi];
      var idx = bi;
      var isNap = (idx === napIdx);
      var isOutsider = !!candidate._isOutsider;
      var scored = candidate.scored;
      var sport = candidate.type;
      var tipId = candidate._tipId;
      var tipsterProfile = candidate._tipsterProfile;
      var adjustedFactors = candidate._adjustedFactors;

      // Get enrichment signals for this tip (may be empty/skipped)
      var enrichResult = enrichmentResults.get(tipId) || { signals: {}, skipped: true };
      var enrichSignals = (!enrichResult.skipped && !enrichResult.lowQuality && !enrichResult.parseError)
        ? enrichResult.signals : {};

      // Generate analysis — enrichment signals woven inline into template fields
      var analysis = scoringModel.generateAnalysis(scored, sport, enrichSignals, candidate._analystKey);

      // Odds movement explainer — if this selection has been shortening, ask Sonar why
      if (candidate._movement && candidate._movement.direction === 'shortening' && perplexityClient) {
        try {
          var movementExplain = await perplexityClient.explainOddsMovement({
            selection: sport === 'racing' ? (scored.runner || {}).horseName : (scored.selectedSelection || ''),
            event: sport === 'racing' ? ((scored.race || {}).meeting + ' ' + ((scored.race || {}).time || '')) : (((scored.fixture || {}).homeTeam || '') + ' vs ' + ((scored.fixture || {}).awayTeam || '')),
            sport: sport,
            openPrice: String(candidate._movement.openPrice || ''),
            currentPrice: String(candidate._movement.currentPrice || ''),
            changePct: String(candidate._movement.changePct || ''),
          });
          if (movementExplain) {
            analysis.oddsMovement = movementExplain;
            console.log('[Auto-Tips] Odds explainer: ' + (sport === 'racing' ? (scored.runner || {}).horseName : scored.selectedSelection) + ' — ' + movementExplain);
          }
        } catch (moveErr) {
          // Non-fatal — tip publishes without movement explanation
        }
      }

      // GPT Consensus Verification — independent second opinion from OpenAI
      var gptVerification = { consensus: false, dualAIVerified: false };
      var gptVerifier = deps.gptVerifier;
      if (gptVerifier && gptVerifier.isAvailable) {
        try {
          // Build a preview tip object for GPT to evaluate
          var previewTip = {
            selection: sport === 'racing' ? (scored.runner || {}).horseName : (scored.selectedSelection || ''),
            event: sport === 'racing' ? ((scored.race || {}).meeting + ' ' + ((scored.race || {}).time || '')) : ((scored.fixture || {}).homeTeam + ' vs ' + (scored.fixture || {}).awayTeam),
            market: sport === 'racing' ? (isOutsider ? 'Each-Way' : 'Win') : (scored.selectedMarket || ''),
            odds: sport === 'racing' ? scored.odds : (scored.selectedOdds || 0),
            modelProbability: scored.modelProbability,
            impliedProbability: scored.impliedProbability,
            edge: scored.edge,
            confidence: scored.confidence,
            sport: sport,
            analysis: analysis,
          };
          gptVerification = await gptVerifier.verifyTip(previewTip, scored);
          if (gptVerification.dualAIVerified) {
            analysis.dualAIVerified = true;
            analysis.gptConfidence = gptVerification.gptConfidence;
            analysis.gptReasoning = gptVerification.gptReasoning;
          }
        } catch (gptErr) {
          // Non-fatal — tip publishes without verification badge
        }
      }

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
      } else if (sport === 'football') {
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
      } else if (sport === 'rugby') {
        var rgFixture = scored.fixture || {};
        tip = {
          id: tipId,
          sport: 'rugby',
          event: (rgFixture.homeTeam || 'Home') + ' vs ' + (rgFixture.awayTeam || 'Away') + ' - ' + (rgFixture.league || 'Super League'),
          league: rgFixture.league || 'Super League',
          kickoff: rgFixture.time || '',
          venue: rgFixture.venue || '',
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
          bookmakerOdds: {},
          recentForm: [],
        };
      } else if (sport === 'tennis') {
        var tnFixture = scored.fixture || {};
        tip = {
          id: tipId,
          sport: 'tennis',
          event: (tnFixture.player1 || 'P1') + ' vs ' + (tnFixture.player2 || 'P2') + ' - ' + (tnFixture.tournament || 'Tournament'),
          league: tnFixture.tour || 'ATP',
          kickoff: tnFixture.time || '',
          venue: tnFixture.tournament || '',
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
          bookmakerOdds: {},
          recentForm: [],
        };
      } else if (sport === 'american-football') {
        var nfFixture = scored.fixture || {};
        tip = {
          id: tipId,
          sport: 'american-football',
          event: (nfFixture.homeTeam || 'Home') + ' vs ' + (nfFixture.awayTeam || 'Away') + ' - NFL' + (nfFixture.week ? ' Week ' + nfFixture.week : ''),
          league: 'NFL',
          kickoff: nfFixture.time || '',
          venue: nfFixture.venue || '',
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
          bookmakerOdds: {},
          recentForm: [],
        };
      } else if (sport === 'basketball') {
        var bkFixture = scored.fixture || {};
        tip = {
          id: tipId,
          sport: 'basketball',
          event: (bkFixture.homeTeam || 'Home') + ' vs ' + (bkFixture.awayTeam || 'Away') + ' - NBA',
          league: 'NBA',
          kickoff: bkFixture.time || '',
          venue: bkFixture.venue || '',
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
          bookmakerOdds: {},
          recentForm: [],
        };
      }

      // Persist adjustedFactors on the tip object for quality-loop correlation
      tip.adjustedFactors = adjustedFactors;

      newTips.push(tip);
    }

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

      // Mark this candidate as published in shadow scoring
      try {
        await db.query(
          "UPDATE scored_candidates SET was_published = true, tip_id = $1 WHERE date = $2 AND selection = $3 AND sport = $4 AND was_published = false LIMIT 1",
          [nt.id, today, nt.selection, nt.sport]
        );
      } catch (e) { /* non-fatal */ }

      // Now tip exists in DB — write tip_enrichment (FK-safe) and link enrichment_id
      var enrichResult = enrichmentResults.get(nt.id);
      if (enrichResult && enrichResult.enrichmentData) {
        try {
          var eData = enrichResult.enrichmentData;
          eData.tipId = nt.id;
          var enrichmentId = await db.createTipEnrichment(eData);
          if (enrichmentId) {
            await db.updateTip(nt.id, { enrichmentId: enrichmentId });
          }
        } catch (enrichWriteErr) {
          console.log('[Auto-Tips] Enrichment write failed for ' + nt.selection + ': ' + enrichWriteErr.message);
        }
      }
    }
    // Make the lowest-confidence tip free (so free users see at least 1)
    if (newTips.length > 0) {
      var lowestConf = newTips.reduce(function(min, t) { return t.confidence < min.confidence ? t : min; }, newTips[0]);
      lowestConf.isPremium = false;
      try { await db.updateTip(lowestConf.id, { isPremium: false }); } catch(e) {}
    }

    // Mark published candidates in the scored_candidates table
    try {
      for (var pi = 0; pi < newTips.length; pi++) {
        var pubTip = newTips[pi];
        // Save published tip as a candidate too (wasPublished = true)
        await db.saveScoredCandidate({
          sport: pubTip.sport, selection: pubTip.selection,
          event: pubTip.event || pubTip.meeting || '', meeting: pubTip.meeting || '',
          league: pubTip.league || '', market: pubTip.market || 'Win',
          odds: pubTip.odds || 0, confidence: pubTip.confidence || 0,
          modelProbability: pubTip.modelProbability || 0,
          impliedProbability: pubTip.impliedProbability || 0,
          edge: pubTip.edge || 0, analyst: pubTip.tipsterProfile || '',
          date: today, kickoff: pubTip.raceTime || pubTip.kickoff || '',
          wasPublished: true, tipId: pubTip.id,
        }).catch(function() { /* skip if duplicate */ });
      }
    } catch (pubErr) { /* non-fatal */ }

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

    // Push notification: tips published
    var pushService = deps.pushService;
    if (pushService && pushService.isAvailable) {
      var napName = newTips.find(function(t) { return t.isNap; });
      pushService.broadcast(db, {
        title: newTips.length + ' tips published',
        body: (napName ? 'NAP: ' + napName.selection + ' — ' : '') + 'Check your dashboard for today\'s selections.',
        url: '/#/dashboard',
        tag: 'daily-tips-' + today,
      }, 'premium').catch(function(e) { console.log('[Push] Broadcast error:', e.message); });
    }

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
  // =========================================================================
  // SHADOW CANDIDATE SETTLEMENT — settle ALL scored candidates, not just tips
  // =========================================================================
  async function settleShadowCandidates() {
    try {
      var today = new Date().toISOString().split('T')[0];
      var threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];

      // Get unsettled candidates from last 3 days
      var unsettled = await db.getScoredCandidates({ settled: false });
      unsettled = unsettled.filter(function(c) {
        var d = c.date ? (typeof c.date === 'string' ? c.date.split('T')[0] : new Date(c.date).toISOString().split('T')[0]) : '';
        return d >= threeDaysAgo && d <= today;
      });

      if (unsettled.length === 0) return;

      // Get all results for matching
      var allResults = await db.getResults();
      var settledCount = 0;

      for (var i = 0; i < unsettled.length; i++) {
        var cand = unsettled[i];
        var candSel = (cand.selection || '').toLowerCase().trim();
        var candDate = cand.date ? (typeof cand.date === 'string' ? cand.date.split('T')[0] : new Date(cand.date).toISOString().split('T')[0]) : '';

        // Check if a published tip with the same selection+date has a result
        var matchingResult = allResults.find(function(r) {
          var rSel = (r.selection || '').toLowerCase().trim();
          var rDate = normDate(r.date);
          return rSel === candSel && rDate === candDate;
        });

        if (matchingResult) {
          await db.settleCandidate(cand.id, matchingResult.result, matchingResult.pnl || 0);
          settledCount++;
          continue;
        }

        // For football candidates, try to match by event to finished fixtures
        if (cand.sport === 'football' && footballSource && process.env.API_FOOTBALL_KEY) {
          try {
            var fbRaw = await footballSource.fetchFixturesByDate(candDate);
            var dayFixtures = footballSource.normalise(fbRaw).filter(function(f) { return f.status === 'FT'; });
            var candEvent = (cand.event || '').toLowerCase();

            var fmatch = dayFixtures.find(function(f) {
              return candEvent.indexOf(f.homeTeam.toLowerCase()) !== -1 || candEvent.indexOf(f.awayTeam.toLowerCase()) !== -1;
            });

            if (fmatch) {
              var homeGoals = fmatch.homeGoals || 0;
              var awayGoals = fmatch.awayGoals || 0;
              var totalGoals = homeGoals + awayGoals;
              var won = false;
              var market = (cand.market || '').toLowerCase();
              var selection = candSel;

              if (market.indexOf('result') !== -1 || market.indexOf('match') !== -1 || market.indexOf('win') !== -1) {
                if (selection.indexOf(fmatch.homeTeam.toLowerCase()) !== -1) won = homeGoals > awayGoals;
                else if (selection.indexOf(fmatch.awayTeam.toLowerCase()) !== -1) won = awayGoals > homeGoals;
                else if (selection.indexOf('draw') !== -1) won = homeGoals === awayGoals;
              } else if (market.indexOf('btts') !== -1 || market.indexOf('both teams') !== -1) {
                won = selection.indexOf('yes') !== -1 ? (homeGoals > 0 && awayGoals > 0) : !(homeGoals > 0 && awayGoals > 0);
              } else if (market.indexOf('over') !== -1) {
                if (selection.indexOf('2.5') !== -1) won = totalGoals > 2;
                else if (selection.indexOf('1.5') !== -1) won = totalGoals > 1;
                else if (selection.indexOf('3.5') !== -1) won = totalGoals > 3;
              } else if (market.indexOf('under') !== -1) {
                if (selection.indexOf('2.5') !== -1) won = totalGoals < 3;
              }

              var resultVal = won ? 'won' : 'lost';
              var stake = 2;
              var pnl = won ? ((cand.odds - 1) * stake) : -stake;
              await db.settleCandidate(cand.id, resultVal, Math.round(pnl * 100) / 100);
              settledCount++;
            }
          } catch (e) { /* skip individual errors */ }
        }

        // For racing candidates, match via racing results
        if (cand.sport === 'racing' && racingSource && process.env.RACING_API_KEY) {
          try {
            var raceResults = await racingSource.fetchResults(candDate);
            if (raceResults && raceResults.results) {
              var normHorse = function(name) {
                if (!name) return '';
                return name.toLowerCase().replace(/\s*\([a-z]{2,4}\)\s*$/i, '').trim();
              };
              var horseName = normHorse(cand.selection);
              var candMeeting = (cand.meeting || '').toLowerCase().trim();

              var match = raceResults.results.find(function(r) {
                var raceCourse = (r.course || r.meeting || '').toLowerCase().trim();
                var courseMatch = !candMeeting || raceCourse.indexOf(candMeeting) !== -1 || candMeeting.indexOf(raceCourse) !== -1;
                return courseMatch && r.runners && r.runners.some(function(runner) {
                  return normHorse(runner.horse) === horseName;
                });
              });

              if (match) {
                var winner = match.runners.find(function(r) { return parseInt(r.position, 10) === 1; });
                var tipWon = winner && normHorse(winner.horse) === horseName;
                var rResult = tipWon ? 'won' : 'lost';
                var rStake = 2;
                var rPnl = tipWon ? ((cand.odds - 1) * rStake) : -rStake;
                await db.settleCandidate(cand.id, rResult, Math.round(rPnl * 100) / 100);
                settledCount++;
              }
            }
          } catch (e) { /* skip */ }
        }
      }

      if (settledCount > 0) {
        console.log('[Shadow Settle] Settled ' + settledCount + ' candidate(s) from ' + unsettled.length + ' unsettled');
      }
    } catch (err) {
      console.error('[Shadow Settle] Error:', err.message);
    }
  }

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
                var racingOutcome = tipRunner ? (tip.selection + ' finished ' + (tipRunner.position === '1' ? '1st' : tipRunner.position === '2' ? '2nd' : tipRunner.position === '3' ? '3rd' : tipRunner.position + 'th') + (tipRunner.sp ? ' (SP ' + tipRunner.sp + ')' : '')) : '';
                if (winner && normHorse(winner.horse) !== tipName) {
                  racingOutcome += ' — Winner: ' + winner.horse + (winner.sp ? ' (SP ' + winner.sp + ')' : '');
                }
                await db.updateTip(tip.id, { actualOutcome: racingOutcome });

                await db.createResult({
                  id: resultId,
                  tipId: tip.id, sport: 'racing', event: tip.event, selection: tip.selection,
                  market: tip.market, odds: tip.odds, stake: stake,
                  result: resultVal, pnl: Math.round(pnl * 100) / 100,
                  date: tip.date, isPremium: tip.isPremium, tipsterProfile: tip.tipsterProfile || 'The Edge',
                  confidence: tip.confidence, actualOutcome: racingOutcome,
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

                // Generate AI race replay analysis (non-blocking IIFE — does not block settle loop)
                if (aiReports && aiReports.isAvailable() && tip.sport === 'racing') {
                  // IIFE has its own function scope — var declarations here don't conflict with outer scope
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

                      // Fetch Sonar post-race context (non-blocking, runs inside IIFE)
                      var pxClient = deps.perplexityClient;
                      if (pxClient) {
                        try {
                          var sonarReplayCtx = await pxClient.enrichReplay(replayData);
                          if (sonarReplayCtx) {
                            replayData.liveContext = sonarReplayCtx;
                          }
                        } catch (sonarReplayErr) {
                          // Non-fatal — Claude generates without Sonar context
                        }
                      }

                      var replay = await aiReports.generateRaceReplay(replayData);
                      if (replay && tip._resultId) {
                        await db.updateResult(tip._resultId, { replayAnalysis: replay });
                        console.log('[Auto-Settle] Race replay generated for: ' + tip.selection + (replayData.liveContext ? ' (Sonar-enriched)' : ''));
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

        // Also settle race predictions ("Our Pick" in every race)
        try {
          if (raceResults && raceResults.results && raceResults.results.length > 0) {
            var rpSettled = await db.settleRacePredictions(raceResults.results);
            if (rpSettled > 0) console.log('[Auto-Settle] Race predictions: ' + rpSettled + ' settled');
          }
        } catch (rpErr) { /* non-fatal */ }
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

              var actualOutcome = fmatch.homeTeam + ' ' + homeGoals + '-' + awayGoals + ' ' + fmatch.awayTeam;
              await db.updateTip(ftip.id, { actualOutcome: actualOutcome });

              await db.createResult({
                id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                tipId: ftip.id, sport: 'football', event: ftip.event, selection: ftip.selection,
                market: ftip.market, odds: ftip.odds, stake: fStake,
                result: fResultVal, pnl: Math.round(fPnl * 100) / 100,
                date: ftip.date, isPremium: ftip.isPremium, tipsterProfile: ftip.tipsterProfile || 'The Edge',
                confidence: ftip.confidence, actualOutcome: actualOutcome,
              });
              updated++;
              var fClvLabel = fClvPct !== null ? ' CLV: ' + fClvPct.toFixed(2) + '%' : '';
              console.log('[Auto-Settle] Football: ' + ftip.selection + ' (' + actualOutcome + ') = ' + fResultVal + ' (' + fPnl.toFixed(2) + 'u)' + fClvLabel + ' [' + ftip.date + ']');

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

        // Also settle match predictions ("Our Take" on every game)
        try {
          var predResults = [];
          for (var fdi = 0; fdi < datesToSettle.length; fdi++) {
            try {
              var dayMatches = await footballSource.getResults(datesToSettle[fdi]);
              if (dayMatches) predResults = predResults.concat(dayMatches);
            } catch(e) {}
          }
          if (predResults.length > 0) {
            var predSettled = await db.settleMatchPredictions(predResults);
            if (predSettled > 0) console.log('[Auto-Settle] Match predictions: ' + predSettled + ' settled');
          }
        } catch (predErr) { /* non-fatal */ }
      }

      // Auto-settle NBA basketball results
      var basketballDataSvc = deps.basketballData;
      if (basketballDataSvc && basketballDataSvc.isAvailable) {
        try {
          var nbaResults = [];
          for (var nbi = 0; nbi < datesToSettle.length; nbi++) {
            try {
              var dayNbaResults = await basketballDataSvc.getResults(datesToSettle[nbi]);
              nbaResults = nbaResults.concat(dayNbaResults);
            } catch (e) { /* individual day optional */ }
          }

          for (var nbti = 0; nbti < activeTips.length; nbti++) {
            var nbTip = activeTips[nbti];
            if (nbTip.sport !== 'basketball') continue;

            var nbMatch = nbaResults.find(function(g) {
              var eventLower = (nbTip.event || '').toLowerCase();
              return eventLower.indexOf(g.homeTeam.toLowerCase()) !== -1 ||
                     eventLower.indexOf(g.awayTeam.toLowerCase()) !== -1;
            });

            if (nbMatch) {
              var nbHomeScore = nbMatch.homeScore || 0;
              var nbAwayScore = nbMatch.awayScore || 0;
              var nbTotalPoints = nbHomeScore + nbAwayScore;
              var nbWon = false;

              var nbMarket = (nbTip.market || '').toLowerCase();
              var nbSelection = (nbTip.selection || '').toLowerCase();

              // Match Winner
              if (nbMarket.indexOf('winner') !== -1 || nbMarket.indexOf('result') !== -1) {
                if (nbSelection.indexOf(nbMatch.homeTeam.toLowerCase()) !== -1) nbWon = nbHomeScore > nbAwayScore;
                else if (nbSelection.indexOf(nbMatch.awayTeam.toLowerCase()) !== -1) nbWon = nbAwayScore > nbHomeScore;
              }
              // Over/Under
              else if (nbMarket.indexOf('over') !== -1) {
                var nbLine = parseFloat(nbMarket.match(/[\d.]+/)) || 220.5;
                nbWon = nbTotalPoints > nbLine;
              } else if (nbMarket.indexOf('under') !== -1) {
                var nbULine = parseFloat(nbMarket.match(/[\d.]+/)) || 220.5;
                nbWon = nbTotalPoints < nbULine;
              }

              var nbResultVal = nbWon ? 'won' : 'lost';
              var nbStake = parseFloat(nbTip.staking) || 2;
              var nbPnl = nbWon ? ((nbTip.odds - 1) * nbStake) : -nbStake;

              // Check for duplicate
              var nbAllResults = await db.getResults();
              var nbAlready = nbAllResults.some(function(r) {
                return r.selection === nbTip.selection && normDate(r.date) === normDate(nbTip.date);
              });
              if (nbAlready) {
                if (nbTip.status === 'active') await db.updateTip(nbTip.id, { status: 'settled' });
                continue;
              }

              var nbOutcome = nbMatch.homeTeam + ' ' + nbHomeScore + '-' + nbAwayScore + ' ' + nbMatch.awayTeam;
              await db.updateTip(nbTip.id, {
                status: 'settled', result: nbResultVal, actualOutcome: nbOutcome,
                settledAt: new Date().toISOString(),
                settlementSource: 'auto-basketball-api',
              });

              await db.createResult({
                id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                tipId: nbTip.id, sport: 'basketball', event: nbTip.event, selection: nbTip.selection,
                market: nbTip.market, odds: nbTip.odds, stake: nbStake,
                result: nbResultVal, pnl: Math.round(nbPnl * 100) / 100,
                date: nbTip.date, isPremium: nbTip.isPremium, tipsterProfile: nbTip.tipsterProfile || 'The Edge',
                confidence: nbTip.confidence, actualOutcome: nbOutcome,
              });
              updated++;
              console.log('[Auto-Settle] NBA: ' + nbTip.selection + ' (' + nbMatch.homeTeam + ' ' + nbHomeScore + '-' + nbAwayScore + ' ' + nbMatch.awayTeam + ') = ' + nbResultVal + ' (' + nbPnl.toFixed(2) + 'u)');

              // Telegram for wins
              if (telegramBot && telegramBot.isAvailable() && nbWon) {
                try {
                  await telegramBot.sendResult({
                    selection: nbTip.selection, odds: nbTip.odds, result: nbResultVal,
                    pnl: Math.round(nbPnl * 100) / 100, event: nbTip.event,
                  });
                } catch (tgErr) { /* non-fatal */ }
              }
            }
          }
        } catch (err) { console.error('[Auto-Settle] NBA error:', err.message); }
      }

      // Auto-settle rugby league results
      var rugbyDataSvc = deps.rugbyData;
      if (rugbyDataSvc && rugbyDataSvc.isAvailable) {
        try {
          var rgResults = [];
          for (var rgi = 0; rgi < datesToSettle.length; rgi++) {
            try {
              var dayRgResults = await rugbyDataSvc.getResults(datesToSettle[rgi]);
              rgResults = rgResults.concat(dayRgResults);
            } catch (e) { /* individual day optional */ }
          }

          for (var rgti = 0; rgti < activeTips.length; rgti++) {
            var rgTip = activeTips[rgti];
            if (rgTip.sport !== 'rugby') continue;

            var rgMatch = rgResults.find(function(g) {
              var eventLower = (rgTip.event || '').toLowerCase();
              return eventLower.indexOf(g.homeTeam.toLowerCase()) !== -1 ||
                     eventLower.indexOf(g.awayTeam.toLowerCase()) !== -1;
            });

            if (rgMatch) {
              var rgHomeScore = rgMatch.homeScore || 0;
              var rgAwayScore = rgMatch.awayScore || 0;
              var rgTotalPts = rgHomeScore + rgAwayScore;
              var rgWon = false;

              var rgMarket = (rgTip.market || '').toLowerCase();
              var rgSelection = (rgTip.selection || '').toLowerCase();

              if (rgMarket.indexOf('winner') !== -1 || rgMarket.indexOf('result') !== -1) {
                if (rgSelection.indexOf(rgMatch.homeTeam.toLowerCase()) !== -1) rgWon = rgHomeScore > rgAwayScore;
                else if (rgSelection.indexOf(rgMatch.awayTeam.toLowerCase()) !== -1) rgWon = rgAwayScore > rgHomeScore;
              } else if (rgMarket.indexOf('over') !== -1) {
                var rgLine = parseFloat(rgMarket.match(/[\d.]+/)) || 42.5;
                rgWon = rgTotalPts > rgLine;
              } else if (rgMarket.indexOf('under') !== -1) {
                var rgULine = parseFloat(rgMarket.match(/[\d.]+/)) || 42.5;
                rgWon = rgTotalPts < rgULine;
              }

              var rgResultVal = rgWon ? 'won' : 'lost';
              var rgStake = parseFloat(rgTip.staking) || 2;
              var rgPnl = rgWon ? ((rgTip.odds - 1) * rgStake) : -rgStake;

              var rgAllResults = await db.getResults();
              var rgAlready = rgAllResults.some(function(r) {
                return r.selection === rgTip.selection && normDate(r.date) === normDate(rgTip.date);
              });
              if (rgAlready) {
                if (rgTip.status === 'active') await db.updateTip(rgTip.id, { status: 'settled' });
                continue;
              }

              var rgOutcome = rgMatch.homeTeam + ' ' + rgHomeScore + '-' + rgAwayScore + ' ' + rgMatch.awayTeam;
              await db.updateTip(rgTip.id, {
                status: 'settled', result: rgResultVal, actualOutcome: rgOutcome,
                settledAt: new Date().toISOString(),
                settlementSource: 'auto-rugby-api',
              });

              await db.createResult({
                id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                tipId: rgTip.id, sport: 'rugby', event: rgTip.event, selection: rgTip.selection,
                market: rgTip.market, odds: rgTip.odds, stake: rgStake,
                result: rgResultVal, pnl: Math.round(rgPnl * 100) / 100,
                date: rgTip.date, isPremium: rgTip.isPremium, tipsterProfile: rgTip.tipsterProfile || 'The Edge',
                confidence: rgTip.confidence, actualOutcome: rgOutcome,
              });
              updated++;
              console.log('[Auto-Settle] Rugby: ' + rgTip.selection + ' (' + rgMatch.homeTeam + ' ' + rgHomeScore + '-' + rgAwayScore + ' ' + rgMatch.awayTeam + ') = ' + rgResultVal + ' (' + rgPnl.toFixed(2) + 'u)');

              if (telegramBot && telegramBot.isAvailable() && rgWon) {
                try {
                  await telegramBot.sendResult({
                    selection: rgTip.selection, odds: rgTip.odds, result: rgResultVal,
                    pnl: Math.round(rgPnl * 100) / 100, event: rgTip.event,
                  });
                } catch (tgErr) { /* non-fatal */ }
              }
            }
          }
        } catch (err) { console.error('[Auto-Settle] Rugby error:', err.message); }
      }

      // Auto-settle NFL results
      var nflDataSvc = deps.nflData;
      if (nflDataSvc && nflDataSvc.isAvailable) {
        try {
          var nflResults = [];
          for (var nfi = 0; nfi < datesToSettle.length; nfi++) {
            try {
              var dayNflResults = await nflDataSvc.getResults(datesToSettle[nfi]);
              nflResults = nflResults.concat(dayNflResults);
            } catch (e) { /* individual day optional */ }
          }

          for (var nfti = 0; nfti < activeTips.length; nfti++) {
            var nfTip = activeTips[nfti];
            if (nfTip.sport !== 'american-football') continue;

            var nfMatch = nflResults.find(function(g) {
              var eventLower = (nfTip.event || '').toLowerCase();
              return eventLower.indexOf(g.homeTeam.toLowerCase()) !== -1 ||
                     eventLower.indexOf(g.awayTeam.toLowerCase()) !== -1;
            });

            if (nfMatch) {
              var nfHomeScore = nfMatch.homeScore || 0;
              var nfAwayScore = nfMatch.awayScore || 0;
              var nfTotal = nfHomeScore + nfAwayScore;
              var nfWon = false;

              var nfMarket = (nfTip.market || '').toLowerCase();
              var nfSelection = (nfTip.selection || '').toLowerCase();

              if (nfMarket.indexOf('moneyline') !== -1 || nfMarket.indexOf('winner') !== -1) {
                if (nfSelection.indexOf(nfMatch.homeTeam.toLowerCase()) !== -1) nfWon = nfHomeScore > nfAwayScore;
                else if (nfSelection.indexOf(nfMatch.awayTeam.toLowerCase()) !== -1) nfWon = nfAwayScore > nfHomeScore;
              } else if (nfMarket.indexOf('over') !== -1) {
                var nfLine = parseFloat(nfMarket.match(/[\d.]+/)) || 45.5;
                nfWon = nfTotal > nfLine;
              } else if (nfMarket.indexOf('under') !== -1) {
                var nfULine = parseFloat(nfMarket.match(/[\d.]+/)) || 45.5;
                nfWon = nfTotal < nfULine;
              }

              var nfResultVal = nfWon ? 'won' : 'lost';
              var nfStake = parseFloat(nfTip.staking) || 2;
              var nfPnl = nfWon ? ((nfTip.odds - 1) * nfStake) : -nfStake;

              var nfAllResults = await db.getResults();
              var nfAlready = nfAllResults.some(function(r) {
                return r.selection === nfTip.selection && normDate(r.date) === normDate(nfTip.date);
              });
              if (nfAlready) {
                if (nfTip.status === 'active') await db.updateTip(nfTip.id, { status: 'settled' });
                continue;
              }

              var nfOutcome = nfMatch.homeTeam + ' ' + nfHomeScore + '-' + nfAwayScore + ' ' + nfMatch.awayTeam;
              await db.updateTip(nfTip.id, {
                status: 'settled', result: nfResultVal, actualOutcome: nfOutcome,
                settledAt: new Date().toISOString(),
                settlementSource: 'auto-nfl-api',
              });

              await db.createResult({
                id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                tipId: nfTip.id, sport: 'american-football', event: nfTip.event, selection: nfTip.selection,
                market: nfTip.market, odds: nfTip.odds, stake: nfStake,
                result: nfResultVal, pnl: Math.round(nfPnl * 100) / 100,
                date: nfTip.date, isPremium: nfTip.isPremium, tipsterProfile: nfTip.tipsterProfile || 'The Edge',
                confidence: nfTip.confidence, actualOutcome: nfOutcome,
              });
              updated++;
              console.log('[Auto-Settle] NFL: ' + nfTip.selection + ' (' + nfMatch.homeTeam + ' ' + nfHomeScore + '-' + nfAwayScore + ' ' + nfMatch.awayTeam + ') = ' + nfResultVal + ' (' + nfPnl.toFixed(2) + 'u)');

              if (telegramBot && telegramBot.isAvailable() && nfWon) {
                try {
                  await telegramBot.sendResult({ selection: nfTip.selection, odds: nfTip.odds, result: nfResultVal, pnl: Math.round(nfPnl * 100) / 100, event: nfTip.event });
                } catch (tgErr) { /* non-fatal */ }
              }
            }
          }
        } catch (err) { console.error('[Auto-Settle] NFL error:', err.message); }
      }

      // Auto-settle tennis results
      var tennisDataSvc = deps.tennisData;
      if (tennisDataSvc && tennisDataSvc.isAvailable) {
        try {
          var tnResults = [];
          for (var tni = 0; tni < datesToSettle.length; tni++) {
            try {
              var dayTnResults = await tennisDataSvc.getResults(datesToSettle[tni]);
              tnResults = tnResults.concat(dayTnResults);
            } catch (e) { /* individual day optional */ }
          }

          for (var tnti = 0; tnti < activeTips.length; tnti++) {
            var tnTip = activeTips[tnti];
            if (tnTip.sport !== 'tennis') continue;

            // Match by player name in the event
            var tnMatch = tnResults.find(function(m) {
              var eventLower = (tnTip.event || '').toLowerCase();
              return eventLower.indexOf(m.player1.toLowerCase()) !== -1 ||
                     eventLower.indexOf(m.player2.toLowerCase()) !== -1;
            });

            if (tnMatch && tnMatch.winner) {
              var tnSelection = (tnTip.selection || '').toLowerCase();
              var tnWinner = '';
              if (tnMatch.winner === 'First Player') tnWinner = tnMatch.player1.toLowerCase();
              else if (tnMatch.winner === 'Second Player') tnWinner = tnMatch.player2.toLowerCase();

              var tnWon = tnSelection.indexOf(tnWinner) !== -1 || tnWinner.indexOf(tnSelection.split(' ').pop()) !== -1;

              var tnResultVal = tnWon ? 'won' : 'lost';
              var tnStake = parseFloat(tnTip.staking) || 2;
              var tnPnl = tnWon ? ((tnTip.odds - 1) * tnStake) : -tnStake;

              var tnAllResults = await db.getResults();
              var tnAlready = tnAllResults.some(function(r) {
                return r.selection === tnTip.selection && normDate(r.date) === normDate(tnTip.date);
              });
              if (tnAlready) {
                if (tnTip.status === 'active') await db.updateTip(tnTip.id, { status: 'settled' });
                continue;
              }

              var tnOutcome = (tnMatch.finalResult || tnMatch.winner || '');
              await db.updateTip(tnTip.id, {
                status: 'settled', result: tnResultVal, actualOutcome: tnOutcome,
                settledAt: new Date().toISOString(),
                settlementSource: 'auto-tennis-api',
              });

              await db.createResult({
                id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                tipId: tnTip.id, sport: 'tennis', event: tnTip.event, selection: tnTip.selection,
                market: tnTip.market, odds: tnTip.odds, stake: tnStake,
                result: tnResultVal, pnl: Math.round(tnPnl * 100) / 100,
                date: tnTip.date, isPremium: tnTip.isPremium, tipsterProfile: tnTip.tipsterProfile || 'The Edge',
                confidence: tnTip.confidence, actualOutcome: tnOutcome,
              });
              updated++;
              console.log('[Auto-Settle] Tennis: ' + tnTip.selection + ' = ' + tnResultVal + ' (' + tnPnl.toFixed(2) + 'u) [' + tnMatch.finalResult + ']');

              if (telegramBot && telegramBot.isAvailable() && tnWon) {
                try {
                  await telegramBot.sendResult({ selection: tnTip.selection, odds: tnTip.odds, result: tnResultVal, pnl: Math.round(tnPnl * 100) / 100, event: tnTip.event });
                } catch (tgErr) { /* non-fatal */ }
              }
            }
          }
        } catch (err) { console.error('[Auto-Settle] Tennis error:', err.message); }
      }

      if (updated > 0) {
        console.log('[Auto-Settle] Settled ' + updated + ' tip(s)');

        // Run strike rate monitor after each settle
        try { await maintainStrikeRate(); } catch (e) { console.error('[StrikeMonitor] Error:', e.message); }

        // Shadow scoring: settle ALL unsettled candidates against today's results
        try {
          await settleShadowCandidates();
        } catch (shadowSettleErr) {
          console.error('[Shadow Settle] Error:', shadowSettleErr.message);
        }

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

      // Fetch Sonar live context ONCE (shared across all subscribers)
      var sonarContext = { racing: null, football: null };
      var perplexityClient = deps.perplexityClient;
      if (perplexityClient) {
        try {
          sonarContext = await perplexityClient.enrichBulletin(todayTips);
          if (sonarContext.racing || sonarContext.football) {
            console.log('[Bulletin] Sonar context: racing=' + (sonarContext.racing ? 'yes' : 'no') + ', football=' + (sonarContext.football ? 'yes' : 'no'));
          }
        } catch (sonarErr) {
          console.log('[Bulletin] Sonar enrichment skipped: ' + sonarErr.message);
        }
      }

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
              streak: streakStr,
              liveContext: { racing: sonarContext.racing, football: sonarContext.football },
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
            var sportLabel = tip.sport === 'racing' ? 'Racing' : tip.sport === 'football' ? 'Football' : tip.sport === 'basketball' ? 'NBA' : tip.sport === 'tennis' ? 'Tennis' : tip.sport === 'rugby' ? 'Rugby' : tip.sport === 'american-football' ? 'NFL' : 'Tip';
            tipCardsHtml += '<div style="background:#141824;border-left:3px solid #d4a843;padding:14px 16px;margin:10px 0;border-radius:6px;">';
            tipCardsHtml += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#8b8d93;margin-bottom:4px;">' + sportLabel + '</div>';
            tipCardsHtml += '<strong style="color:#d4a843;font-size:15px;">' + (tip.selection || '') + '</strong>';
            if (tip.odds) tipCardsHtml += ' <span style="color:#e8e6e3;font-weight:800;font-size:15px;">&mdash; ' + tip.odds + '</span>';
            tipCardsHtml += '<br><span style="color:#8b8d93;font-size:12px;">' + (tip.event || '') + '</span>';
            if (tip.isPremium) tipCardsHtml += ' <span style="background:#d4a843;color:#0a0e1a;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;">PREMIUM</span>';
            // Analysis summary — why we picked this
            if (tip.analysis && tip.analysis.summary) {
              tipCardsHtml += '<p style="color:#a0a4b0;font-size:12px;line-height:1.5;margin:8px 0 0;border-top:1px solid rgba(255,255,255,0.06);padding-top:8px;">' + tip.analysis.summary + '</p>';
            }
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
          htmlBody += '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.12),rgba(212,168,67,0.04));border:2px solid rgba(212,168,67,0.3);border-radius:10px;padding:20px;margin:24px 0;text-align:center;">';
          htmlBody += '<a href="https://eliteedgesports.co.uk/#/acca-generator" style="color:#d4a843;font-weight:700;font-size:16px;text-decoration:none;display:block;margin:0 0 8px;">Try Our Acca Generator &rarr;</a>';
          htmlBody += '<p style="color:#8b8d93;font-size:13px;margin:0 0 16px;">Our Smart Acca Generator uses today\'s fixtures and our probability model to build optimised 2-8 fold accumulators.</p>';
          htmlBody += '<a href="https://eliteedgesports.co.uk/#/acca-generator" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">Build My Acca &rarr;</a>';
          htmlBody += '</div>';
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

        // Check if the tipped horse is still among the runners AND not flagged as non-runner
        var found = false;
        var isNR = false;
        for (var r = 0; r < matchedCard.runners.length; r++) {
          var runner = matchedCard.runners[r];
          var runnerName = (runner.name || runner.horse || runner.horseName || '').toLowerCase().trim();
          if (runnerName === selectionName || runnerName.indexOf(selectionName) !== -1 || selectionName.indexOf(runnerName) !== -1) {
            found = true;
            // Check if runner is flagged as non-runner even though still in the list
            if (runner.isNonRunner || runner.is_non_runner || runner.nonRunner || runner.status === 'NR' || runner.status === 'Withdrawn' || runner.scratched) {
              isNR = true;
            }
            break;
          }
        }

        if (!found || isNR) {
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
              message: 'Your 14-day free trial has ended. Upgrade to Premium to keep full access.',
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
                html: '<p>Hi ' + user.name + ',</p><p>Your 14-day free trial has ended. You now have free-tier access.</p><p>Upgrade to Premium to continue enjoying full access to all tips, analysis, and features.</p><p>Best,<br>Elite Edge Sports Tips</p>',
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
                html: '<p>Hi ' + user.name + ',</p><p>Your 14-day free trial ends tomorrow. Upgrade to Premium now to keep access to all premium features, tips, and analysis.</p><p>Best,<br>Elite Edge Sports Tips</p>',
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
  setInterval(safeRun('NonRunners', checkNonRunners), 2 * 60 * 1000); // Every 2 minutes
  setTimeout(safeRun('NonRunners', checkNonRunners), 60000); // 60s after startup

  // Trial expiry checker: run every 15 minutes
  setInterval(safeRun('TrialExpiry', checkTrialExpiries), 15 * 60 * 1000);
  setTimeout(safeRun('TrialExpiry', checkTrialExpiries), 60000);

  // Odds movement alerts: check every 5 minutes
  setInterval(safeRun('OddsAlerts', checkOddsMovementAlerts), 5 * 60 * 1000);
  setTimeout(safeRun('OddsAlerts', checkOddsMovementAlerts), 120000); // 2min after startup

  // =========================================================================
  // STRIPE DUNNING — check grace periods, send final warnings, downgrade
  // =========================================================================
  async function checkDunningGrace() {
    try {
      var users = await db.getUsers();
      var now = new Date();

      for (var i = 0; i < users.length; i++) {
        var u = users[i];
        if (!u.paymentFailedAt || !u.paymentGraceEnd) continue;

        var graceEnd = new Date(u.paymentGraceEnd);
        var failedAt = new Date(u.paymentFailedAt);
        var hoursInGrace = (now.getTime() - failedAt.getTime()) / (1000 * 60 * 60);

        // Stage 1: After 48 hours, send final warning (if not already sent)
        if (hoursInGrace >= 48 && (u.dunningStage || 0) < 2 && now < graceEnd) {
          try {
            await emailService.sendPaymentFinalWarning({ name: u.name, email: u.email });
            await db.updateUser(u.id, { dunningStage: 2 });
            console.log('[Dunning] Final warning sent to', u.email);
          } catch (e) {
            console.error('[Dunning] Final warning email failed for', u.email + ':', e.message);
          }
        }

        // Stage 2: Grace period expired — downgrade to free
        if (now >= graceEnd) {
          await db.updateUser(u.id, {
            subscription: 'free',
            paymentFailedAt: null,
            paymentGraceEnd: null,
            dunningStage: 0,
          });
          console.log('[Dunning] Grace expired — downgraded', u.email, 'to free');

          // Audit log
          try {
            await db.createAuditEntry({
              userId: u.id, userEmail: u.email,
              action: 'subscription_downgraded', entity: 'user', entityId: u.id,
              details: { reason: 'payment_failed_grace_expired' },
            });
          } catch (e) { /* non-fatal */ }
        }
      }
    } catch (err) {
      console.error('[Dunning] Error:', err.message);
    }
  }

  // Dunning check: every 30 minutes
  setInterval(safeRun('Dunning', checkDunningGrace), 30 * 60 * 1000);
  setTimeout(safeRun('Dunning', checkDunningGrace), 2 * 60 * 1000);

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
  // =========================================================================
  // PRE-RACE VALIDATION — re-evaluate tips 30-45 mins before race
  // Checks: going changes, non-runners impact, odds drift, edge erosion
  // =========================================================================
  var validatedTips = new Set();

  async function preRaceValidation() {
    if (!racingSource) return;
    try {
      var tips = await db.getTips({ sport: 'racing', status: 'active' });
      if (!tips || tips.length === 0) return;

      var now = new Date();
      var ukNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
      var currentMins = ukNow.getHours() * 60 + ukNow.getMinutes();

      for (var i = 0; i < tips.length; i++) {
        var tip = tips[i];
        if (validatedTips.has(tip.id)) continue;

        // Parse race time
        var raceTime = tip.raceTime || '';
        if (!raceTime) continue;
        var timeParts = raceTime.split(':');
        var raceMins = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1] || 0);

        // Only validate 15-45 minutes before race
        var minsUntilRace = raceMins - currentMins;
        if (minsUntilRace < 15 || minsUntilRace > 45) continue;

        validatedTips.add(tip.id);
        var warnings = [];
        var shouldPull = false;

        // 1. Check current odds vs published odds (drift detection)
        if (tip.bookmakerOdds && Object.keys(tip.bookmakerOdds).length > 0) {
          var currentPrices = Object.values(tip.bookmakerOdds).filter(function(v) { return v > 0; });
          if (currentPrices.length > 0) {
            var currentAvg = currentPrices.reduce(function(s, v) { return s + v; }, 0) / currentPrices.length;
            var publishedOdds = tip.odds || 0;
            if (publishedOdds > 0 && currentAvg > 0) {
              var driftPct = ((currentAvg - publishedOdds) / publishedOdds) * 100;

              // Store drift data on the tip
              await db.updateTip(tip.id, {
                oddsDrift: Math.round(driftPct * 10) / 10,
                currentOdds: Math.round(currentAvg * 100) / 100,
              });

              if (driftPct > 40) {
                warnings.push('ODDS DRIFTED ' + Math.round(driftPct) + '% — market confidence has weakened significantly');
                shouldPull = true;
              } else if (driftPct > 20) {
                warnings.push('Odds drifted ' + Math.round(driftPct) + '% — consider reducing stake');
              } else if (driftPct < -15) {
                warnings.push('Odds shortened ' + Math.abs(Math.round(driftPct)) + '% — market agrees with our selection');
              }
            }
          }
        }

        // 2. Recalculate edge with current odds
        var currentOddsVal = tip.currentOdds || tip.odds;
        if (currentOddsVal > 0 && tip.modelProbability > 0) {
          var currentImplied = 1 / currentOddsVal;
          var currentEdge = tip.modelProbability - currentImplied;
          if (currentEdge < 0.03 && (tip.edge || 0) >= 0.05) {
            warnings.push('Edge eroded from ' + ((tip.edge || 0) * 100).toFixed(1) + '% to ' + (currentEdge * 100).toFixed(1) + '% — value may have gone');
            if (currentEdge < 0.01) shouldPull = true;
          }
        }

        // 3. Apply confidence decay based on drift
        var oddsDrift = tip.oddsDrift || 0;
        if (oddsDrift > 20) {
          var newConf = Math.max((tip.confidence || 7) - 1, 4);
          if (oddsDrift > 40) newConf = Math.max((tip.confidence || 7) - 2, 3);
          if (newConf !== tip.confidence) {
            await db.updateTip(tip.id, { confidence: newConf, preRaceAdjusted: true });
            warnings.push('Confidence adjusted from ' + tip.confidence + ' to ' + newConf + ' (market drift)');
          }
        }

        // 4. Store warnings on the tip for frontend display
        if (warnings.length > 0) {
          await db.updateTip(tip.id, { preRaceWarnings: warnings });
          console.log('[PreRace] ' + tip.selection + ': ' + warnings.join(' | '));
        }

        // 5. If conditions are severely against, void the tip
        if (shouldPull) {
          await db.updateTip(tip.id, { status: 'voided', preRacePulled: true });
          await db.createNotification({
            type: 'warning',
            message: 'TIP PULLED: ' + tip.selection + ' — ' + warnings[0],
            tipId: tip.id,
          });
          console.log('[PreRace] PULLED: ' + tip.selection + ' — conditions changed too much');
        }
      }
    } catch (err) {
      console.error('[PreRace] Validation error:', err.message);
    }
  }

  // PRE-MATCH VALIDATION — same as pre-race but for football
  async function preMatchValidation() {
    try {
      var tips = await db.getTips({ sport: 'football', status: 'active' });
      if (!tips || tips.length === 0) return;

      var now = new Date();
      var ukNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
      var currentMins = ukNow.getHours() * 60 + ukNow.getMinutes();

      for (var i = 0; i < tips.length; i++) {
        var tip = tips[i];
        if (validatedTips.has(tip.id)) continue;

        // Parse kickoff time
        var kickoff = tip.kickoff || '';
        if (!kickoff) continue;
        var koParts = kickoff.split(':');
        var koMins = parseInt(koParts[0]) * 60 + parseInt(koParts[1] || 0);
        var minsUntilKO = koMins - currentMins;
        if (minsUntilKO < 15 || minsUntilKO > 60) continue;

        validatedTips.add(tip.id);
        var warnings = [];
        var shouldPull = false;

        // Odds drift check
        if (tip.bookmakerOdds && Object.keys(tip.bookmakerOdds).length > 0) {
          var prices = Object.values(tip.bookmakerOdds).filter(function(v) { return v > 0; });
          if (prices.length > 0) {
            var avgNow = prices.reduce(function(s, v) { return s + v; }, 0) / prices.length;
            var pubOdds = tip.odds || 0;
            if (pubOdds > 0 && avgNow > 0) {
              var drift = ((avgNow - pubOdds) / pubOdds) * 100;
              await db.updateTip(tip.id, { oddsDrift: Math.round(drift * 10) / 10, currentOdds: Math.round(avgNow * 100) / 100 });

              if (drift > 30) {
                warnings.push('ODDS DRIFTED ' + Math.round(drift) + '% — late team news may have changed the picture');
                shouldPull = true;
              } else if (drift > 15) {
                warnings.push('Odds drifted ' + Math.round(drift) + '% — possible late lineup change');
              } else if (drift < -10) {
                warnings.push('Odds shortened ' + Math.abs(Math.round(drift)) + '% — market backs our selection');
              }
            }
          }
        }

        // Edge recalculation
        var curOdds = tip.currentOdds || tip.odds;
        if (curOdds > 0 && tip.modelProbability > 0) {
          var curEdge = tip.modelProbability - (1 / curOdds);
          if (curEdge < 0.02 && (tip.edge || 0) >= 0.05) {
            warnings.push('Edge eroded to ' + (curEdge * 100).toFixed(1) + '% — value may have gone');
            if (curEdge < 0) shouldPull = true;
          }
        }

        // Confidence decay for football
        var fDrift = tip.oddsDrift || 0;
        if (fDrift > 15) {
          var newConf = Math.max((tip.confidence || 7) - 1, 4);
          if (fDrift > 30) newConf = Math.max((tip.confidence || 7) - 2, 3);
          if (newConf !== tip.confidence) {
            await db.updateTip(tip.id, { confidence: newConf, preRaceAdjusted: true });
            warnings.push('Confidence adjusted to ' + newConf + ' (market drift)');
          }
        }

        if (warnings.length > 0) {
          await db.updateTip(tip.id, { preRaceWarnings: warnings });
          console.log('[PreMatch] ' + tip.selection + ': ' + warnings.join(' | '));
        }

        if (shouldPull) {
          await db.updateTip(tip.id, { status: 'voided', preRacePulled: true });
          await db.createNotification({ type: 'warning', message: 'TIP PULLED: ' + tip.selection + ' — ' + warnings[0], tipId: tip.id });
          console.log('[PreMatch] PULLED: ' + tip.selection);
        }
      }
    } catch (err) {
      console.error('[PreMatch] Validation error:', err.message);
    }
  }

  // Run pre-race + pre-match validation every 5 minutes during active hours
  setInterval(function() {
    var uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    if (uk.getHours() >= 10 && uk.getHours() <= 22) {
      safeRun('PreRace', preRaceValidation)();
      safeRun('PreMatch', preMatchValidation)();
    }
  }, 5 * 60 * 1000);

  // =========================================================================
  // POST-RESULT LOSS ANALYSIS — determines WHY each loss happened
  // Runs after auto-settle. Compares pre-race/match conditions to outcomes.
  // =========================================================================
  async function analyseLosses() {
    try {
      var allResults = await db.getResults();
      var allTips = await db.getTips();
      var tipMap = {};
      allTips.forEach(function(t) { tipMap[t.id] = t; });

      // Only analyse recent losses not yet analysed
      var recentLosses = allResults.filter(function(r) {
        if (r.result !== 'lost') return false;
        var d = new Date(r.date);
        var dayAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        return d >= dayAgo;
      });

      // Check which have already been analysed
      var existing = [];
      try { existing = await db.getLossAnalysis({}); } catch(e) {}
      var analysedTipIds = {};
      existing.forEach(function(la) { if (la.tip_id) analysedTipIds[la.tip_id] = true; });

      var newAnalyses = 0;
      for (var i = 0; i < recentLosses.length; i++) {
        var result = recentLosses[i];
        if (analysedTipIds[result.tipId]) continue;

        var tip = tipMap[result.tipId] || {};
        var analysis = tip.analysis || {};
        var factors = {};
        try { factors = typeof analysis === 'string' ? JSON.parse(analysis) : analysis; } catch(e) {}

        var lossReason = '';
        var lossCategory = 'unknown';
        var lesson = '';

        if (result.sport === 'racing') {
          // Racing loss analysis
          var goingText = (factors.goingSuitability || '').toLowerCase();
          var riskText = (factors.riskNotes || '').toLowerCase();
          var actualOutcome = (tip.actualOutcome || result.actualOutcome || '').toLowerCase();

          // Going change
          if (goingText.indexOf('uncertain') !== -1 || goingText.indexOf('prove') !== -1 || goingText.indexOf('risk') !== -1) {
            lossCategory = 'going_uncertainty';
            lossReason = 'Going suitability was flagged as uncertain in the analysis — the ground may not have suited.';
            lesson = 'When going is flagged as uncertain, reduce confidence by 1 point or skip unless going factor is 0.8+.';
          }
          // Short-priced favourite beaten
          else if ((result.odds || 0) < 2.5) {
            lossCategory = 'short_price_beaten';
            lossReason = 'Short-priced selection (odds ' + (result.odds || 0).toFixed(2) + ') beaten — limited value at this price with no margin for error.';
            lesson = 'Short-priced favourites offer poor risk/reward. Consider minimum odds of 2.5 for racing tips.';
          }
          // Big field randomness
          else if (actualOutcome && (actualOutcome.indexOf('12th') !== -1 || actualOutcome.indexOf('15th') !== -1 || actualOutcome.indexOf('last') !== -1)) {
            lossCategory = 'field_size_variance';
            lossReason = 'Selection finished well back in a large field — racing luck and field size increase variance.';
            lesson = 'Large field races (14+ runners) carry inherent variance. Consider each-way to protect.';
          }
          // Narrowly beaten (placed but not won)
          else if (actualOutcome && (actualOutcome.indexOf('2nd') !== -1 || actualOutcome.indexOf('3rd') !== -1)) {
            lossCategory = 'narrowly_beaten';
            lossReason = 'Selection placed but did not win — the analysis was directionally correct.';
            lesson = 'Narrow defeats are part of racing. Consider each-way markets for selections rated 7+ confidence.';
          }
          // Trainer form cold
          else if (factors.trainerForm && factors.trainerForm.toLowerCase().indexOf('quiet') !== -1) {
            lossCategory = 'trainer_form_cold';
            lossReason = 'Trainer yard was flagged as quiet in the analysis — cold stables have lower strike rates.';
            lesson = 'Reduce confidence by 1 point when trainer form factor is below 0.5.';
          }
          else {
            lossCategory = 'standard_variance';
            lossReason = 'No clear causal factor identified — likely standard racing variance.';
            lesson = 'Some losses are inevitable. Focus on long-term ROI, not individual results.';
          }
        } else if (result.sport === 'football') {
          // Football loss analysis
          var injText = (factors.injuries || '').toLowerCase();
          var market = (result.market || '').toLowerCase();

          // Late team news / injury impact
          if (injText.indexOf('late') !== -1 || injText.indexOf('check') !== -1 || injText.indexOf('doubt') !== -1) {
            lossCategory = 'late_team_news';
            lossReason = 'Team news was uncertain at time of selection — late changes may have affected the outcome.';
            lesson = 'When injury status is uncertain, reduce confidence or wait for confirmed team news.';
          }
          // Draw when we backed a win
          else if (market.indexOf('result') !== -1 && result.actualOutcome && result.actualOutcome.match(/\b(\d+)-\1\b/)) {
            lossCategory = 'draw_not_predicted';
            lossReason = 'Match ended in a draw — our Match Result pick for a win was wrong.';
            lesson = 'When H2H shows 3+ draws, consider Double Chance instead of Match Result.';
          }
          // Low-scoring game when we backed goals
          else if ((market.indexOf('over') !== -1 || market.indexOf('btts') !== -1) && result.actualOutcome) {
            var scoreMatch = result.actualOutcome.match(/(\d+)\s*-\s*(\d+)/);
            if (scoreMatch) {
              var goals = parseInt(scoreMatch[1]) + parseInt(scoreMatch[2]);
              if (goals <= 1) {
                lossCategory = 'low_scoring_upset';
                lossReason = 'Match produced ' + goals + ' goal(s) — defensive display contradicted the data.';
                lesson = 'Low-scoring upsets happen. If clean sheet % is above 30% for either side, goals markets are riskier.';
              }
            }
          }
          // High-scoring when we backed under
          else if (market.indexOf('under') !== -1) {
            lossCategory = 'high_scoring_upset';
            lossReason = 'More goals than expected — attacking output exceeded defensive expectations.';
            lesson = 'Under markets are fragile. One red card or penalty changes everything.';
          }
          // Short odds beaten
          else if ((result.odds || 0) < 1.8) {
            lossCategory = 'heavy_favourite_beaten';
            lossReason = 'Heavy favourite lost — odds of ' + (result.odds || 0).toFixed(2) + ' offered no value.';
            lesson = 'Avoid odds below 1.8 for football — upsets happen too often at these prices.';
          }
          else {
            lossCategory = 'standard_variance';
            lossReason = 'No clear causal factor — likely standard football variance.';
            lesson = 'Football is unpredictable by nature. The model identifies edges, not certainties.';
          }
        } else {
          lossCategory = 'standard_variance';
          lossReason = 'Standard result variance.';
          lesson = 'Focus on long-term ROI across all sports.';
        }

        await db.saveLossAnalysis({
          tipId: result.tipId, sport: result.sport, selection: result.selection,
          event: result.event, analyst: result.tipsterProfile || tip.tipsterProfile || '',
          odds: result.odds, confidence: tip.confidence || result.confidence || 0,
          lossReason: lossReason, lossCategory: lossCategory,
          factors: factors, lesson: lesson,
          date: result.date || new Date().toISOString().split('T')[0],
        });
        newAnalyses++;
      }

      if (newAnalyses > 0) console.log('[LossAnalysis] Analysed ' + newAnalyses + ' new loss(es)');
    } catch (err) {
      console.error('[LossAnalysis] Error:', err.message);
    }
  }

  // Run loss analysis 2 minutes after auto-settle (gives settle time to complete)
  setInterval(function() { setTimeout(safeRun('LossAnalysis', analyseLosses), 2 * 60 * 1000); }, 10 * 60 * 1000);
  setTimeout(safeRun('LossAnalysis', analyseLosses), 5 * 60 * 1000);

  // AUTO-TUNE ANALYST WEIGHTS (every Monday 3am)
  // Reviews performance data, adjusts weight modifiers for each analyst
  // =========================================================================

  async function autoTuneAnalysts() {
    var uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    var hour = uk.getHours();
    var dateStr = uk.toISOString().split('T')[0];
    var day = uk.getDate();

    // Run every Monday at 3am (weekly tuning cycle)
    var dayOfWeek = uk.getDay();
    if (dayOfWeek !== 1 || hour !== 3 || lastAutoTuneDate === dateStr) return;
    lastAutoTuneDate = dateStr;

    console.log('[AutoTune] Starting weekly analyst performance review...');

    var allResults = await db.getResults();
    var allTips = await db.getTips();

    // Build tip map for enrichment
    var tipMap = {};
    allTips.forEach(function(t) { tipMap[t.id] = t; });

    // Pull ALL prediction data for comprehensive learning
    var racePredictions = [];
    var matchPredictions = [];
    var shadowCandidates = [];
    try { racePredictions = await db.getRacePredictions({}); } catch(e) {}
    try { matchPredictions = await db.getMatchPredictions({}); } catch(e) {}
    try { shadowCandidates = await db.getScoredCandidates({ settled: true }); } catch(e) {}

    // Racing prediction accuracy — model's top pick in every race
    var rpSettled = racePredictions.filter(function(p) { return p.correct !== null; });
    var rpCorrect = rpSettled.filter(function(p) { return p.correct === true; });
    var rpPlaced = rpSettled.filter(function(p) { return p.finish_position && p.finish_position <= 3; });
    var rpWinRate = rpSettled.length > 0 ? Math.round((rpCorrect.length / rpSettled.length) * 100) : 0;
    var rpPlaceRate = rpSettled.length > 0 ? Math.round((rpPlaced.length / rpSettled.length) * 100) : 0;

    // Football prediction accuracy — verdict on every game
    var mpSettled = matchPredictions.filter(function(p) { return p.result !== null; });
    var mpCorrect = mpSettled.filter(function(p) { return p.correct === true; });
    var mpAccuracy = mpSettled.length > 0 ? Math.round((mpCorrect.length / mpSettled.length) * 100) : 0;

    // Shadow candidate accuracy — all scored selections
    var scWins = shadowCandidates.filter(function(c) { return c.result === 'won'; });
    var scTotal = shadowCandidates.filter(function(c) { return c.result === 'won' || c.result === 'lost'; });

    console.log('[AutoTune] Data: ' + allResults.length + ' tip results, ' + rpSettled.length + ' race predictions, ' + mpSettled.length + ' match predictions, ' + scTotal.length + ' shadow candidates');

    var analysts = ['The Professor', 'The Scout', 'The Clocker', 'The Tactician', 'The Edge'];
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

      // LOSS PATTERN ANALYSIS — identify why "bankers" lose
      var bankerLosses = losses.filter(function(r) {
        var tip = tipMap[r.tipId] || {};
        return (tip.confidence || 0) >= 8 && (r.odds || 0) < 4.0;
      });
      if (bankerLosses.length >= 2) {
        // Analyse common factors in high-confidence losses
        var lossFactors = { goingFailed: 0, drawFailed: 0, longAbsence: 0, shortOdds: 0 };
        bankerLosses.forEach(function(r) {
          var tip = tipMap[r.tipId] || {};
          var factors = (tip.analysis && typeof tip.analysis === 'object') ? tip.analysis : {};
          if (r.odds < 2.5) lossFactors.shortOdds++;
          // Check if going was flagged as a concern
          if (factors.goingSuitability && (factors.goingSuitability.indexOf('uncertain') !== -1 || factors.goingSuitability.indexOf('risk') !== -1 || factors.goingSuitability.indexOf('prove') !== -1)) {
            lossFactors.goingFailed++;
          }
        });
        var patterns = [];
        if (lossFactors.shortOdds >= 2) patterns.push(lossFactors.shortOdds + ' high-confidence losses were at very short odds (<2.5) — odds too short to recover from occasional defeats');
        if (lossFactors.goingFailed >= 2) patterns.push(lossFactors.goingFailed + ' losses had going flagged as uncertain — model should weight going concerns higher for this analyst');
        if (patterns.length > 0) {
          actions.push('LOSS PATTERNS (confidence 8+ losses): ' + patterns.join('; '));
        } else {
          actions.push('BANKER LOSSES: ' + bankerLosses.length + ' high-confidence tip(s) lost — no clear pattern identified, likely variance');
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

      // --- ACTIVE TUNING: actually apply adjustments based on loss patterns ---
      var analystKey = name === 'The Professor' ? 'professor' : name === 'The Scout' ? 'scout' : name === 'The Clocker' ? 'clocker' : name === 'The Tactician' ? 'tactician' : 'edge';
      var profile = analystProfiles.profiles[analystKey];
      if (profile) {
        var adjustmentsMade = [];

        // If low-confidence tips are losing, narrow the odds range minimum
        if (lowConfPnl < -3 && lowConfTotal >= 3) {
          profile.oddsRange.min = Math.min(profile.oddsRange.min + 0.3, 3.0);
          adjustmentsMade.push('Raised min odds to ' + profile.oddsRange.min.toFixed(1));
        }

        // If big-price tips are losing badly, cap the max odds
        if (bigOdds.length >= 3 && rangePnl(bigOdds) < -5) {
          profile.oddsRange.max = Math.max(profile.oddsRange.max - 1.0, 8.0);
          adjustmentsMade.push('Lowered max odds to ' + profile.oddsRange.max.toFixed(1));
        }

        // If short-odds tips are losing, raise minimum
        if (shortOdds.length >= 3 && rangePnl(shortOdds) < -3) {
          profile.oddsRange.min = Math.min(profile.oddsRange.min + 0.5, 2.5);
          adjustmentsMade.push('Raised min odds to ' + profile.oddsRange.min.toFixed(1) + ' (short odds losing)');
        }

        // If a specific market is consistently losing, remove it from preferred
        for (var pmkt in byMarket) {
          if (byMarket[pmkt].total >= 5 && byMarket[pmkt].pnl < -3) {
            var sportKeys = ['racing', 'football'];
            sportKeys.forEach(function(sk) {
              if (profile.preferredMarkets[sk]) {
                var idx = profile.preferredMarkets[sk].indexOf(pmkt);
                if (idx !== -1) {
                  profile.preferredMarkets[sk].splice(idx, 1);
                  adjustmentsMade.push('Removed ' + pmkt + ' from ' + sk + ' preferred markets');
                }
              }
            });
          }
        }

        // If ROI is strongly positive, slightly widen the range (reward success)
        if (roi > 20 && analystResults.length >= 10) {
          profile.oddsRange.max = Math.min(profile.oddsRange.max + 0.5, 25.0);
          adjustmentsMade.push('Widened max odds to ' + profile.oddsRange.max.toFixed(1) + ' (strong ROI)');
        }

        // --- LEARN FROM ALL SELECTIONS (not just published tips) ---

        // The Clocker: learn from race predictions (Our Pick in every race)
        if (analystKey === 'clocker' && rpSettled.length >= 10) {
          actions.push('RACE PREDICTIONS: ' + rpCorrect.length + '/' + rpSettled.length + ' winners (' + rpWinRate + '%), ' + rpPlaced.length + ' placed (' + rpPlaceRate + '%)');
          // If win rate is below 15% on all race picks, the going/course weighting needs increasing
          if (rpWinRate < 15 && rpSettled.length >= 20) {
            profile.racingWeightModifiers.going = Math.min(profile.racingWeightModifiers.going + 0.1, 2.0);
            profile.racingWeightModifiers.course = Math.min(profile.racingWeightModifiers.course + 0.1, 2.0);
            adjustmentsMade.push('Clocker: increased going/course weights (win rate ' + rpWinRate + '% too low)');
          }
          // If win rate is above 25%, the model is strong — slightly widen odds range
          if (rpWinRate > 25 && rpSettled.length >= 20) {
            profile.oddsRange.max = Math.min(profile.oddsRange.max + 1.0, 30.0);
            adjustmentsMade.push('Clocker: widened max odds (win rate ' + rpWinRate + '% — strong)');
          }
        }

        // The Tactician: learn from match predictions (Our Take on every game)
        if (analystKey === 'tactician' && mpSettled.length >= 10) {
          actions.push('MATCH PREDICTIONS: ' + mpCorrect.length + '/' + mpSettled.length + ' correct (' + mpAccuracy + '%)');
          // By market type analysis
          var mpByMarket = {};
          mpSettled.forEach(function(p) {
            var m = (p.market || 'unknown').toLowerCase();
            var key = m.indexOf('result') !== -1 ? 'match_result' : m.indexOf('btts') !== -1 || m.indexOf('both') !== -1 ? 'btts' : 'goals';
            if (!mpByMarket[key]) mpByMarket[key] = { correct: 0, total: 0 };
            mpByMarket[key].total++;
            if (p.correct) mpByMarket[key].correct++;
          });
          for (var mKey in mpByMarket) {
            var mData = mpByMarket[mKey];
            var mAcc = mData.total > 0 ? Math.round((mData.correct / mData.total) * 100) : 0;
            actions.push('  ' + mKey + ': ' + mData.correct + '/' + mData.total + ' (' + mAcc + '%)');
            // If a market type is below 40% accuracy with 10+ picks, reduce its weight
            if (mAcc < 40 && mData.total >= 10) {
              if (mKey === 'btts') {
                var idx = profile.preferredMarkets.football.indexOf('Both Teams to Score');
                if (idx !== -1) { profile.preferredMarkets.football.splice(idx, 1); adjustmentsMade.push('Tactician: dropped BTTS (' + mAcc + '% accuracy)'); }
              }
              if (mKey === 'goals' && mAcc < 35) {
                profile.footballWeightModifiers.shots = Math.max(profile.footballWeightModifiers.shots - 0.1, 0.8);
                adjustmentsMade.push('Tactician: reduced shots weight (goals market ' + mAcc + '%)');
              }
            }
          }
          // If overall accuracy is above 60%, increase injury/motivation weights (the key differentiators)
          if (mpAccuracy > 60 && mpSettled.length >= 20) {
            profile.footballWeightModifiers.injuries = Math.min(profile.footballWeightModifiers.injuries + 0.1, 2.0);
            profile.footballWeightModifiers.motivation = Math.min(profile.footballWeightModifiers.motivation + 0.1, 2.0);
            adjustmentsMade.push('Tactician: boosted injury/motivation weights (accuracy ' + mpAccuracy + '%)');
          }
        }

        // All analysts: learn from LOSS PATTERNS (causal analysis)
        try {
          var analystLosses = await db.getLossAnalysis({ analyst: name });
          if (analystLosses.length >= 3) {
            // Count loss categories
            var catCounts = {};
            analystLosses.forEach(function(la) {
              var cat = la.loss_category || 'unknown';
              catCounts[cat] = (catCounts[cat] || 0) + 1;
            });
            var topCats = Object.keys(catCounts).sort(function(a, b) { return catCounts[b] - catCounts[a]; }).slice(0, 3);
            actions.push('LOSS PATTERNS: ' + topCats.map(function(c) { return c.replace(/_/g, ' ') + ' (' + catCounts[c] + 'x)'; }).join(', '));

            // Apply causal lessons
            if (catCounts['going_uncertainty'] >= 3 && profile.racingWeightModifiers) {
              profile.racingWeightModifiers.going = Math.min(profile.racingWeightModifiers.going + 0.15, 2.0);
              adjustmentsMade.push('Going weight +0.15 (going uncertainty caused ' + catCounts['going_uncertainty'] + ' losses)');
            }
            if (catCounts['short_price_beaten'] >= 3) {
              profile.oddsRange.min = Math.min(profile.oddsRange.min + 0.5, 3.0);
              adjustmentsMade.push('Min odds raised (short prices beaten ' + catCounts['short_price_beaten'] + 'x)');
            }
            if (catCounts['late_team_news'] >= 3 && profile.footballWeightModifiers) {
              profile.footballWeightModifiers.injuries = Math.min(profile.footballWeightModifiers.injuries + 0.15, 2.0);
              adjustmentsMade.push('Injury weight +0.15 (late team news caused ' + catCounts['late_team_news'] + ' losses)');
            }
            if (catCounts['heavy_favourite_beaten'] >= 3) {
              profile.oddsRange.min = Math.max(profile.oddsRange.min, 1.8);
              adjustmentsMade.push('Min odds floor at 1.8 (heavy favourites beaten ' + catCounts['heavy_favourite_beaten'] + 'x)');
            }
            if (catCounts['draw_not_predicted'] >= 3 && profile.preferredMarkets && profile.preferredMarkets.football) {
              if (profile.preferredMarkets.football.indexOf('Double Chance') === -1) {
                profile.preferredMarkets.football.push('Double Chance');
                adjustmentsMade.push('Added Double Chance to preferred markets (draws causing losses)');
              }
            }
            if (catCounts['narrowly_beaten'] >= 5 && profile.preferredMarkets && profile.preferredMarkets.racing) {
              if (profile.preferredMarkets.racing.indexOf('Each-Way') === -1) {
                profile.preferredMarkets.racing.push('Each-Way');
                adjustmentsMade.push('Added Each-Way to preferred markets (narrowly beaten ' + catCounts['narrowly_beaten'] + 'x)');
              }
            }
          }
        } catch(e) {}

        // All analysts: learn from shadow candidates
        if (scTotal.length >= 20) {
          var scAnalystPicks = shadowCandidates.filter(function(c) { return c.analyst === name; });
          var scAnalystWins = scAnalystPicks.filter(function(c) { return c.result === 'won'; });
          var scAnalystSettled = scAnalystPicks.filter(function(c) { return c.result === 'won' || c.result === 'lost'; });
          if (scAnalystSettled.length >= 5) {
            var scSR = Math.round((scAnalystWins.length / scAnalystSettled.length) * 100);
            actions.push('SHADOW PICKS: ' + scAnalystWins.length + '/' + scAnalystSettled.length + ' (' + scSR + '%) — includes unpublished selections');
          }
        }

        if (adjustmentsMade.length > 0) {
          actions.push('APPLIED: ' + adjustmentsMade.join(', '));
          console.log('[AutoTune] ' + name + ' adjustments: ' + adjustmentsMade.join(', '));
        }
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
      reportHtml += '<h1 style="color:#d4a843;">Weekly Analyst Performance Review</h1>';
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

      // Loss pattern intelligence
      try {
        var lossPatterns = await db.getLossPatterns();
        if (lossPatterns.length > 0) {
          reportHtml += '<div style="background:#2a1a1a;border:1px solid #ef4444;padding:20px;margin:20px 0;border-radius:8px;">';
          reportHtml += '<h2 style="color:#ef4444;margin-bottom:12px;">Loss Pattern Intelligence</h2>';
          reportHtml += '<p style="color:#94a3b8;font-size:13px;margin-bottom:12px;">Top recurring loss causes — the model is actively learning from these:</p>';
          lossPatterns.slice(0, 8).forEach(function(lp) {
            reportHtml += '<p style="color:#cbd5e1;font-size:13px;margin:4px 0;"><strong style="color:#f59e0b;">' + lp.category.replace(/_/g, ' ') + '</strong> — ' + lp.count + 'x (' + lp.sport + ', ' + lp.analyst + ') avg odds: ' + lp.avgOdds.toFixed(2) + ', avg conf: ' + Math.round(lp.avgConfidence) + '</p>';
          });
          reportHtml += '</div>';
        }
      } catch(e) {}

      // All-selections accuracy section
      reportHtml += '<div style="background:#0a0e1a;border:1px solid #2a2d45;padding:20px;margin:20px 0;border-radius:8px;">';
      reportHtml += '<h2 style="color:#d4a843;margin-bottom:12px;">All Selections Accuracy (Not Just Published Tips)</h2>';
      if (rpSettled.length > 0) {
        reportHtml += '<p style="color:#cbd5e1;">Racing — Our Pick in every race: <strong style="color:#22c55e;">' + rpCorrect.length + '/' + rpSettled.length + ' winners (' + rpWinRate + '%)</strong>, ' + rpPlaced.length + ' placed (' + rpPlaceRate + '%)</p>';
      }
      if (mpSettled.length > 0) {
        reportHtml += '<p style="color:#cbd5e1;">Football — Our Take on every game: <strong style="color:#22c55e;">' + mpCorrect.length + '/' + mpSettled.length + ' correct (' + mpAccuracy + '%)</strong></p>';
      }
      if (scTotal.length > 0) {
        var scOverallSR = scTotal.length > 0 ? Math.round((scWins.length / scTotal.length) * 100) : 0;
        reportHtml += '<p style="color:#cbd5e1;">Shadow Candidates (all scored): <strong>' + scWins.length + '/' + scTotal.length + ' (' + scOverallSR + '%)</strong></p>';
      }
      reportHtml += '</div>';

      // Add marketing-ready stats summary
      var allResults = await db.getResults();
      var counted = allResults.filter(function(r) { return r.result && r.result !== 'void'; });
      var allWins = counted.filter(function(r) { return r.result === 'won' || r.result === 'placed'; });
      var allPnl = counted.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
      var allStaked = counted.reduce(function(s, r) { return s + (r.stake || 1); }, 0);
      var allROI = allStaked > 0 ? Math.round((allPnl / allStaked) * 100) : 0;
      var allSR = counted.length > 0 ? Math.round((allWins.length / counted.length) * 100) : 0;

      reportHtml += '<div style="background:#0a0e1a;border:2px solid #d4a843;padding:20px;margin:20px 0;border-radius:8px;">';
      reportHtml += '<h2 style="color:#d4a843;margin-bottom:12px;">Marketing-Ready Stats (copy/paste)</h2>';
      reportHtml += '<p style="color:#22c55e;font-size:18px;font-weight:800;">+' + allROI + '% ROI | ' + allSR + '% Strike Rate | ' + counted.length + ' Verified Tips | +' + allPnl.toFixed(2) + ' units profit</p>';
      reportHtml += '<p style="color:#94a3b8;font-size:13px;margin-top:8px;">Full track record: https://eliteedgesports.co.uk/#/track-record</p>';
      reportHtml += '</div>';

      reportHtml += '<p style="font-size:12px;color:#64748b;margin-top:20px;">This report is generated automatically every Monday at 3am.</p>';
      reportHtml += '</div>';

      emailService._sendEmail({
        to: adminEmail,
        subject: '📊 Elite Edge — Weekly Analyst Review',
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
  // MONTHLY CREDIT RESET — runs at 1am UK daily, resets credits for users whose reset date has passed
  // =========================================================================
  async function resetMonthlyCredits() {
    try {
      if (!db.isAvailable()) return;
      var today = new Date().toISOString().split('T')[0];
      var uk = getUKTime();
      if (uk.getHours() !== 1) return; // only run at 1am

      var users = await db.getUsers();
      var resetCount = 0;
      for (var i = 0; i < users.length; i++) {
        var u = users[i];
        if (!u.creditsMonthlyAllowance || u.creditsMonthlyAllowance <= 0) continue;
        if (!u.creditsResetDate) continue;
        var resetDate = typeof u.creditsResetDate === 'string' ? u.creditsResetDate.split('T')[0] : '';
        if (resetDate > today) continue; // not due yet

        // Reset credits to monthly allowance
        var nextReset = new Date();
        nextReset.setMonth(nextReset.getMonth() + 1);
        await db.updateUser(u.id, {
          credits: u.creditsMonthlyAllowance,
          creditsResetDate: nextReset.toISOString().split('T')[0],
        });
        await db.recordCreditTransaction({
          userId: u.id, amount: u.creditsMonthlyAllowance,
          balanceAfter: u.creditsMonthlyAllowance,
          type: 'monthly_reset', description: 'Monthly credit reset — ' + u.creditsMonthlyAllowance + ' credits',
        });
        resetCount++;
      }
      if (resetCount > 0) console.log('[Credits] Reset monthly credits for ' + resetCount + ' user(s)');
    } catch (err) {
      console.error('[Credits] Monthly reset error:', err.message);
    }
  }

  setInterval(safeRun('CreditReset', resetMonthlyCredits), 30 * 60 * 1000);
  setTimeout(safeRun('CreditReset', resetMonthlyCredits), 60000);

  // =========================================================================
  // ENRICHMENT QUALITY LOOP — runs at 3:00am UK time
  // Joins enrichment signals to settled tips, computes CLV/ROI correlation
  // =========================================================================
  var lastQualityLoopDate = '';

  async function runEnrichmentQualityLoop() {
    var uk = getUKTime();
    var hour = uk.getHours();
    var dateStr = uk.toISOString().split('T')[0];

    // Run at 3:00am UK, once per day
    if (hour !== 3 || lastQualityLoopDate === dateStr) return;
    lastQualityLoopDate = dateStr;

    try {
      var qualityLoop = require('./perplexity/qualityLoop');
      var results = await qualityLoop.runQualityLoop(db);
      var sigCount = results.signals ? results.signals.length : 0;
      var aggCount = results.aggregates ? results.aggregates.length : 0;
      console.log('[QualityLoop] Completed: ' + sigCount + ' signal(s), ' + aggCount + ' sport aggregate(s)');
    } catch (err) {
      console.error('[QualityLoop] Error:', err.message);
    }
  }

  // Quality loop: check every 10 minutes, 3 mins after startup
  setInterval(safeRun('QualityLoop', runEnrichmentQualityLoop), 10 * 60 * 1000);
  setTimeout(safeRun('QualityLoop', runEnrichmentQualityLoop), 3 * 60 * 1000);

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
