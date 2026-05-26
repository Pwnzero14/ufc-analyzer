# Resume — UI rounds 1–3, session of 2026-05-06

Branch: `feature/sleek-theme-v1` — 2 commits pushed this session, 1 batch uncommitted. UFC 328 (Chimaev vs Strickland) lines still loaded; card hasn't settled.

---

## What shipped this session

### Round 1 — committed `3f01f69`, pushed
1. **KPI strip horizontalization** — `Calibrated Hit Rate / Avg Confidence / Actionable Leans` collapsed from a 3-card grid to a single horizontal strip with baseline-aligned label / value / trend chunks separated by 1px dividers. `.model-health-grid` → `.model-health-strip`. Wraps on narrow screens; dividers hidden via media query. Saves ~70px vertical.
2. **Stale-age pills inline on platform pills** — moved from the Slate Check header onto each platform pill (e.g. `Pick6 26 [10m]`) with green/amber/red `.fresh / .aging / .stale` states from the same threshold logic. Slate Check panel now shows only Title + Summary + Issues. Dead `.qa-pill*` CSS removed.
3. **Sort & Trend popover** — 11 sort buttons + 3 trend buttons collapsed behind a single `Sort & Trend [Card Order · L3] ▾` trigger. Existing button handlers untouched (selectors are global). Closes on outside click, Escape, item select.
4. **Active-state chip on platform pill** — floating `Showing PICK6 lines` label dropped; replaced by a gold `ACTIVE` chip inside the selected platform pill (`.pill-active-badge`).
5. **Density toggles → gear submenu** — `Compact View` + `History: Compact` collapsed behind a `⚙` icon at the right edge with a small popover. Buttons keep their IDs/handlers; popover stays open across multiple toggles since the two switches are independent.
6. **Empty-state regression fix** — switched the no-lines-loaded hide logic from per-button refs to parent `.sort-trend-control` / `.density-control` refs so popover triggers also hide when no lines are loaded.

### Round 2 — committed `b16fa0b`, pushed
7. **View tab counts** — `All Fighters [26]`, `▲ Lean Over [15]`, `▼ Lean Under [9]` chips reflect underlying slate (ignore search/tag filters). AI Best Picks / Parlay Lab / Calibration / Archive intentionally uncounted — they're modes, not filters. New `updateViewTabCounts()` runs at the top of `_renderFightersImpl`.
8. **Slate Check compact mode** — adds `.qa-compact` class when `level === 'ok'`. Title + summary inline, padding 6/14, summary text demoted to text2 weight 500. Reverts to full panel layout the moment a warning or error fires.
9. **Status header rationalization** — `94 stored / 94 matched` → `94 archived` when equal; `max Δ7.0 · ↻94 prev · Δ0.0` → `max Δ7.0` when no recent move. Both chunks gain title-attr tooltips with full breakdown. `↻Δx.x` trail returns automatically when `_maxPrevDelta > 0`.
10. **Line Movers split by direction** — top-20 selection unchanged, partitioned into `▲ Steamers (n)` (green) and `▼ Drifters (n)` (red) sections. Section headers reuse `.rise / .drop` colors; count chips reuse the view-tab chip styling. Empty sections don't render.

### Round 3 — UNCOMMITTED (analyzer.html, src/analyzer.ts)
11. **RESET LINES safety move** — destructive red button removed from the always-visible action bar; now lives at the bottom of the More dropdown as `.overflow-item.overflow-item-danger`, separated by a top border + extra padding. Hover state: red-tinted background. Click flash preserved (`DONE!` for 2s with green success class) — dynamic text wrapped in `.overflow-item-label` span so the leading `⚠` icon survives. Visibility toggle changed from `display:'inline'` to `display:''` for proper flex rendering.
12. **Subtitle cleanup** — `Fantasy Lines · History · Leans` removed from under the `UFC Analyzer` wordmark. `.logo-sub` CSS rule deleted. The wrapping `<div>` is gone — `.logo` flex container holds icon and title directly. ~12px reclaimed.

---

## Backlog — UI suggestions still on the menu

