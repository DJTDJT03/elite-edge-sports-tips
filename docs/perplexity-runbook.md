# Perplexity Sonar — Operations Runbook

Last updated: 29 April 2026

---

## 1. Daily Monitoring Checklist

Check each morning after 8:45am UK (after tips generate and bulletin sends).

### Where to look

| What | Where | URL |
|------|-------|-----|
| Sonar status | Admin panel | `GET /api/admin/sonar/status` or Admin > Live Data |
| Spend ledger | Admin panel | `GET /api/analytics/quality-loop` or Admin > Selection Analytics |
| Enrichment quality | Admin dashboard | Admin > Selection Analytics > Enrichment Quality Loop |

### What to check

**1. Suppression state** (`GET /api/admin/sonar/status`)
- `state: "closed"` = normal, enrichment active
- `state: "open"` = suppressed (check why — admin disabled? rate limits? failures?)
- `state: "disabled"` = `PERPLEXITY_ENABLED=false` in Railway env

**2. Daily spend** (same endpoint, `dailySpendUsd` field)
- Normal: $0.03-$0.12/day (4 tip enrichments + 2 bulletin + 1-4 replays)
- Concern: >$0.25 = check for retry storms or replay clusters
- Blocked: "daily_cap_reached" appearing in logs = cap hit, raise or investigate

**3. Enrichment ratio** (check server logs for `[Auto-Tips] Perplexity enrichment:`)
- Normal: `3/4 tips enriched` or `4/4 tips enriched`
- Concern: `0/4 tips enriched` = Sonar down or suppressed
- OK: `2/4 tips enriched` = two cache hits or budget timeout on slow calls

**4. Quality loop** (Admin > Selection Analytics > Enrichment Quality Loop)
- First 30 days: all verdicts will be "Insufficient data" — this is normal
- After 30 days: look for signals flipping from green to red

### What "wrong" looks like

| Symptom | Likely cause | Action |
|---------|-------------|--------|
| `state: "open"` you didn't set | 3+ consecutive API failures or 3+ rate limits | Check Perplexity status page, wait 30 min for auto-recovery |
| `dailySpendUsd` > $0.30 | Replay cluster on busy race day | Normal on Saturdays; concern if on a Tuesday |
| All tips show `enrichment_skipped: "suppression_open"` | Sonar API outage | Tips still publish template-only, no subscriber impact |
| `enrichment_skipped: "budget_exceeded"` on all 4 tips | Sonar latency spike | 15s budget protected the scheduler; next run will hit cache |

---

## 2. Kill-Switch Playbook

### When to use
- Unexpected cost spike (>$0.50/day)
- Sonar returning garbage that degrades analysis quality
- Rate-limit cascade (state stuck open, retrying on every scheduler cycle)
- Any production incident where enrichment is a suspect

### How to disable (instant, no redeploy)

```bash
# Via curl (replace TOKEN with your admin JWT):
curl -X POST https://eliteedgesports.co.uk/api/admin/sonar/disable \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "cost spike investigation"}'

# Response: {"status":"disabled","message":"Sonar enrichment disabled. Tips will publish template-only."}
```

Or via the admin panel: Admin > Live Data > (future: Sonar Controls section).

### How to verify it took effect

```bash
curl https://eliteedgesports.co.uk/api/admin/sonar/status \
  -H "Authorization: Bearer TOKEN"

# Check: "state": "open"
# Check: subsequent tips in logs show [Auto-Tips] Perplexity enrichment: 0/4 tips enriched
```

### How to re-enable

```bash
curl -X POST https://eliteedgesports.co.uk/api/admin/sonar/enable \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "investigation resolved"}'
```

### Nuclear option (survives admin event table issues)

Set `PERPLEXITY_ENABLED=false` in Railway dashboard > Variables. Triggers redeploy (~60-90s). The client returns no-op for every call, zero overhead.

---

