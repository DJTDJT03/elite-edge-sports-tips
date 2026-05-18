/**
 * Marketing Content Engine — Standalone Event Branch
 *
 * Reusable for any major event (World Cup, Euros, Champions League).
 * Swap the event config JSON to change the entire campaign.
 *
 * This module NEVER modifies:
 *  - Core tip generation
 *  - Settlement engine
 *  - Scoring model
 *  - Existing notifications
 *  - Database schema (uses own table)
 *
 * It ONLY reads from existing APIs and writes to marketing_content table.
 */

'use strict';

var fs = require('fs');
var path = require('path');

function MarketingEngine(deps) {
  this.db = deps.db;
  this.aiReports = deps.aiReports;
  this.telegramBot = deps.telegramBot;
  this.emailService = deps.emailService;
  this.sportMonks = deps.sportMonks;

  // Load active event config
  var eventId = process.env.MARKETING_EVENT || 'worldcup2026';
  var configPath = path.join(__dirname, '..', 'config', 'events', eventId + '.json');
  try {
    this.event = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('[Marketing] Loaded event: ' + this.event.name);
  } catch(e) {
    this.event = null;
    console.log('[Marketing] No event config found at ' + configPath);
  }
}

// =========================================================================
// FIXTURE CLASSIFICATION — auto Hero/Hub/Hygiene
// =========================================================================
MarketingEngine.prototype.classifyFixture = function(fixture) {
  if (!this.event) return { tier: 'hygiene', reason: 'No event loaded' };

  var home = (fixture.homeTeam || '').toLowerCase();
  var away = (fixture.awayTeam || '').toLowerCase();
  var hero = (this.event.heroTeam || '').toLowerCase();
  var stage = (fixture.stage || '').toLowerCase();

  // HERO triggers
  if (home === hero || away === hero) return { tier: 'hero', reason: this.event.heroTeam + ' playing' };
  if (stage.indexOf('final') !== -1) return { tier: 'hero', reason: 'Final/semi-final match' };
  if (stage.indexOf('semi') !== -1) return { tier: 'hero', reason: 'Semi-final' };
  if (stage.indexOf('quarter') !== -1) return { tier: 'hero', reason: 'Quarter-final' };

  // Check rivalries
  var rivalries = this.event.rivalries || {};
  for (var key in rivalries) {
    var teams = key.toLowerCase().split('-');
    if ((home.indexOf(teams[0]) !== -1 && away.indexOf(teams[1]) !== -1) ||
        (home.indexOf(teams[1]) !== -1 && away.indexOf(teams[0]) !== -1)) {
      return { tier: 'hero', reason: 'Rivalry: ' + key };
    }
  }

  // Knockout stage = hub minimum
  if (stage.indexOf('16') !== -1 || stage.indexOf('round') !== -1) return { tier: 'hub', reason: 'Knockout stage' };

  // Group decider (last match day)
  if (fixture.groupImplications) return { tier: 'hub', reason: 'Group implications' };

  // Default
  return { tier: 'hygiene', reason: 'Standard fixture' };
};

// =========================================================================
// GENERATE CONTENT PACK — all content for a fixture in one call
// =========================================================================
MarketingEngine.prototype.generateContentPack = async function(fixture) {
  if (!this.event || !this.aiReports) return null;

  var classification = this.classifyFixture(fixture);
  var ev = this.event;

  // Build the prompt for Claude
  var prompt = this._buildContentPrompt(fixture, classification, ev);

  try {
    var response = await this.aiReports.generateCustom(prompt.system, prompt.user);
    var content = null;
    try {
      // Try to parse as JSON
      var jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) content = JSON.parse(jsonMatch[0]);
    } catch(e) {
      // Fallback: store as raw text
      content = { raw: response, tier: classification.tier };
    }

    if (content) {
      content.fixtureId = fixture.id;
      content.tier = classification.tier;
      content.tierReason = classification.reason;
      content.homeTeam = fixture.homeTeam || fixture.home_team;
      content.awayTeam = fixture.awayTeam || fixture.away_team;
      content.kickoff = fixture.kickoff;
      content.generatedAt = new Date().toISOString();
      content.eventId = ev.id;

      // Generate outcome templates (auto-post after FT)
      content.outcomeTemplates = this._generateOutcomeTemplates(fixture, classification, ev);

      // Store in database
      await this._saveContentPack(content);
    }

    return content;
  } catch(err) {
    console.error('[Marketing] Content generation failed:', err.message);
    return null;
  }
};

