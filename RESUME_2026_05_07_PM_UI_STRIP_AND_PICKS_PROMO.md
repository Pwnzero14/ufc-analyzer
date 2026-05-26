# Resume — UFC Analyzer UI continuation, evening of 2026-05-07

**Branch:** `feature/sleek-theme-v1` — clean, both commits pushed to origin. Continuation from [RESUME_2026_05_07_UI_FINAL_AND_PICK_LOGIC.md](RESUME_2026_05_07_UI_FINAL_AND_PICK_LOGIC.md), same day.

**UFC 328 status:** unchanged from prior resume. Card lines + Betr SS lines all in. Khamzat FP-OVER 110.5 lean stands. FP Betr lines still pending until Pick6/UD post FP lines.

---

## What shipped this session

### 1. Top stat strip — Avg Confidence → Top Edge

The top KPI row now reads **Calibrated Hit Rate · Top Edge · Actionable Leans**.

- Replaced redundant Avg Confidence card (CHR and Avg Conf are nearly identical on most slates).
- Top Edge = highest EV across actionable leans, formatted as `+43%` with subtitle `Pat Sabatini · FP-OVER`.
- Uses `computeFighterEV()` — same EV math as the verdict bars / Best Picks UI.
- Filters via `shouldSkipFpSideForFighter` so unplaceable pick-em sides (underdog FP-UNDERs on Pick6/UD/Betr, Betr underdog FP-OVERs) don't surface. Caught Roman Kopylov FP-UNDER on first run before this filter was added.