## 3. Quality-Loop Interpretation

### How to read the dashboard

The quality loop runs nightly at 3:00am UK. It answers two questions:

**Question 1 (Aggregate cards):** Do enriched tips outperform non-enriched tips?
- One card per sport (Racing, Football)
- "Enriched CLV" vs "Baseline CLV" — the delta tells you if Perplexity data correlates with better closing-line value
- A positive delta means enriched tips are getting better odds relative to the market close

**Question 2 (Signal table):** Which specific signals are earning their keep?
- Each row is a (signal, sport) pair
- "Avg CLV" = CLV of tips that had this signal
- "Baseline CLV" = CLV of enriched tips in the same sport that did NOT have this signal
- This isolates each signal's contribution — a going_update with +2.5% delta means tips with going intelligence had 2.5% better CLV than enriched tips without it

### Verdict meanings

| Verdict | Color | Meaning |
|---------|-------|---------|
| Earning its keep | Green | Signal correlates with better CLV AND better ROI |
| Mixed signal | Amber | CLV and ROI disagree — one positive, one negative, or one flat |
| Inconclusive | Grey | Delta < 0.5% in either direction — too close to call |
| No benefit — consider disabling | Red | Signal correlates with worse CLV AND worse ROI |
| Insufficient data | Grey | Fewer than 10 tips in either group — wait for more data |

### What to do when a signal turns red

**Do NOT immediately disable it.** Follow this checklist:

1. **Check sample size.** N=12 with a -0.8% delta is noise. N=80 with -2.1% is a real signal.
2. **Check sport-specific.** A signal might be red for football but green for racing. The sport partition already handles this, but double-check.
3. **Monitor for 2 weeks.** One bad week can flip a signal. Wait for the trend to stabilise.
4. **After 2 weeks of red with N>50:** Comment out the signal key in `server/services/perplexity/signalSchema.js` (remove it from `RACING_SIGNALS` or `FOOTBALL_SIGNALS`). The prompt will stop asking for it, Sonar won't return it, and it dies naturally. No other code changes needed.

### Worked example

> `manager_comments` shows red for football for 14 days straight. N=62. CLV delta -1.8%, ROI delta -3.2%.

Action:
1. In `server/services/perplexity/signalSchema.js`, remove `'manager_comments'` from `FOOTBALL_SIGNALS`
2. In `server/services/perplexity/prompts.js`, remove the manager_comments line from `buildFootballTipPrompt`
3. In `server/services/scoringModel.js`, remove the `if (sig.manager_comments)` weaving block in `_generateFootballAnalysis`
4. Commit, push, deploy. Signal stops appearing in new tips. Quality loop will show it declining in the table as old tips age out of the 90-day window.

---

## 4. Cost Calibration After Week 1

### The reconciliation

After 7 days of live enrichment, compare your Perplexity invoice to tracked spend:

```sql
SELECT
  SUM(cost_usd) AS tracked_total,
  SUM(token_cost_usd) AS tracked_token_cost,
  SUM(request_fee_usd) AS tracked_request_fees,
  COUNT(*) FILTER (WHERE cache_hit = false AND error IS NULL) AS actual_api_calls,
  AVG(search_count) FILTER (WHERE cache_hit = false AND error IS NULL) AS avg_search_count
FROM sonar_spend_ledger
WHERE date >= '2026-04-29' AND date <= '2026-05-05';
```

### If invoice > tracked by >5%

The `request_fee_usd` calculation may be wrong. Current assumption: $0.005 per search (low context), multiplied by `search_count`. Perplexity may charge per-request (flat) not per-search.

**To diagnose:**

```sql
-- Compute implied per-call fee from the gap
SELECT
  (INVOICE_AMOUNT - SUM(token_cost_usd)) / COUNT(*) FILTER (WHERE cache_hit = false AND error IS NULL) AS implied_per_call_fee
FROM sonar_spend_ledger
WHERE date >= '2026-04-29' AND date <= '2026-05-05';
```

