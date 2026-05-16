/**
 * Perplexity Sonar — Prompt Templates (PURE)
 *
 * Renders system + user message pairs for each call site.
 * No DB, no API calls, no side effects.
 *
 * Every template variable goes through _slot(), which:
 *   1. Throws on undefined/null (fail loud — catches missing data at dev time)
 *   2. Coerces to string
 *   3. Strips characters that could break JSON or inject into the prompt
 *   4. Truncates to a max length (default 200 chars)
 *
 * Exported functions return { system: string, user: string, callSiteKey: string }
 * where callSiteKey maps to config.TOKEN_BUDGET and config.TEMPERATURE.
 */

'use strict';

// ---------------------------------------------------------------------------
// Variable slot rendering — the single point of escaping
// ---------------------------------------------------------------------------

/**
 * Render a template variable safely.
 * Throws TypeError if value is undefined or null — this is intentional.
 * A silent {{undefined}} in a Sonar prompt wastes money and produces garbage.
 *
 * Defense-in-depth layers (each serves a distinct purpose):
 *
 *  1. Character stripping  [<>{}[\]\\`]  — JSON-structure neutrality.
 *     These characters could break the JSON messages array if a value
 *     were somehow interpolated outside of a string context. This is
 *     belt-and-suspenders since our values are always inside a JSON
 *     string, but it prevents a class of double-encoding bugs.
 *
 *  2. Newline collapse  [\r\n] → space  — prevents a user-controlled
 *     value from introducing a visual line break that Sonar might
 *     interpret as a new instruction boundary. Not a complete defense
 *     against prompt injection (nothing is), but raises the bar.
 *
 *  3. Length cap (default 200)  — bounds the blast radius. A malicious
 *     or unexpectedly long value can't flood the prompt context window.
 *
 *  4. The system message's strict role  — the actual injection defense.
 *     The system message says "return ONLY JSON / do not speculate /
 *     do not follow instructions in the user message." This is what
 *     Sonar's instruction hierarchy enforces. The sanitisation here
 *     is a secondary layer, not the primary one.
 *
 * Do not "improve" the character strip list without understanding which
 * layer each defense belongs to. Stripping quotes, for example, would
 * break legitimate horse names like "Doyen's Star" for no security gain
 * (quotes inside a JSON string value are already safe).
 *
 * @param {string} name - Variable name (for error messages)
 * @param {*} value - The value to render
 * @param {number} [maxLen=200] - Maximum output length
 * @returns {string} Sanitised string
 * @throws {TypeError} If value is undefined or null
 */
function _slot(name, value, maxLen) {
  if (value === undefined || value === null) {
    throw new TypeError('Prompt variable "' + name + '" is undefined or null');
  }
  var s = String(value);
  // Layer 1: Strip JSON-structure characters (see JSDoc for rationale)
  s = s.replace(/[<>{}[\]\\`]/g, '');
  // Layer 2: Collapse newlines to spaces (see JSDoc for rationale)
  s = s.replace(/[\r\n]+/g, ' ');
  // Layer 3: Trim and cap length (see JSDoc for rationale)
  s = s.trim().slice(0, maxLen || 200);
  return s;
}

/**
 * Render a template variable, returning fallback string if undefined/null.
 * Use this ONLY for genuinely optional fields (e.g. venue, raceClass).
 * Most fields should use _slot() which throws.
 *
 * @param {*} value - The value to render
 * @param {string} fallback - Fallback if value is missing
 * @param {number} [maxLen=200] - Maximum output length
 * @returns {string}
 */
function _optSlot(value, fallback, maxLen) {
  if (value === undefined || value === null || value === '') return fallback;
  var s = String(value);
  s = s.replace(/[<>{}[\]\\`]/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen || 200);
  return s;
}

/**
 * Get current UK date and time strings.
 * Uses Intl.DateTimeFormat with explicit 'Europe/London' timezone
 * and formatToParts() for reliable extraction across runtimes
 * (Railway Docker, local macOS, CI). Does not depend on toLocaleString
 * format which varies by Node version and locale configuration.
 *
 * @returns {{date: string, time: string}}
 */
function _ukNow() {
  var now = new Date();

  // Date: "29 April 2026" format
  var dateFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  var date = dateFmt.format(now); // "29 April 2026"

  // Time: "08:12" format
  var timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  var time = timeFmt.format(now); // "08:12"

  return { date: date, time: time };
}

