**Last session:** 2026-04-29 (mid fight-week — DM vs Prates Sat May 2). Branch: `feature/sleek-theme-v1`. Build: clean. **State:** weight-miss opp-pace amplification + sub-lean adjustment shipped. Phase 1 of analyzer.ts split started — weight-miss, news, fantasy-scoring extracted into `src/analyzer/`. Della Maddalena vs Prates still pending settle.

---

## ✅ Done this session — four commits on `feature/sleek-theme-v1`

| Hash | What | Files |
|---|---|---|
| `b26e893` | feat: weight-miss opp-pace amplification + sub-lean adjustment | analyzer.ts |
| `948212c` | refactor: extract weight-miss detection into src/analyzer/weight-miss.ts | analyzer.ts, analyzer/weight-miss.ts |
| `f737bcf` | refactor: extract news fetch + cache into src/analyzer/news.ts | analyzer.ts, analyzer/news.ts |
| `21b62bf` | refactor: extract fantasy scoring + style derivation into module | analyzer.ts, analyzer/fantasy-scoring.ts |

### 1. Weight-miss opp-pace amp + sub-lean adjustment (`b26e893`)

Two on-deck items from previous session shipped together. Refactored shared delta computation into `_computeWeightMissDeltas`.

- **Sub-lean adjustment** — new `applyWeightMissToFighter(f)` mutates `f.lean / lean_ss / lean_td / lean_ft / lean_ctrl` in place using a shadow-copy snapshot keyed by signal (idempotent across re-priming). SS/TD/FT/CTRL panel displays now reflect the weight-miss signal, not just the priority-picked effective lean. The `applyWeightMissAdjustment` call inside `_computeEffectiveLean` was removed (sub-leans are pre-adjusted now).
- **Opponent-style amplification** — `_getOppPace(fighter)` looks up opponent via `_fighterByNorm`; if `slpm + sapm ≥ 8.5`, multiplies negative `confDelta`/`avgDelta` by 1.2 and adds a "high-pace opponent amplifies cardio drain" reason. Positive (size-advantage) deltas in the grappler-on-TD branches are NOT amplified.
- **`primeCaches()` reordered** — fighter-by-name index built FIRST so opp lookups always succeed during weight-miss apply (was previously partially failing due to in-loop population order).

### 2-4. Analyzer.ts split — Phase 1a-1c (`948212c`, `f737bcf`, `21b62bf`)

Pure relocation, no behavior change. Established `src/analyzer/<module>.ts` convention matching `src/services/`, `src/types/`, `src/config/`.

| Module | LOC | What |
|---|---|---|
| `src/analyzer/weight-miss.ts` | 55 | WeightMissSeverity/Signal types, `_weightMissSignals` shared map, `severityFromLbs`, `parseWeightMissFromTitle` |
| `src/analyzer/news.ts` | 53 | NewsItem type, `_newsCache` + `_newsAlertFighters` shared state, `NEWS_INJURY_KEYWORDS`, `fetchFighterNews` (kept `fetchAllFighterNews` in analyzer.ts — orchestrates module state) |
| `src/analyzer/fantasy-scoring.ts` | 122 | HistoricalScoringPlatform type, `scoringFor`/`winBonusForPlatform`/`calcFPForPlatform`/`calcFP`/`getFightFantasyValueForPlatform`/`isFinish`/`deriveStyle` |

analyzer.ts: 17,063 → 16,874 lines. ~230 lines moved into modules (some net growth from b26e893 feature commit before the splits).

---

## Step 1 next session — verify predictor v2 lift + weight-miss outcomes (carries from 2026-04-27/28)

**Prereq:** Della Maddalena vs Prates must finish + settle first (Sat May 2 ~11 AM EST main card end).

1. 💾 backup → Settle from UFCStats → DISMISS residuals → ▶ Run Learning Cycle on the banner
2. New LEARNING SUMMARY shows avg |Δ| FP for the card
3. **Compare to Sterling/Zalal's ±31.5 baseline.** If FP |Δ| drops to ~±25 or lower, predictor v2 #1+#2 paid off.
4. **Weight-miss outcome check** — if any `⚖ MISS` badges fired during the week:
   - Verify severity tier was correct (small/moderate/big/extreme)
   - Did the lean direction match outcome?
   - Did the opp-pace amplification (if it triggered, look for "High-pace opponent..." reason in row detail) help or hurt?
   - If wildly off → tune deltas in `_computeWeightMissDeltas` at [src/analyzer.ts](src/analyzer.ts) (search for the function name).

