# Resume — 2026-05-10, post-UFC 328 settle

**Branch:** `feature/sleek-theme-v1`
**HEAD (committed, NOT pushed):** `299be07` — fix(settle): widen card cache grace to 30h + grade SS_R1 from per-round table
**Working tree:** clean for source files (only `.claude/settings.local.json` and resume markdown modified/untracked)

---

## What shipped this session (committed in 299be07)

### 1. Card cache 30h grace window — `src/analyzer.ts` + `src/background.ts`
- `isUsableUpcomingCard` and `isCardDateUsable` were both using a 6h grace from midnight of event day, causing `upcoming_ufc_card` to self-delete at 6 AM on event day → `upcomingCardPairs` empty → fighters rendered in scramble order
- Widened to 30h: covers fights through ~10 PM event day + result-absorption window into the morning after

### 2. SS_R1 grader — `src/background.ts`
- `fetchFightDetails` now reads tbody[1] (Per-round Totals) in addition to tbody[0] (Totals); parses Round 1 sig strikes per fighter via `r1Cells[2]`
- Both matched-event and fallback settle paths apply via `applyResult(... 'SS_R1', f.ssR1)`
- Resolved 8 PrizePicks-only R1 SS records from UFC 328 (was previously stuck unsettleable)
- Verified working across 24 fighters in the full settle log; values cross-check against UFCStats (e.g. King Green R1 KO win = SS_R1 of 57, equal to total SS)

### Settlement outcome
UFC 328 fully absorbed — `13354 total records, 0 still unresolved`. Learning Cycle ran successfully — UFC 328 is in the model weights.

---

## NEXT SESSION FOCUS — Pre-line prediction decoupling

### The user's concern (legitimate)
Generating predictions only AFTER lines drop feels backwards. A model forecasting fighter performance should be able to commit to its forecast BEFORE seeing what the books are pricing. Currently the analyzer's UI requires platform lines to be loaded before the user can hit Generate Predictions, which means by the time predictions exist, the lines already do too — no clean "locked-in forecast vs first openers" comparison is possible.