// =========================================================================
// BUILD CONTENT PROMPT — the AI instruction for Claude
// =========================================================================
MarketingEngine.prototype._buildContentPrompt = function(fixture, classification, ev) {
  var home = fixture.homeTeam || fixture.home_team || '';
  var away = fixture.awayTeam || fixture.away_team || '';
  var stage = fixture.stage || 'Group Stage';
  var kickoff = fixture.kickoff || 'TBC';
  var venue = fixture.venue || '';

  var system = 'You are the content engine for Elite Edge Sports Tips. ' +
    'Brand voice: ' + ev.brandVoice.primary + ' ' +
    'Generate tournament content that is intelligent, football-native, emotionally aware, and culturally sharp. ' +
    'Never sound generic, spammy, or like a cheap tipster. ' +
    'Always include: ' + ev.responsibleGambling;

  var tierInstruction = '';
  if (classification.tier === 'hero') {
    tierInstruction = 'This is a HERO fixture — cinematic, emotional, historically significant. Generate maximum content with dramatic hooks and cultural depth. This should feel bigger than football.';
  } else if (classification.tier === 'hub') {
    tierInstruction = 'This is a HUB fixture — build daily engagement with tactical insight, prediction angles, and data-driven analysis. Create trust and habit.';
  } else {
    tierInstruction = 'This is a HYGIENE fixture — keep it concise, informative, and consistent. Quick preview, prediction, and schedule reminder.';
  }

  var narrativeHints = '';
  var narratives = ev.narratives || {};
  for (var key in narratives) {
    if (home.toLowerCase().indexOf(key.toLowerCase().substring(0, 5)) !== -1 ||
        away.toLowerCase().indexOf(key.toLowerCase().substring(0, 5)) !== -1) {
      narrativeHints += narratives[key] + ' ';
    }
  }

  var user = 'EVENT: ' + ev.name + '\n' +
    'MATCH: ' + home + ' vs ' + away + '\n' +
    'STAGE: ' + stage + '\n' +
    'KICKOFF: ' + kickoff + '\n' +
    'VENUE: ' + venue + '\n' +
    'TIER: ' + classification.tier.toUpperCase() + ' (' + classification.reason + ')\n' +
    tierInstruction + '\n\n' +
    (narrativeHints ? 'NARRATIVE CONTEXT: ' + narrativeHints + '\n\n' : '') +
    'Generate a JSON content pack with these fields:\n' +
    '{\n' +
    '  "bigIdea": "the central narrative hook for this fixture",\n' +
    '  "historicHook": "relevant football history or rivalry context",\n' +
    '  "platforms": {\n' +
    '    "x": { "primary": "main tweet (max 280 chars)", "thread": ["follow-up tweet 1", "follow-up tweet 2"], "hashtags": ["relevant", "hashtags"] },\n' +
    '    "instagram": { "caption": "instagram post caption", "storyText": "short story overlay text" },\n' +
    '    "telegram": { "public": "teaser for public channel", "premium": "full insider content for subscribers" },\n' +
    '    "email": { "subject": "email subject line", "preheader": "preview text", "body": "email body paragraph" },\n' +
    '    "push": { "title": "push notification title", "body": "push notification body" }\n' +
    '  },\n' +
    '  "subscriberAngle": "what makes the subscriber version different",\n' +
    '  "publicVsData": "emotion says X, data says Y format",\n' +
    '  "creativeDirection": { "mood": "cinematic/analytical/urgent", "visualStyle": "description for image generation" },\n' +
    '  "segments": ["which audience segments this targets"],\n' +
    '  "funnelStage": "awareness/interest/desire/action/retention"\n' +
    '}\n\n' +
    'Brand hashtags to include: ' + (ev.hashtags || []).join(' ') + '\n' +
    'IMPORTANT: Return ONLY valid JSON. No markdown, no explanation.';

  return { system: system, user: user };
};

