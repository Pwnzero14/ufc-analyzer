**Last session:** 2026-04-30 (mid fight-week — DM vs Prates Sat May 2, weigh-ins Fri May 1). Branch: `feature/sleek-theme-v1`. Build: clean. **State:** two main-event-related fixes shipped (5R math + row pairing) + Learning Summary visual polish; UFC 314 Betr lines entered (24 fighters). Branch is now **37 ahead of origin**. Project snapshot saved to `backups/full_project_snapshot_20260430_135140/`. Analyzer-only snapshot (post-polish) saved to `backups/analyzer_snapshot_20260430_220052/`.

---

## ✅ Done this session — four commits

| Hash | What | Files |
|---|---|---|
| `7d0dfa4` | fix: detect main event by parsing event title, not card position | analyzer.ts |
| `35a9291` | fix: order fighter rows by UFCStats card sequence so badges land correctly | analyzer.ts |
| `40a3e9a` | feat: polish learning summary with stat chips and magnitude bars | analyzer.ts |
| (uncommitted) | Betr lines entered for UFC 314 via `lines_betr_manual_v1` | (storage only, no source change) |

### Polish — Learning Summary panel (`40a3e9a`)

Cosmetic only, post-fight verification surface. Avg |Δ| triplet → 3 stat cards with color-coded left-border (green <8, amber <16, red ≥16). Best/Worst → pill badges. Per-fighter delta rows get a magnitude bar (width = totalErr/45 × 100% capped) plus tabular-nums alignment + subtle hover background. Two edits in `renderPredictionsHtml` around `analyzer.ts` ~L7990 and ~L8021. Will see it Sat post-DM/Prates settle when ▶ Run Learning Cycle fires.

### Fix #1 — title-based main-event detection (`7d0dfa4`)