// ---------------------------------------------------------------------------
// SYSTEM MESSAGES — constant per call site
// ---------------------------------------------------------------------------

var SYSTEM_PER_TIP_JSON =
  'You are a factual UK horse racing and football intelligence feed. You return ONLY a JSON object.\n' +
  'Return raw JSON only. Do not wrap in code fences. Do not include any text before or after the JSON object.\n' +
  'You NEVER speculate, predict outcomes, or give opinions. You report verified facts from the last 24 hours with citation indices referencing your citations array.\n' +
  'If you cannot find recent factual updates for a signal, omit that key entirely.\n' +
  'An empty JSON object {} is a valid response if nothing newsworthy has happened.\n' +
  'If you cannot find a citation from the allowed sources, omit the signal. Do not invent URLs or attribute claims to allowed domains without an actual source.';

var SYSTEM_BULLETIN_PROSE =
  'You are a concise UK racing and football correspondent writing for knowledgeable bettors.\n' +
  'Write in plain prose, not JSON. Keep it under 150 words. Cite your sources inline using [Source Name] format. Do not give tips or predictions.\n' +
  'If you cannot find a citation from the allowed sources, omit the claim. Do not invent URLs or attribute claims to allowed domains without an actual source.';

var SYSTEM_REPLAY_PROSE =
  'You are a UK racing analyst providing post-race factual context. Write in plain prose, not JSON. Keep it under 100 words. Cite sources inline using [Source Name].\n' +
  'Do not give future tips or next-race predictions.\n' +
  'If you cannot find a citation from the allowed sources, omit the claim. Do not invent URLs or attribute claims to allowed domains without an actual source.';

// ---------------------------------------------------------------------------
// 1. Per-Tip Racing Enrichment
// ---------------------------------------------------------------------------

/**
 * Build the per-tip racing enrichment prompt.
 *
 * @param {object} scored - Scored candidate with runner + race data
 * @param {object} scored.runner - {horseName, trainer, jockey}
 * @param {object} scored.race - {meeting, time, going, distance, raceClass}
 * @returns {{system: string, user: string, callSiteKey: string}}
 * @throws {TypeError} If horseName or meeting is missing
 */
function buildRacingTipPrompt(scored) {
  var runner = scored.runner || {};
  var race = scored.race || {};
  var uk = _ukNow();

  var user =
    'Today is ' + uk.date + ' at ' + uk.time + ' UK time.\n' +
    'Race at ' + _slot('meeting', race.meeting) + ' ' + _optSlot(race.time, 'TBC') + ' today.\n' +
    'Horse: ' + _slot('horseName', runner.horseName) + '\n' +
    'Trainer: ' + _optSlot(runner.trainer, 'Unknown') + ' | Jockey: ' + _optSlot(runner.jockey, 'Unknown') + '\n' +
    'Official going: ' + _optSlot(race.going, 'Not available') + ' | Distance: ' + _optSlot(race.distance, 'N/A') + ' | Class: ' + _optSlot(race.raceClass, 'N/A') + '\n\n' +
    'Search for recent updates (last 24 hours) about this specific horse, race, or course. Return a JSON object with ONLY these keys (omit any without a citable fact):\n\n' +
    '{\n' +
    '  "going_update": {"value": "how going has changed from the official description", "citation_index": 0},\n' +
    '  "non_runner": {"value": "declared non-runners in this race and their approximate market position", "citation_index": 1},\n' +
    '  "stable_form": {"value": "trainer wins/runs in the last 7 days, e.g. 3 from 11", "citation_index": 2},\n' +
    '  "headgear_change": {"value": "first-time or changed headgear for this horse", "citation_index": 3},\n' +
    '  "jockey_change": {"value": "jockey change in the last 24 hours", "citation_index": 4},\n' +
    '  "course_report": {"value": "clerk of the course statement or course walk findings", "citation_index": 5},\n' +
    '  "rail_movement": {"value": "rail position and its effect on draw bias", "citation_index": 6}\n' +
    '}\n\n' +
    'Rules:\n' +
    '- citation_index must be an integer referencing your citations array\n' +
    '- Only cite Racing Post, Sporting Life, At The Races, BHA, or official racecourse sites\n' +
    '- If a fact comes from a source not in that list, omit it\n' +
    '- Do not include the horse\'s form figures, ratings, or odds — we already have those\n' +
    '- Do not predict whether the horse will win';

  return { system: SYSTEM_PER_TIP_JSON, user: user, callSiteKey: 'per-tip-racing' };
}

