module.exports = function(deps) {
  const router = require('express').Router();
  const { footballSource, oddsSource, betfairSource, scoringModel, authenticate, db, aiReports } = deps;
  const { storeOddsSnapshot, analyseOddsMovement } = deps.oddsHelpers;

  // ---------------------------------------------------------------------------
  // LIVE FOOTBALL DATA (API-Football)
  // ---------------------------------------------------------------------------

  router.get('/football/live-fixtures', async (req, res) => {
    try {
      if (!footballSource || !process.env.API_FOOTBALL_KEY) {
        return res.json({ live: false, message: 'API-Football not configured. Set API_FOOTBALL_KEY.', fixtures: [] });
      }
      var date = req.query.date || new Date().toISOString().split('T')[0];
      var raw = await footballSource.fetchFixturesByDate(date);
      var normalised = footballSource.normalise(raw);
      res.json({ live: true, fixtures: normalised, fetchedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/football/live-scores', async (req, res) => {
    try {
      if (!footballSource || !process.env.API_FOOTBALL_KEY) {
        return res.json({ live: false, fixtures: [] });
      }
      var raw = await footballSource.fetchLiveScores();
      var normalised = footballSource.normalise(raw);
      res.json({ live: true, fixtures: normalised, fetchedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/football/h2h/:team1/:team2', async (req, res) => {
    try {
      if (!footballSource || !process.env.API_FOOTBALL_KEY) return res.json({ live: false });
      var raw = await footballSource.fetchH2H(req.params.team1, req.params.team2);
      res.json({ live: true, matches: footballSource.normalise(raw) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ---------------------------------------------------------------------------
  // MATCH INTELLIGENCE — Deep analysis for any fixture
  // ---------------------------------------------------------------------------
  router.get('/football/match-intelligence/:fixtureId', async (req, res) => {
    try {
      if (!footballSource || !process.env.API_FOOTBALL_KEY) {
        return res.status(503).json({ error: 'API-Football not configured. Set API_FOOTBALL_KEY.' });
      }

      var fixtureId = req.params.fixtureId;

      // 1. Fetch fixture details
      var fixtureData = await footballSource._apiGet('/fixtures?id=' + fixtureId);
      if (!fixtureData.response || !fixtureData.response.length) {
        return res.status(404).json({ error: 'Fixture not found.' });
      }
      var fixture = fixtureData.response[0];
      var homeTeam = fixture.teams.home;
      var awayTeam = fixture.teams.away;
      var league = fixture.league;
      var venue = fixture.fixture.venue;
      var kickoff = fixture.fixture.date;
      var status = fixture.fixture.status;

      // 2. Fetch H2H data
      var h2hData = await footballSource._apiGet(
        '/fixtures/headtohead?h2h=' + homeTeam.id + '-' + awayTeam.id + '&last=10'
      );
      var h2hMatches = h2hData.response || [];

      // 3. Fetch last 10 fixtures for each team + enhanced data (in parallel)
      var parallelResults = await Promise.allSettled([
        footballSource._apiGet('/fixtures?team=' + homeTeam.id + '&last=10&status=FT'),
        footballSource._apiGet('/fixtures?team=' + awayTeam.id + '&last=10&status=FT'),
        footballSource.fetchInjuries(parseInt(fixtureId)),
        footballSource.fetchPredictions(parseInt(fixtureId)),
        footballSource.fetchTeamStats(homeTeam.id, league.id, '2025'),
        footballSource.fetchTeamStats(awayTeam.id, league.id, '2025'),
      ]);

      var homeFixturesData = parallelResults[0].status === 'fulfilled' ? parallelResults[0].value : { response: [] };
      var awayFixturesData = parallelResults[1].status === 'fulfilled' ? parallelResults[1].value : { response: [] };
      var injuriesData = parallelResults[2].status === 'fulfilled' ? parallelResults[2].value : { response: [] };
      var predictionsData = parallelResults[3].status === 'fulfilled' ? parallelResults[3].value : { response: [] };
      var homeTeamStatsData = parallelResults[4].status === 'fulfilled' ? parallelResults[4].value : { response: null };
      var awayTeamStatsData = parallelResults[5].status === 'fulfilled' ? parallelResults[5].value : { response: null };

      var homeFixtures = homeFixturesData.response || [];
      var awayFixtures = awayFixturesData.response || [];

      // Parse enhanced data
      var injuriesList = injuriesData.response || [];
      var predictionsObj = (predictionsData.response && predictionsData.response.length > 0) ? predictionsData.response[0] : null;
      var homeTeamSeasonStats = homeTeamStatsData.response || null;
      var awayTeamSeasonStats = awayTeamStatsData.response || null;

      // --- Build analysis ---

      // Form analysis: last 5 results for each team
      function getForm(fixtures, teamId) {
        return fixtures.slice(0, 5).map(function(f) {
          var isHome = f.teams.home.id === teamId;
          var goalsFor = isHome ? f.goals.home : f.goals.away;
          var goalsAgainst = isHome ? f.goals.away : f.goals.home;
          var opponent = isHome ? f.teams.away.name : f.teams.home.name;
          var result = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
          return { result: result, goalsFor: goalsFor || 0, goalsAgainst: goalsAgainst || 0, opponent: opponent, date: f.fixture.date };
        });
      }

      var homeForm = getForm(homeFixtures, homeTeam.id);
      var awayForm = getForm(awayFixtures, awayTeam.id);

      // Goals analysis from last 10
      function getGoalsStats(fixtures, teamId) {
        if (!fixtures.length) return { avgScored: 0, avgConceded: 0, cleanSheets: 0, bttsCount: 0, over25Count: 0 };
        var totalScored = 0, totalConceded = 0, cleanSheets = 0, bttsCount = 0, over25Count = 0;
        fixtures.forEach(function(f) {
          var isHome = f.teams.home.id === teamId;
          var gf = isHome ? (f.goals.home || 0) : (f.goals.away || 0);
          var ga = isHome ? (f.goals.away || 0) : (f.goals.home || 0);
          totalScored += gf;
          totalConceded += ga;
          if (ga === 0) cleanSheets++;
          if (gf > 0 && ga > 0) bttsCount++;
          if ((gf + ga) > 2) over25Count++;
        });
        var n = fixtures.length;
        return {
          avgScored: +(totalScored / n).toFixed(2),
          avgConceded: +(totalConceded / n).toFixed(2),
          cleanSheets: cleanSheets,
          cleanSheetPct: Math.round((cleanSheets / n) * 100),
          bttsPct: Math.round((bttsCount / n) * 100),
          over25Pct: Math.round((over25Count / n) * 100),
          totalGames: n
        };
      }

      var homeStats = getGoalsStats(homeFixtures, homeTeam.id);
      var awayStats = getGoalsStats(awayFixtures, awayTeam.id);

      // H2H analysis
      var h2hHomeWins = 0, h2hAwayWins = 0, h2hDraws = 0, h2hTotalGoals = 0, h2hBtts = 0, h2hOver25 = 0;
      var h2hSummary = h2hMatches.map(function(f) {
        var hGoals = f.goals.home || 0;
        var aGoals = f.goals.away || 0;
        var isHomeTeamHome = f.teams.home.id === homeTeam.id;
        if (hGoals > aGoals) {
          if (isHomeTeamHome) h2hHomeWins++; else h2hAwayWins++;
        } else if (aGoals > hGoals) {
          if (isHomeTeamHome) h2hAwayWins++; else h2hHomeWins++;
        } else {
          h2hDraws++;
        }
        h2hTotalGoals += hGoals + aGoals;
        if (hGoals > 0 && aGoals > 0) h2hBtts++;
        if ((hGoals + aGoals) > 2) h2hOver25++;
        return {
          date: f.fixture.date,
          home: f.teams.home.name,
          away: f.teams.away.name,
          homeGoals: hGoals,
          awayGoals: aGoals,
          league: f.league.name
        };
      });

      var h2hCount = h2hMatches.length || 1;
      var h2hAvgGoals = +(h2hTotalGoals / h2hCount).toFixed(2);
      var h2hBttsPct = Math.round((h2hBtts / h2hCount) * 100);
      var h2hOver25Pct = Math.round((h2hOver25 / h2hCount) * 100);

      // --- Auto-generate verdict ---
      var verdictMarket = '';
      var verdictPick = '';
      var verdictReason = '';
      var confidence = 5;
      var riskLevel = 'Medium';

      var combinedBttsPct = (homeStats.bttsPct + awayStats.bttsPct + h2hBttsPct) / 3;
      var combinedOver25Pct = (homeStats.over25Pct + awayStats.over25Pct + h2hOver25Pct) / 3;
      var homeFormWins = homeForm.filter(function(r) { return r.result === 'W'; }).length;
      var awayFormWins = awayForm.filter(function(r) { return r.result === 'W'; }).length;
      var h2hDominance = Math.abs(h2hHomeWins - h2hAwayWins);
      var avgTotalGoals = (homeStats.avgScored + homeStats.avgConceded + awayStats.avgScored + awayStats.avgConceded) / 2;

      if (combinedBttsPct >= 65 && homeStats.avgScored >= 1.0 && awayStats.avgScored >= 1.0) {
        verdictMarket = 'Both Teams to Score';
        verdictPick = 'BTTS - Yes';
        verdictReason = 'Both sides have been finding the net consistently. ' +
          homeTeam.name + ' score in ' + homeStats.bttsPct + '% of matches while ' +
          awayTeam.name + ' manage it in ' + awayStats.bttsPct + '%. ' +
          'The head-to-head record reinforces this with both teams scoring in ' + h2hBttsPct + '% of recent meetings.';
        confidence = Math.min(10, Math.round(combinedBttsPct / 10));
        riskLevel = confidence >= 7 ? 'Low' : 'Medium';
      } else if (h2hDominance >= 3 || (h2hDominance >= 2 && (homeFormWins >= 4 || awayFormWins >= 4))) {
        var dominant = h2hHomeWins > h2hAwayWins ? homeTeam.name : awayTeam.name;
        var dominantWins = Math.max(h2hHomeWins, h2hAwayWins);
        verdictMarket = 'Match Result';
        verdictPick = dominant + ' to Win';
        verdictReason = dominant + ' have won ' + dominantWins + ' of the last ' + h2hMatches.length +
          ' head-to-head meetings. That level of dominance in direct encounters is a strong indicator. ';
        if (dominant === homeTeam.name && homeFormWins >= 3) {
          verdictReason += 'Backed up by strong current form with ' + homeFormWins + ' wins from their last 5 matches.';
        } else if (dominant === awayTeam.name && awayFormWins >= 3) {
          verdictReason += 'Their recent form is equally impressive with ' + awayFormWins + ' wins from 5 outings.';
        }
        confidence = Math.min(10, 5 + h2hDominance);
        riskLevel = confidence >= 7 ? 'Low' : 'Medium';
      } else if (combinedOver25Pct >= 60 || avgTotalGoals >= 3.0) {
        verdictMarket = 'Total Goals';
        verdictPick = 'Over 2.5 Goals';
        verdictReason = 'The numbers point to goals in this one. ' +
          homeTeam.name + ' average ' + homeStats.avgScored.toFixed(1) + ' goals scored and ' +
          homeStats.avgConceded.toFixed(1) + ' conceded per match. ' +
          awayTeam.name + ' contribute ' + awayStats.avgScored.toFixed(1) + ' scored and ' +
          awayStats.avgConceded.toFixed(1) + ' conceded. ' +
          'Head-to-head meetings see an average of ' + h2hAvgGoals + ' goals per game.';
        confidence = Math.min(10, Math.round(combinedOver25Pct / 10));
        riskLevel = confidence >= 7 ? 'Low' : 'Medium';
      } else {
        // Tight/defensive profile
        var homeDraws = homeForm.filter(function(r) { return r.result === 'D'; }).length;
        var awayDraws = awayForm.filter(function(r) { return r.result === 'D'; }).length;
        if (homeDraws + awayDraws >= 4 || h2hDraws >= 3) {
          verdictMarket = 'Match Result';
          verdictPick = 'Draw';
          verdictReason = 'This fixture has stalemate written all over it. ' +
            h2hDraws + ' of the last ' + h2hMatches.length + ' meetings ended level. ' +
            'Neither side shows the kind of form that suggests they can force a result here.';
          confidence = Math.min(10, 4 + h2hDraws);
          riskLevel = 'Medium';
        } else {
          verdictMarket = 'Total Goals';
          verdictPick = 'Under 2.5 Goals';
          verdictReason = 'A low-scoring affair looks the most likely outcome. ' +
            homeTeam.name + ' keep clean sheets in ' + homeStats.cleanSheetPct + '% of games while ' +
            awayTeam.name + ' average just ' + awayStats.avgScored.toFixed(1) + ' goals per game. ' +
            'The head-to-head average is ' + h2hAvgGoals + ' goals per meeting.';
          confidence = Math.min(10, Math.round((100 - combinedOver25Pct) / 12));
          riskLevel = confidence >= 6 ? 'Low-Medium' : 'Medium';
        }
      }

      // Generate written analysis paragraphs
      var overviewText = homeTeam.name + ' welcome ' + awayTeam.name + ' to ' +
        (venue ? venue.name : 'their home ground') + ' in ' + league.name + ' action. ' +
        'Kick-off is scheduled for ' + new Date(kickoff).toLocaleString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
        }) + '.';

      var formText = homeTeam.name + ' come into this match with ' + homeFormWins + ' wins from their last 5 outings' +
        (homeStats.avgScored >= 1.5 ? ', scoring freely at ' + homeStats.avgScored.toFixed(1) + ' goals per game' : '') + '. ' +
        awayTeam.name + ' have recorded ' + awayFormWins + ' wins from 5, ' +
        (awayStats.avgScored >= 1.5 ? 'also finding the net regularly with ' + awayStats.avgScored.toFixed(1) + ' per match' :
         'managing ' + awayStats.avgScored.toFixed(1) + ' goals per game') + '. ' +
        (homeStats.cleanSheetPct >= 40 ? homeTeam.name + ' have been solid defensively with clean sheets in ' + homeStats.cleanSheetPct + '% of recent outings. ' : '') +
        (awayStats.cleanSheetPct >= 40 ? awayTeam.name + ' have kept things tight at the back with ' + awayStats.cleanSheetPct + '% clean sheets. ' : '');

      // Enhanced: add season stats context to form text
      if (homeTeamSeasonStats && homeTeamSeasonStats.goals && homeTeamSeasonStats.goals.for && homeTeamSeasonStats.goals.for.average) {
        var hSeasonGpg = homeTeamSeasonStats.goals.for.average.total;
        var hSeasonPlayed = homeTeamSeasonStats.fixtures && homeTeamSeasonStats.fixtures.played ? homeTeamSeasonStats.fixtures.played.home || 0 : 0;
        if (hSeasonGpg && hSeasonPlayed) {
          formText += homeTeam.name + ' have scored in ' + hSeasonPlayed + ' home games this season, averaging ' + hSeasonGpg + ' goals per game. ';
        }
      }
      if (awayTeamSeasonStats && awayTeamSeasonStats.goals && awayTeamSeasonStats.goals.for && awayTeamSeasonStats.goals.for.average) {
        var aSeasonGpg = awayTeamSeasonStats.goals.for.average.total;
        var aCleanSheetTotal = awayTeamSeasonStats.clean_sheet ? awayTeamSeasonStats.clean_sheet.total || 0 : 0;
        var aPlayedTotal = awayTeamSeasonStats.fixtures && awayTeamSeasonStats.fixtures.played ? awayTeamSeasonStats.fixtures.played.total || 1 : 1;
        var aBttsPctSeason = Math.round(((aPlayedTotal - aCleanSheetTotal) / aPlayedTotal) * 100);
        if (aBttsPctSeason) {
          formText += 'BTTS has landed in ' + aBttsPctSeason + '% of ' + awayTeam.name + '\'s away games. ';
        }
      }

      var h2hText = h2hMatches.length > 0 ?
        'In their last ' + h2hMatches.length + ' meetings, ' + homeTeam.name + ' have won ' + h2hHomeWins +
        ', ' + awayTeam.name + ' have won ' + h2hAwayWins + ', with ' + h2hDraws + ' draws. ' +
        'These fixtures produce an average of ' + h2hAvgGoals + ' goals per game' +
        (h2hBttsPct >= 50 ? ' with both teams scoring in ' + h2hBttsPct + '% of encounters.' : '.') :
        'No recent head-to-head data available for this matchup.';

      // Enhanced analysis: injuries text
      var injuriesText = 'Check team news closer to kick-off for any late changes.';
      if (injuriesList.length > 0) {
        var homeInjuredPlayers = injuriesList.filter(function(inj) { return inj.team && inj.team.id === homeTeam.id; });
        var awayInjuredPlayers = injuriesList.filter(function(inj) { return inj.team && inj.team.id === awayTeam.id; });
        var homeInjuredNames = homeInjuredPlayers.map(function(inj) { return inj.player ? inj.player.name : 'Unknown'; });
        var awayInjuredNames = awayInjuredPlayers.map(function(inj) { return inj.player ? inj.player.name : 'Unknown'; });

        injuriesText = 'Key injuries: ';
        if (homeInjuredNames.length > 0) {
          injuriesText += homeTeam.name + ' missing ' + homeInjuredNames.join(', ') + '. ';
        } else {
          injuriesText += homeTeam.name + ' at full strength. ';
        }
        if (awayInjuredNames.length > 0) {
          injuriesText += awayTeam.name + ' missing ' + awayInjuredNames.join(', ') + '.';
        } else {
          injuriesText += awayTeam.name + ' at full strength.';
        }
      }

      // Enhanced analysis: predictions text
      var predictionsText = '';
      if (predictionsObj && predictionsObj.predictions && predictionsObj.predictions.percent) {
        var pct = predictionsObj.predictions.percent;
        var predHomePct = pct.home || '0%';
        var predDrawPct = pct.draw || '0%';
        var predAwayPct = pct.away || '0%';
        var predWinner = 'draw';
        var predWinnerPct = predDrawPct;
        if (parseInt(predHomePct) > parseInt(predAwayPct) && parseInt(predHomePct) > parseInt(predDrawPct)) {
          predWinner = homeTeam.name; predWinnerPct = predHomePct;
        } else if (parseInt(predAwayPct) > parseInt(predHomePct)) {
          predWinner = awayTeam.name; predWinnerPct = predAwayPct;
        }
        predictionsText = 'Independent prediction model gives ' + predWinner + ' a ' + predWinnerPct + ' chance of winning. ' +
          '(Home: ' + predHomePct + ', Draw: ' + predDrawPct + ', Away: ' + predAwayPct + ')';
      }

      var riskText = '';
      if (riskLevel === 'Low') {
        riskText = 'The data signals are clear and consistent across form, head-to-head, and statistical trends. This represents one of the stronger opportunities on the card.';
      } else if (riskLevel === 'Low-Medium') {
        riskText = 'There is a reasonable degree of certainty here, though one or two factors introduce minor uncertainty. A solid proposition overall.';
      } else if (riskLevel === 'Medium') {
        riskText = 'There are competing signals in the data. While the overall direction is clear, this is not a standout selection. Stake accordingly.';
      } else {
        riskText = 'The data is inconclusive or contradictory. This selection carries above-average risk and should be approached with caution.';
      }

      // --- Betfair Exchange enrichment for football ---
      var matchExchangeData = null;
      var exchangeAnalysisText = '';
      if (betfairSource && betfairSource.isConfigured()) {
        try {
          var bfFootballMarkets = await betfairSource.fetchFootballMarkets(homeTeam.name, awayTeam.name);
          if (bfFootballMarkets && bfFootballMarkets.length > 0) {
            // Get exchange data for the main MATCH_ODDS market
            var matchOddsMarket = bfFootballMarkets.find(function(m) {
              return m.description && m.description.marketType === 'MATCH_ODDS';
            }) || bfFootballMarkets[0];

            var bfExData = await betfairSource.getExchangeData(matchOddsMarket.marketId);
            if (bfExData && bfExData.runners && bfExData.runners.length > 0) {
              matchExchangeData = {
                marketId: bfExData.marketId,
                totalMatched: bfExData.totalMatched,
                runners: bfExData.runners.map(function(er) {
                  return {
                    runnerName: er.runnerName,
                    backPrice: er.backPrice,
                    layPrice: er.layPrice,
                    spread: er.spread,
                    tradedVolume: er.tradedVolume,
                    priceMovement: er.priceMovement,
                    volumeRank: er.volumeRank,
                  };
                }),
              };

              // Generate exchange analysis text
              var topVolRunner = bfExData.runners.filter(function(r) { return r.tradedVolume > 0; })
                .sort(function(a, b) { return b.tradedVolume - a.tradedVolume; })[0];
              if (topVolRunner && topVolRunner.tradedVolume > 1000) {
                var fVolFormatted = topVolRunner.tradedVolume >= 1000
                  ? '\u00A3' + (topVolRunner.tradedVolume / 1000).toFixed(0) + 'k'
                  : '\u00A3' + topVolRunner.tradedVolume;
                var fMovText = topVolRunner.priceMovement === 'shortening' ? 'price shortening'
                  : topVolRunner.priceMovement === 'drifting' ? 'price drifting' : 'price stable';
                exchangeAnalysisText = 'Betfair Exchange shows heavy money on ' + topVolRunner.runnerName +
                  ' \u2014 ' + fVolFormatted + ' traded, ' + fMovText + '.';

                // Check for other interesting markets (BTTS, Over/Under)
                for (var bmIdx = 0; bmIdx < bfFootballMarkets.length; bmIdx++) {
                  var bfMkt = bfFootballMarkets[bmIdx];
                  var mktType = bfMkt.description ? bfMkt.description.marketType : (bfMkt.marketName || '');
                  if (mktType === 'OVER_UNDER_25' || mktType === 'BOTH_TEAMS_TO_SCORE') {
                    try {
                      var altExData = await betfairSource.getExchangeData(bfMkt.marketId);
                      if (altExData && altExData.runners) {
                        var altTopRunner = altExData.runners.filter(function(r) { return r.tradedVolume > 0; })
                          .sort(function(a, b) { return b.tradedVolume - a.tradedVolume; })[0];
                        if (altTopRunner && altTopRunner.tradedVolume > 2000) {
                          var altVolFmt = altTopRunner.tradedVolume >= 1000
                            ? '\u00A3' + (altTopRunner.tradedVolume / 1000).toFixed(0) + 'k'
                            : '\u00A3' + altTopRunner.tradedVolume;
                          exchangeAnalysisText += ' Also: ' + altVolFmt + ' traded on ' +
                            (altTopRunner.runnerName || mktType) + ' (' + fMovText + ').';
                        }
                      }
                    } catch (altErr) { /* non-fatal */ }
                    break; // Only check one additional market
                  }
                }
              }
            }
          }
        } catch (bfMatchErr) {
          console.log('[match-intelligence] Betfair data unavailable: ' + bfMatchErr.message);
        }
      }

      // --- Odds Movement Intelligence ---
      var oddsMovementData = null;
      var oddsMovementText = '';
      try {
        var miEventKey = (homeTeam.name + ' v ' + awayTeam.name).toLowerCase();
        // Analyse movement for home team (most common selection)
        var homeMovement = analyseOddsMovement(miEventKey, homeTeam.name);
        var awayMovement = analyseOddsMovement(miEventKey, awayTeam.name);
        // Use the movement for the verdict pick if available, otherwise home team
        var primaryMovement = null;
        var primarySelection = '';
        if (verdictPick && verdictPick.indexOf(homeTeam.name) !== -1) {
          primaryMovement = homeMovement;
          primarySelection = homeTeam.name;
        } else if (verdictPick && verdictPick.indexOf(awayTeam.name) !== -1) {
          primaryMovement = awayMovement;
          primarySelection = awayTeam.name;
        } else {
          primaryMovement = homeMovement;
          primarySelection = homeTeam.name;
        }

        if (primaryMovement) {
          oddsMovementData = {
            direction: primaryMovement.direction,
            openingAvg: primaryMovement.openingAvg,
            currentAvg: primaryMovement.currentAvg,
            changePercent: primaryMovement.changePercent,
            bookmakers: primaryMovement.bookmakerCount,
            selection: primarySelection,
          };
          if (primaryMovement.direction === 'shortening') {
            oddsMovementText = 'Market movement: odds have shortened from ' + primaryMovement.openingAvg.toFixed(2) + ' to ' + primaryMovement.currentAvg.toFixed(2) + ' across ' + primaryMovement.bookmakerCount + ' bookmakers \u2014 strong market confidence in ' + primarySelection + '.';
          } else if (primaryMovement.direction === 'drifting') {
            oddsMovementText = 'Market movement: odds have drifted from ' + primaryMovement.openingAvg.toFixed(2) + ' to ' + primaryMovement.currentAvg.toFixed(2) + ' across ' + primaryMovement.bookmakerCount + ' bookmakers \u2014 market confidence in ' + primarySelection + ' is weakening.';
          } else {
            oddsMovementText = 'Market movement: odds stable around ' + primaryMovement.currentAvg.toFixed(2) + ' across ' + primaryMovement.bookmakerCount + ' bookmakers \u2014 no significant market shifts detected.';
          }
        }
      } catch (omIntelErr) {
        // Non-fatal — skip odds movement
      }

      res.json({
        fixtureId: parseInt(fixtureId),
        match: {
          homeTeam: homeTeam.name,
          homeTeamId: homeTeam.id,
          homeTeamLogo: homeTeam.logo,
          awayTeam: awayTeam.name,
          awayTeamId: awayTeam.id,
          awayTeamLogo: awayTeam.logo,
          league: league.name,
          leagueLogo: league.logo,
          country: league.country,
          venue: venue ? venue.name : '',
          city: venue ? venue.city : '',
          kickoff: kickoff,
          status: status.short,
          statusLong: status.long,
          homeGoals: fixture.goals.home,
          awayGoals: fixture.goals.away
        },
        form: {
          home: homeForm,
          away: awayForm
        },
        h2h: {
          matches: h2hSummary,
          homeWins: h2hHomeWins,
          awayWins: h2hAwayWins,
          draws: h2hDraws,
          avgGoals: h2hAvgGoals,
          bttsPct: h2hBttsPct,
          over25Pct: h2hOver25Pct
        },
        stats: {
          home: homeStats,
          away: awayStats
        },
        injuries: {
          home: injuriesList.filter(function(inj) { return inj.team && inj.team.id === homeTeam.id; }).map(function(inj) {
            return { player: inj.player ? inj.player.name : 'Unknown', type: inj.player ? inj.player.type : '', reason: inj.player ? inj.player.reason : '' };
          }),
          away: injuriesList.filter(function(inj) { return inj.team && inj.team.id === awayTeam.id; }).map(function(inj) {
            return { player: inj.player ? inj.player.name : 'Unknown', type: inj.player ? inj.player.type : '', reason: inj.player ? inj.player.reason : '' };
          }),
        },
        predictions: predictionsObj ? {
          winProbability: predictionsObj.predictions && predictionsObj.predictions.percent ? predictionsObj.predictions.percent : null,
          predictedGoals: predictionsObj.predictions && predictionsObj.predictions.goals ? predictionsObj.predictions.goals : null,
          advice: predictionsObj.predictions ? predictionsObj.predictions.advice : null,
        } : null,
        seasonStats: {
          home: homeTeamSeasonStats || null,
          away: awayTeamSeasonStats || null,
        },
        verdict: {
          market: verdictMarket,
          pick: verdictPick,
          reason: verdictReason,
          confidence: confidence,
          riskLevel: riskLevel,
          riskText: riskText
        },
        oddsMovement: oddsMovementData,
        exchangeData: matchExchangeData,
        analysis: {
          overview: overviewText,
          form: formText,
          h2h: h2hText,
          injuries: injuriesText,
          predictions: predictionsText,
          oddsMovement: oddsMovementText || null,
          exchange: exchangeAnalysisText || null,
        },
        generatedAt: new Date().toISOString()
      });

    } catch (err) {
      console.error('[match-intelligence] Error:', err.message);
      res.status(500).json({ error: 'Failed to generate match intelligence: ' + err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // AI MATCH PREVIEW — Claude-powered written analysis
  // ---------------------------------------------------------------------------
  router.get('/football/ai-preview/:fixtureId', async (req, res) => {
    try {
      if (!aiReports || !aiReports.isAvailable()) {
        return res.status(503).json({ error: 'AI reports not available. ANTHROPIC_API_KEY not configured.' });
      }
      if (!footballSource || !process.env.API_FOOTBALL_KEY) {
        return res.status(503).json({ error: 'API-Football not configured.' });
      }

      var fixtureId = req.params.fixtureId;

      // Fetch fixture details (reuse match-intelligence logic)
      var fixtureData = await footballSource._apiGet('/fixtures?id=' + fixtureId);
      if (!fixtureData.response || !fixtureData.response.length) {
        return res.status(404).json({ error: 'Fixture not found.' });
      }
      var fixture = fixtureData.response[0];
      var homeTeam = fixture.teams.home;
      var awayTeam = fixture.teams.away;
      var league = fixture.league;
      var venue = fixture.fixture.venue;
      var kickoff = fixture.fixture.date;

      // Fetch supporting data in parallel
      var parallelResults = await Promise.allSettled([
        footballSource._apiGet('/fixtures?team=' + homeTeam.id + '&last=5&status=FT'),
        footballSource._apiGet('/fixtures?team=' + awayTeam.id + '&last=5&status=FT'),
        footballSource._apiGet('/fixtures/headtohead?h2h=' + homeTeam.id + '-' + awayTeam.id + '&last=5'),
        footballSource.fetchInjuries(parseInt(fixtureId)),
      ]);

      var homeFixtures = (parallelResults[0].status === 'fulfilled' ? parallelResults[0].value : { response: [] }).response || [];
      var awayFixtures = (parallelResults[1].status === 'fulfilled' ? parallelResults[1].value : { response: [] }).response || [];
      var h2hMatches = (parallelResults[2].status === 'fulfilled' ? parallelResults[2].value : { response: [] }).response || [];
      var injuriesList = (parallelResults[3].status === 'fulfilled' ? parallelResults[3].value : { response: [] }).response || [];

      // Build form arrays
      function getFormArray(fixtures, teamId) {
        return fixtures.slice(0, 5).map(function(f) {
          var isHome = f.teams.home.id === teamId;
          var gf = isHome ? (f.goals.home || 0) : (f.goals.away || 0);
          var ga = isHome ? (f.goals.away || 0) : (f.goals.home || 0);
          return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
        });
      }

      // Build goals stats
      function avgGoals(fixtures, teamId) {
        if (!fixtures.length) return 0;
        var total = 0;
        fixtures.forEach(function(f) {
          var isHome = f.teams.home.id === teamId;
          total += isHome ? (f.goals.home || 0) : (f.goals.away || 0);
        });
        return +(total / fixtures.length).toFixed(2);
      }

      // H2H record
      var h2hHomeWins = 0, h2hAwayWins = 0, h2hDraws = 0;
      var h2hLastMeetings = h2hMatches.slice(0, 5).map(function(f) {
        var hg = f.goals.home || 0;
        var ag = f.goals.away || 0;
        var isHomeTeamHome = f.teams.home.id === homeTeam.id;
        if (hg > ag) { if (isHomeTeamHome) h2hHomeWins++; else h2hAwayWins++; }
        else if (ag > hg) { if (isHomeTeamHome) h2hAwayWins++; else h2hHomeWins++; }
        else { h2hDraws++; }
        return { home: f.teams.home.name, away: f.teams.away.name, homeGoals: hg, awayGoals: ag };
      });

      // Injuries
      var homeInjuries = injuriesList.filter(function(inj) { return inj.team && inj.team.id === homeTeam.id; }).map(function(inj) { return inj.player ? inj.player.name : 'Unknown'; });
      var awayInjuries = injuriesList.filter(function(inj) { return inj.team && inj.team.id === awayTeam.id; }).map(function(inj) { return inj.player ? inj.player.name : 'Unknown'; });

      var previewData = {
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
        league: league.name,
        kickoff: kickoff,
        venue: venue ? venue.name : '',
        homeForm: getFormArray(homeFixtures, homeTeam.id),
        awayForm: getFormArray(awayFixtures, awayTeam.id),
        homeGoals: avgGoals(homeFixtures, homeTeam.id),
        awayGoals: avgGoals(awayFixtures, awayTeam.id),
        h2hRecord: {
          homeWins: h2hHomeWins,
          draws: h2hDraws,
          awayWins: h2hAwayWins,
          lastMeetings: h2hLastMeetings,
        },
        injuries: {
          home: homeInjuries,
          away: awayInjuries,
        },
      };

      var result = await aiReports.generateFootballPreview(previewData);
      if (!result) {
        return res.status(500).json({ error: 'Failed to generate AI preview. Please try again.' });
      }

      res.json({ fixtureId: parseInt(fixtureId), aiPreview: result, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[AI Football Preview] Error:', err.message);
      res.status(500).json({ error: 'Failed to generate AI preview: ' + err.message });
    }
  });

  // AI diagnostic — tests Claude API directly
  router.get('/football/ai-test', async (req, res) => {
    try {
      if (!aiReports) return res.json({ error: 'aiReports not in deps' });
      if (!aiReports.isAvailable()) return res.json({ error: 'AI not available — client is null', hasKey: !!process.env.ANTHROPIC_API_KEY, keyPrefix: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.substring(0, 12) + '...' : 'NOT SET' });

      // Test Claude API directly
      var Anthropic = require('@anthropic-ai/sdk').default;
      var testClient = new Anthropic();
      var models = ['claude-sonnet-4-5-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'];
      var lastError = null;
      for (var i = 0; i < models.length; i++) {
        try {
          var testResponse = await testClient.messages.create({
            model: models[i],
            max_tokens: 256,
            messages: [{ role: 'user', content: 'Say "Hello from Elite Edge" in one sentence.' }],
          });
          return res.json({ success: true, model: models[i], response: testResponse.content[0].text });
        } catch (modelErr) {
          lastError = { model: models[i], status: modelErr.status, message: modelErr.message, type: modelErr.error ? modelErr.error.type : null, errorBody: modelErr.error || null };
        }
      }
      res.json({ success: false, error: 'All models failed', lastError: lastError });
    } catch (err) {
      res.json({ success: false, error: err.message, stack: err.stack ? err.stack.split('\n').slice(0, 5) : [] });
    }
  });

  // Diagnostic: API-Football status check (admin only)
  router.get('/football/diagnostic', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    try {
      if (!process.env.API_FOOTBALL_KEY) return res.json({ error: 'Not configured' });
      const https = require('https');
      const endpoints = ['/status', '/fixtures?date=' + new Date().toISOString().split('T')[0]];
      const results = {};
      for (const path of endpoints) {
        try {
          const data = await new Promise((resolve, reject) => {
            const r = https.request({
              hostname: 'v3.football.api-sports.io',
              path: path,
              method: 'GET',
              headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
            }, (resp) => {
              let b = '';
              resp.on('data', c => b += c);
              resp.on('end', () => resolve({ status: resp.statusCode, body: b.substring(0, 1500) }));
            });
            r.on('error', reject);
            r.setTimeout(15000, () => { r.destroy(); reject(new Error('Timeout')); });
            r.end();
          });
          results[path] = data;
        } catch (e) { results[path] = { error: e.message }; }
      }
      res.json(results);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