Three call sites previously used `upcomingCardPairs[length-1]` as "main event". UFCStats event-page fight ordering is not reliably "prelims first, main event last" for upcoming events, so JDM/Prates was incorrectly tagged 3R despite being UFC 314's main event. New helper [`findHeadlinerPair()`](src/analyzer.ts#L533-L555) parses `"X vs Y"` from `upcomingEventName || inferredEventNameFromLines` and matches against `upcomingCardPairs` using `strictCardNameMatch` / `namesMatch`. Replaces positional inference at:
- [`getScheduledRoundsContext`](src/analyzer.ts#L1799-L1801)
- [`generatePredictions` loop](src/analyzer.ts#L7838-L7844)
- [`buildFighterRow`](src/analyzer.ts#L11843-L11848)

### Fix #2 — card-order row pairing (`35a9291`)

Badge logic in `renderFighters` is positional (`Math.floor(i / 2)` → fight index). Assumes `activeFighters` arrives card-ordered with each fight's two fighters at adjacent indices, but the upstream sort produced Pick6/UD scrape order. Result: Tim Elliott + Wes Schultz (don't fight each other) appeared as MAIN EVENT pair. New helper [`orderFightersByCard`](src/analyzer.ts#L5596-L5625) reorders by `upcomingCardPairs` (UFCStats source of truth) using namesMatch fallback for naming variants like Cam vs Cameron Rowston. Applied only when `currentSort === 'default'` ([analyzer.ts:10295-10300](src/analyzer.ts#L10295-L10300)).

### Betr UFC 314 lines

24 fighters in `lines_betr_manual_v1` — 22 SS, 7 FP, 0 TD, 0 FT. Workflow followed correctly: BACKUP → read-only diagnostic → confirmed `lines_open_v1` betr opener count was 0 → mutation snippet → F5. JDM/Prates SS only (FP not posted at write time — edit via row-edit modal if/when posted).

---

## 🚨 START NEXT SESSION HERE — depends on timing

### If user reports DM vs Prates is over and ready to settle (Sat May 2 ~11 AM EST or later)

1. 💾 BACKUP first (always)
2. Settle from UFCStats → DISMISS residuals → ▶ Run Learning Cycle
3. New LEARNING SUMMARY shows avg |Δ| FP for the card
4. **Compare to Sterling/Zalal's ±31.5 baseline.** If FP |Δ| drops to ~±25 or lower, predictor v2 #1+#2 (duration model + book prior) paid off.
5. **Weight-miss outcome check** — if any `⚖ MISS` badges fired during the week:
   - Verify severity tier was correct (small/moderate/big/extreme)
   - Did the lean direction match outcome?
   - Did the opp-pace amplification ("High-pace opponent..." reason) help or hurt?
   - If wildly off → tune deltas in `_computeWeightMissDeltas` at [src/analyzer.ts](src/analyzer.ts).
6. If predictor v2 verified → queue **#3 RLM-as-calibration + #4 adaptive trend rate** from `project_predictor_improvements_remaining.md` (~35 lines combined).

### If user reports it's Friday/Saturday morning but fight hasn't happened yet

1. Check whether weigh-ins have posted on Google News
2. Look for `⚖ MISS X.X LB` badges on fighter rows
3. Click badge → news modal should open with source headline
4. Expand row → Top 3 Drivers should mention weight miss
5. SS / TD / FT sub-panels should ALSO reflect adjusted conf/avg (sub-leans pre-adjusted, not just effective lean)
6. Look for "High-pace opponent (X.X SLpM+SApM) amplifies cardio drain risk" reason (only fires when opp's slpm+sapm ≥ 8.5)

**False positives:** "X infamously missed weight at UFC 200" (historical), "never missed weight" (denial), "will miss weight" (prediction). Add new patterns to `parseWeightMissFromTitle` at [src/analyzer/weight-miss.ts](src/analyzer/weight-miss.ts).

### If user reports Betr line movement during fight week

Use **BETR LINES modal row-edit** (preserves openLine for movement chips). Do NOT re-run the bulk write snippet — that resets openLines.

### If event hasn't happened and it's not yet fight week (post-DM/Prates session, before next event)

Phase 1 of analyzer.ts split is done (8 modules out, no pure-relocation chunks left worth grabbing). Next on-deck:

**Phase 2 (post-fight territory):**
- Betr screenshot reader IIFE (~230 LOC, lines ~16,082-16,312) — refactor into `init(ctx)` factory taking `storageGet/Set`, `mergeAndEnrich`, `openingLineKey`, `syncUpcomingCardContext`, `runtimeSendMessage` + ~20 module-state vars as deps. **High risk** — touches irreplaceable Betr line data flow.
- UI panels into `src/analyzer/panels/` — line-shop modal alone is ~1,300 lines. DOM-coupled.

**Phase 3 (later):** lean-engine.ts (~1,100 LOC), prop-predictor.ts (~2,700 LOC), prediction-enhancers.ts (~1,500 LOC), fair-value.ts (~1,400 LOC).

**Medium-risk targets (deferrable, post-fight):**
- UFC STATS FETCH (~187 LOC, lines 853-1040) — `fetchFromUFCStats` + `fetchFighterStats`, has cache + reads `window.fighterStatsCache`
- CANCELLED FIGHTERS subsystem (~150 LOC, lines 290-446) — discrete subsystem but mutates module-state Set + writes `chrome.storage`

### If user reports empty analyzer / "predictions look weird"

Check data first (no upcoming card, stale FighterDB, missing `avgTimeMins` reverts predictor v2). The sub-lean weight-miss path mutates leans during `primeCaches` — if those mutations stack across renders, the shadow-copy idempotency in `applyWeightMissToFighter` is broken, look at `_wmKey` / `_wmOrig` snapshot logic.

### If user reports false-positive weight-miss badge

Update negation regex in `parseWeightMissFromTitle` at [src/analyzer/weight-miss.ts](src/analyzer/weight-miss.ts).

### If user reports a regression in main-event handling

The fix at `7d0dfa4` depends on `upcomingEventName || inferredEventNameFromLines` containing the `"X vs Y"` suffix. If `findHeadlinerPair()` returns null for an actual main event, the title may not match the regex `/:\s*(.+?)\s+vs\.?\s+(.+)$/i`. Diagnose with `console.log(findHeadlinerPair(), upcomingEventName, inferredEventNameFromLines)` in the analyzer console.

### If user reports row pairing regression

The fix at `35a9291` depends on `upcomingCardPairs` being populated. If the analyzer shows fighters not in card order, check `upcomingCardPairs.length` and that `currentSort === 'default'` (user-selected sorts intentionally bypass card-order).

---

## Current commit ladder ahead of `origin/feature/sleek-theme-v1` (newest first)

- `40a3e9a feat: polish learning summary with stat chips and magnitude bars` *(this session)*
- `35a9291 fix: order fighter rows by UFCStats card sequence so badges land correctly` *(this session)*
- `7d0dfa4 fix: detect main event by parsing event title, not card position` *(this session)*
- `0323a41 refactor: extract analytics helpers (Phase 1h)` (2026-04-30)
- `0b03af2 refactor: extract HTML parsers (Phase 1g)` (2026-04-30)
- `1a518ec refactor: extract style matchup matrix (Phase 1f)` (2026-04-29)
- `c648ad7 refactor: extract fighter image fetcher (Phase 1e)` (2026-04-29)
- `43f0fc2 refactor: extract venue factors (Phase 1d)` (2026-04-29)
- `8e73d41 docs: refresh resume for 2026-04-29 session` (2026-04-29)
- `21b62bf refactor: extract fantasy scoring + style derivation (Phase 1c)` (2026-04-29)
- `f737bcf refactor: extract news fetch + cache (Phase 1b)` (2026-04-29)
- `948212c refactor: extract weight-miss detection (Phase 1a)` (2026-04-29)
- `b26e893 feat: weight-miss opp-pace amplification + sub-lean adjustment` (2026-04-29)
- `e068189 feat: weight-miss feeds into lean projection + confidence` (2026-04-28)
- `482ecc6 feat: weight-miss badge with severity tiers from news headlines` (2026-04-28)
- `81dbc1e feat: top-3 lean drivers callout in row detail panel` (2026-04-28)
- `9062b8d perf: strip render instrumentation, keep lazy-render fix` (2026-04-28)
- `836b698 feat: PrizePicks-specific scoring + Round-1 SS line plumbing` (2026-04-28)
- `ea8dac2 feat: predictor v2 — duration model + book prior + learning UX` (2026-04-27)

**Snapshot tags for revert:** `clv-rlm-v1` (2026-04-24), `ctrl-autofetch-v1` (2026-04-24), `ufcstats-matching-v3` (2026-04-20).

**Project directory snapshot (this session):** `backups/full_project_snapshot_20260430_135140/`

**Cache key:** `ufcstats_v49` (unchanged — no FighterDB schema changes this session).

**Working tree status at session end:** clean except for `RESUME_NEXT_SESSION.md` (this file) and `.claude/settings.local.json`. All source-code changes committed.

---

## Mid-fight-week timeline (carry-forward)

- ✅ Thu 4/30 EOD — pre-weigh-in, no weight-miss signals can fire yet. Two fixes shipped, Betr lines entered.
- 🔜 **Fri 5/1** — ceremonial weigh-ins; Google News starts indexing "missed weight" headlines. **First chance to verify weight-miss in production.**
- 🔜 **Sat 5/2** — fight day, ~4 AM start, main card ends ~11 AM EST → settlement window. **First real predictor v2 outcome data.**

Lines status as of session end: P6 24 · UD 26 · Betr 24 · PP 15 · DK (no data). 132 stored / 132 matched. Slate has 4 issues (DK no data + lines aging — both expected mid-week).

---

## On deck (post-fight)

1. **Predictor v2 #3 + #4** — see `project_predictor_improvements_remaining.md`. ~35 lines combined. Order matters: only after #1+#2 verified.
2. **Phase 2 + 3 splits** above.
3. **SS_R1 settlement** — UFCStats parser pulls totals only; would need per-round splits.
4. **Weight-miss number tuning** — heuristic conf/avg deltas, calibrate after 5-10 real cases.
5. **iOS / iPhone access** — Orion Browser path or static dashboard path.

**❌ Off the list permanently:** Kelly stake sizing — user declined twice. See `feedback_no_kelly_stakes.md`. Do not propose.

## Loose ends (still not blocking)

- Pick6 CTRL settlement label mismatch (`Control` vs `ctrl`) — low-priority.
- `?`-platform records (138 unstamped) in `prop_archive_v1`. Pollutes per-platform analytics, doesn't affect display.
- Banner-vs-storage unresolved-count mismatch — **user said "don't worry about this."**
- Pick6 pickGroup polling auto-fetch still misses CTRL — see `project_pick6_pickgroup_polling_pending.md`.
- MAIN EVENT badge fix only applies when `currentSort === 'default'` and `upcomingCardPairs.length > 0`. If neither is true, falls back to scrape-order pairing (which may still misalign).

## Don'ts (persistent)

- **LINE DATA IS IRREPLACEABLE.** Backup BEFORE any storage-mutating snippet.
- **NEVER bump `BETR_EVENT_DATE` or edit the hardcoded seed** to enter Betr lines. Use `lines_betr_manual_v1` console snippet path.
- User is in **Chrome**. ↻ reload flushes cache.
- Betr entry: screenshot → diagnostic first → backup → snippet → F5 the analyzer tab (NOT the extension).
- **DK partial coverage is normal** — not a scraper bug.
- **Skip Pick6 CTRL UNDER unless `ctrl_under_available === true`.**
- **Do not propose Kelly stakes** — user declined twice, persistent feedback memory.

---

## Resume prompt (copy/paste at start of next session)

> Reading `RESUME_NEXT_SESSION.md`. Branch `feature/sleek-theme-v1`. **State:** twelve commits ahead of origin (Phase 1a-1h analyzer split + 2 main-event fixes shipped today). Build clean. UFC 314 Betr lines entered (24 fighters in `lines_betr_manual_v1`); JDM/Prates SS only, no FP at write time. Della Maddalena vs Prates Sat May 2 ~11 AM EST settle is gating both predictor v2 lift verification AND first real weight-miss outcome data.
>
> **Branch in conversation:**
>
> - **If DM vs Prates is over and ready to settle** → backup → settle from UFCStats → DISMISS residuals → ▶ Run Learning Cycle. Verify (a) FP |Δ| vs Sterling/Zalal ±31.5 baseline (target ±25 or lower), (b) any `⚖ MISS` badges fired correctly. If predictor v2 verified, queue #3 + #4 from `project_predictor_improvements_remaining.md`.
> - **If event hasn't happened but it's Friday/Saturday morning** → check whether weigh-ins posted, look for `⚖ MISS` badges, expand row to verify Top 3 Drivers + SS/TD/FT sub-panels reflect weight-miss.
> - **If user reports Betr line movement during fight week** → BETR LINES modal row-edit (preserves openLine). NEVER re-run the bulk snippet.
> - **If event hasn't happened and it's not fight week yet** → Phase 1 done (8 modules). Next is Phase 2 (Betr IIFE → factory, ~230 LOC, **high risk**, or UI panels). Both post-fight territory. Predictor #3+#4 (~35 lines) want DM vs Prates settle data first. Don't propose Kelly stakes.
> - **If user reports empty analyzer / weird predictions** → check data first (upcoming card, stale FighterDB, missing `avgTimeMins`).
> - **If user reports main-event regression** → diagnose `findHeadlinerPair()` — check `upcomingEventName`/`inferredEventNameFromLines` contains `"X vs Y"` suffix that matches the regex.
> - **If user reports row pairing regression** → check `upcomingCardPairs.length > 0` and `currentSort === 'default'`.
> - **If user reports false-positive weight-miss badge** → update negation regex in `parseWeightMissFromTitle` at [src/analyzer/weight-miss.ts](src/analyzer/weight-miss.ts).
