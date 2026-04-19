/**
 * Elite Edge Sports Tips — AI Report Generator
 *
 * Uses the Claude API to generate professional written match previews,
 * race previews, and daily briefings from statistical data.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 * Degrades gracefully when unavailable.
 */

const Anthropic = require('@anthropic-ai/sdk').default;

class AIReportGenerator {
  constructor() {
    this.client = null;
    this._cache = new Map();
    this._cacheTTL = 30 * 60 * 1000; // 30 minutes

    if (process.env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic(); // uses ANTHROPIC_API_KEY env var automatically
      console.log('[AI Reports] Claude API configured');
    } else {
      console.log('[AI Reports] No ANTHROPIC_API_KEY — AI reports disabled');
    }
  }

  isAvailable() {
    return !!this.client;
  }

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------
  _getCached(key) {
    var entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this._cacheTTL) {
      this._cache.delete(key);
      return null;
    }
    return entry.data;
  }

  _setCache(key, data) {
    this._cache.set(key, { data: data, timestamp: Date.now() });
  }

  // ---------------------------------------------------------------------------
  // FOOTBALL MATCH PREVIEW
  // ---------------------------------------------------------------------------
  async generateFootballPreview(data) {
    if (!this.client) return null;

    var cacheKey = 'football:' + (data.homeTeam || '') + ':' + (data.awayTeam || '') + ':' + (data.kickoff || '');
    var cached = this._getCached(cacheKey);
    if (cached) return cached;

    try {
      var userPrompt = 'Generate a professional match preview for the following fixture.\n\n';
      userPrompt += 'FIXTURE: ' + data.homeTeam + ' vs ' + data.awayTeam + '\n';
      userPrompt += 'League: ' + (data.league || 'Unknown') + '\n';
      userPrompt += 'Kick-off: ' + (data.kickoff || 'TBC') + '\n';
      userPrompt += 'Venue: ' + (data.venue || 'TBC') + '\n\n';

      userPrompt += 'HOME FORM (last 5): ' + (data.homeForm ? data.homeForm.join(', ') : 'N/A') + '\n';
      userPrompt += 'AWAY FORM (last 5): ' + (data.awayForm ? data.awayForm.join(', ') : 'N/A') + '\n\n';

      if (data.homeGoals != null || data.awayGoals != null) {
        userPrompt += 'GOALS STATS:\n';
        userPrompt += '  Home avg scored: ' + (data.homeGoals || 'N/A') + '\n';
        userPrompt += '  Away avg scored: ' + (data.awayGoals || 'N/A') + '\n';
        if (data.homeXG) userPrompt += '  Home xG: ' + data.homeXG + '\n';
        if (data.awayXG) userPrompt += '  Away xG: ' + data.awayXG + '\n';
        userPrompt += '\n';
      }

      if (data.h2hRecord) {
        userPrompt += 'HEAD-TO-HEAD RECORD:\n';
        userPrompt += '  Home wins: ' + (data.h2hRecord.homeWins || 0) + '\n';
        userPrompt += '  Draws: ' + (data.h2hRecord.draws || 0) + '\n';
        userPrompt += '  Away wins: ' + (data.h2hRecord.awayWins || 0) + '\n';
        if (data.h2hRecord.lastMeetings && data.h2hRecord.lastMeetings.length > 0) {
          userPrompt += '  Last meetings: ' + data.h2hRecord.lastMeetings.map(function(m) {
            return m.home + ' ' + m.homeGoals + '-' + m.awayGoals + ' ' + m.away;
          }).join('; ') + '\n';
        }
        userPrompt += '\n';
      }

      if (data.injuries) {
        userPrompt += 'INJURIES:\n';
        if (data.injuries.home && data.injuries.home.length > 0) {
          userPrompt += '  Home missing: ' + data.injuries.home.map(function(p) { return typeof p === 'string' ? p : p.player || p; }).join(', ') + '\n';
        }
        if (data.injuries.away && data.injuries.away.length > 0) {
          userPrompt += '  Away missing: ' + data.injuries.away.map(function(p) { return typeof p === 'string' ? p : p.player || p; }).join(', ') + '\n';
        }
        userPrompt += '\n';
      }

      if (data.odds) {
        userPrompt += 'ODDS:\n';
        userPrompt += '  Home: ' + (data.odds.home || 'N/A') + '\n';
        userPrompt += '  Draw: ' + (data.odds.draw || 'N/A') + '\n';
        userPrompt += '  Away: ' + (data.odds.away || 'N/A') + '\n';
        if (data.odds.bestBookmaker) userPrompt += '  Best bookmaker: ' + data.odds.bestBookmaker + '\n';
        userPrompt += '\n';
      }

      if (data.ourTip) {
        userPrompt += 'OUR TIP:\n';
        userPrompt += '  Selection: ' + (data.ourTip.selection || 'N/A') + '\n';
        userPrompt += '  Market: ' + (data.ourTip.market || 'N/A') + '\n';
        userPrompt += '  Odds: ' + (data.ourTip.odds || 'N/A') + '\n';
        userPrompt += '  Confidence: ' + (data.ourTip.confidence || 'N/A') + '/10\n';
        if (data.ourTip.edge) userPrompt += '  Edge: ' + data.ourTip.edge + '\n';
        userPrompt += '\n';
      }

      userPrompt += 'Return your response as JSON with these fields:\n';
      userPrompt += '- preview: the full written preview (300-400 words)\n';
      userPrompt += '- headline: a punchy headline for this preview (max 80 chars)\n';
      userPrompt += '- keyStats: array of 3-5 key statistical talking points (short strings)\n';
      userPrompt += '- verdict: one-sentence final verdict\n';

      var response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system: 'You are an elite UK sports analyst writing for Elite Edge Sports Tips, the UK\'s premium betting intelligence service. Write a professional, data-driven match preview. Tone: authoritative, analytical, concise. Use British English. Reference specific stats. Be honest about risks. Never guarantee outcomes. Format with clear sections. Around 300-400 words. Always respond with valid JSON only — no markdown, no code fences.',
        messages: [{ role: 'user', content: userPrompt }],
      });

      var text = response.content[0].text.trim();
      // Strip markdown code fences if present
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      var result;
      try {
        result = JSON.parse(text);
      } catch (parseErr) {
        // If JSON parsing fails, build a structured response from the raw text
        console.log('[AI Reports] JSON parse failed, using raw text as preview');
        result = {
          preview: text,
          headline: text.split('\n')[0].substring(0, 80) || 'Match Preview',
          keyStats: [],
          verdict: text.split('\n').pop() || ''
        };
      }

      this._setCache(cacheKey, result);
      return result;
    } catch (err) {
      console.error('[AI Reports] Football preview error:', err.message);
      if (err.status) console.error('[AI Reports] Status:', err.status, 'Type:', err.error?.type);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // RACING PREVIEW
  // ---------------------------------------------------------------------------
  async generateRacingPreview(data) {
    if (!this.client) return null;

    var cacheKey = 'racing:' + (data.meeting || '') + ':' + (data.raceTime || '') + ':' + (data.selection ? data.selection.name : '');
    var cached = this._getCached(cacheKey);
    if (cached) return cached;

    try {
      var userPrompt = 'Generate a professional race preview focused on our selection.\n\n';
      userPrompt += 'RACE: ' + (data.raceName || 'Race') + '\n';
      userPrompt += 'Meeting: ' + (data.meeting || 'Unknown') + '\n';
      userPrompt += 'Time: ' + (data.raceTime || 'TBC') + '\n';
      userPrompt += 'Class: ' + (data.raceClass || 'N/A') + '\n';
      userPrompt += 'Distance: ' + (data.distance || 'N/A') + '\n';
      userPrompt += 'Going: ' + (data.going || 'N/A') + '\n';
      userPrompt += 'Runners: ' + (data.runners || 'N/A') + '\n\n';

      if (data.selection) {
        userPrompt += 'OUR SELECTION:\n';
        userPrompt += '  Name: ' + (data.selection.name || 'N/A') + '\n';
        userPrompt += '  Trainer: ' + (data.selection.trainer || 'N/A') + '\n';
        userPrompt += '  Jockey: ' + (data.selection.jockey || 'N/A') + '\n';
        userPrompt += '  Form: ' + (data.selection.form || 'N/A') + '\n';
        userPrompt += '  Official Rating: ' + (data.selection.officialRating || 'N/A') + '\n';
        userPrompt += '  Age: ' + (data.selection.age || 'N/A') + '\n';
        userPrompt += '  Weight: ' + (data.selection.weight || 'N/A') + '\n';
        if (data.selection.draw) userPrompt += '  Draw: ' + data.selection.draw + '\n';
        userPrompt += '\n';
      }

      if (data.courseRecord) userPrompt += 'Course record: ' + data.courseRecord + '\n';
      if (data.goingSuitability) userPrompt += 'Going suitability: ' + data.goingSuitability + '\n';
      if (data.trainerForm) userPrompt += 'Trainer form: ' + data.trainerForm + '\n';
      if (data.jockeyForm) userPrompt += 'Jockey form: ' + data.jockeyForm + '\n';
      userPrompt += '\n';

      if (data.odds) {
        userPrompt += 'ODDS:\n';
        userPrompt += '  Best price: ' + (data.odds.bestPrice || 'N/A') + '\n';
        if (data.odds.bestBookmaker) userPrompt += '  Best bookmaker: ' + data.odds.bestBookmaker + '\n';
        if (data.odds.averagePrice) userPrompt += '  Average price: ' + data.odds.averagePrice + '\n';
        userPrompt += '\n';
      }

      if (data.weather) {
        userPrompt += 'WEATHER: ' + (data.weather.conditions || '') + ', ' + (data.weather.temp || '') + 'C';
        if (data.weather.windSpeed) userPrompt += ', Wind ' + data.weather.windSpeed + 'mph';
        userPrompt += '\n\n';
      }

      if (data.ourTip) {
        userPrompt += 'OUR TIP:\n';
        userPrompt += '  Confidence: ' + (data.ourTip.confidence || 'N/A') + '/10\n';
        if (data.ourTip.edge) userPrompt += '  Edge: ' + data.ourTip.edge + '\n';
        if (data.ourTip.staking) userPrompt += '  Staking: ' + data.ourTip.staking + '\n';
        if (data.ourTip.market) userPrompt += '  Market: ' + data.ourTip.market + '\n';
        userPrompt += '\n';
      }

      userPrompt += 'Return your response as JSON with these fields:\n';
      userPrompt += '- preview: the full written preview (200-300 words)\n';
      userPrompt += '- headline: a punchy headline for this preview (max 80 chars)\n';
      userPrompt += '- keyFactors: array of 3-5 key factors in favour of the selection (short strings)\n';
      userPrompt += '- verdict: one-sentence final verdict\n';

      var response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system: 'You are an elite UK horse racing analyst writing for Elite Edge Sports Tips. Write a professional race preview focused on our selection. Reference form figures, going preference, trainer/jockey stats, draw position, and course suitability. British English. Around 200-300 words. Be analytical, not promotional. Always respond with valid JSON only — no markdown, no code fences.',
        messages: [{ role: 'user', content: userPrompt }],
      });

      var text = response.content[0].text.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      var result;
      try { result = JSON.parse(text); } catch(pe) {
        result = { preview: text, headline: text.split('\n')[0].substring(0, 80) || 'Race Preview', keyFactors: [], verdict: '' };
      }

      this._setCache(cacheKey, result);
      return result;
    } catch (err) {
      console.error('[AI Reports] Racing preview error:', err.message);
      if (err.status) console.error('[AI Reports] Status:', err.status, 'Type:', err.error?.type);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // EMAIL BULLETIN (AI-personalised morning email)
  // ---------------------------------------------------------------------------
  async generateEmailBulletin(data) {
    if (!this.client) return null;

    var cacheKey = 'bulletin:' + (data.userName || '') + ':' + (data.date || new Date().toISOString().split('T')[0]);
    var cached = this._getCached(cacheKey);
    if (cached) return cached;

    try {
      var userPrompt = 'Generate a personalised morning email bulletin.\n\n';
      userPrompt += 'SUBSCRIBER NAME: ' + (data.userName || 'Subscriber') + '\n';
      userPrompt += 'DATE: ' + (data.date || new Date().toLocaleDateString('en-GB')) + '\n\n';

      if (data.yesterdayResults) {
        userPrompt += 'YESTERDAY\'S RESULTS:\n';
        userPrompt += '  Wins: ' + (data.yesterdayResults.wins || 0) + '\n';
        userPrompt += '  Losses: ' + (data.yesterdayResults.losses || 0) + '\n';
        userPrompt += '  P&L: ' + (data.yesterdayResults.pnl || 0) + ' units\n';
        userPrompt += '  Strike Rate: ' + (data.yesterdayResults.strikeRate || 0) + '%\n\n';
      }

      if (data.tips && data.tips.length > 0) {
        userPrompt += 'TODAY\'S TIPS (' + data.tips.length + '):\n';
        data.tips.forEach(function(tip) {
          userPrompt += '  - ' + (tip.selection || 'Selection') + ' in ' + (tip.event || '') + ' at ' + (tip.odds || 'TBC');
          if (tip.isPremium) userPrompt += ' [PREMIUM]';
          if (tip.confidence) userPrompt += ' (confidence: ' + tip.confidence + '/10)';
          userPrompt += '\n';
        });
        userPrompt += '\n';
      }

      if (data.napSelection) {
        userPrompt += 'NAP OF THE DAY: ' + (typeof data.napSelection === 'string' ? data.napSelection : data.napSelection.selection || data.napSelection) + '\n\n';
      }

      if (data.streak) {
        userPrompt += 'CURRENT STREAK: ' + data.streak + '\n\n';
      }

      userPrompt += 'Return your response as JSON with these fields:\n';
      userPrompt += '- subject: email subject line (max 60 chars)\n';
      userPrompt += '- greeting: personalised morning greeting using the subscriber name once\n';
      userPrompt += '- resultsReview: brief summary of yesterday\'s results\n';
      userPrompt += '- todaysPicks: overview of today\'s headline picks\n';
      userPrompt += '- signOff: warm professional sign-off\n';

      var response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system: 'You are writing a premium morning email bulletin for Elite Edge Sports Tips, the UK\'s #1 sports analysis service. Write a personalised, engaging email in British English. Be confident but never guarantee outcomes. Include a brief morning greeting, yesterday\'s results summary, today\'s headline picks, and a sign-off. Keep it under 250 words. Tone: professional, warm, data-driven. The subscriber\'s name is provided — use it once in the greeting. Always respond with valid JSON only — no markdown, no code fences. JSON fields: subject, greeting, resultsReview, todaysPicks, signOff.',
        messages: [{ role: 'user', content: userPrompt }],
      });

      var text = response.content[0].text.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      var result;
      try { result = JSON.parse(text); } catch(pe) {
        result = { subject: 'Elite Edge Daily', greeting: text.split('\n')[0] || '', resultsReview: '', todaysPicks: text, signOff: '' };
      }

      this._setCache(cacheKey, result);
      return result;
    } catch (err) {
      console.error('[AI Reports] Email bulletin error:', err.message);
      if (err.status) console.error('[AI Reports] Status:', err.status, 'Type:', err.error?.type);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // DAILY SUMMARY / MORNING BRIEFING
  // ---------------------------------------------------------------------------
  async generateDailySummary(data) {
    if (!this.client) return null;

    var cacheKey = 'daily:' + (data.date || new Date().toISOString().split('T')[0]);
    var cached = this._getCached(cacheKey);
    if (cached) return cached;

    try {
      var userPrompt = 'Generate a punchy morning briefing for our premium subscribers.\n\n';
      userPrompt += 'DATE: ' + (data.date || new Date().toLocaleDateString('en-GB')) + '\n';
      userPrompt += 'Total tips today: ' + (data.totalTips || 0) + '\n';
      userPrompt += 'Premium tips: ' + (data.premiumTips || 0) + '\n\n';

      if (data.napSelection) {
        userPrompt += 'NAP OF THE DAY: ' + (typeof data.napSelection === 'string' ? data.napSelection : data.napSelection.selection || data.napSelection.name || 'TBC') + '\n\n';
      }

      if (data.racingTips && data.racingTips.length > 0) {
        userPrompt += 'RACING TIPS (' + data.racingTips.length + '):\n';
        data.racingTips.forEach(function(tip) {
          userPrompt += '  - ' + (tip.selection || tip.name || 'Selection') + ' at ' + (tip.meeting || tip.event || '') + ' (' + (tip.odds || '') + ')\n';
        });
        userPrompt += '\n';
      }

      if (data.footballTips && data.footballTips.length > 0) {
        userPrompt += 'FOOTBALL TIPS (' + data.footballTips.length + '):\n';
        data.footballTips.forEach(function(tip) {
          userPrompt += '  - ' + (tip.selection || tip.name || 'Selection') + ' — ' + (tip.event || '') + ' (' + (tip.odds || '') + ')\n';
        });
        userPrompt += '\n';
      }

      if (data.keyRaces && data.keyRaces.length > 0) {
        userPrompt += 'KEY RACES TO WATCH:\n';
        data.keyRaces.forEach(function(race) {
          userPrompt += '  - ' + (race.name || race) + '\n';
        });
        userPrompt += '\n';
      }

      userPrompt += 'Return your response as JSON with these fields:\n';
      userPrompt += '- briefing: the full morning briefing text (150-200 words)\n';
      userPrompt += '- headline: a punchy headline for the day (max 60 chars)\n';

      var response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system: 'You are writing a punchy morning briefing for Elite Edge Sports Tips subscribers. Cover the headline picks, key stats, and what to watch. 150-200 words. British English. Tone: confident, authoritative, concise. Not promotional — informative. Always respond with valid JSON only — no markdown, no code fences.',
        messages: [{ role: 'user', content: userPrompt }],
      });

      var text = response.content[0].text.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      var result;
      try { result = JSON.parse(text); } catch(pe) {
        result = { briefing: text, headline: text.split('\n')[0].substring(0, 80) || 'Morning Briefing' };
      }

      this._setCache(cacheKey, result);
      return result;
    } catch (err) {
      console.error('[AI Reports] Daily summary error:', err.message);
      if (err.status) console.error('[AI Reports] Status:', err.status, 'Type:', err.error?.type);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new AIReportGenerator();