// =========================================================================
// OUTCOME TEMPLATES — pre-built for auto-posting after FT
// =========================================================================
MarketingEngine.prototype._generateOutcomeTemplates = function(fixture, classification, ev) {
  var home = fixture.homeTeam || fixture.home_team || '';
  var away = fixture.awayTeam || fixture.away_team || '';
  var tags = (ev.hashtags || []).join(' ');
  var isHero = classification.tier === 'hero';
  var heroTeam = ev.heroTeam || '';
  var isHeroGame = home.indexOf(heroTeam) !== -1 || away.indexOf(heroTeam) !== -1;

  return {
    homeWin: {
      telegram: (isHeroGame && home.indexOf(heroTeam) !== -1) ?
        '🏴󠁧󠁢󠁥󠁮󠁧󠁿 ' + home.toUpperCase() + ' WIN!\n\n' + (isHero ? 'The tournament dream continues. ' : '') + 'Full post-match analysis on the app.\n\n' + tags :
        '⚽ FT: ' + home + ' beat ' + away + '.\n\n' + ev.brandVoice.secondary + '\n\n' + tags,
      push: { title: home + ' win!', body: 'Full-time result confirmed. Check the app for updated predictions.' },
    },
    awayWin: {
      telegram: (isHeroGame && away.indexOf(heroTeam) !== -1) ?
        '🏴󠁧󠁢󠁥󠁮󠁧󠁿 ' + away.toUpperCase() + ' WIN!\n\n' + (isHero ? 'The tournament dream continues. ' : '') + 'Full post-match analysis on the app.\n\n' + tags :
        '⚽ FT: ' + away + ' beat ' + home + '.\n\n' + ev.brandVoice.secondary + '\n\n' + tags,
      push: { title: away + ' win!', body: 'Full-time result confirmed. Check the app for updated predictions.' },
    },
    draw: {
      telegram: '⚽ FT: ' + home + ' and ' + away + ' share the points.\n\n' +
        (isHero ? 'What does this mean for the bracket? Analysis on the app.' : ev.brandVoice.secondary) + '\n\n' + tags,
      push: { title: 'Draw: ' + home + ' vs ' + away, body: 'Full-time. See the bracket implications.' },
    },
    upset: {
      telegram: '🚨 UPSET ALERT!\n\n' + away + ' knock out ' + home + '!\n\n' +
        'The tournament just blew wide open. Full reaction on the app.\n\n' + tags,
      push: { title: '🚨 Major upset!', body: away + ' cause a shock. See the full reaction.' },
    },
  };
};

// =========================================================================
// AUTO-POST AFTER RESULT — called by settlement engine
// =========================================================================
MarketingEngine.prototype.postResultContent = async function(fixture, result) {
  if (!this.event) return;

  try {
    // Find the content pack for this fixture
    var pack = await this._getContentPack(fixture.id || fixture.fixtureId);
    if (!pack || !pack.outcomeTemplates) return;

    var templates = pack.outcomeTemplates;
    var homeGoals = result.homeGoals || 0;
    var awayGoals = result.awayGoals || 0;

    // Select the right template
    var template;
    if (homeGoals > awayGoals) template = templates.homeWin;
    else if (awayGoals > homeGoals) template = templates.awayWin;
    else template = templates.draw;

    // Inject actual score
    var scoreStr = (fixture.homeTeam || fixture.home_team) + ' ' + homeGoals + '-' + awayGoals + ' ' + (fixture.awayTeam || fixture.away_team);

    // Post to Telegram public channel
    if (this.telegramBot && this.telegramBot.isAvailable()) {
      var tgText = template.telegram.replace('FT:', 'FT: ' + scoreStr + '\n');
      await this.telegramBot.sendMessage(tgText);
      console.log('[Marketing] Auto-posted result to Telegram: ' + scoreStr);
    }

    // Log the post
    await this._logPost(fixture, 'result_auto', template);
  } catch(err) {
    console.error('[Marketing] Auto-post failed:', err.message);
  }
};

// =========================================================================
// GENERATE DAILY PACK — all fixtures for today
// =========================================================================
MarketingEngine.prototype.generateDailyPack = async function() {
  if (!this.event || !this.sportMonks) return { generated: 0 };

  var today = new Date().toISOString().split('T')[0];
  console.log('[Marketing] Generating daily content pack for ' + today);

  try {
    var fixtures = await this.sportMonks.getFixturesByDate(today);
    if (!fixtures || fixtures.length === 0) {
      console.log('[Marketing] No fixtures today — generating rest day content');
      return await this._generateRestDayContent(today);
    }

    var generated = 0;
    // Sort by tier priority (hero first)
    var self = this;
    var classified = fixtures.map(function(f) {
      return { fixture: f, classification: self.classifyFixture(f) };
    }).sort(function(a, b) {
      var tierOrder = { hero: 0, hub: 1, hygiene: 2 };
      return (tierOrder[a.classification.tier] || 2) - (tierOrder[b.classification.tier] || 2);
    });

    // Generate content for hero + hub fixtures (limit to top 6 to save API costs)
    var toGenerate = classified.filter(function(c) { return c.classification.tier !== 'hygiene'; }).slice(0, 6);

    // Always include at least 2 hygiene if no hero/hub
    if (toGenerate.length < 2) {
      toGenerate = classified.slice(0, 4);
    }

    for (var i = 0; i < toGenerate.length; i++) {
      try {
        await this.generateContentPack(toGenerate[i].fixture);
        generated++;
      } catch(e) {
        console.error('[Marketing] Failed to generate for fixture:', e.message);
      }
    }

    console.log('[Marketing] Generated ' + generated + ' content packs for ' + today);
    return { generated: generated, total: fixtures.length, date: today };
  } catch(err) {
    console.error('[Marketing] Daily pack error:', err.message);
    return { generated: 0, error: err.message };
  }
};

