**Last session:** 2026-04-28 (morning/early afternoon). Branch: `feature/sleek-theme-v1`. Build: clean. **State:** PrizePicks scoring + R1 SS plumbing committed, PERF lazy-render fix verified (~50× speedup) and instrumentation stripped, "Top 3 Lean Drivers" callout shipped, weight-miss detection + lean integration shipped. Della Maddalena vs Prates still pending settle — when it lands, it validates BOTH predictor v2 (#1+#2 from `ea8dac2`) AND first real weight-miss data.

---

## ✅ Done this session — five commits on `feature/sleek-theme-v1`

| Hash | What | Files |
|---|---|---|
| `836b698` | feat: PrizePicks-specific scoring + Round-1 SS line plumbing | background.ts, config/index.ts, content.ts, services/PropArchiveService.ts, types/index.ts |
| `9062b8d` | perf: strip render instrumentation, keep lazy-render fix | analyzer.ts |
| `81dbc1e` | feat: top-3 lean drivers callout in row detail panel | analyzer.ts, analyzer.html |
| `482ecc6` | feat: weight-miss badge with severity tiers from news headlines | analyzer.ts, analyzer.html |
| `e068189` | feat: weight-miss feeds into lean projection + confidence | analyzer.ts |

### 1. PrizePicks scoring + R1 SS plumbing (`836b698`)

Bundled the prior-session refactor that was sitting unstaged:

- New `PRIZEPICKS_SCORING` constant in [src/config/index.ts](src/config/index.ts) — sigStr×0.5, sub×4, lower win bonuses, no quick-finish, no non-sig/control/reversal
- `Fantasy_PP` archive type — written alongside `Fantasy` during UFCStats settlement so PP FP lines settle against the right rubric
- `sub` (submission attempts) field on FightResult/FightStats/OppFightResult, scraped from UFCStats col 7 in [background.ts:644](src/background.ts#L644)
- `line_ss_r1` / `sigStrR1` plumbed end-to-end (Fighter type, mergeFighters allowlist, content.ts DOM scraper, background.ts API parser, with R1 regex ordered before generic SS)
- Platform-aware `toArchivePropTypeFromLineKey` routes PrizePicks `line_fp` → `Fantasy_PP`

**Known gap (intentional):** SS_R1 lines archive but won't settle yet. UFCStats `fetchFightDetails` pulls totals only, no per-round splits. Stays unsettled until per-round parsing lands.

### 2. PERF lazy-render fix verified + stripped (`9062b8d`)

Lazy-render fix from 2026-04-25 verified at **13–26ms total / 3–8ms html-template** for 24 rows, vs the ~1000ms baseline. ~50× past the ~250ms target. Stripped all instrumentation (`_perfStart`, `_perfMarks`, `_mark`, `_bfrTimes`, 6 `_tXxx` pairs in `buildFighterRow`, `_buildRowTotal` wrapper, end-of-render `console.log` block). Kept `_pendingDetailBuilders` WeakMap + lazy `toggleRow` — that's the actual fix.

### 3. Top 3 lean drivers callout (`81dbc1e`)

Above the Pro/Risk grid in the (lazy-rendered) detail panel, a "Why OVER · Top 3 drivers" or "Why UNDER · Top 3 drivers" callout. Color-themed: green for OVER, red for UNDER. Numbered chips 1/2/3 + reason text. Direction-aware:
- `lean === 'over'` → drivers from `proReasons` (icon='pos')
- `lean === 'under'` → drivers from `riskReasons` (icon='neg', they're pros for going under)
- `push`/`none` skip the callout

Position-in-array is the implicit ranking (each producer pushes its strongest reason first). Pure UI add, ~30 lines + ~60 lines of CSS.

### 4 + 5. Weight-miss badge + lean integration (`482ecc6` + `e068189`)

**Detection** ([src/analyzer.ts:236-296](src/analyzer.ts#L236-L296)) — reuses Google News RSS via existing `fetchAllFighterNews`. Separate keyword channel (`parseWeightMissFromTitle`) detects "missed weight" / "X lbs over" / "fails to make weight" patterns, rejects negations ("never missed", "won't miss"), parses pound-amount when present (regex `by X lbs` / `X pounds over` / `over by X`). Categorizes by severity:

| Severity | Range | Treatment |
|---|---|---|
| small | <1lb | Drained, no upside, clear UNDER |
| moderate | 1–2lb | Drained, mild UNDER nudge |
| big | 2–5lb | MIXED — grappler on TD/CTRL gets OVER (size advantage in grappling); else UNDER (cardio dominates) |
| extreme | 5+lb | Major red flag — strong UNDER, with grappler-on-TD nuance preserved |
| unknown | parsed N/A | Conservative moderate UNDER nudge |

**Visual badge** — colored chip beside the existing NEWS badge in `row-expand-slot`. Severity-tiered colors (orange/amber/yellow/red/grey). Click reuses the existing news modal (same `data-news-fighter` handler).

**Lean integration** — `applyWeightMissAdjustment` wraps `_computeEffectiveLean`, shifts conf and avg projection, auto-flips lean direction if adjusted projection crosses the line. Reasons injected so they surface in Top 3 Drivers + Pro/Risk grid.

**What it doesn't do yet (deferred, by choice):**
- **Opponent-style amplification** — user's rule "high-pace opp amplifies cardio drain" not yet wired. Would be ~10 lines (read `oppEntry.db.slpm + sapm`, if ≥8.5 amplify confDelta by ~20%).
- **Sub-lean adjustment** — only the *effective* (priority-picked) lean is adjusted. If FP is the effective lean, the SS sub-panel display still shows un-adjusted lean text. Edge case mostly invisible day-to-day.
- **Number tuning** — heuristic conf/avg deltas. Will likely need calibration after 5-10 real cases.

---

## Step 1 next session — verify predictor v2 lift (carries from 2026-04-27)

**Prereq:** Della Maddalena vs Prates must finish + settle first.

1. 💾 backup → Settle from UFCStats → DISMISS residuals → ▶ Run Learning Cycle on the banner
2. New LEARNING SUMMARY shows avg |Δ| FP for Della Maddalena vs Prates
3. **Compare to Sterling/Zalal's ±31.5 baseline.** If FP |Δ| drops to ~±25 or lower, predictor v2 #1+#2 paid off.
4. If lift is weak: dig into per-fighter delta rows, check `Duration:` and `Book prior:` factor lines. Most likely failure mode: missing `avgTimeMins` on FighterDB silently reverts to old scaling.

If verified → queue predictor v2 #3 (RLM-as-calibration) and #4 (adaptive trend rate). Both pre-spec'd in memory `project_predictor_improvements_remaining.md`.

## Step 2 next session — verify weight-miss in fight week

**Prereq:** Friday weigh-ins post + Google News indexes "missed weight" headlines.

1. Reload extension → analyzer page
2. Look for `⚖ MISS X.X LB` badges on fighter rows. If any fighter actually missed weight on the card, expect a colored badge.
3. Click the badge → news modal should open with the source headline
4. Expand the fighter's row → "Why OVER/UNDER" Top 3 Drivers should mention the weight miss for that fighter
5. After fight settles, eyeball whether the lean direction matched outcome. If wildly off → tune the conf/avg deltas in `applyWeightMissAdjustment`.

**False positives to watch:** historical references ("X infamously missed weight at UFC 200"), denials ("never missed weight"), predictions ("will miss weight"). The negation regex catches the obvious cases but new patterns may appear. If false positive observed → add to negation regex in `parseWeightMissFromTitle`.

## Step 3 next session — finish the predictor v2 → v3 backlog

Two queued items pre-spec'd in memory `project_predictor_improvements_remaining.md`:

- **#3 RLM as per-fighter calibration during learning** (~5-10% FP |Δ| lift). ~30 lines in `runLearningCycle`.
- **#4 Adaptive trend learning rate by sample count** (~3-5% lift). ~5 lines at [PropLinePredictorService.ts:591-594](src/services/PropLinePredictorService.ts#L591-L594).

**Order matters:** only do these AFTER predictor v2 #1+#2 are verified, because layering #3+#4 on top makes attribution harder if #1 needs tuning.

---

## What's still on deck (untouched, lower priority)

1. **Fractional-Kelly stake sizing on each fighter row** — EV already computed per-book ([src/analyzer.ts:5929](src/analyzer.ts#L5929)). User declined this session in favor of weigh-in flag + top drivers.
2. **Weight-miss opponent-style amplification** — high-pace opp (slpm+sapm ≥ 8.5) amplifies cardio drain risk. ~10 lines in `applyWeightMissAdjustment`. Acknowledged in design, deferred.
3. **Weight-miss sub-lean adjustment** — also adjust `f.lean_ss`, `f.lean_td`, `f.lean_ft` (not just effective lean) so SS/TD/FT panel displays reflect the signal. Currently only effective lean adjusted.
4. **Weight-miss number tuning** — conf/avg deltas are heuristic. Tune after 5-10 real cases played out.
5. **SS_R1 settlement** — UFCStats parser pulls totals only; would need per-round splits to settle Round-1 sig strike lines that we now scrape and archive.
6. **Split `analyzer.ts`** — 16k+ lines in one file.
7. **iOS / iPhone access** — Orion Browser path or static dashboard path.

---

## Pre-existing context (carried forward, persistent)

**Recent commits ahead of `origin/feature/sleek-theme-v1`** (newest first):

- `e068189 feat: weight-miss feeds into lean projection + confidence` (this session)
- `482ecc6 feat: weight-miss badge with severity tiers from news headlines` (this session)
- `81dbc1e feat: top-3 lean drivers callout in row detail panel` (this session)
- `9062b8d perf: strip render instrumentation, keep lazy-render fix` (this session)
- `836b698 feat: PrizePicks-specific scoring + Round-1 SS line plumbing` (this session)
- `ea8dac2 feat: predictor v2 — duration model + book prior + learning UX` (2026-04-27)
- `2de0dda feat: post-event CLV audit loop + RLM signal` (2026-04-26, battle-tested)

**Snapshot tags for revert:**
- `clv-rlm-v1` (2026-04-24) — Post-event CLV + RLM
- `ctrl-autofetch-v1` (2026-04-24) — Pick6 CTRL auto-fetch
- `ufcstats-matching-v3` (2026-04-20)

**Cache key:** `ufcstats_v49` (unchanged this session — no FighterDB schema changes).

**Working tree status:** clean except for `RESUME_NEXT_SESSION.md` (this file) and `.claude/settings.local.json`. The 5 source-code changes from this session are all committed.

## Loose ends carried from 2026-04-26 (still not blocking)

- Pick6 CTRL settlement label mismatch (`Control` vs `ctrl`) at [src/analyzer.ts:14650](src/analyzer.ts#L14650). Low-priority unless you want CTRL to auto-settle.
- `?`-platform records (138 unstamped) in `prop_archive_v1`. Pollutes per-platform analytics, doesn't affect display.
- Banner-vs-storage unresolved-count mismatch — **user said "don't worry about this."**

## Don'ts (persistent)

- **LINE DATA IS IRREPLACEABLE.** Backup BEFORE any storage-mutating snippet.
- **NEVER bump `BETR_EVENT_DATE` or edit the hardcoded seed** to enter Betr lines.
- User is in **Chrome**. ↻ reload flushes cache.
- Betr entry: screenshot → Claude writes console snippet targeting `lines_betr_manual_v1` only.
- **DK partial coverage is normal** — not a scraper bug.
- **Skip Pick6 CTRL UNDER unless `ctrl_under_available === true`.**
- For PERF logs (if instrumentation re-added): user must use **analyzer page DevTools (F12)**, NOT service worker console.

---

## Resume prompt

> Reading `RESUME_NEXT_SESSION.md`. Branch `feature/sleek-theme-v1`. **State:** five commits this session — PrizePicks scoring + R1 SS, PERF strip (verified ~50× speedup), Top 3 Lean Drivers callout, weight-miss detection+badge, weight-miss lean integration. Della Maddalena vs Prates still pending settle — when it lands, that single event validates BOTH predictor v2 lift (vs Sterling/Zalal ±31.5 FP |Δ| baseline) AND first real weight-miss signal data.
>
> **Branch in conversation:**
>
> - **If user reports Della Maddalena vs Prates is over and ready to settle** → run normal post-event flow (backup, settle, DISMISS, ▶ Run Learning Cycle). Then double-check: (a) predictor v2 FP |Δ| lift vs ±31.5 baseline — target ±25 or lower; (b) any weight-miss badges that fired during the week — verify they showed correct severity, lean direction matched outcome. If predictor v2 verified, queue #3 (RLM-as-calibration) + #4 (adaptive trend rate) from memory `project_predictor_improvements_remaining.md`. If weight-miss numbers feel off, propose tuning the deltas in `applyWeightMissAdjustment`.
> - **If user reports the event hasn't happened yet but it's mid-fight-week** → check whether Friday weigh-ins have posted yet. If yes, look for `⚖ MISS` badges on the analyzer; expand a row to verify Top 3 Drivers reflects the weight-miss signal. If pre-Friday, no weight-miss signals will fire — that's expected.
> - **If user reports the event hasn't happened and it's not yet fight week** → on-deck list items: Kelly stake sizing, opponent-style amplification for weight-miss, sub-lean adjustment for weight-miss consistency, or split-analyzer.ts. User declined Kelly stakes this session in favor of weigh-in flag + top drivers, so confirm before re-offering.
> - **If user reports an empty analyzer / "predictions look weird"** → first check whether it's a data issue (no upcoming card, stale FighterDB cache, missing `avgTimeMins` reverting predictor v2 to old scaling). The new model has fallbacks but missing fields silently degrade.
> - **If user reports false-positive weight-miss badge** → check the source headline (in the badge's title attribute), update negation regex in `parseWeightMissFromTitle` ([src/analyzer.ts:255-296](src/analyzer.ts#L255-L296)).