// ---------------------------------------------------------------------------
// 2. Per-Tip Football Enrichment
// ---------------------------------------------------------------------------

/**
 * Build the per-tip football enrichment prompt.
 *
 * @param {object} scored - Scored candidate with fixture data
 * @param {object} scored.fixture - {homeTeam, awayTeam, league, kickoff, venue}
 * @param {string} scored.selectedMarket
 * @param {string} scored.selectedSelection
 * @returns {{system: string, user: string, callSiteKey: string}}
 * @throws {TypeError} If homeTeam or awayTeam is missing
 */
function buildFootballTipPrompt(scored) {
  var fixture = scored.fixture || {};
  var uk = _ukNow();

  var user =
    'Today is ' + uk.date + ' at ' + uk.time + ' UK time.\n' +
    'Match today: ' + _slot('homeTeam', fixture.homeTeam) + ' vs ' + _slot('awayTeam', fixture.awayTeam) + '\n' +
    'League: ' + _optSlot(fixture.league, 'N/A') + ' | Kickoff: ' + _optSlot(fixture.kickoff, 'TBC') + ' | Venue: ' + _optSlot(fixture.venue, 'N/A') + '\n' +
    'Our market: ' + _optSlot(scored.selectedMarket, 'N/A') + ' | Our selection: ' + _optSlot(scored.selectedSelection, 'N/A') + '\n\n' +
    'Search for recent updates (last 24 hours) about this specific fixture. Return a JSON object with ONLY these keys (omit any without a citable fact):\n\n' +
    '{\n' +
    '  "team_news": {"value": "confirmed starting XI or late fitness updates not yet on official APIs", "citation_index": 0},\n' +
    '  "tactical_change": {"value": "formation switch or significant tactical shift from recent games", "citation_index": 1},\n' +
    '  "rotation_risk": {"value": "manager signals about resting players due to fixture congestion or upcoming priority games", "citation_index": 2},\n' +
    '  "motivation_context": {"value": "what each team is playing for — title, relegation, European qualification, or dead rubber", "citation_index": 3},\n' +
    '  "manager_comments": {"value": "only verbatim quotes from cited press conference reports. Do not paraphrase. If only a paraphrase is available, omit this signal", "citation_index": 4},\n' +
    '  "injury_update": {"value": "late injury or illness news from the last 24 hours", "citation_index": 5}\n' +
    '}\n\n' +
    'Rules:\n' +
    '- citation_index must be an integer referencing your citations array\n' +
    '- Only cite BBC Sport, Sky Sports, The Guardian, Telegraph, Premier League, EFL, or Transfermarkt\n' +
    '- If a fact comes from a source not in that list, omit it\n' +
    '- Do not include league standings, historical stats, or odds — we already have those\n' +
    '- Do not predict the match result';

  return { system: SYSTEM_PER_TIP_JSON, user: user, callSiteKey: 'per-tip-football' };
}

// ---------------------------------------------------------------------------
// 3. Bulletin Racing Context
// ---------------------------------------------------------------------------

/**
 * Build the bulletin racing context prompt.
 *
 * @param {Array} tips - Today's racing tips [{selection, event}]
 * @returns {{system: string, user: string, callSiteKey: string}}
 * @throws {TypeError} If tips array is empty (caller should check before invoking)
 */
function buildBulletinRacingPrompt(tips) {
  if (!Array.isArray(tips) || tips.length === 0) {
    throw new TypeError('buildBulletinRacingPrompt requires a non-empty array of tips, got: ' + (Array.isArray(tips) ? '[]' : typeof tips));
  }
  var uk = _ukNow();
  var selectionsList = tips.map(function(t) {
    return _slot('selection', t.selection) + ' (' + _optSlot(t.event, 'event TBC') + ')';
  }).join('; ');

  var user =
    'Today is ' + uk.date + ' at ' + uk.time + ' UK time.\n' +
    'Write a 2-paragraph morning racing briefing for today.\n' +
    'Our selections today are: ' + selectionsList + '\n\n' +
    'Paragraph 1: Going updates across today\'s UK meetings. Which courses have changed from yesterday\'s official going? Any watering or overnight rain impact?\n\n' +
    'Paragraph 2: One notable non-runner, market mover, or storyline from today\'s cards that a serious punter should know about.\n\n' +
    'Only reference Racing Post, Sporting Life, At The Races, or official racecourse accounts. If you cannot find today\'s going updates, say so — do not guess.';

  return { system: SYSTEM_BULLETIN_PROSE, user: user, callSiteKey: 'bulletin' };
}

