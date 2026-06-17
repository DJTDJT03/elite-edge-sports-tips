module.exports = function(deps) {
  const router = require('express').Router();
  const { racingSource, weatherSource, betfairSource, racingOddsSource, movementTracker, scoringModel, authenticate, db, aiReports } = deps;

  // Helper for server-side fractional odds formatting
  function formatOddsFrac(dec) {
    var fracs = [[1.50,'1/2'],[1.67,'4/6'],[1.80,'4/5'],[2.00,'evens'],[2.25,'5/4'],[2.50,'6/4'],[2.75,'7/4'],[3.00,'2/1'],[3.50,'5/2'],[4.00,'3/1'],[4.50,'7/2'],[5.00,'4/1'],[5.50,'9/2'],[6.00,'5/1'],[7.00,'6/1'],[8.00,'7/1'],[9.00,'8/1'],[10.00,'9/1'],[11.00,'10/1'],[13.00,'12/1'],[15.00,'14/1'],[17.00,'16/1'],[21.00,'20/1'],[26.00,'25/1'],[34.00,'33/1'],[51.00,'50/1']];
    var best = fracs[0]; var bestDiff = Math.abs(dec - best[0]);
    for (var i = 1; i < fracs.length; i++) { var d = Math.abs(dec - fracs[i][0]); if (d < bestDiff) { best = fracs[i]; bestDiff = d; } }
    return best[1];
  }

  // ---------------------------------------------------------------------------
  // WEATHER ENDPOINTS
  // ---------------------------------------------------------------------------

  router.get('/weather/check', async (req, res) => {
    var course = req.query.course || 'Ayr';
    res.json({
      envSet: !!process.env.OPENWEATHER_API_KEY,
      envPrefix: process.env.OPENWEATHER_API_KEY ? process.env.OPENWEATHER_API_KEY.substring(0, 8) + '...' : 'NOT SET',
      sourceFound: !!weatherSource,
      configured: weatherSource ? weatherSource.isConfigured() : false,
      testResult: null
    });
  });

  router.get('/weather/test', async (req, res) => {
    try {
      if (!weatherSource || !weatherSource.isConfigured()) {
        return res.json({ error: 'Weather not configured', envSet: !!process.env.OPENWEATHER_API_KEY });
      }
      var course = req.query.course || 'Ayr';
      var coords = weatherSource.getCourseCoords(course);
      if (!coords) {
        return res.json({ error: 'Course not found in lookup', course: course, availableCourses: Object.keys(weatherSource.courseCoords).slice(0, 10) });
      }
      // Try raw API call directly
      var https = require('https');
      var url = '/data/2.5/weather?lat=' + coords.lat + '&lon=' + coords.lon + '&units=metric&appid=' + process.env.OPENWEATHER_API_KEY;
      var rawData = await new Promise(function(resolve, reject) {
        var r = https.request({
          hostname: 'api.openweathermap.org',
          path: url,
          method: 'GET'
        }, function(resp) {
          var b = '';
          resp.on('data', function(c) { b += c; });
          resp.on('end', function() { resolve({ status: resp.statusCode, body: b.substring(0, 500) }); });
        });
        r.on('error', function(e) { reject(e); });
        r.setTimeout(10000, function() { r.destroy(); reject(new Error('timeout')); });
        r.end();
      });
      var parsed = null;
      try { parsed = JSON.parse(rawData.body); } catch(e) {}
      var weather = await weatherSource.fetchForCourse(course);
      res.json({ course: course, coords: coords, rawStatus: rawData.status, rawResponse: parsed, processedWeather: weather });
    } catch (err) {
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });

  // ---------------------------------------------------------------------------
  // LIVE RACING DATA (The Racing API)
  // ---------------------------------------------------------------------------

  router.get('/racing/live-cards', async (req, res) => {
    try {
      if (!racingSource || !process.env.RACING_API_KEY) {
        return res.json({
          live: false,
          message: 'Racing API not configured. Set RACING_API_KEY and RACING_API_SECRET environment variables.',
          setup: 'Sign up for free trial at https://www.theracingapi.com/',
          racecards: []
        });
      }
      const raw = await racingSource.fetch();
      var normalised = racingSource.normalise(raw);
      // Filter to UK-only races (region === 'GB') and today's date only
      var today = new Date().toISOString().split('T')[0];
      normalised = normalised.filter(function(r) {
        if (r.region !== 'GB') return false;
        // Exclude future big-race entries — only show today's races
        if (r.date) {
          var rDate = r.date.toString().split('T')[0].substring(0, 10);
          if (rDate !== today && rDate !== '') return false;
        }
        return true;
      });
      // Filter runners: only declared runners with odds (not non-runners, not 90-entry fields)
      normalised.forEach(function(race) {
        if (race.runners && race.runners.length > 0) {
          var declared = race.runners.filter(function(r) {
            return !r.isNonRunner && r.odds && r.odds > 0;
          });
          // Use declared runners if available, otherwise keep all (pre-odds cards)
          if (declared.length > 0) race.runners = declared;
        }
      });
      res.json({ live: true, racecards: normalised, fetchedAt: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/racing/live-results', async (req, res) => {
    try {
      const date = req.query.date || new Date().toISOString().split('T')[0];
      if (!racingSource || !process.env.RACING_API_KEY) {
        return res.json({ live: false, message: 'Racing API not configured', results: [] });
      }
      const results = await racingSource.fetchResults(date);
      res.json({ live: true, results: results.results || [], fetchedAt: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Full race detail by race_id (pulls runners for a single race)
  router.get('/racing/race/:id', async (req, res) => {
    try {
      if (!process.env.RACING_API_KEY) return res.json({ error: 'Not configured' });
      const https = require('https');
      const auth = Buffer.from(`${process.env.RACING_API_KEY}:${process.env.RACING_API_SECRET}`).toString('base64');
      const data = await new Promise((resolve, reject) => {
        const r = https.request({
          hostname: 'api.theracingapi.com',
          path: '/v1/racecards/big-races',
          method: 'GET',
          headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
        }, (resp) => {
          let b = '';
          resp.on('data', c => b += c);
          resp.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
        });
        r.on('error', reject);
        r.setTimeout(15000, () => { r.destroy(); reject(new Error('Timeout')); });
        r.end();
      });
      const race = (data.racecards || []).find(r => r.race_id === req.params.id);
      if (!race) return res.status(404).json({ error: 'Race not found' });
      res.json(race);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dedicated endpoint for big-races (future festival cards)
  router.get('/racing/big-races', async (req, res) => {
    try {
      if (!process.env.RACING_API_KEY) return res.json({ error: 'Not configured' });
      const https = require('https');
      const auth = Buffer.from(`${process.env.RACING_API_KEY}:${process.env.RACING_API_SECRET}`).toString('base64');
      const data = await new Promise((resolve, reject) => {
        const r = https.request({
          hostname: 'api.theracingapi.com',
          path: '/v1/racecards/big-races',
          method: 'GET',
          headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
        }, (resp) => {
          let b = '';
          resp.on('data', c => b += c);
          resp.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
        });
        r.on('error', reject);
        r.setTimeout(15000, () => { r.destroy(); reject(new Error('Timeout')); });
        r.end();
      });
      // Return Aintree races with full runner data for a specific target
      const aintree = (data.racecards || []).filter(r => r.course === 'Aintree');
      const target = req.query.race_id;
      if (target) {
        const race = aintree.find(r => r.race_id === target);
        return res.json(race || { error: 'not found' });
      }
      // Summary view — just race headers + runner count
      const summary = aintree.map(r => ({
        race_id: r.race_id,
        date: r.date,
        time: r.off_time,
        raceName: r.race_name,
        raceClass: r.race_class,
        distance: r.distance,
        going: r.going || r.going_detailed || '',
        prize: r.prize,
        fieldSize: r.field_size,
        runnerCount: (r.runners || []).length
      }));
      res.json({ count: aintree.length, aintree: summary });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Diagnostic: raw Racing API response for debugging (admin only)
  router.get('/racing/diagnostic', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    try {
      if (!racingSource || !process.env.RACING_API_KEY) {
        return res.json({ error: 'Racing API not configured' });
      }
      const https = require('https');
      const auth = Buffer.from(`${process.env.RACING_API_KEY}:${process.env.RACING_API_SECRET}`).toString('base64');
      const serverDate = new Date().toISOString();
      const queryDate = req.query.date || '';
      const dateSuffix = queryDate ? `?date=${queryDate}` : '';
      const endpoints = [
        '/racecards/big-races',
        '/racecards/summaries',
      ];
      const results = {};
      for (const path of endpoints) {
        try {
          const data = await new Promise((resolve, reject) => {
            const apiReq = https.request({
              hostname: 'api.theracingapi.com',
              path: `/v1${path}`,
              method: 'GET',
              headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
            }, (r) => {
              let body = '';
              r.on('data', c => body += c);
              r.on('end', () => resolve({ status: r.statusCode, body: body.substring(0, 50000) }));
            });
            apiReq.on('error', reject);
            apiReq.setTimeout(10000, () => { apiReq.destroy(); reject(new Error('Timeout')); });
            apiReq.end();
          });
          results[path] = data;
        } catch (e) {
          results[path] = { error: e.message };
        }
      }
      res.json({ serverDate, endpoints: results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/racing/horse/:horseId', async (req, res) => {
    try {
      if (!racingSource || !process.env.RACING_API_KEY) {
        return res.json({ live: false, message: 'Racing API not configured' });
      }
      const form = await racingSource.fetchHorseForm(req.params.horseId);
      res.json({ live: true, form });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // AI RACE PREVIEW — Claude-powered written race analysis
  // ---------------------------------------------------------------------------
  router.get('/racing/ai-preview/:raceId', async (req, res) => {
    try {
      if (!aiReports || !aiReports.isAvailable()) {
        return res.status(503).json({ error: 'AI reports not available. ANTHROPIC_API_KEY not configured.' });
      }
      if (!racingSource || !process.env.RACING_API_KEY) {
        return res.status(503).json({ error: 'Racing API not configured.' });
      }

      var raceId = req.params.raceId;

      // Fetch today's race cards and intelligence data
      var raw = await racingSource.fetch();
      var races = racingSource.normalise(raw);
      races = races.filter(function(r) { return r.region === 'GB'; });

      // Find the race by raceId or time
      var race = races.find(function(r) { return r.raceId === raceId || r.time === raceId; });
      if (!race) {
        return res.status(404).json({ error: 'Race not found.' });
      }

      var runners = race.runners || [];
      if (runners.length === 0) {
        return res.status(404).json({ error: 'No runners found for this race.' });
      }

      // Find favourite (shortest price)
      var sortedByOdds = runners.filter(function(r) { return r.odds && parseFloat(r.odds) > 1; })
        .sort(function(a, b) { return parseFloat(a.odds) - parseFloat(b.odds); });
      var favourite = sortedByOdds[0] || runners[0];

      // Get weather if available
      var weatherData = null;
      if (weatherSource && weatherSource.isConfigured()) {
        try {
          weatherData = await weatherSource.fetchForCourse(race.meeting);
        } catch (wErr) { /* non-fatal */ }
      }

      // Build best odds for the selection
      var bestOdds = null;
      if (favourite.allOdds && favourite.allOdds.length) {
        var bestDec = 0;
        for (var i = 0; i < favourite.allOdds.length; i++) {
          var dec = parseFloat(favourite.allOdds[i].decimal) || 0;
          if (dec > bestDec) { bestDec = dec; bestOdds = favourite.allOdds[i]; }
        }
      }

      var previewData = {
        meeting: race.meeting,
        raceTime: race.time,
        raceName: race.raceName || race.raceClass || 'Race',
        raceClass: race.raceClass || '',
        distance: race.distance || '',
        going: race.going || '',
        runners: runners.length,
        selection: {
          name: favourite.horseName,
          trainer: favourite.trainer,
          jockey: favourite.jockey,
          form: favourite.form,
          officialRating: favourite.officialRating,
          age: favourite.age,
          weight: favourite.weight,
          draw: favourite.draw,
        },
        odds: {
          bestPrice: bestOdds ? (bestOdds.fractional || bestOdds.decimal) : (favourite.odds || 'N/A'),
          bestBookmaker: bestOdds ? bestOdds.bookmaker : '',
          averagePrice: favourite.odds || '',
        },
        weather: weatherData ? {
          temp: weatherData.temp,
          conditions: weatherData.description,
          windSpeed: weatherData.windSpeed,
        } : null,
      };

      var result = await aiReports.generateRacingPreview(previewData);
      if (!result) {
        return res.status(500).json({ error: 'Failed to generate AI preview. Please try again.' });
      }

      res.json({ raceId: raceId, meeting: race.meeting, time: race.time, aiPreview: result, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[AI Racing Preview] Error:', err.message);
      res.status(500).json({ error: 'Failed to generate AI preview: ' + err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // RACE INTELLIGENCE — Premium race-by-race analysis (auto-generated)
  // ---------------------------------------------------------------------------
  router.get('/racing/intelligence', async (req, res) => {
    try {
      if (!racingSource || !process.env.RACING_API_KEY) {
        return res.json({ live: false, message: 'Racing API not configured', races: [] });
      }
      var raw = await racingSource.fetch();
      var races = racingSource.normalise(raw);
      // Filter to UK-only races
      races = races.filter(function(r) { return r.region === 'GB'; });
      if (!races || races.length === 0) {
        return res.json({ live: true, races: [], fetchedAt: new Date().toISOString() });
      }

      var intelligence = races.map(function(race) {
        var runners = race.runners || [];
        if (runners.length === 0) return null;

        // Sort by odds (shortest price first)
        var sortedByOdds = runners.filter(function(r) { return r.odds && parseFloat(r.odds) > 1; })
          .sort(function(a, b) { return parseFloat(a.odds) - parseFloat(b.odds); });

        var favourite = sortedByOdds[0] || runners[0];
        var danger = sortedByOdds[1] || null;
        var outsider = sortedByOdds.length > 3 ? sortedByOdds[Math.floor(sortedByOdds.length * 0.6)] : null;

        // Analyse form figures
        function parseForm(formStr) {
          if (!formStr) return { runs: 0, wins: 0, places: 0, recent: '', raw: '' };
          var chars = formStr.replace(/[^0-9FfPpUuRr\-\/]/g, '').split('');
          var wins = chars.filter(function(c) { return c === '1'; }).length;
          var places = chars.filter(function(c) { return /[123]/.test(c); }).length;
          return { runs: chars.length, wins: wins, places: places, recent: formStr.slice(-10), raw: formStr };
        }

        // Field analysis
        var fieldSize = runners.length;
        var ratedRunners = runners.filter(function(r) { return r.officialRating && parseInt(r.officialRating) > 0; });
        var avgRating = ratedRunners.length > 0 ? Math.round(ratedRunners.reduce(function(s, r) { return s + parseInt(r.officialRating); }, 0) / ratedRunners.length) : null;
        var topRated = ratedRunners.length > 0 ? ratedRunners.slice().sort(function(a, b) { return parseInt(b.officialRating) - parseInt(a.officialRating); })[0] : null;

        // Form analysis of key runners
        var favForm = parseForm(favourite ? favourite.form : '');
        var dangerForm = danger ? parseForm(danger.form) : null;

        // Going preference analysis
        var goingType = (race.going || '').toLowerCase();
        var isHeavy = goingType.indexOf('heavy') !== -1 || goingType.indexOf('soft') !== -1;
        var isFirm = goingType.indexOf('firm') !== -1;

        // Build race profile
        var isFlat = (race.raceType || '').toLowerCase() === 'flat';
        var distanceStr = race.distance || '';
        var isSprint = distanceStr.indexOf('5f') !== -1 || distanceStr.indexOf('6f') !== -1;

        // Trim a Racing Post Spotlight comment to a clean length for display.
        var clip = function (s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; };

        // Generate pace analysis referencing actual data
        var paceComment = '';
        if (fieldSize <= 5) {
          paceComment = 'Just ' + fieldSize + ' runners declared -- expect a tactical affair. ' + (favourite ? favourite.horseName + ' as favourite may try to control the pace from the front.' : 'The favourite may look to control the tempo.');
        } else if (fieldSize <= 10) {
          paceComment = fieldSize + ' runners should produce a fair gallop. ' + (isSprint && isFlat ? 'In a sprint with this field size, drawn low could be an advantage.' : 'Look for runners who travel well and can quicken in the final furlong.');
        } else if (fieldSize <= 16) {
          paceComment = 'Competitive ' + fieldSize + '-runner field -- expect a strong gallop from the outset. ' + (isFlat ? 'Horses drawn towards the middle may get the best of it.' : 'Those who can travel and switch off in behind should be suited.');
        } else {
          paceComment = 'Large field of ' + fieldSize + ' runners -- this will be a cavalry charge. ' + (isFlat ? 'Draw and early positioning are critical. Low draws may have a significant edge.' : 'Stamina is paramount -- the pace will be relentless.');
        }

        // Generate going insight referencing actual going
        var goingInsight = '';
        if (isHeavy) {
          goingInsight = 'Ground described as ' + race.going + ' -- testing conditions that will sort the wheat from the chaff. ';
          if (favourite) goingInsight += 'Check ' + favourite.horseName + '\'s form on soft/heavy carefully -- proven ground form is essential today.';
        } else if (isFirm) {
          goingInsight = race.going + ' ground will favour speed-oriented types. ' + (favourite ? 'If ' + favourite.horseName + ' has quick-ground form, that is a positive.' : 'Speed figures become more reliable on a quick surface.');
        } else {
          goingInsight = race.going + ' ground should be fair for the majority of the field. Form on similar surfaces is the best guide.';
        }

        // Key runner insight -- SPECIFIC to actual horse data
        var favInsight = '';
        if (favourite) {
          var favOdds = parseFloat(favourite.odds) || 0;
          var favOddsFrac = formatOddsFrac(favOdds);
          var formComment = '';
          if (favForm.raw) {
            if (favForm.wins >= 2) formComment = ' Form of ' + favForm.raw + ' shows ' + favForm.wins + ' wins from ' + favForm.runs + ' runs -- a consistent performer at this level.';
            else if (favForm.wins === 1) formComment = ' Form reads ' + favForm.raw + ' with a win last time' + (favForm.places > 1 ? ' and ' + (favForm.places - 1) + ' additional place(s)' : '') + '.';
            else if (favForm.places > 0) formComment = ' Form reads ' + favForm.raw + ' -- yet to win but has placed ' + favForm.places + ' time(s) from ' + favForm.runs + ' starts.';
            else formComment = ' Form of ' + favForm.raw + ' suggests this one has something to prove.';
          }
          if (favOdds < 2.0) {
            favInsight = favourite.horseName + ' is a strong market leader at ' + favOddsFrac + '.' + formComment;
            if (favourite.trainer) favInsight += ' Trained by ' + favourite.trainer + (favourite.jockey ? ' with ' + favourite.jockey + ' booked -- a combination that demands respect.' : '.');
          } else if (favOdds < 3.5) {
            favInsight = favourite.horseName + ' heads the market at ' + favOddsFrac + '.' + formComment;
            if (favourite.jockey) favInsight += ' ' + favourite.jockey + ' takes the ride' + (favourite.trainer ? ' for ' + favourite.trainer : '') + '.';
          } else {
            favInsight = favourite.horseName + ' is a tentative favourite at ' + favOddsFrac + ' in what looks a wide-open race.' + formComment;
            if (favourite.trainer) favInsight += ' ' + favourite.trainer + ' saddles this one' + (favourite.jockey ? ' under ' + favourite.jockey : '') + '.';
          }
          // Draw comment for flat sprints
          if (isFlat && favourite.draw && (isSprint || fieldSize >= 12)) {
            favInsight += ' Drawn ' + favourite.draw + ' of ' + fieldSize + (parseInt(favourite.draw) <= Math.floor(fieldSize / 3) ? ' -- a low draw that could prove advantageous.' : parseInt(favourite.draw) >= Math.ceil(fieldSize * 0.66) ? ' -- a high draw that is a potential concern.' : '.');
          }
          // Ratings + the Racing Post Spotlight (unique professional comment per horse)
          if (favourite.rpr || favourite.ts) favInsight += ' Ratings: OR ' + (favourite.officialRating || '-') + (favourite.rpr ? ', RPR ' + favourite.rpr : '') + (favourite.ts ? ', TS ' + favourite.ts : '') + '.';
          if (favourite.spotlight) favInsight += ' Spotlight: "' + clip(favourite.spotlight, 260) + '"';
        }

        var dangerInsight = '';
        if (danger) {
          var dangerOddsFrac = formatOddsFrac(parseFloat(danger.odds) || 0);
          dangerInsight = danger.horseName + ' at ' + dangerOddsFrac + ' is the principal danger.';
          if (dangerForm && dangerForm.raw) {
            if (dangerForm.wins > 0) dangerInsight += ' Form of ' + dangerForm.raw + ' includes ' + dangerForm.wins + ' win(s) -- proven ability at this level.';
            else if (dangerForm.places > 0) dangerInsight += ' Form of ' + dangerForm.raw + ' shows placed efforts that suggest a win is not far away.';
            else dangerInsight += ' Form reads ' + dangerForm.raw + ' -- perhaps unexposed and could improve for this scenario.';
          }
          if (danger.jockey) dangerInsight += ' ' + danger.jockey + ' takes the ride' + (danger.trainer ? ' for ' + danger.trainer : '') + '.';
          if (danger.spotlight) dangerInsight += ' Spotlight: "' + clip(danger.spotlight, 220) + '"';
        }

        var outsiderInsight = '';
        if (outsider) {
          var outOdds = parseFloat(outsider.odds) || 0;
          var outOddsFrac = formatOddsFrac(outOdds);
          outsiderInsight = outsider.horseName + ' at ' + outOddsFrac + ' catches the eye at a bigger price.';
          if (outsider.trainer) outsiderInsight += ' ' + outsider.trainer + '\'s record in similar races is noteworthy.';
          if (outsider.jockey) outsiderInsight += ' ' + outsider.jockey + ' is an interesting jockey booking at this price.';
          outsiderInsight += ' Worth a look for each-way value in a ' + fieldSize + '-runner field.';
          if (outsider.spotlight) outsiderInsight += ' Spotlight: "' + clip(outsider.spotlight, 200) + '"';
        }

        // Class analysis
        var classInsight = '';
        if (race.raceClass) {
          var cls = race.raceClass.toLowerCase();
          if (cls.indexOf('1') !== -1 || cls.indexOf('group') !== -1 || cls.indexOf('grade') !== -1) classInsight = 'Top-class contest -- ' + (favourite ? favourite.horseName + '\'s form figures must be given extra weight at this level.' : 'Form is generally reliable at this level.');
          else if (cls.indexOf('2') !== -1 || cls.indexOf('listed') !== -1) classInsight = 'Quality race with potential for unexposed improvers. Horses dropping in class can offer significant value.';
          else if (cls.indexOf('3') !== -1 || cls.indexOf('4') !== -1) classInsight = 'Competitive ' + race.raceClass + ' race. Handicap marks, recent improvement, and trainer form are the key angles.';
          else classInsight = 'Lower-grade ' + race.raceClass + ' race -- course-and-distance winners and horses with recent placed form are often the answer.';
        }

        // Build specific verdict referencing actual data
        var verdict = '';
        if (favourite) {
          var fOdds = parseFloat(favourite.odds) || 0;
          if (fOdds > 0 && fOdds < 2.5 && favForm.wins >= 1) {
            verdict = 'We like ' + favourite.horseName + ' at ' + formatOddsFrac(fOdds) + '. ' + (favForm.wins >= 2 ? 'Consistent winning form of ' + favForm.raw + ' is hard to oppose' : 'A winner last time with solid form of ' + favForm.raw) + (favourite.trainer ? '. ' + favourite.trainer + ' in good form with this type.' : '.');
          } else if (danger && dangerForm && dangerForm.wins > 0 && parseFloat(danger.odds) > fOdds) {
            verdict = 'We like ' + danger.horseName + ' at ' + formatOddsFrac(parseFloat(danger.odds)) + ' to outrun ' + favourite.horseName + '. Form of ' + dangerForm.raw + ' reads well' + (danger.jockey ? ' and ' + danger.jockey + ' is a strong booking.' : '.');
          } else if (fOdds >= 2.5 && outsider) {
            verdict = 'Wide-open affair. ' + outsider.horseName + ' at ' + formatOddsFrac(parseFloat(outsider.odds)) + ' appeals as an each-way play where ' + favourite.horseName + ' (' + formatOddsFrac(fOdds) + ') looks vulnerable.';
          } else {
            verdict = favourite.horseName + ' at ' + formatOddsFrac(fOdds) + ' is the most likely winner based on the form, but consider the market for any late moves.';
          }
        }

        return {
          raceId: race.raceId,
          meeting: race.meeting,
          time: race.time,
          raceName: race.raceName,
          raceClass: race.raceClass,
          distance: race.distance,
          going: race.going,
          surface: race.surface,
          prizeMoney: race.prizeMoney,
          raceType: race.raceType,
          region: race.region,
          fieldSize: fieldSize,
          avgRating: avgRating,
          topRated: topRated ? { name: topRated.horseName, rating: topRated.officialRating } : null,
          favourite: favourite ? { name: favourite.horseName, odds: favourite.odds, jockey: favourite.jockey, trainer: favourite.trainer, form: favourite.form, draw: favourite.draw, allOdds: favourite.allOdds || [] } : null,
          danger: danger ? { name: danger.horseName, odds: danger.odds, jockey: danger.jockey, trainer: danger.trainer, form: danger.form, draw: danger.draw, allOdds: danger.allOdds || [] } : null,
          outsider: outsider ? { name: outsider.horseName, odds: outsider.odds, jockey: outsider.jockey, trainer: outsider.trainer, form: outsider.form, draw: outsider.draw } : null,
          runners: runners,
          insights: {
            overview: (race.meeting || 'Meeting') + ' ' + (race.time || '') + ' -- ' + (race.raceName || race.raceClass || 'Race') + '. ' + fieldSize + '-runner ' + (race.raceClass || '') + ' over ' + (race.distance || 'unknown') + ' on ' + (race.going || 'unknown') + ' ground.' + (race.prizeMoney ? ' Prize: ' + race.prizeMoney + '.' : ''),
            paceAnalysis: paceComment,
            goingAnalysis: goingInsight,
            classAnalysis: classInsight,
            favouriteAnalysis: favInsight,
            dangerAnalysis: dangerInsight,
            outsiderInsight: outsiderInsight,
            verdict: verdict,
            keyAngle: topRated && favourite && topRated.horseName !== favourite.horseName ? 'Interesting split: ' + topRated.horseName + ' (OR ' + topRated.officialRating + ') is the top-rated runner but ' + favourite.horseName + ' leads the market at ' + formatOddsFrac(parseFloat(favourite.odds)) + '. Worth investigating why the market disagrees with the ratings.' : avgRating ? 'Average OR in this race is ' + avgRating + '. Runners rated significantly above this mark are of obvious interest.' : ''
          }
        };
      }).filter(Boolean);

      // --- Betfair Exchange enrichment ---
      if (betfairSource && betfairSource.isConfigured()) {
        for (var rIdx = 0; rIdx < intelligence.length; rIdx++) {
          try {
            var raceIntel = intelligence[rIdx];
            if (!raceIntel || !raceIntel.meeting) continue;

            var bfMarkets = await betfairSource.fetchRacingMarkets(raceIntel.meeting, raceIntel.time);
            if (!bfMarkets || bfMarkets.length === 0) continue;

            var bfMarket = bfMarkets[0];
            var exchangeResult = await betfairSource.getExchangeData(bfMarket.marketId);
            if (!exchangeResult || !exchangeResult.runners) continue;

            // Add exchange data to the intelligence response
            raceIntel.exchangeData = {
              marketId: exchangeResult.marketId,
              totalMatched: exchangeResult.totalMatched,
              runners: exchangeResult.runners.map(function(er) {
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

            // Add exchange insight to analysis text
            var topExRunner = exchangeResult.runners.filter(function(r) { return r.tradedVolume > 0; })
              .sort(function(a, b) { return b.tradedVolume - a.tradedVolume; })[0];
            if (topExRunner && topExRunner.tradedVolume > 500) {
              var volFormatted = topExRunner.tradedVolume >= 1000
                ? (topExRunner.tradedVolume / 1000).toFixed(1) + 'k'
                : topExRunner.tradedVolume.toString();
              var movementText = topExRunner.priceMovement === 'shortening' ? 'price shortening \u2014 strong professional backing'
                : topExRunner.priceMovement === 'drifting' ? 'price drifting \u2014 market confidence weakening'
                : 'price stable \u2014 market settled';
              raceIntel.insights.exchangeAnalysis = 'Betfair Exchange: \u00A3' + volFormatted + ' traded on ' +
                topExRunner.runnerName + ', ' + movementText + '. ' +
                (exchangeResult.totalMatched >= 10000
                  ? 'Total market volume of \u00A3' + (exchangeResult.totalMatched / 1000).toFixed(0) + 'k indicates strong market interest.'
                  : 'Market still building \u2014 expect volume to increase closer to post time.');
            }
          } catch (bfErr) {
            // Non-fatal — continue without exchange data for this race
            console.log('[Racing Intelligence] Betfair data unavailable for race ' + (rIdx + 1) + ': ' + bfErr.message);
          }
        }
      }

      // --- Weather enrichment ---
      if (weatherSource && weatherSource.isConfigured()) {
        var meetingWeatherCache = {};
        for (var wIdx = 0; wIdx < intelligence.length; wIdx++) {
          try {
            var wRace = intelligence[wIdx];
            if (!wRace || !wRace.meeting) continue;
            var meetingName = wRace.meeting;
            if (!meetingWeatherCache[meetingName]) {
              meetingWeatherCache[meetingName] = await weatherSource.fetchForCourse(meetingName);
            }
            var courseWeather = meetingWeatherCache[meetingName];
            if (courseWeather) {
              wRace.weather = {
                temp: courseWeather.temp,
                windSpeed: courseWeather.windSpeed,
                windDirection: courseWeather.windDirection,
                rain: courseWeather.rain,
                description: courseWeather.description
              };
              // Generate weather impact assessment
              var weatherImpact = '';
              if (courseWeather.rain > 0 || (courseWeather.description && courseWeather.description.indexOf('rain') !== -1)) {
                var currentGoing = (wRace.going || '').toLowerCase();
                if (currentGoing.indexOf('good') !== -1 && currentGoing.indexOf('soft') === -1) {
                  weatherImpact = 'Rain forecast \u2014 going may soften from ' + (wRace.going || 'Good') + ' to Good to Soft. Horses with soft ground form are favoured.';
                } else if (currentGoing.indexOf('soft') !== -1) {
                  weatherImpact = 'Further rain expected \u2014 ground could deteriorate further. Proven soft/heavy ground form essential.';
                } else {
                  weatherImpact = 'Rain forecast \u2014 going likely to soften. Horses with soft ground form are favoured.';
                }
              } else if (courseWeather.windSpeed > 20) {
                var distCheck = (wRace.distance || '').toLowerCase();
                var isSprintRace = distCheck.indexOf('5f') !== -1 || distCheck.indexOf('6f') !== -1;
                if (isSprintRace) {
                  weatherImpact = 'Strong crosswind (' + courseWeather.windSpeed + 'mph) \u2014 may affect sprinters in the home straight.';
                } else {
                  weatherImpact = 'Strong wind (' + courseWeather.windSpeed + 'mph) \u2014 may be a factor for front-runners exposed to the elements.';
                }
              } else {
                weatherImpact = 'Dry and ' + (courseWeather.temp > 15 ? 'warm' : courseWeather.temp > 5 ? 'mild' : 'cold') + ' \u2014 going should remain as advertised.';
              }
              wRace.insights.weatherAnalysis = 'Weather at ' + meetingName + ': ' + courseWeather.description + ', ' + Math.round(courseWeather.temp) + '\u00B0C, wind ' + courseWeather.windSpeed + 'mph ' + courseWeather.windDirection + '. ' + weatherImpact;
            }
          } catch (wErr) {
            // Non-fatal — continue without weather for this race
          }
        }
      }

      res.json({ live: true, races: intelligence, fetchedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[Racing Intelligence] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