Replace `INVOICE_AMOUNT` with the actual billed amount.

**To fix:**
1. Update `config.DEFAULT_REQUEST_FEE` to the implied per-call fee
2. If the fee is per-request (not per-search), remove the `* searchCount` multiplier in `client.js` line ~357 (the TODO comment marks the exact spot)
3. Recalculate `DAILY_CAP_USD` if the per-call cost is significantly different

---

## 5. Failure-Mode Playbook

### Sonar API outage

**What happens:** `deriveSuppressionState` detects 3+ consecutive failures, sets state to `open`. All enrichment calls return `{skipped: true, reason: "suppression_open"}`. Tips publish with template-only analysis. Email bulletins generate without Sonar context. Replays generate without post-race intelligence.

**Subscriber impact:** None. Analysis text reverts to the pre-Perplexity template. No degradation visible to users.

**Action:** None required. Suppression auto-clears after 30 minutes of no failures in the ledger. When Sonar recovers, the next scheduler cycle will succeed, state closes, enrichment resumes.

### Daily cap hit

**Symptoms:** `enrichment_skipped: "daily_cap_reached"` in logs after mid-afternoon.

**Diagnosis:**
```sql
SELECT call_site, COUNT(*), SUM(cost_usd)
FROM sonar_spend_ledger WHERE date = CURRENT_DATE
GROUP BY call_site;
```

**Decision:** If spend is from legitimate calls (busy race day), raise `config.DAILY_CAP_USD` from $0.50 to $1.00. If spend is from retry storms or a bug, investigate the error column first.

### Prompt-build error spikes

**Symptoms:** `enrichment_skipped: "prompt_build_error: ..."` in logs.

**Diagnosis:** The scored candidate is missing required fields (horseName, meeting, homeTeam, awayTeam). Check if the Racing API or Football API returned incomplete data. The tip still publishes — the error is in enrichment only.

**Action:** Check the data source. If a specific API is returning empty fields, the scoring model should also be affected (tips with missing data score poorly and get filtered out).

### Citation-grounding rejection rate spike

**Symptoms:** Quality loop shows most signals as "Insufficient data" despite N>10 enriched tips. Check `tip_enrichment` table:

```sql
SELECT low_quality, COUNT(*)
FROM tip_enrichment WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY low_quality;
```

If >80% are `low_quality = true`, Sonar is returning citations from disallowed domains or no citations at all.

**Action:** Consider upgrading one call site from `sonar` to `sonar-pro` ($3/$15 per 1M tokens, better citation quality). Update `config.DEFAULT_MODEL` or make it per-call-site. This is an A/B test — run `sonar-pro` for per-tip enrichment for a week and compare `low_quality` rates.

---

## 6. Concurrent Replay Clusters

### When they happen

Saturday afternoons, 14:00-16:00 UK time. Multiple racing tips settle within the same 5-minute autoSettleResults window. Each settled racing tip spawns a non-blocking IIFE that calls `enrichReplay()`. With 4 racing tips settling simultaneously, that's 4 parallel Sonar calls.

### What the spend ledger looks like

```sql
SELECT created_at, call_site, entity_id, cost_usd, latency_ms
FROM sonar_spend_ledger
WHERE call_site = 'replay' AND date = CURRENT_DATE
ORDER BY created_at;
```

Normal: 1-2 replay calls spread across the afternoon.
Saturday peak: 4-6 calls clustered in a 5-minute window, ~$0.03-$0.06 burst.

### When to be concerned

Sustained >$0.05 in any 5-minute window on a non-Saturday. This suggests either duplicate settlements or the IIFE is retrying when it shouldn't be.

**Action:** Check `enrichment_skipped` column — if you see `"concurrent_claim"` entries, the cache is working (second caller skipped). If you see multiple successful calls for the same entity_id, the cache key isn't matching (investigate `_tipEntityId` construction).