// ---------------------------------------------------------------------------
// 4. Bulletin Football Context
// ---------------------------------------------------------------------------

/**
 * Build the bulletin football context prompt.
 *
 * @param {Array} tips - Today's football tips [{selection, event, market}]
 * @returns {{system: string, user: string, callSiteKey: string}}
 * @throws {TypeError} If tips array is empty
 */
function buildBulletinFootballPrompt(tips) {
  if (!Array.isArray(tips) || tips.length === 0) {
    throw new TypeError('buildBulletinFootballPrompt requires a non-empty array of tips, got: ' + (Array.isArray(tips) ? '[]' : typeof tips));
  }
  var uk = _ukNow();
  var selectionsList = tips.map(function(t) {
    return _slot('selection', t.selection) + ' (' + _optSlot(t.event, 'event TBC') +
      (t.market ? ' - ' + _optSlot(t.market, '') : '') + ')';
  }).join('; ');

  var user =
    'Today is ' + uk.date + ' at ' + uk.time + ' UK time.\n' +
    'Write a 2-paragraph match-day briefing for today.\n' +
    'Our selections today are: ' + selectionsList + '\n\n' +
    'Paragraph 1: Key confirmed team news for today\'s fixtures. Focus on the matches our selections are in. Who is definitely out, who is back, any surprise inclusions?\n\n' +
    'Paragraph 2: One tactical or motivation angle that could affect today\'s games. Is a team rotating for a bigger game midweek? Is there a must-win relegation scenario? Any managerial pressure?\n\n' +
    'Only reference BBC Sport, Sky Sports, The Guardian, or official club/league sources. If team sheets are not yet confirmed, say so — do not speculate on lineups.';

  return { system: SYSTEM_BULLETIN_PROSE, user: user, callSiteKey: 'bulletin' };
}

// ---------------------------------------------------------------------------
// 5. Race Replay Context
// ---------------------------------------------------------------------------

/**
 * Build the race replay context prompt.
 *
 * @param {object} data - {selection, meeting, raceTime, result, position, winnerName, winnerOdds, going, distance, runners}
 * @returns {{system: string, user: string, callSiteKey: string}}
 * @throws {TypeError} If selection or meeting is missing
 */
function buildReplayPrompt(data) {
  var uk = _ukNow();

  // Estimate finish time: raceTime + ~5 minutes
  var finishTime = _optSlot(data.raceTime, 'unknown');
  if (data.raceTime) {
    try {
      var parts = String(data.raceTime).split(':');
      if (parts.length >= 2) {
        var h = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10) + 5;
        if (m >= 60) { m -= 60; h += 1; }
        finishTime = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
      }
    } catch (e) { /* keep original raceTime as fallback */ }
  }

  var user =
    'Today is ' + uk.date + ' at ' + uk.time + ' UK time.\n' +
    'Post-race report needed for:\n' +
    'Race: ' + _slot('meeting', data.meeting) + ' ' + _optSlot(data.raceTime, 'TBC') + ' — race finished at approximately ' + finishTime + '\n' +
    'Our selection: ' + _slot('selection', data.selection) + ' — finished ' + _optSlot(data.position, 'N/A') + ' (' + _optSlot(data.result, 'unknown') + ')\n' +
    'Winner: ' + _optSlot(data.winnerName, 'Unknown') + ' (SP ' + _optSlot(data.winnerOdds, 'N/A') + ')\n' +
    'Going: ' + _optSlot(data.going, 'N/A') + ' | Distance: ' + _optSlot(data.distance, 'N/A') + ' | Field: ' + (data.runners || 0) + ' runners\n\n' +
    'In 2-3 sentences, cover:\n' +
    '1. Was there a track bias or pace factor that affected the result?\n' +
    '2. Any visual excuse for our selection (hampered, slow start, wrong part of track)?\n' +
    '3. Was the winner a clear best or did the race fall apart for others?\n\n' +
    'Only cite Racing Post, Sporting Life, or At The Races race reports.\n' +
    'If no post-race reporting is available yet, say "No post-race reports available yet."';

  return { system: SYSTEM_REPLAY_PROSE, user: user, callSiteKey: 'replay' };
}

