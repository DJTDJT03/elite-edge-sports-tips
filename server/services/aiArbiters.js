/**
 * Multi-model AI arbiter panel.
 *
 * The consensus engine's three in-house analysts (statistical) debate a fixture
 * and reach a pick. This panel then gets INDEPENDENT verdicts from several
 * different reasoning models (OpenAI GPT, Google Gemini, xAI Grok) and aggregates
 * their votes — diverse models reduce correlated errors vs a single arbiter.
 *
 * Each provider is gated by its own API key; absent keys are skipped gracefully.
 * Pluggable — never touches the locked tipping engine.
 */
var https = require('https');

function postJson(hostname, path, headers, bodyObj, timeoutMs) {
  return new Promise(function (resolve) {
    var body = JSON.stringify(bodyObj);
    var opts = {
      hostname: hostname, path: path, method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, headers || {}),
    };
    var req = https.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    });
    req.setTimeout(timeoutMs || 12000, function () { req.destroy(); resolve(null); });
    req.on('error', function () { resolve(null); });
    req.write(body);
    req.end();
  });
}

// Pull the first {...} JSON object out of a model's text response.
function parseVerdict(text) {
  if (!text) return null;
  var m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    var o = JSON.parse(m[0]);
    return {
      agrees: o.agrees === true || /^(yes|agree|true)$/i.test(String(o.agrees)),
      confidence: Math.max(0, Math.min(10, Number(o.confidence) || 0)),
      reasoning: String(o.reasoning || '').slice(0, 280),
    };
  } catch (e) { return null; }
}

function buildPrompt(data) {
  var lines = (data.agents || []).map(function (a) {
    return '- ' + a.agent + ': ' + a.pick + ' (' + a.market + '), confidence ' + a.confidence + '/10 — ' + (a.reasoning || '');
  }).join('\n');
  var cons = data.consensus ? (data.consensus.selection + ' (' + data.consensus.market + ')') : 'no clear consensus';
  return 'You are an independent professional football betting analyst acting as an arbiter. ' +
    'Three in-house analysts debated a fixture and reached a consensus pick. Review them and give your INDEPENDENT verdict.\n\n' +
    'Fixture: ' + (data.fixture || '') + (data.league ? ' (' + data.league + ')' : '') + '\n' +
    'Analyst debate:\n' + lines + '\n' +
    'Consensus pick: ' + cons + '\n\n' +
    'Respond with ONLY valid JSON, no prose:\n' +
    '{"agrees": true or false, "confidence": 0-10, "reasoning": "one short sentence"}\n' +
    '- agrees: is the consensus pick the strongest call?\n' +
    '- confidence: your confidence in that pick (0-10).';
}

module.exports = function () {
  var providers = [];

  // OpenAI GPT (OpenAI-compatible)
  if (process.env.OPENAI_API_KEY) {
    providers.push({
      name: 'GPT', model: process.env.OPENAI_ARBITER_MODEL || 'gpt-4o-mini',
      call: function (prompt) {
        return postJson('api.openai.com', '/v1/chat/completions', { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY }, {
          model: this.model, temperature: 0.3, max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }).then(function (r) { return r && r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : null; });
      },
    });
  }
  // xAI Grok (OpenAI-compatible API)
  if (process.env.XAI_API_KEY) {
    providers.push({
      name: 'Grok', model: process.env.XAI_ARBITER_MODEL || 'grok-2-latest',
      call: function (prompt) {
        return postJson('api.x.ai', '/v1/chat/completions', { 'Authorization': 'Bearer ' + process.env.XAI_API_KEY }, {
          model: this.model, temperature: 0.3, max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }).then(function (r) { return r && r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : null; });
      },
    });
  }
  // Google Gemini
  if (process.env.GEMINI_API_KEY) {
    var gm = process.env.GEMINI_ARBITER_MODEL || 'gemini-2.0-flash';
    providers.push({
      name: 'Gemini', model: gm,
      call: function (prompt) {
        return postJson('generativelanguage.googleapis.com', '/v1beta/models/' + gm + ':generateContent?key=' + process.env.GEMINI_API_KEY, {}, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
        }).then(function (r) {
          try { return r.candidates[0].content.parts[0].text; } catch (e) { return null; }
        });
      },
    });
  }

  function isAvailable() { return providers.length > 0; }
  function names() { return providers.map(function (p) { return p.name; }); }

  // Run every available model, aggregate the votes.
  async function panel(data) {
    if (!providers.length) return null;
    var prompt = buildPrompt(data);
    var results = await Promise.all(providers.map(function (p) {
      return p.call(prompt).then(function (text) {
        var v = parseVerdict(text);
        return v ? { model: p.name, agrees: v.agrees, confidence: v.confidence, reasoning: v.reasoning } : null;
      }).catch(function () { return null; });
    }));
    var votes = results.filter(Boolean);
    if (!votes.length) return null;
    var agreeCount = votes.filter(function (v) { return v.agrees; }).length;
    var avgConf = Math.round(votes.reduce(function (s, v) { return s + v.confidence; }, 0) / votes.length);
    var majorityAgree = agreeCount > votes.length / 2;
    return {
      agrees: majorityAgree,
      disagrees: !majorityAgree && agreeCount === 0,
      confidence: avgConf,
      panelSize: votes.length,
      agreeCount: agreeCount,
      votes: votes,
      label: agreeCount + '/' + votes.length + ' models agree',
    };
  }

  console.log('[AI Arbiters] Panel models: ' + (names().join(', ') || 'none (set OPENAI_API_KEY / GEMINI_API_KEY / XAI_API_KEY)'));

  return { panel: panel, isAvailable: isAvailable, names: names };
};