### The good news (revealed during planning)
`generatePredictions` at [src/analyzer.ts:8207](src/analyzer.ts#L8207) **already** uses `upcomingCardPairs` (from `syncUpcomingCardContext(true)` at line 8210) as its fighter roster. It does NOT consume platform lines as input — only UFCStats fighter history, opponent absorption, archetype, recency, etc. Predictor v2 #2 (book prior) is also dead in production until archive grows past ~6 events, so even that path is moot right now.

**Translation:** the model is already decoupled. The work is purely UI plumbing.

### What's actually gated on `allFighters.length` (the platform-lines roster)
Need to investigate at start of next session:
- Whether the Generate Predictions button renders at all when no platform lines are loaded
- Whether the prediction TABLE (`renderPredictionsHtml` at [src/analyzer.ts:8278](src/analyzer.ts#L8278)) needs a fallback display path that works without `allFighters` populated
- Whether `_cachedPredictions` properly persists and renders across page loads when no lines exist

Specific files/lines to start with:
- [src/analyzer.ts:8207-8276](src/analyzer.ts#L8207-L8276) — `generatePredictions` (already decoupled, just confirm)
- [src/analyzer.ts:8315](src/analyzer.ts#L8315) and [src/analyzer.ts:8330](src/analyzer.ts#L8330) — `predictorGenerateBtn` render points (check enclosing conditions)
- [src/analyzer.ts:8278+](src/analyzer.ts#L8278) — `renderPredictionsHtml` (check if it bails when `allFighters` empty)
- [src/analyzer.ts:9657-9669](src/analyzer.ts#L9657-L9669) — button click handler (already calls `generatePredictions` directly, no roster check)

### Plan
1. Open analyzer with lines cleared (or wait for next slate before lines drop)
2. Click Generate Predictions — does the button exist? Does the function fire? Where does the UI get stuck?
3. Find each gating check on `allFighters.length === 0` in the predictor render path and replace with a fallback that uses `upcomingCardPairs` as the roster
4. Display predictions in a "no-lines mode" — just show predicted SS/TD/FP per fighter without lean arrows or platform comparison columns. Maybe show a "Lines not loaded — predictions will compare once lines drop" hint
5. When lines DO drop and AUTO-FETCH runs, the existing comparison flow lights up automatically against the already-saved `_cachedPredictions`

### Estimated effort
30-45 minutes if the gating is purely cosmetic (a few `if (allFighters.length === 0) return;` early-returns to bypass). More if the UI has been baked deeply around the assumption.

### Acceptance test
- Wipe platform lines (or test before next slate publishes them)
- Open analyzer
- Generate Predictions runs successfully and shows predicted SS/TD/FP per fighter
- Predictions persist across page reload
- When AUTO-FETCH later pulls platform lines, the table updates to show edges/leans against the pre-existing predictions
- Edge values for first-drop lines should be visible/loggable so the user can see how their committed forecast compared to opening books

---

## Other open carryover

### High priority
- **Long-form vs canonical event-name re-injection bug** — past events (Burns/Malott, Sterling/Zalal, Prates/Della Maddalena, UFC 328) keep showing as unresolved because some path re-creates archive records using long-form event names (`UFC Fight Night: Gilbert Burns vs Mike Malott`) that don't match the canonical UFCStats names (`UFC Fight Night: Burns vs. Malott`) the prior settle resolved. 256 unresolved records flapped 8 ↔ 203 ↔ 256 during this session because of this. Likely culprit: `mergeFighters` allowlist (per [project_merge_fighters_field_list.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_merge_fighters_field_list.md)) or some content-script/auto-fetch path. Investigate by grepping for archive writes that include `event:` field.

### Medium priority
- **`clearMissedWeight('Jeremy Stephens')`** in analyzer console — weight-miss override flag from yesterday is no longer needed post-settlement
- **Push the commit** — `299be07` is local-only on `feature/sleek-theme-v1`; push when ready
- **Pick6 pickGroup polling still misses CTRL** — see [project_pick6_pickgroup_polling_pending.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md)

### Low priority
- **Settle fires too early on event day** — uses same midnight-based heuristic that caused the cache bug. Fired at 10:27 AM on UFC 328 event day with 0 fights found. Harmless but wasteful. Apply same 30h grace to whatever is gating Settle in [src/background.ts:3066+](src/background.ts#L3066)
- **Tab count race condition** — `LEAN OVER 0 / LEAN UNDER 0 / AI BEST PICKS 8` on hard reload, observed once, didn't reproduce
- **AUTO-FETCH state-aware styling** — button stays bright green even with fresh `5m` pills (CSS specificity)
- **SS_R1 grader edge case** — Chimaev/Strickland both showed SS_R1=0; user verified this is correct (R1 was a grappling round with 0 sig strikes for both fighters — Chimaev secured 2 TDs and 4:47 control). Not a bug, but flag for awareness.
- **Analyzer phase-2 split** — Betr IIFE + UI panels per [project_analyzer_split_progress.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md)

---

## Don't-forgets (unchanged)

- Don't propose Kelly stakes
- Don't recommend storage-mutating snippets without read-only diagnosis first
- Reset Lines preserves Betr pre-fight-week, clears on/after event day
- Same-fight cross-stat OVERs/UNDERs are negatively correlated — lean ONE side, never both
- Big |delta| ≠ data bug; check fighter UFCStats history before flagging delta anomalies
- Resume document at start of session can be stale on uncommitted state — verify with `git status` before assuming work is unshipped
- Skipping AUTO-FETCH before Run Learning Cycle is fine if the gate is already flipped (button active) — the auto-fetch step is just the conventional way to flip it. The next-card line load can come whenever the new slate publishes; predictions for the new card can wait until then.

---

## Workflow reminder for the user (verbatim from session)

When next slate's lines drop on Pick6/UD/Betr/DK/PP:
1. AUTO-FETCH LINES
2. (Confirmed gate already flipped — Run Learning Cycle was completed this session)
3. Generate Predictions for new card with updated weights

If pre-line predictions feature ships first:
1. Generate Predictions BEFORE lines drop (using just UFCStats card data)
2. Lines drop, AUTO-FETCH runs
3. Edges light up automatically against the locked-in forecast