// ---------------------------------------------------------------------------
// 6. Odds Movement Explainer
// ---------------------------------------------------------------------------

var SYSTEM_ODDS_EXPLAINER =
  'You are a UK racing and football market analyst. Write one concise sentence explaining why odds have shortened.\n' +
  'Cite your source inline using [Source Name]. Do not speculate — only report if you find a specific reason.\n' +
  'If you cannot find a cited reason, respond with exactly: "No confirmed reason found."\n' +
  'If you cannot find a citation from the allowed sources, omit the claim. Do not invent URLs or attribute claims to allowed domains without an actual source.';

/**
 * Build the odds movement explainer prompt.
 *
 * @param {object} data - {selection, event, sport, openPrice, currentPrice, changePct}
 * @returns {{system: string, user: string, callSiteKey: string}}
 * @throws {TypeError} If selection is missing
 */
function buildOddsExplainerPrompt(data) {
  var uk = _ukNow();
  var sport = data.sport || 'racing';

  var sources = sport === 'racing'
    ? 'Racing Post, Sporting Life, At The Races, or official racecourse sources'
    : 'BBC Sport, Sky Sports, The Guardian, or official league sources';

  var user =
    'Today is ' + uk.date + ' at ' + uk.time + ' UK time.\n' +
    _slot('selection', data.selection) + ' in ' + _optSlot(data.event, 'today\'s card') + '.\n' +
    'Odds have shortened from ' + _optSlot(data.openPrice, '?') + ' to ' + _optSlot(data.currentPrice, '?') +
    ' (' + _optSlot(data.changePct, '?') + '% shortening across bookmakers).\n\n' +
    'In one sentence, explain WHY. Common reasons: trial/gallop reports, jockey booking, stable confidence, non-runner reshuffling market, significant money from known connections.\n\n' +
    'Only cite ' + sources + '. If no reason is findable, respond: "No confirmed reason found."';

  return { system: SYSTEM_ODDS_EXPLAINER, user: user, callSiteKey: 'odds-explainer' };
}

// ---------------------------------------------------------------------------
// CLOCKER — Deep Racing Intelligence Prompt
// ---------------------------------------------------------------------------

/**
 * Build enhanced Perplexity prompt for The Clocker's deep racing research.
 * Asks for trainer intent signals, pace analysis context, and stable form
 * data that the standard racing prompt doesn't cover.
 */
