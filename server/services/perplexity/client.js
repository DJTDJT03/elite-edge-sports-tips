/**
 * Perplexity Sonar — Client Module
 *
 * Orchestrates: cache lookup, API call with retry, suppression state,
 * cost accounting, citation grounding, and enrichment storage.
 *
 * Env vars:
 *   PERPLEXITY_ENABLED=false  — kill switch, disables all enrichment (no init, no claims)
 *   PERPLEXITY_DRY_RUN=true   — mock responses, no API calls, pipeline still exercises
 *   PERPLEXITY_API_KEY         — required when enabled and not dry-run
 *
 * This module exports a factory: require('./client')(db) -> client object.
 */

'use strict';

var config = require('./config');
var citationFilter = require('./citationFilter');
var signalSchema = require('./signalSchema');
var prompts = require('./prompts');

// ---------------------------------------------------------------------------
// Dry-run mock response
// ---------------------------------------------------------------------------
var DRY_RUN_RESPONSE = {
  choices: [{
    message: {
      content: JSON.stringify({
        signals: {
          going_update: { value: '[DRY RUN] Going reported as good to soft', citation_index: 0 },
          stable_form: { value: '[DRY RUN] Yard in good form this month', citation_index: 0 },
        },
      }),
    },
  }],
  citations: ['https://www.racingpost.com/dry-run-fixture'],
  usage: { prompt_tokens: 100, completion_tokens: 80, search_count: 1 },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
module.exports = function createPerplexityClient(db) {
  var ENABLED = process.env.PERPLEXITY_ENABLED !== 'false';
  var DRY_RUN = process.env.PERPLEXITY_DRY_RUN === 'true';
  var API_KEY = process.env.PERPLEXITY_API_KEY || '';

  if (!ENABLED) {
    console.log('[Sonar] Disabled (PERPLEXITY_ENABLED=false)');
    return _noopClient();
  }

  if (!DRY_RUN && !API_KEY) {
    console.log('[Sonar] No API key set — enrichment disabled');
    return _noopClient();
  }

  console.log('[Sonar] Initialised' + (DRY_RUN ? ' (DRY RUN)' : '') + ' — model: ' + config.DEFAULT_MODEL);

  // In-memory suppression state, re-derived from ledger on init
  var _suppressionState = 'closed'; // 'closed' | 'open'

  // Derive on startup
  _deriveSuppressionState().then(function(state) {
    _suppressionState = state;
    if (state === 'open') console.log('[Sonar] Suppression state: OPEN (derived from ledger)');
  }).catch(function() { /* non-fatal */ });

  // Schedule cache cleanup + orphan recovery: on init + every hour (unref so tests can exit)
  _cleanupAndRecover();
  var _cleanupInterval = setInterval(_cleanupAndRecover, 60 * 60 * 1000);
  if (_cleanupInterval.unref) _cleanupInterval.unref();

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  /**
   * Enrich a single tip with Perplexity Sonar context.
   *
   * Cache flow:
   * 1. Check cache for completed response -> return cached data (cost_usd = 0)
   * 2. Check for pending claim -> if 'in_flight', IMMEDIATELY return
   *    {skipped: true, reason: 'concurrent_claim'}. No retry, no wait.
   *    A ledger row is written with cost_usd = 0, enrichment_skipped = 'concurrent_claim'.
   *    The tip publishes with template-only analysis.
   * 3. If 'stale', reclaim the row and proceed to API call.
   * 4. If 'none', claim the row and proceed to API call.
   *
   * Abandoned promises (from budget_exceeded in enrichBatch) continue running
   * in the background and will incur cost and populate sonar_cache. The abandoned
   * tip publishes template-only, but the cache fills and subsequent tips or
   * bulletin/replay calls benefit. The daily cap reflects these calls.
   *
   * @param {object} scored - The scored candidate object
   * @param {string} sport - 'racing' or 'football'
   * @param {string} tipId - The tip ID for ledger/enrichment linking
   * @returns {Promise<{signals: object, citations: Array, skipped: boolean, reason?: string, enrichmentId?: number}>}
   */
  async function enrichTip(scored, sport, tipId) {
    // Check suppression
    if (_suppressionState === 'open') {
      return _skipResult('suppression_open', 'per-tip', tipId);
    }

    // Check daily cap
    var dailySpend = await db.getDailySpend();
    if (dailySpend >= config.DAILY_CAP_USD) {
      return _skipResult('daily_cap_reached', 'per-tip', tipId);
    }

    // Build cache key
    var entityId = _tipEntityId(scored, sport);
    var ttl = _getTTL(sport, 'per-tip');
    var timeBucket = Math.floor(Date.now() / (ttl * 1000));
    var cacheKey = 'per-tip:' + entityId + ':' + timeBucket;

    // 1. Cache hit?
    var cached = await db.getSonarCache(cacheKey);
    if (cached) {
      _logSpend({ callSite: 'per-tip', entityId: entityId, tipId: tipId, cacheHit: true });
      return _enrichmentFromCache(cached, sport, tipId);
    }

    // 2. Claim check — skip-and-defer on concurrent claim
    var claimStatus = await db.checkSonarClaim(cacheKey, config.STALE_THRESHOLD_MS);
    if (claimStatus === 'in_flight') {
      return _skipResult('concurrent_claim', 'per-tip', tipId);
    }
    if (claimStatus === 'stale') {
      await db.reclaimStaleSonarCache(cacheKey, config.STALE_THRESHOLD_MS);
    } else {
      var claimed = await db.claimSonarCache(cacheKey, 'per-tip', entityId, timeBucket, ttl);
      if (!claimed) {
        return _skipResult('claim_failed', 'per-tip', tipId);
      }
    }

    // 3. Build prompt from templates and call Sonar
    var promptObj;
    try {
      promptObj = sport === 'racing'
        ? prompts.buildRacingTipPrompt(scored)
        : prompts.buildFootballTipPrompt(scored);
    } catch (promptErr) {
      return _skipResult('prompt_build_error: ' + promptErr.message, 'per-tip', tipId);
    }
    var result = await _callSonar(promptObj, promptObj.callSiteKey, entityId, tipId);

    if (result.error) {
      _updateSuppressionOnFailure(result.error);
      return _skipResult('api_error: ' + result.error, 'per-tip', tipId);
    }

    // 4. Process response
    var processed = _processResponse(result, sport);

    // 5. Complete cache
    await db.completeSonarCache(
      cacheKey, result.rawContent, processed.validCitations,
      result.inputTokens, result.outputTokens, result.searchCount, result.latencyMs
    );

    // 6. Enrichment data returned to caller — NOT written to tip_enrichment yet.
    // The caller (scheduler) writes to tip_enrichment AFTER the tip exists in
    // the tips table, because tip_enrichment.tip_id is a FK to tips(id).
    var enrichmentData = {
      callSite: 'per-tip',
      rawResponse: result.rawBody,
      extractedSignals: processed.grounded,
      citations: processed.validCitations,
      droppedClaims: processed.allDropped,
      lowQuality: processed.lowQuality,
      parseError: processed.parseError,
      usedInDecision: false,
      sonarModel: config.DEFAULT_MODEL,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      searchCount: result.searchCount,
      requestFeeUsd: result.requestFee,
      latencyMs: result.latencyMs,
    };

    // 7. Update suppression on success
    _suppressionState = 'closed';

    return {
      signals: processed.grounded,
      citations: processed.validCitations,
      skipped: false,
      lowQuality: processed.lowQuality,
      parseError: processed.parseError,
      enrichmentData: enrichmentData,
    };
  }

  /**
   * Enrich a batch of tips in parallel with a hard latency budget.
   *
   * Uses harvest-on-resolve: results are stored as they land. Only tips still
   * pending at the budget cutoff get enrichment_skipped: 'budget_exceeded'.
   * Abandoned promises continue running in the background — they incur cost
   * and populate sonar_cache, but the tip publishes template-only.
   *
   * @param {Array} items - [{scored, sport, tipId}]
   * @returns {Promise<Map<string, object>>} Map of tipId -> enrichment result
   */
  async function enrichBatch(items) {
    if (!items || items.length === 0) return new Map();

    var results = new Map();
    var budgetExpired = false;

    // Launch all enrichments in parallel
    var promises = items.map(function(item) {
      return enrichTip(item.scored, item.sport, item.tipId)
        .then(function(result) {
          // Only store if budget hasn't expired yet for this tip.
          // After budget expires, late-arriving results are discarded
          // (the promise continues running and populates sonar_cache,
          // but we don't overwrite the budget_exceeded entry).
          if (!budgetExpired || !results.has(item.tipId)) {
            results.set(item.tipId, result);
          }
        })
        .catch(function(err) {
          if (!budgetExpired || !results.has(item.tipId)) {
            results.set(item.tipId, { skipped: true, reason: 'error: ' + err.message, signals: {}, citations: [] });
          }
        });
    });

    // Race against budget — resolve when all complete OR budget expires
    await new Promise(function(resolve) {
      Promise.all(promises).then(resolve);
      setTimeout(resolve, config.ENRICHMENT_BUDGET_MS);
    });

    // Mark budget as expired, then fill in any tips that didn't resolve in time
    budgetExpired = true;
    items.forEach(function(item) {
      if (!results.has(item.tipId)) {
        results.set(item.tipId, { skipped: true, reason: 'budget_exceeded', signals: {}, citations: [] });
        _logSpend({ callSite: 'per-tip', entityId: item.tipId, tipId: item.tipId, enrichmentSkipped: 'budget_exceeded' });
      }
    });

    return results;
  }

  /**
   * Fetch contextual intelligence for the daily email bulletin.
   * Two queries: one for racing context, one for football.
   *
   * @param {Array} tips - Today's tips
   * @param {object} results - Yesterday's results summary
   * @returns {Promise<{racing: string|null, football: string|null}>}
   */
  async function enrichBulletin(tips, results) {
    if (_suppressionState === 'open') return { racing: null, football: null };

    var racingTips = tips.filter(function(t) { return t.sport === 'racing'; });
    var footballTips = tips.filter(function(t) { return t.sport === 'football'; });

    var racingContext = null;
    var footballContext = null;

    if (racingTips.length > 0) {
      try {
        var rPromptObj = prompts.buildBulletinRacingPrompt(racingTips);
        var rResult = await _callSonar(rPromptObj, 'bulletin', 'racing-daily', null);
        if (!rResult.error && rResult.rawContent) {
          racingContext = typeof rResult.rawContent === 'string' ? rResult.rawContent : JSON.stringify(rResult.rawContent);
        }
      } catch (e) { /* prompt build failed — skip racing context */ }
    }

    if (footballTips.length > 0) {
      try {
        var fPromptObj = prompts.buildBulletinFootballPrompt(footballTips);
        var fResult = await _callSonar(fPromptObj, 'bulletin', 'football-daily', null);
        if (!fResult.error && fResult.rawContent) {
          footballContext = typeof fResult.rawContent === 'string' ? fResult.rawContent : JSON.stringify(fResult.rawContent);
        }
      } catch (e) { /* prompt build failed — skip football context */ }
    }

    return { racing: racingContext, football: footballContext };
  }

  /**
   * Fetch post-race context for AI replay generation.
   *
   * @param {object} replayData - {selection, meeting, raceTime, result, going, ...}
   * @returns {Promise<string|null>} Context string or null
   */
  async function enrichReplay(replayData) {
    if (_suppressionState === 'open') return null;

    var promptObj;
    try { promptObj = prompts.buildReplayPrompt(replayData); }
    catch (e) { return null; }
    var entityId = (replayData.meeting + '-' + replayData.selection).toLowerCase().replace(/[^a-z0-9]/g, '-');
    var result = await _callSonar(promptObj, 'replay', entityId, null);

    if (result.error || !result.rawContent) return null;
    return typeof result.rawContent === 'string' ? result.rawContent : JSON.stringify(result.rawContent);
  }

  /**
   * Explain why odds have shortened for a selection.
   * Returns a one-sentence explanation with citation, or null.
   *
   * @param {object} data - {selection, event, sport, openPrice, currentPrice, changePct}
   * @returns {Promise<string|null>}
   */
  async function explainOddsMovement(data) {
    if (_suppressionState === 'open') return null;

    var promptObj;
    try { promptObj = prompts.buildOddsExplainerPrompt(data); }
    catch (e) { return null; }
    var entityId = ('odds-' + (data.selection || '')).toLowerCase().replace(/[^a-z0-9]/g, '-');
    var result = await _callSonar(promptObj, 'odds-explainer', entityId, null);

    if (result.error || !result.rawContent) return null;
    var text = typeof result.rawContent === 'string' ? result.rawContent : JSON.stringify(result.rawContent);
    // Filter out the "no reason found" response
    if (text.toLowerCase().indexOf('no confirmed reason found') !== -1) return null;
    return text.trim();
  }

  /**
   * Get current suppression state.
   * @returns {string} 'open' or 'closed'
   */
  function getState() {
    return _suppressionState;
  }

  /**
   * Force suppression state (used by admin endpoints).
   * @param {string} state - 'open' or 'closed'
   */
  function setState(state) {
    _suppressionState = state;
  }

  // =========================================================================
  // INTERNAL: Sonar API call with retry
  // =========================================================================

  /**
   * Call Sonar API with retry and backoff.
   *
   * @param {object|string} promptObj - Either {system, user, callSiteKey} from prompts.js,
   *   or a plain string (legacy, used by bulletin/replay until migrated)
   * @param {string} callSite - Call site identifier for logging/budgeting
   * @param {string} entityId - Entity identifier for cache/ledger
   * @param {string} tipId - Tip ID for ledger linking (null for bulletin/replay)
   */
  async function _callSonar(promptObj, callSite, entityId, tipId) {
    var startMs = Date.now();

    // Resolve prompt object vs legacy string
    var messages;
    var callSiteKey;
    if (typeof promptObj === 'object' && promptObj.system) {
      messages = [
        { role: 'system', content: promptObj.system },
        { role: 'user', content: promptObj.user },
      ];
      callSiteKey = promptObj.callSiteKey || callSite;
    } else {
      // Legacy: plain string prompt (bulletin/replay until migrated in D3/D4)
      messages = [{ role: 'user', content: String(promptObj) }];
      callSiteKey = callSite;
    }

    var maxTokens = (config.TOKEN_BUDGET[callSiteKey] || {}).maxOutput || 600;
    var temperature = config.TEMPERATURE[callSiteKey];
    if (temperature === undefined) temperature = 0;

    // Dry-run mode
    if (DRY_RUN) {
      var dryLatency = 50;
      _logSpend({
        callSite: callSite, entityId: entityId, tipId: tipId,
        inputTokens: 100, outputTokens: 80, searchCount: 1,
        tokenCostUsd: 0, requestFeeUsd: 0, costUsd: 0,
        latencyMs: dryLatency, enrichmentSkipped: 'dry_run',
      });
      return {
        rawBody: DRY_RUN_RESPONSE,
        rawContent: JSON.parse(DRY_RUN_RESPONSE.choices[0].message.content),
        citations: DRY_RUN_RESPONSE.citations || [],
        inputTokens: 100,
        outputTokens: 80,
        searchCount: 1,
        requestFee: 0,
        latencyMs: dryLatency,
        error: null,
      };
    }

    var lastError = null;
    var attempts = config.MAX_RETRIES + 1;

    for (var attempt = 0; attempt < attempts; attempt++) {
      try {
        var response = await _httpPost(config.API_ENDPOINT, {
          model: config.DEFAULT_MODEL,
          messages: messages,
          max_tokens: maxTokens,
          temperature: temperature,
          return_citations: true,
          search_context_size: 'low',
        }, config.TIMEOUT_MS);

        var latencyMs = Date.now() - startMs;

        // Parse usage
        var usage = response.usage || {};
        var inputTokens = usage.prompt_tokens || 0;
        var outputTokens = usage.completion_tokens || 0;
        var searchCount = usage.search_count || 1;

        // Compute cost.
        // Sonar's usage response includes prompt_tokens, completion_tokens, and search_count
        // but does NOT include the request fee. We hardcode based on search_context_size
        // which we always set to 'low' ($5/1K requests = $0.005/request).
        // If we ever switch to 'medium' ($0.008) or 'high' ($0.012), update config.DEFAULT_REQUEST_FEE.
        var tokenCost = ((inputTokens * config.COST_PER_M_INPUT) + (outputTokens * config.COST_PER_M_OUTPUT)) / 1000000;
        // TODO: verify against billed cost after week 1 — Perplexity may charge per request, not per search.
        // If billed cost ≈ tracked cost / avg search_count, drop the multiplier.
        var requestFee = config.DEFAULT_REQUEST_FEE * searchCount;
        var totalCost = tokenCost + requestFee;

        // Log spend
        _logSpend({
          callSite: callSite, entityId: entityId, tipId: tipId,
          model: config.DEFAULT_MODEL, inputTokens: inputTokens, outputTokens: outputTokens,
          searchCount: searchCount, tokenCostUsd: tokenCost, requestFeeUsd: requestFee,
          costUsd: totalCost, latencyMs: latencyMs,
        });

        // Extract content
        var content = null;
        try {
          var messageContent = response.choices && response.choices[0] && response.choices[0].message
            ? response.choices[0].message.content : null;
          if (messageContent) {
            try { content = JSON.parse(messageContent); }
            catch (e) { content = messageContent; } // non-JSON text response
          }
        } catch (e) { /* parse failure handled below */ }

        return {
          rawBody: response,
          rawContent: content,
          citations: response.citations || [],
          inputTokens: inputTokens,
          outputTokens: outputTokens,
          searchCount: searchCount,
          requestFee: requestFee,
          latencyMs: latencyMs,
          error: null,
        };

      } catch (err) {
        lastError = err.message || 'unknown error';
        // Don't retry on 4xx (except 429)
        if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
          break;
        }
        // Retry on 429, 5xx, timeout
        if (attempt < attempts - 1) {
          await _sleep(1000 * (attempt + 1)); // linear backoff: 1s, 2s
        }
      }
    }

    // All attempts failed
    var failLatency = Date.now() - startMs;
    _logSpend({
      callSite: callSite, entityId: entityId, tipId: tipId,
      latencyMs: failLatency, error: lastError,
    });

    return { rawBody: null, rawContent: null, citations: [], inputTokens: 0, outputTokens: 0,
             searchCount: 0, requestFee: 0, latencyMs: failLatency, error: lastError };
  }

  // =========================================================================
  // INTERNAL: HTTP POST with timeout
  // =========================================================================

  /**
   * HTTP POST with hard total timeout.
   * Uses req.setTimeout (socket idle timeout) AND a setTimeout guard
   * (total wall-clock timeout) to handle slow-drip responses that keep
   * the socket alive but never complete.
   */
  function _httpPost(url, body, timeoutMs) {
    return new Promise(function(resolve, reject) {
      var https = require('https');
      var urlObj = new URL(url);
      var payload = JSON.stringify(body);
      var settled = false;

      function settle(fn, arg) {
        if (settled) return;
        settled = true;
        clearTimeout(wallTimer);
        fn(arg);
      }

      var opts = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + API_KEY,
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      var req = https.request(opts, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { settle(resolve, JSON.parse(data)); }
            catch (e) {
              var err = new Error('Malformed JSON in 200 response');
              err.statusCode = 200;
              settle(reject, err);
            }
          } else {
            var err2 = new Error('HTTP ' + res.statusCode + ': ' + data.slice(0, 200));
            err2.statusCode = res.statusCode;
            settle(reject, err2);
          }
        });
      });

      // Socket-level idle timeout
      req.setTimeout(timeoutMs, function() {
        req.destroy();
        settle(reject, new Error('Socket timeout after ' + timeoutMs + 'ms'));
      });

      // Hard wall-clock timeout — catches slow-drip responses
      var wallTimer = setTimeout(function() {
        req.destroy();
        settle(reject, new Error('Wall-clock timeout after ' + timeoutMs + 'ms'));
      }, timeoutMs);

      req.on('error', function(err) { settle(reject, err); });
      req.write(payload);
      req.end();
    });
  }

  // =========================================================================
  // INTERNAL: Response processing (citation filter + signal extraction)
  // =========================================================================

  function _processResponse(result, sport) {
    // Parse error — store raw, flag, bail
    if (!result.rawContent || typeof result.rawContent === 'string') {
      return {
        grounded: {},
        validCitations: [],
        allDropped: [],
        lowQuality: true,
        parseError: !result.rawContent,
      };
    }

    // Extract signals
    var extracted = signalSchema.extractSignals(result.rawContent, sport);
    if (!extracted.valid) {
      return {
        grounded: {},
        validCitations: [],
        allDropped: [],
        lowQuality: true,
        parseError: true,
      };
    }

    // Filter citations
    var citations = (result.citations || []).map(function(c, i) {
      return { url: typeof c === 'string' ? c : (c && c.url) || '', index: i };
    });
    var citationResult = citationFilter.filterCitations(citations, sport);

    // Ground signals against valid citations
    var groundResult = citationFilter.groundSignals(extracted.signals, citationResult.valid);

    // Assess quality
    var quality = citationFilter.assessQuality({
      totalSignals: Object.keys(extracted.signals).length,
      groundedCount: Object.keys(groundResult.grounded).length,
      droppedCount: groundResult.dropped.length,
      validCitationCount: citationResult.valid.length,
      totalCitations: citations.length,
    });

    return {
      grounded: groundResult.grounded,
      validCitations: citationResult.valid,
      allDropped: groundResult.dropped.concat(citationResult.dropped),
      lowQuality: quality.lowQuality,
      parseError: false,
    };
  }

  // =========================================================================
  // INTERNAL: Suppression state
  // =========================================================================

  /**
   * Derive suppression state from recent spend ledger rows.
   *
   * This is NOT a standard circuit breaker — there is no half-open probe transition.
   * "Open" (suppressed) auto-clears after SUPPRESSION_WINDOW_MINUTES of no recent
   * failures in the ledger. On process restart, state is re-derived from the ledger
   * so a deploy cannot silently reset an open suppression.
   *
   * Admin markers (admin_disabled / admin_enabled) take precedence over failure-based
   * suppression. If the most recent admin marker is 'admin_disabled', suppression is
   * forced open regardless of failure history, until an 'admin_enabled' marker is written.
   *
   * @returns {Promise<string>} 'open' or 'closed'
   */
  async function _deriveSuppressionState() {
    if (!db || !db.isAvailable()) return 'closed';
    try {
      // Check admin events first (highest priority) — separate table, not spend ledger
      var adminEvent = await db.getLatestSonarAdminEvent();
      if (adminEvent && adminEvent.action === 'disabled') return 'open';
      // admin 'enabled' or no admin event — fall through to failure-based check

      // Failure-based: check last N rows in window
      var windowMin = config.SUPPRESSION_WINDOW_MINUTES;
      var recent = await db.query(
        "SELECT error, enrichment_skipped, created_at FROM sonar_spend_ledger WHERE cache_hit = false AND created_at > NOW() - make_interval(mins => $1) ORDER BY created_at DESC LIMIT 10",
        [windowMin]
      );

      if (recent.rows.length === 0) return 'closed';

      // 3+ consecutive failures
      var consecutive = 0;
      for (var i = 0; i < recent.rows.length; i++) {
        if (recent.rows[i].error) consecutive++; else break;
      }
      if (consecutive >= config.SUPPRESSION_FAILURE_THRESHOLD) return 'open';

      // 3+ rate limits in window
      var rateLimits = recent.rows.filter(function(r) {
        return r.error && r.error.indexOf('429') !== -1;
      });
      if (rateLimits.length >= config.SUPPRESSION_RATE_LIMIT_THRESHOLD) return 'open';

      return 'closed';
    } catch (e) {
      console.error('[Sonar] Suppression state derivation failed:', e.message);
      return 'closed'; // fail-open: allow calls if we can't check
    }
  }

  function _updateSuppressionOnFailure(error) {
    // Quick in-memory check: if this is a rate limit, suppress immediately
    if (error && error.indexOf('429') !== -1) {
      _suppressionState = 'open';
      console.log('[Sonar] Suppression: OPEN (rate limited)');
    }
    // Full re-derivation happens async
    _deriveSuppressionState().then(function(state) { _suppressionState = state; }).catch(function() {});
  }

  // Prompt templates moved to prompts.js (pure module, tested separately)

  // =========================================================================
  // INTERNAL: Helpers
  // =========================================================================

  function _tipEntityId(scored, sport) {
    if (sport === 'racing') {
      var r = scored.runner || {};
      var race = scored.race || {};
      return ('racing-' + (race.meeting || '') + '-' + (r.horseName || '')).toLowerCase().replace(/[^a-z0-9]/g, '-');
    } else {
      var f = scored.fixture || {};
      return ('football-' + (f.homeTeam || '') + '-v-' + (f.awayTeam || '')).toLowerCase().replace(/[^a-z0-9]/g, '-');
    }
  }

  function _getTTL(sport, callSite) {
    if (callSite === 'replay') return config.TTL_LOW;
    // Per-tip: going/non-runner = high volatility; stable form = medium
    // Use high for per-tip since race-day info changes fast
    return config.TTL_HIGH;
  }

  // _sanitize removed — replaced by prompts._slot / prompts._optSlot

  async function _skipResult(reason, callSite, tipId) {
    _logSpend({ callSite: callSite, entityId: tipId || '', tipId: tipId, enrichmentSkipped: reason });
    return { signals: {}, citations: [], skipped: true, reason: reason };
  }

  function _logSpend(data) {
    try {
      db.recordSonarSpend({
        callSite: data.callSite || 'unknown',
        entityId: data.entityId || null,
        model: data.model || config.DEFAULT_MODEL,
        inputTokens: data.inputTokens || 0,
        outputTokens: data.outputTokens || 0,
        searchCount: data.searchCount || 0,
        tokenCostUsd: data.tokenCostUsd || 0,
        requestFeeUsd: data.requestFeeUsd || 0,
        costUsd: data.costUsd || 0,
        tipId: data.tipId || null,
        bulletinId: data.bulletinId || null,
        latencyMs: data.latencyMs || null,
        cacheHit: data.cacheHit || false,
        enrichmentSkipped: data.enrichmentSkipped || null,
        error: data.error || null,
      }).catch(function(e) { console.error('[Sonar] Ledger write failed:', e.message); });
    } catch (e) { /* non-fatal */ }
  }

  function _enrichmentFromCache(cached, sport, tipId) {
    var content = cached.response_json;
    if (!content) return { signals: {}, citations: [], skipped: false, lowQuality: true };
    var processed = _processResponse({
      rawContent: content,
      citations: cached.citations || [],
    }, sport);
    return {
      signals: processed.grounded,
      citations: processed.validCitations,
      skipped: false,
      lowQuality: processed.lowQuality,
      parseError: processed.parseError,
    };
  }

  function _cleanupAndRecover() {
    if (!db || !db.isAvailable()) return;
    // Clean expired cache rows
    db.cleanExpiredSonarCache().catch(function(e) {
      console.error('[Sonar] Cache cleanup failed:', e.message);
    });
    // Backfill orphaned enrichment links — tips that have a tip_enrichment row
    // but no enrichment_id set (e.g. after a mid-run crash between createTipEnrichment
    // and updateTip). Idempotent, cheap single UPDATE.
    _backfillOrphanEnrichmentLinks();
  }

  async function _backfillOrphanEnrichmentLinks() {
    if (!db || !db.isAvailable()) return;
    try {
      var result = await db.query(
        'UPDATE tips t SET enrichment_id = e.id FROM tip_enrichment e WHERE e.tip_id = t.id AND t.enrichment_id IS NULL'
      );
      if (result.rowCount > 0) {
        console.log('[Sonar] Backfilled ' + result.rowCount + ' orphaned enrichment link(s)');
      }
    } catch (e) {
      // Non-fatal — table may not exist yet on first deploy
    }
  }

  function _sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  // =========================================================================
  // Return public interface
  // =========================================================================
  return {
    enrichTip: enrichTip,
    enrichBatch: enrichBatch,
    enrichBulletin: enrichBulletin,
    enrichReplay: enrichReplay,
    explainOddsMovement: explainOddsMovement,
    getState: getState,
    setState: setState,
    deriveSuppressionState: _deriveSuppressionState,
  };
};

// ---------------------------------------------------------------------------
// No-op client (when disabled or no API key)
// ---------------------------------------------------------------------------
function _noopClient() {
  var noop = { signals: {}, citations: [], skipped: true, reason: 'disabled' };
  return {
    enrichTip: function() { return Promise.resolve(noop); },
    enrichBatch: function() { return Promise.resolve(new Map()); },
    enrichBulletin: function() { return Promise.resolve({ racing: null, football: null }); },
    enrichReplay: function() { return Promise.resolve(null); },
    explainOddsMovement: function() { return Promise.resolve(null); },
    getState: function() { return 'disabled'; },
    setState: function() {},
    deriveSuppressionState: function() { return Promise.resolve('disabled'); },
  };
}