Ranked by signal × effort (top is best next pick):

1. **Learning cards → horizontal strip** — the four `Learning Memory / Market Accuracy / Pattern Tracker / Learning Drilldown` cards still in 4-card grid form, while the KPI strip above them is now horizontal. Same-pattern collapse to a single row would harmonize the two zones and reclaim ~80px vertical. Best consistency win, medium effort.
2. **Sources row consolidation** — `SOURCES P6 UD DK PP BT` between platform pills and search bar is set-once-rarely. Two options:
   - **a)** Hide row when all five sources are active (default state) — only renders when something's toggled off
   - **b)** Move into a small filter icon
   
   Option (a) is the sneakier win — invisible until needed, no new icon to learn.
3. **Density gear status dot** — the `⚙` icon at the right of filter row 2 looks the same whether default or `History: Readable / Detailed View` is active. A small colored dot in the corner when a non-default mode is on would tell you something's enabled without opening it.
4. **Stale-age pill saturation tiers** — currently 1h and 24h both render the same red. Ramp opacity/saturation by hours-stale for glanceable severity.
5. **Fighter card header alignment** — `FIGHTER · LINES · AVG FP · SS · TDS · CONSIST · LEAN` floats above the cards without column dividers. Subtle vertical guides or sticky-on-scroll background would tie the header to rows.

---

## Older backlog (carried from prior sessions)

- **Push uncommitted Round 3 work** — RESET LINES move + subtitle cleanup are sitting on disk, need a commit + push.
- **Pick6 pickGroup polling misses CTRL** — open since pre-Prates. Needs live Pick6 CTRL props to repro; can't debug until Pick6 posts CTRL for a slate. See [project_pick6_pickgroup_polling_pending.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md).
- **SS_R1 grader** — only worth it if next slate has many SS_R1 props. Defer.
- **Analyzer phase-2 split** — Betr IIFE + UI panels per [project_analyzer_split_progress.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md). Post-fight territory.
- **UFC 328 lift verification** — once card settles, re-run the lift snippet in [project_predictor_improvements_remaining.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_predictor_improvements_remaining.md). Watch whether `Book prior` fired on >0 fighters this time.

---

## Don't forget

- Don't propose Kelly stakes ([feedback_no_kelly_stakes.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_kelly_stakes.md))
- Don't recommend storage-mutating snippets without read-only diagnosis first ([feedback_no_destructive_snippets_without_verify.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_destructive_snippets_without_verify.md))
- Sanity-check fighter UFCStats history before flagging delta anomalies ([feedback_check_fighter_history_before_flagging_anomaly.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_check_fighter_history_before_flagging_anomaly.md))
- Reset Lines preserves Betr pre-fight-week, clears on/after event day ([feedback_betr_reset_rule.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_betr_reset_rule.md))
- Resume document at the start of session can be stale on uncommitted state — verify with `git status` before assuming work is unshipped (yesterday's resume claimed work was uncommitted that had already been pushed in `ac08df3`).

---

## Lessons banked from this session

- **Popover-relocate pattern is reusable** — the trick used in items 3 (Sort & Trend), 5 (Density), and 11 (RESET LINES) is the same: leave the original buttons in place with their existing IDs/handlers/selectors, wrap them in a hidden popover container, add a trigger button. Click handlers don't need to change because they target by selector. Only catch: if the click handler does `textContent` swaps that would wipe child icons, you need a dedicated label span (caught this in item 11; nicked it in item 4 with `<span aria-hidden>` for the icon).
- **Empty-state hide refs need to track the new container, not the original button** — when popover-relocating, update parent visibility refs (`.sort-trend-control` instead of `#sortGroup`). Missed this in round 1 item 3 and only caught it when bundling round 1 item 5 — fixed both as part of item 5 cleanup.
- **The resume's stale-state warning held**: the prior session's resume claimed `analyzer.html` and `src/analyzer.ts` were uncommitted with 8 UI items. They were actually already in commit `ac08df3` — resume was written mid-session before that commit landed. Always verify with `git log` and `git status` before acting on a resume's uncommitted-work claim.