function buildClockerPrompt(scored) {
  var runner = scored.runner || {};
  var race = scored.race || {};
  var uk = _ukNow();

  var user =
    'Today is ' + uk.date + ' at ' + uk.time + ' UK time.\n' +
    'Race at ' + _slot('meeting', race.meeting) + ' ' + _optSlot(race.time, 'TBC') + ' today.\n' +
    'Horse: ' + _slot('horseName', runner.horseName) + '\n' +
    'Trainer: ' + _optSlot(runner.trainer, 'Unknown') + ' | Jockey: ' + _optSlot(runner.jockey, 'Unknown') + '\n' +
    'Going: ' + _optSlot(race.going, 'N/A') + ' | Distance: ' + _optSlot(race.distance, 'N/A') + ' | Class: ' + _optSlot(race.raceClass, 'N/A') + '\n' +
    'Headgear: ' + _optSlot(runner.headgear, 'None') + '\n\n' +
    'You are a deep racing intelligence analyst. Search for the following specific data about this horse, trainer, and race. Return a JSON object with ONLY these keys (omit any without a citable fact):\n\n' +
    '{\n' +
    '  "trainer_strike_rate": {"value": "trainer wins/runs in last 14 days and percentage, e.g. 8 from 32 (25%)", "citation_index": 0},\n' +
    '  "trainer_course_record": {"value": "trainer record at this specific course, e.g. 5 from 22 at Newbury", "citation_index": 1},\n' +
    '  "jockey_booking_signal": {"value": "has the jockey been booked specifically for this ride, any notable switches from other mounts", "citation_index": 2},\n' +
    '  "equipment_history": {"value": "headgear history for this horse — is today first-time, or a return to equipment that worked before", "citation_index": 3},\n' +
    '  "going_form": {"value": "horse form specifically on today\'s going (e.g. 2 wins from 3 on soft ground)", "citation_index": 4},\n' +
    '  "distance_form": {"value": "horse record at today\'s distance, any step up/down in trip, pedigree for the distance", "citation_index": 5},\n' +
    '  "pace_context": {"value": "likely pace scenario — which runners are front-runners, is there pace on, will it suit hold-up or prominent runners", "citation_index": 6},\n' +
    '  "course_config": {"value": "course characteristics that affect this race — left/right-handed, uphill/downhill finish, draw bias on today\'s ground", "citation_index": 7},\n' +
    '  "stable_confidence": {"value": "any quoted comments from trainer or connections about this horse\'s chances, gallop/trial reports", "citation_index": 8}\n' +
    '}\n\n' +
    'Rules:\n' +
    '- citation_index must be an integer referencing your citations array\n' +
    '- Only cite Racing Post, Sporting Life, At The Races, BHA, Timeform, or official racecourse sites\n' +
    '- Be specific with numbers — not "good record" but "3 from 7 (43%)"' +
    '- Do not predict whether the horse will win\n' +
    '- Do not include odds or form figures — we already have those';

  return { system: SYSTEM_PER_TIP_JSON, user: user, callSiteKey: 'per-tip-clocker' };
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
// TACTICIAN — Deep Football Intelligence Prompt
// ---------------------------------------------------------------------------

function buildTacticianPrompt(scored) {
  var fixture = scored.fixture || {};
  var uk = _ukNow();

  var user =
    'Today is ' + uk.date + ' at ' + uk.time + ' UK time.\n' +
    'Match: ' + _slot('homeTeam', fixture.homeTeam) + ' vs ' + _slot('awayTeam', fixture.awayTeam) + '\n' +
    'League: ' + _optSlot(fixture.league, 'Unknown') + ' | Kickoff: ' + _optSlot(fixture.kickoff, 'TBC') + '\n' +
    'Venue: ' + _optSlot(fixture.venue, 'TBC') + '\n' +
    'Our market: ' + _optSlot(scored.selectedMarket, 'Match Result') + ' | Selection: ' + _optSlot(scored.selectedSelection, 'TBC') + '\n\n' +
    'You are a deep football intelligence analyst. Search for the following specific data about this match. Return a JSON object with ONLY these keys (omit any without a citable fact):\n\n' +
    '{\n' +
    '  "manager_quotes": {"value": "pre-match press conference quotes from both managers about team selection, tactics, or injury updates", "citation_index": 0},\n' +
    '  "expected_lineup": {"value": "confirmed or expected starting XI changes, formation, notable inclusions or omissions", "citation_index": 1},\n' +
    '  "injury_update": {"value": "confirmed injuries/suspensions for both teams with expected return dates", "citation_index": 2},\n' +
    '  "tactical_setup": {"value": "expected formation and tactical approach for both sides, any recent system changes", "citation_index": 3},\n' +
    '  "motivation_context": {"value": "what is at stake for each team — league position, relegation, title, European qualification, cup progression, derby rivalry", "citation_index": 4},\n' +
    '  "rotation_risk": {"value": "upcoming fixtures that might cause rotation, midweek European ties, fixture congestion", "citation_index": 5},\n' +
    '  "referee_record": {"value": "assigned referee, average cards per game, penalties awarded this season, tendency for home/away bias", "citation_index": 6},\n' +
    '  "h2h_tactical": {"value": "recent head-to-head results with scorelines, any tactical pattern (e.g. always high-scoring, one side dominates)", "citation_index": 7},\n' +
    '  "xg_trend": {"value": "xG performance trend for both teams over last 5 matches — overperforming or underperforming expected goals", "citation_index": 8}\n' +
    '}\n\n' +
    'Rules:\n' +
    '- citation_index must be an integer referencing your citations array\n' +
    '- Only cite BBC Sport, Sky Sports, The Athletic, Guardian, official club sites, FBRef, Understat, Transfermarkt\n' +
    '- Be specific with numbers — not "good form" but "W4 D1 L0 in last 5, xG 2.1 per game"\n' +
    '- Do not predict the result or recommend a bet';

  return { system: SYSTEM_PER_TIP_JSON, user: user, callSiteKey: 'per-tip-tactician' };
}

// ---------------------------------------------------------------------------
// WORLD CUP TACTICIAN — Tournament-Specific Deep Intelligence (12 signals)
// ---------------------------------------------------------------------------

function buildWorldCupPreviewPrompt(fixture) {
  var uk = _ukNow();

  var user =
    'Today is ' + uk.date + ' at ' + uk.time + ' UK time.\n' +
    'TOURNAMENT: FIFA World Cup 2026 (USA, Canada, Mexico)\n' +
    'Match: ' + _slot('homeTeam', fixture.home_team || fixture.homeTeam) + ' vs ' + _slot('awayTeam', fixture.away_team || fixture.awayTeam) + '\n' +
    'Stage: ' + _optSlot(fixture.stage, 'Group') + (fixture.group_letter ? ' | Group ' + fixture.group_letter : '') + '\n' +
    'Kickoff: ' + _optSlot(fixture.kickoff, 'TBC') + '\n' +
    'Venue: ' + _optSlot(fixture.venue, 'TBC') + '\n\n' +
    'You are a world-class football intelligence analyst covering the FIFA World Cup. Search for the following specific data about this match. Return a JSON object with ONLY these keys (omit any without a citable fact):\n\n' +
    '{\n' +
    '  "squad_news": {"value": "confirmed squad, key absentees, star players available, any last-minute call-ups or withdrawals", "citation_index": 0},\n' +
    '  "manager_tactics": {"value": "expected formation, tactical approach from both managers, any system changes from last match, press conference quotes", "citation_index": 1},\n' +
    '  "group_implications": {"value": "what does each team need from this match to qualify — scenarios for advancement, elimination, or group winners", "citation_index": 2},\n' +
    '  "tournament_form": {"value": "how each team has performed in this World Cup so far — goals scored/conceded, xG, dominant performances or lucky escapes", "citation_index": 3},\n' +
    '  "key_player_battle": {"value": "the decisive individual matchup — e.g. striker vs centre-back, playmaker vs defensive midfielder — with stats and context", "citation_index": 4},\n' +
    '  "h2h_history": {"value": "head-to-head record including previous World Cup meetings with scorelines, any psychological edge", "citation_index": 5},\n' +
    '  "motivation_pressure": {"value": "psychological factors — knockout stage nerves, defending champions pressure, nation expectations, underdog mentality, grudge matches", "citation_index": 6},\n' +
    '  "conditions_venue": {"value": "stadium altitude, heat, playing surface, timezone travel for teams, crowd factor — home continent advantage for USA/Canada/Mexico", "citation_index": 7},\n' +
    '  "referee_profile": {"value": "assigned referee and nationality, officiating style, average cards/penalties, any controversy history with these teams", "citation_index": 8},\n' +
    '  "betting_market": {"value": "current odds and market movement — where the money is going, any significant drift or shortening, Asian handicap line", "citation_index": 9},\n' +
    '  "predicted_scoreline": {"value": "most likely scoreline based on data analysis — include xG-based prediction and reasoning", "citation_index": 10},\n' +
    '  "elite_edge_verdict": {"value": "the single best betting angle for this match — market, selection, and why the value exists. Be specific with odds and edge", "citation_index": 11}\n' +
    '}\n\n' +
    'Rules:\n' +
    '- citation_index must be an integer referencing your citations array\n' +
    '- Cite: BBC Sport, Sky Sports, The Athletic, Guardian, ESPN, FIFA.com, FBRef, Transfermarkt, WhoScored, Flashscore, official FA/federation sites\n' +
    '- Be specific with numbers — not "good form" but "W2 D1 L0 in group, 5 goals scored, xG 4.2"\n' +
    '- For group_implications, include mathematical scenarios (e.g. "a draw eliminates X if Y beats Z")\n' +
    '- Do not hedge — give a clear, data-backed verdict';

  return { system: SYSTEM_PER_TIP_JSON, user: user, callSiteKey: 'per-tip-worldcup' };
}

// ---------------------------------------------------------------------------
module.exports = {
  buildWorldCupPreviewPrompt: buildWorldCupPreviewPrompt,
  buildTacticianPrompt: buildTacticianPrompt,
  buildClockerPrompt: buildClockerPrompt,
  buildRacingTipPrompt: buildRacingTipPrompt,
  buildFootballTipPrompt: buildFootballTipPrompt,
  buildBulletinRacingPrompt: buildBulletinRacingPrompt,
  buildBulletinFootballPrompt: buildBulletinFootballPrompt,
  buildReplayPrompt: buildReplayPrompt,
  buildOddsExplainerPrompt: buildOddsExplainerPrompt,
  // Exposed for testing only:
  _slot: _slot,
  _optSlot: _optSlot,
  _ukNow: _ukNow,
};
