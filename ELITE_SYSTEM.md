# Elite Edge — System Engineering Log & Roadmap to "World's Best"

This document records how the tipping intelligence actually works, what was
**broken**, what has been **fixed**, and the **roadmap + open decisions** to make
the system genuinely elite, live and self-improving.

> Guardrails (do not cross without explicit sign-off): payment streams, branding,
> users/logins/accounts and the user route are OFF-LIMITS. The scoring model,
> analyst profiles, scheduler, selection filters and auto-settle are LOCKED per
> CLAUDE.md — changes to those require Darren's approval (flagged below).

---

## 1. How a football pick is actually made (end-to-end)

`scheduler.js` → for each fixture:
1. **Odds** (The Odds API) → implied 1X2 probabilities (the objective anchor).
2. **Fixtures + standings + form** (API-Football + Football-Data.org).
3. **Real xG** (Understat) attached per team.
4. **Scoring model** (`scoringModel.js`) → a `factors{}` vector.
5. **Consensus engine** (`consensusEngine.js`) — 3 agents (Tactician / Professor /
   Market) debate and make the *actual* pick + confidence.
6. **Quant model** (`quantModel.js`, Elo + Dixon-Coles) — independent probability,
   powers the "Model Read", Bankers and the value scan.
7. **Perplexity + AI arbiter** — written analysis + a small confidence nudge.

## 2. What was BROKEN (root causes of "rubbish / fake / slow")

| Problem | Root cause |
|---|---|
| "Draw" model read on every game | Quant model had **0 club ratings** — only 48 WC nations → uniform 43/27/29 → Draw everywhere. |
| Bankers / value weak | Same uninformed model underneath. |
| Not using "full power" | Real Understat **xG fetched then discarded** (consensus used an odds proxy); goals/BTTS on a proxy; "The Market" agent almost always in null-market fallback; Perplexity is post-pick prose only. |
| Not self-learning | Quant model learnt **only from World Cup** results, never club results. AutoTune ran on **all-time** data, not the mandated 14-day window; shadow-vs-published never compared; calibration advisory-only. |
| Stale standings / slow | Standings graded off near-empty early-season tables; settlement/refresh cadence not tuned for "live". |

## 3. What has been FIXED (shipped, adversarially reviewed, smoke-green)

- **Club grading (seeding).** `quantModel.seedRating` + admin `/football/admin/seed-ratings` + auto-run on boot & weekly. Pulls SportMonks standings across 14 leagues and assigns real, differentiated Elo (per-tier base = cross-league strength; PPG + goal-difference = within-league spread). When the current table is thin (< 5 games), grades from the **last completed season's final table** (full spread). Never overwrites a rating **learnt** from real results (`played > 0` guard).
- **Self-learning from results.** Every settled club result now feeds `quantModel.updateFromResult` (idempotent per fixture; skips internationals handled by the WC path). Model builds real Elo over time.
- **AutoTune fixed to the charter's 14-day rolling window** (results + loss three-strike), using `normDate()` so Postgres DATE columns actually compare (previous attempt was a silent no-op).
- **Real xG → goals/BTTS.** `scoringModel.xgSignals` turns Understat xG into genuine Over 2.5 + BTTS probabilities via Poisson (`factors.overProb`/`btts`) — match-result pick logic untouched.
- **Stopped uninformed output.** Model Read verdict + model panel + Cosmo value scan are hidden unless the model `knows()` both teams. As grades/learning land, informed reads return.

## 4. The self-learning loop (current logic)

- **Settle** (every 2 min): grade result, PnL, CLV → feed Elo (`updateFromResult`).
- **Loss-classify** (~2 min after settle): tag each loss into causal categories.
- **AutoTune** (nightly 23:00 UK): over a **trailing 14-day window**, adjust analyst
  weights/odds-ranges/markets only on a 3-strike pattern; calibration (30-day) is
  advisory. Persists analyst state + tuning log to `audit_log`.
- **Seed refresh** (weekly): re-grade unlearned clubs from standings.

## 5. Roadmap to elite (prioritised) — OPEN

1. **Live data freshness** — standings/results must refresh right after a matchday
   finalises (short server cache + post-settle standings refresh). *(safe)*
2. **Faster settlement** — tighten the settle loop + result verification so wins/
   losses post within minutes of full-time. *(safe)*
3. **Market-based "Our Take"** — de-vigged bookmaker consensus as the informed
   verdict for every fixture *today*, model read layered on. *(safe)*
4. **Wire the dead signals into the PICK** — real xG into match-result strength,
   quant goals/BTTS into consensus factors, "The Market" agent fed by persisted
   odds movement, Perplexity/injuries/lineups pre-pick. **⚠ touches locked
   scoring/consensus — needs sign-off.**
5. **Deeper grading research** — seed/refine Elo from multi-season match results
   (not just standings) + xG-adjusted ratings. *(safe)*
6. **Calibration acts** — let a sustained confidence inversion actually adjust, not
   just log. **⚠ touches locked AutoTune — needs sign-off.**
7. **Engagement** — live scores/'⚡ just settled' feed, streaks, per-league live
   tables. *(safe, no user/billing changes)*
8. **Marketing signup fields** — capture (opt-in) favourite team / sports / how
   they heard about us, on new signups only. *(additive; no change to existing
   users or the user route)*

## 6. Core changes I need Darren to approve
- Item 4 (wire real signals into match-result pick selection — changes picks).
- Item 6 (calibration auto-acts).
Everything else proceeds without touching payments, branding, users or logins.