// =========================================================================
// REST DAY CONTENT — tournament never goes silent
// =========================================================================
MarketingEngine.prototype._generateRestDayContent = async function(date) {
  if (!this.aiReports) return { generated: 0 };

  var ev = this.event;
  var system = 'You are the content engine for ' + ev.name + '. Brand voice: ' + ev.brandVoice.primary;
  var user = 'No fixtures today (' + date + '). Generate rest-day content:\n\n' +
    'Return JSON with:\n' +
    '{\n' +
    '  "bracketAnalysis": "what happens next in the tournament",\n' +
    '  "playerRankings": "top 5 performers so far",\n' +
    '  "predictionScorecard": "how our model is performing",\n' +
    '  "throwback": "on this day in World Cup history",\n' +
    '  "platforms": {\n' +
    '    "x": { "primary": "tweet", "hashtags": ' + JSON.stringify(ev.hashtags) + ' },\n' +
    '    "telegram": { "public": "public channel post" },\n' +
    '    "email": { "subject": "subject", "body": "body" }\n' +
    '  }\n' +
    '}\n\nReturn ONLY valid JSON.';

  try {
    var response = await this.aiReports.generateCustom(system, user);
    var content = JSON.parse(response.match(/\{[\s\S]*\}/)[0]);
    content.type = 'rest_day';
    content.date = date;
    content.eventId = ev.id;
    await this._saveContentPack(content);
    return { generated: 1, type: 'rest_day' };
  } catch(e) {
    return { generated: 0, error: e.message };
  }
};

// =========================================================================
// DATABASE — isolated marketing_content table
// =========================================================================
MarketingEngine.prototype._saveContentPack = async function(content) {
  if (!this.db || !this.db.isAvailable()) return;
  try {
    await this.db.query(
      "INSERT INTO marketing_content (fixture_id, event_id, tier, content, generated_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (fixture_id, event_id) DO UPDATE SET content = $4, generated_at = NOW()",
      [content.fixtureId || content.date || 'rest_' + Date.now(), content.eventId || 'unknown', content.tier || 'hygiene', JSON.stringify(content)]
    );
  } catch(e) { console.error('[Marketing] Save failed:', e.message); }
};

MarketingEngine.prototype._getContentPack = async function(fixtureId) {
  if (!this.db || !this.db.isAvailable()) return null;
  try {
    var { rows } = await this.db.query(
      "SELECT content FROM marketing_content WHERE fixture_id = $1 ORDER BY generated_at DESC LIMIT 1",
      [String(fixtureId)]
    );
    return rows.length > 0 ? JSON.parse(rows[0].content) : null;
  } catch(e) { return null; }
};

MarketingEngine.prototype._logPost = async function(fixture, type, content) {
  if (!this.db || !this.db.isAvailable()) return;
  try {
    await this.db.query(
      "INSERT INTO marketing_posts (fixture_id, post_type, platform, content, posted_at) VALUES ($1, $2, $3, $4, NOW())",
      [fixture.id || fixture.fixtureId || 'unknown', type, 'telegram', JSON.stringify(content)]
    );
  } catch(e) { /* non-fatal */ }
};

// =========================================================================
// GET TODAY'S CONTENT — for admin dashboard review
// =========================================================================
MarketingEngine.prototype.getTodayContent = async function() {
  if (!this.db || !this.db.isAvailable()) return [];
  try {
    var today = new Date().toISOString().split('T')[0];
    var { rows } = await this.db.query(
      "SELECT * FROM marketing_content WHERE generated_at::date = $1 ORDER BY generated_at DESC",
      [today]
    );
    return rows.map(function(r) { return { fixtureId: r.fixture_id, tier: r.tier, content: JSON.parse(r.content), generatedAt: r.generated_at }; });
  } catch(e) { return []; }
};

module.exports = MarketingEngine;