If predictor v2 verified → queue #3 (RLM-as-calibration) + #4 (adaptive trend rate) from `project_predictor_improvements_remaining.md`.

## Step 2 next session — verify weight-miss in fight week

**Prereq:** Friday May 1 weigh-ins post + Google News indexes "missed weight" headlines.

1. Reload extension → analyzer page
2. Look for `⚖ MISS X.X LB` badges on fighter rows
3. Click the badge → news modal should open with the source headline
4. Expand the fighter's row → "Why OVER/UNDER" Top 3 Drivers should mention weight miss
5. SS / TD / FT sub-panels (if displayed for that fighter) should ALSO reflect adjusted conf/avg from `applyWeightMissToFighter` (new this session)
6. Look for the "High-pace opponent (X.X SLpM+SApM) amplifies cardio drain risk" reason — only fires when opp's slpm+sapm ≥ 8.5

**False positives:** "X infamously missed weight at UFC 200" (historical), "never missed weight" (denial), "will miss weight" (prediction). The negation regex catches obvious ones but new patterns may appear → add to `parseWeightMissFromTitle` at [src/analyzer/weight-miss.ts](src/analyzer/weight-miss.ts).

## Step 3 next session — finish Phase 1 of analyzer split

Only `venue-factors` left in Phase 1 (Betr screenshot reader was deferred to Phase 2 — too coupled, ~20 module-state dependencies).

**Phase 1d — `src/analyzer/venue-factors.ts`** (~67 lines):

