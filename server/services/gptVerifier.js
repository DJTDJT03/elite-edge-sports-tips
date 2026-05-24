/**
 * Elite Edge Sports Tips — GPT Consensus Verifier
 *
 * Independent tip verification using OpenAI GPT-4o-mini.
 * Each tip scored by Claude's model gets a second opinion from GPT.
 * Only tips where both AI engines agree (confidence 6+) get the
 * "Dual AI Verified" badge.
 *
 * Requires OPENAI_API_KEY env var.
 * Cost: ~$0.01 per verification (~$0.09/day for 9 tips, ~$3/month).
 */

'use strict';

var https = require('https');

var MODEL = 'gpt-4o-mini';
var API_URL = 'https://api.openai.com/v1/chat/completions';
var TIMEOUT_MS = 10000;
var MIN_CONSENSUS_CONFIDENCE = 6;

class GPTVerifier {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.isAvailable = !!this.apiKey;
    if (this.isAvailable) {
      console.log('[GPT Verifier] Initialized — model: ' + MODEL);
    } else {
      console.log('[GPT Verifier] No OPENAI_API_KEY — verification disabled');
    }
  }

  /**
   * Verify a tip independently with GPT.
   * Returns {verified: bool, gptConfidence: number, gptReasoning: string, consensus: bool}
   *
   * @param {object} tip - The tip object with selection, odds, analysis, sport, etc.
   * @param {object} scored - The scored candidate with factors
   * @returns {Promise<object>}
   */
  async verifyTip(tip, scored) {
    if (!this.isAvailable) return { verified: false, skipped: true, reason: 'no_api_key' };

    try {
      var sport = tip.sport || 'racing';
      var prompt = this._buildPrompt(tip, scored, sport);

      var response = await this._callGPT(prompt);
      if (!response) return { verified: false, skipped: true, reason: 'api_error' };

      // Parse GPT's assessment
      var gptConfidence = 5;
      var gptReasoning = '';
      var gptAgrees = false;

      try {
        var parsed = typeof response === 'string' ? JSON.parse(response) : response;
        gptConfidence = parseInt(parsed.confidence) || 5;
        gptReasoning = parsed.reasoning || '';
        gptAgrees = parsed.agrees === true;
      } catch (parseErr) {
        // GPT returned non-JSON — try to extract confidence from text
        var confMatch = String(response).match(/confidence[:\s]*(\d+)/i);
        if (confMatch) gptConfidence = parseInt(confMatch[1]) || 5;
        gptReasoning = String(response).substring(0, 200);
        gptAgrees = gptConfidence >= MIN_CONSENSUS_CONFIDENCE;
      }

      var modelConfidence = tip.confidence || scored.confidence || 5;
      var consensus = modelConfidence >= MIN_CONSENSUS_CONFIDENCE && gptConfidence >= MIN_CONSENSUS_CONFIDENCE && gptAgrees;

      console.log('[GPT Verifier] ' + (tip.selection || 'Unknown') + ': model=' + modelConfidence + '/10, GPT=' + gptConfidence + '/10, consensus=' + (consensus ? 'YES' : 'NO'));

      return {
        verified: true,
        consensus: consensus,
        dualAIVerified: consensus,
        modelConfidence: modelConfidence,
        gptConfidence: gptConfidence,
        gptReasoning: gptReasoning,
        gptAgrees: gptAgrees,
      };
    } catch (err) {
      console.error('[GPT Verifier] Error:', err.message);
      return { verified: false, skipped: true, reason: err.message };
    }
  }

  /**
   * Build the verification prompt for GPT.
   */
  _buildPrompt(tip, scored, sport) {
    var factors = scored.factors || {};
    var factorList = Object.keys(factors).map(function(k) {
      return k + ': ' + ((factors[k] || 0) * 100).toFixed(0) + '%';
    }).join(', ');

    var systemMsg = 'You are an independent sports betting analyst providing a second opinion on a tip selection. ' +
      'You must evaluate whether this selection represents genuine value based on the data provided. ' +
      'Be critical — only agree if the evidence genuinely supports the selection. ' +
      'Return JSON only: {"confidence": 1-10, "agrees": true/false, "reasoning": "one sentence"}';

    var userMsg = 'Evaluate this ' + sport + ' tip:\n\n' +
      'Selection: ' + (tip.selection || 'Unknown') + '\n' +
      'Event: ' + (tip.event || 'Unknown') + '\n' +
      'Market: ' + (tip.market || 'Win') + '\n' +
      'Odds: ' + (tip.odds || 0) + '\n' +
      'Model Probability: ' + ((tip.modelProbability || 0) * 100).toFixed(1) + '%\n' +
      'Implied Probability: ' + ((tip.impliedProbability || 0) * 100).toFixed(1) + '%\n' +
      'Edge: ' + ((tip.edge || 0) * 100).toFixed(1) + '%\n' +
      'Model Confidence: ' + (tip.confidence || 0) + '/10\n' +
      'Factor Scores: ' + factorList + '\n';

    if (tip.analysis && tip.analysis.summary) {
      userMsg += 'Analysis: ' + tip.analysis.summary.substring(0, 300) + '\n';
    }

    userMsg += '\nDoes this selection represent genuine value at these odds? ' +
      'Rate your confidence 1-10 and state whether you agree with the selection.';

    return { system: systemMsg, user: userMsg };
  }

  /**
   * Call OpenAI API.
   */
  _callGPT(prompt) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var payload = JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        max_tokens: 150,
        temperature: 0,
        response_format: { type: 'json_object' },
      });

      var opts = {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + self.apiKey,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: TIMEOUT_MS,
      };

      var req = https.request(opts, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var parsed = JSON.parse(data);
            if (parsed.error) {
              console.error('[GPT Verifier] API error:', parsed.error.message);
              resolve(null);
              return;
            }
            var content = parsed.choices && parsed.choices[0] && parsed.choices[0].message
              ? parsed.choices[0].message.content : null;
            resolve(content);
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.setTimeout(TIMEOUT_MS, function() { req.destroy(); resolve(null); });
      req.on('error', function() { resolve(null); });
      req.write(payload);
      req.end();
    });
  }
  async verifyConsensus(data) {
    if (!this.apiKey) return null;
    try {
      var prompt = 'You are an independent football analyst reviewing a multi-agent debate.\n\n' +
        'FIXTURE: ' + data.fixture + ' (' + data.league + ')\n\n' +
        'THREE AGENTS ANALYSED THIS FIXTURE:\n\n';

      data.agents.forEach(function(a) {
        prompt += a.agent + ' picks: ' + a.pick + ' (' + a.market + ') — Confidence: ' + a.confidence + '/10\n';
        prompt += 'Reasoning: ' + a.reasoning + '\n\n';
      });

      if (data.consensus) {
        prompt += 'CONSENSUS: ' + data.consensus.selection + ' (' + data.consensus.market + ') — agreed by ' + data.consensus.agreeing + '\n\n';
      }

      prompt += 'As an independent arbiter, respond with JSON:\n' +
        '{"agrees": true/false, "reasoning": "your brief assessment", "confidence_adjustment": -1/0/+1}\n' +
        'Do you agree with the consensus pick? Only respond with JSON.';

      var result = await this._callOpenAI(prompt);
      try {
        var jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
      } catch(e) {}
      return { agrees: true, reasoning: result, confidence_adjustment: 0 };
    } catch(e) {
      return null;
    }
  }
}

module.exports = new GPTVerifier();