---

## 7. v2 TODO List

Accumulated technical debt to address in a future pass:

1. **Verify `requestFee * searchCount` against billed cost.** Perplexity may charge per-request, not per-search. If billed cost approximately equals tracked cost / avg search_count, drop the multiplier. See the TODO comment in `client.js` at the `requestFee` calculation.

2. **Add focused `_callSonar` tests.** The TODO in `test/clientHttp.test.js` lists: 429 with backoff timing verification, 500 retry, wall-clock timeout expiry, malformed JSON in 200, valid JSON missing expected shape. Current tests cover behavioural outputs but not the retry/error paths directly.

3. **Statistical significance on quality-loop deltas.** Replace the binary N>=10 threshold with confidence intervals. With N=12 the noise band is ~15-20% wide; with N=200 it's ~3%. A Welch's t-test or bootstrap CI per signal would give a p-value column alongside the verdict. Worth adding once the first signal crosses N=50.

4. **Split "bad enrichment" from "no enrichment" in aggregate comparison.** Currently, tips with `low_quality = true` enrichment fall into the `not_enriched` group (because the CASE checks `e.low_quality = false`). This means bad Sonar responses are counted as baseline, not as a third "enrichment attempted but failed" category. A three-way comparison would reveal if bad enrichment is worse than no enrichment.

5. **Reconsider domain allowlist after first month.** Query: `SELECT url, COUNT(*) FROM (SELECT jsonb_array_elements_text(citations) AS url FROM tip_enrichment WHERE low_quality = false) sub GROUP BY url ORDER BY COUNT(*) DESC LIMIT 20;`. Drop any source that produced citations but whose signals never showed a positive quality-loop delta.

6. **Run the SQL integration test against a real database.** The integration test (`test/qualityLoopIntegration.test.js`) requires `DATABASE_URL`. Run locally with `DATABASE_URL=postgresql://... npm test` or against a staging Postgres. Currently skips gracefully without DB connection.

---

## Recap

**Tests:** 106 total, 106 pass (105 unit + 1 integration skip without DB).

**Files added:**
- `server/services/perplexity/config.js` — constants, pricing, TTLs, allowlists
- `server/services/perplexity/signalSchema.js` — pure signal validators
- `server/services/perplexity/citationFilter.js` — pure citation grounding
- `server/services/perplexity/client.js` — orchestrator with retry, cache, suppression
- `server/services/perplexity/prompts.js` — pure prompt rendering
- `server/services/perplexity/qualityLoop.js` — nightly quality analysis
- `test/citationFilter.test.js`, `test/signalSchema.test.js`, `test/clientHttp.test.js`, `test/prompts.test.js`, `test/generateAnalysis.test.js`, `test/bulletinReplay.test.js`, `test/qualityLoop.test.js`, `test/qualityLoopIntegration.test.js`
- `test/fixtures/sonar-responses.js`
- `docs/perplexity-runbook.md`

**Files modified:**
- `server/db.js` — CRUD for sonar_cache, spend_ledger, admin_events, tip_enrichment, quality_snapshots
- `server/db/migrate.js` — 6 new tables
- `server/index.js` — auto-migrate + perplexityClient wired into deps
- `server/routes/admin.js` — sonar disable/enable/status endpoints
- `server/routes/analytics.js` — quality-loop endpoint
- `server/services/scheduler.js` — enrichBatch in tip generation, enrichBulletin in bulletin, enrichReplay in settlement
- `server/services/scoringModel.js` — generateAnalysis accepts enrichment signals
- `server/services/aiReports.js` — liveContext consumption in bulletin and replay
- `admin/js/analytics.js` — quality-loop dashboard section
- `package.json` — `npm test` script

**The system is now operating in observation mode for the first 30 days; no changes to scoring weights based on Sonar data until the quality loop has 30 settled days of evidence.**