- Extract `VenueFactorEntry` interface, `VENUE_DB` const, `DEFAULT_VENUE` const, `resolveVenueFactor` function from [src/analyzer.ts:292-356](src/analyzer.ts#L292-L356).
- **DO NOT extract** `currentVenueFactor` / `currentVenueLabel` mutable state — many sites mutate/read them ([src/analyzer.ts:573](src/analyzer.ts#L573), 4217-4220, 4720-4726, 5194-5200, 5363-5369, 15389-15396). Stays in analyzer.ts.
- The "VENUE FACTOR DATABASE" banner spans well past the venue stuff — only lines 292-356 are actually about venues. The rest (361-682) is event display name building, name matching, cancelled fighters, storage helpers, etc. — different concerns, leave alone.

After Phase 1d, analyzer.ts should be ~16,810 lines.

## What's on deck after Phase 1 (untouched)

1. **Predictor v2 #3 + #4** — see `project_predictor_improvements_remaining.md`. ~35 lines combined. Order matters: only after #1+#2 verified.
2. **Phase 2 split** — UI panels into `src/analyzer/panels/` (line-shop modal is 1,300 LOC), Betr screenshot reader IIFE → `init(ctx)` factory.
3. **Phase 3 split** — lean-engine, prop-predictor, prediction-enhancers, fair-value.
4. **Phase 4 split** — analyzer.ts becomes entry point only.
5. **SS_R1 settlement** — UFCStats parser pulls totals only; would need per-round splits.
6. **Weight-miss number tuning** — heuristic conf/avg deltas, calibrate after 5-10 real cases.
7. **iOS / iPhone access** — Orion Browser path or static dashboard path.

**❌ Off the list permanently:** Kelly stake sizing — user declined twice (2026-04-28 and 2026-04-29). Saved as feedback memory `feedback_no_kelly_stakes.md`. Do not propose.

---

## Pre-existing context (carried forward, persistent)

**Recent commits ahead of `origin/feature/sleek-theme-v1`** (newest first):

- `21b62bf refactor: extract fantasy scoring + style derivation` (this session)
- `f737bcf refactor: extract news fetch + cache` (this session)
- `948212c refactor: extract weight-miss detection` (this session)
- `b26e893 feat: weight-miss opp-pace amplification + sub-lean adjustment` (this session)
- `e068189 feat: weight-miss feeds into lean projection + confidence` (2026-04-28)
- `482ecc6 feat: weight-miss badge with severity tiers from news headlines` (2026-04-28)
- `81dbc1e feat: top-3 lean drivers callout in row detail panel` (2026-04-28)
- `9062b8d perf: strip render instrumentation, keep lazy-render fix` (2026-04-28)
- `836b698 feat: PrizePicks-specific scoring + Round-1 SS line plumbing` (2026-04-28)
- `ea8dac2 feat: predictor v2 — duration model + book prior + learning UX` (2026-04-27)
- `2de0dda feat: post-event CLV audit loop + RLM signal` (2026-04-26, battle-tested)

**Snapshot tags for revert:**
- `clv-rlm-v1` (2026-04-24)
- `ctrl-autofetch-v1` (2026-04-24)
- `ufcstats-matching-v3` (2026-04-20)

**Cache key:** `ufcstats_v49` (unchanged — no FighterDB schema changes this session).

**Working tree status:** clean except for `RESUME_NEXT_SESSION.md` (this file) and `.claude/settings.local.json`. All source-code changes committed.

**Mid-fight-week timeline:**
- Wed 4/29 (today, end of session) — pre-weigh-in, no weight-miss signals will fire
- Fri 5/1 — ceremonial weigh-ins; Google News will start indexing "missed weight" headlines after
- Sat 5/2 — fight day, 4 AM start, main card ends ~11 AM EST → settlement window
- Lines status today: UD/Pick6/PrizePicks SS/TD/FT only. No FP lines anywhere yet, no Betr yet, no DK either.

## Loose ends (still not blocking)

- Pick6 CTRL settlement label mismatch (`Control` vs `ctrl`) at [src/analyzer.ts:14650](src/analyzer.ts#L14650). Low-priority.
- `?`-platform records (138 unstamped) in `prop_archive_v1`. Pollutes per-platform analytics, doesn't affect display.
- Banner-vs-storage unresolved-count mismatch — **user said "don't worry about this."**
- Pick6 pickGroup polling auto-fetch still misses CTRL — see `project_pick6_pickgroup_polling_pending.md`.

## Don'ts (persistent)

- **LINE DATA IS IRREPLACEABLE.** Backup BEFORE any storage-mutating snippet.
- **NEVER bump `BETR_EVENT_DATE` or edit the hardcoded seed** to enter Betr lines.
- User is in **Chrome**. ↻ reload flushes cache.
- Betr entry: screenshot → Claude writes console snippet targeting `lines_betr_manual_v1` only.
- **DK partial coverage is normal** — not a scraper bug.
- **Skip Pick6 CTRL UNDER unless `ctrl_under_available === true`.**
- **Do not propose Kelly stakes** — user declined twice, persistent feedback memory.

---

## Resume prompt

> Reading `RESUME_NEXT_SESSION.md`. Branch `feature/sleek-theme-v1`. **State:** four commits this session — weight-miss opp-pace amp + sub-lean adjustment, plus Phase 1a-1c of analyzer.ts split (weight-miss / news / fantasy-scoring extracted into `src/analyzer/`). Della Maddalena vs Prates Sat May 2 — both predictor v2 lift validation AND first real weight-miss data still pending settle.
>
> **Branch in conversation:**
>
> - **If user reports DM vs Prates is over and ready to settle** → backup, settle, DISMISS, ▶ Run Learning Cycle. Verify (a) predictor v2 FP |Δ| vs ±31.5 baseline — target ±25 or lower; (b) any `⚖ MISS` badges that fired — severity correct, lean direction matched outcome, opp-pace amplification reason fired/helped where appropriate. If predictor v2 verified, queue #3 + #4 from `project_predictor_improvements_remaining.md`. If weight-miss numbers off, tune deltas in `_computeWeightMissDeltas`.
> - **If user reports event hasn't happened yet but it's Friday/Saturday morning** → check whether weigh-ins have posted, look for `⚖ MISS` badges, expand row to verify Top 3 Drivers + SS/TD/FT sub-panels reflect weight-miss (new this session — sub-leans are now adjusted, not just effective lean).
> - **If user reports event hasn't happened and it's not yet fight week** → on-deck: Phase 1d venue-factors split (~67 lines, queued), then Phase 2 split, then predictor #3+#4. Don't propose Kelly stakes.
> - **If user reports empty analyzer / "predictions look weird"** → check data first (no upcoming card, stale FighterDB, missing `avgTimeMins` reverts predictor v2). The new sub-lean weight-miss path mutates leans during `primeCaches` — if those mutations stack across renders, the shadow-copy idempotency in `applyWeightMissToFighter` is broken, look at `_wmKey` / `_wmOrig` snapshot logic.
> - **If user reports false-positive weight-miss badge** → update negation regex in `parseWeightMissFromTitle` — moved this session to [src/analyzer/weight-miss.ts](src/analyzer/weight-miss.ts).