Files:
- [analyzer.html:4731-4735](analyzer.html#L4731-L4735) — card markup (`mhTopEdge` / `mhTopEdgeTrend`)
- [src/analyzer.ts:5887-5944](src/analyzer.ts#L5887-L5944) — `renderModelHealthWidget` rebuilt to keep fighter refs in `leanPairs`, scan for max EV, format result; empty state shows `--` / "No actionable edges"

### 2. AI Best Picks tab promotion

Visual separation from the filter group + count chip.

- New `.tab-btn-primary` CSS class: gold text, gold left-border separator, always-on subtle gold background tint, font-weight 700.
- Visually marks AI Best Picks as a destination, not a filter.
- Count chip: `AI BEST PICKS · 10` — counts placeable actionable leans per direction (post `shouldSkipFpSideForFighter`), capped at 8 per direction to match the panel's section limit.
- First pass had alpha values too subtle (border `0.28`, chip `0.14`, no background). Bumped to border `0.55`, chip `0.22`, always-on background `0.06`. Now reads as a different zone at a glance.

Files:
- [analyzer.html:2263-2272](analyzer.html#L2263-L2272) — `.tab-btn-primary` CSS
- [analyzer.html:4713](analyzer.html#L4713) — button gets `tab-btn-primary` class + `tabCountBestPicks` chip
- [src/analyzer.ts:10634-10657](src/analyzer.ts#L10634-L10657) — `updateViewTabCounts` extended with `bestOver`/`bestUnder` post-filter counts

---

## Status: shipped

Both pieces verified visually in 10:27 PM screenshot, then split into two commits and pushed to `origin/feature/sleek-theme-v1`:
- `39b661e` feat(ui): top KPI strip — replace Avg Confidence with Top Edge
- `d1c81d2` feat(ui): promote AI Best Picks tab + count chip

Top Edge shows `+43% Pat Sabatini · FP-OVER` (placeable, no underdog FP-UNDER leaks). AI BEST PICKS tab reads gold with count chip when inactive, gold solid fill when active.

---

## Known issue to verify next session

**Tab count race condition.** Observed in one screenshot: `LEAN OVER 0 / LEAN UNDER 0` simultaneously with `AI BEST PICKS 8`. All three counts come from the same loop in `updateViewTabCounts`, so they should be consistent. Possible explanations:
- Render-timing: counts ran before lean cache populated, then a partial re-render only updated some IDs.
- DOM caching: text node replacement raced with a parallel render.

To repro: hard-reload the analyzer page and watch the tab counts as the toast "Loaded N fighters with stats!" appears. If it persists, instrument `updateViewTabCounts` with a console.debug to confirm the values it computes vs. what lands in DOM.

---

## UI items still on the menu (from earlier 2026-05-07 session — high to low impact)

3. **Learning panel takes too much real estate.** 4-column wrap (Memory · Market Acc · Pattern Tracker · Drilldown) — only Drilldown is actionable (`Lean into SS UNDER · grade C`). Options: promote Drilldown to a full-width banner + collapse the other 3 behind a chip (same pattern as Sources), or wrap the whole panel under a `LEARNING ▾` toggle.
4. **Fighter card column headers nearly invisible.** Guides shipped at 14% alpha but the labels themselves (FIGHTER · LINES · AVG FP · SS · TDS · CONSIST · LEAN) are barely readable. Bump label opacity/weight or make sticky with the platform pills row.
5. **"X Rivalry split" annotation ambiguous.** Reading the Khamzat card, the dim grey "X Rivalry split" — does X mean "no rivalry" or "rivalry detected"? Either icon-only with tooltip, or clearer label.
6. **Slate Check + 3-card stat strip could collapse into one status banner.** Both say "current state of the slate."
7. **DEBUG button → More menu.** Floating bottom-right today.

---

## Pending from prior sessions (not blocking)

- **AUTO-FETCH state-aware** — button stays bright green even with fresh `5m` pills; CSS specificity issue likely.
- **Pick6 pickGroup polling misses CTRL** — needs live Pick6 CTRL props to repro. See [project_pick6_pickgroup_polling_pending.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md).
- **SS_R1 grader** — defer until next slate has SS_R1 props.
- **Analyzer phase-2 split** — Betr IIFE + UI panels per [project_analyzer_split_progress.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md).
- **UFC 328 lift verification** — re-run post-card.
- **FP Betr lines for UFC 328** — user enters via screenshot reader once Pick6/UD post.

---

## Don't-forgets (unchanged)

- Don't propose Kelly stakes
- Don't recommend storage-mutating snippets without read-only diagnosis first
- Sanity-check fighter UFCStats history before flagging delta anomalies
- Reset Lines preserves Betr pre-fight-week, clears on/after event day
- **Same-fight cross-stat OVERs (or UNDERs) are negatively correlated — lean ONE side, never both** (FP wins cross-stat tiebreaker)
- Resume document at start of session can be stale on uncommitted state — verify with `git status` before assuming work is unshipped

---

## Lessons banked from this session

- **Gold tint calibration for inactive UI states.** First pass at `.tab-btn-primary` used border `rgba(0.28)` + chip `rgba(0.14)` — the user couldn't tell at a glance if it had applied. Bumping to border `rgba(0.55)` + chip `rgba(0.22)` + always-on subtle bg `rgba(0.06)` was the threshold where it reads as a different zone. Inactive-state visuals need ~2× the alpha of what feels right when authoring, because the active-state contrast (solid gold fill vs. teal-grey transparent) sets the reader's expectation of how big a difference "different" looks.
- **Headline metrics must respect placement rules.** When surfacing a "best edge on the slate" metric, plumb `shouldSkipFpSideForFighter` (the same filter Best Picks/Parlay Lab use). Otherwise unplaceable underdog FP-UNDERs win the EV race. The model assigns directional leans regardless of pick-em availability — filtering happens at surface time, in every surface.
- **EV is the right "edge" unit.** Initially considered raw `|proj - line|` for Top Edge, but the user's whole prior session was about how raw stat edge is misleading (Strickland +42.8 SS-OVER vs Khamzat +30 FP-OVER, where the bigger-edge pick is illusory). EV factors in conf + odds and matches the unit shown elsewhere in the UI (`~EV: +37%` on verdict bars). Consistent unit, consistent reasoning.
