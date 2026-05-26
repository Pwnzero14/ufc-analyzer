# Resume — UI enhancement pass (partial), session of 2026-05-05

Branch: `feature/sleek-theme-v1` — uncommitted UI work in `analyzer.html` + `src/analyzer.ts`. Working tree is dirty; nothing pushed yet for this session.

UFC 328 (Chimaev vs Strickland) lines are loaded; predictions live; card hasn't settled.

---

## What shipped this session (uncommitted)

A run of UI suggestions worked top-down. Each item was implemented, tested visually, and confirmed before moving on.

### 1. Pattern Tracker / Learning Drilldown — differentiated
Both cards were surfacing the same `topHit` / `topMiss` data. Pattern Tracker stays as the data card (raw hit/miss tags + percentages). Drilldown is now the *recommendation* card:
- Title: `Lean into ${hitLabel}`
- Meta: `Fade ${missLabel}`
- Body: `Based on ${taggedSamples} tagged samples tracked.`

Both code paths updated — memory-engine path at [src/analyzer.ts:5953-5978](src/analyzer.ts#L5953-L5978) and bucket-fallback path at [src/analyzer.ts:6027-6037](src/analyzer.ts#L6027-L6037). Empty-state branches untouched.

### 2. Line Movers density
Each row now carries open→close inline with platform attribution:
`Marco Tulio  SS  UD 78.5→84.5  ▲6  P6, UD  STEAM  RLM UNDER`

Implementation: extended `SummaryEntry` with `open`, `close`, `sourcePlat` fields ([src/analyzer.ts:14471](src/analyzer.ts#L14471)); captured the values when finding max-delta platform. Added `.movement-summary-line` CSS column. Sign dropped from delta (arrow conveys direction).

### 3. Action button bar reorganization
Header buttons split by daily-use vs rare:
- **Always visible**: AUTO-FETCH (promoted to solid green primary CTA), Refresh, More ▾
- **In More dropdown**: Export, Report, Shop, Backup, Restore

Dropdown handler at [src/analyzer.ts:15659-15685](src/analyzer.ts#L15659-L15685). Closes on outside click, Escape, and item selection.

⚠ **Specificity gotcha caught**: there's a `.btn` rule at [analyzer.html:2101](analyzer.html#L2101) with a `linear-gradient` background. My initial `.auto-fetch-btn` rule (single class) was being overridden. Fixed by bumping selector to `.btn.auto-fetch-btn`. Future button-style work needs to check this rule's order.

### 4. Recommendation pill scannability
The `▲ OVER (SS) · 62% C` pill on each card got more visual weight:
- Font 11px → 13px, letter-spacing wider, padding 5×10 → 7×12
- Background opacity 0.09 → 0.18, border 0.22 → 0.50, plus colored glow shadow
- `.lean-conf-inline` opacity 0.7 → 0.92, font 9px → 10.5px, weight 400 → 600
- `.confidence-meter` height 4px → 6px
- Fill is now full-opacity `rgb()` (was rgba 0.8) plus `box-shadow: 0 0 6px currentColor` for glow matching the lean side

### 5. NEWS badge
Red → amber. Reds train the eye to expect blockers; news is informational. Now `rgba(255,170,60,0.14)` background with `#ffb24a` text — matches `weight-miss-moderate` palette. Removed the `pulse-warn` animation (calmer, passive flag).

### 6. Status header chunking
The long string in the top-right is now four CSS-separated chunks:
`● Live · 67 lines │ 📍 94 stored / 94 matched │ 🕒 34.4h old │ max Δ6.0 · ↻94 prev · Δ0.0`

Implementation: `_oc.innerHTML` emits three `<span class="status-chunk">` chunks ([src/analyzer.ts:14155-14158](src/analyzer.ts#L14155-L14158)). CSS adds `border-left` separator on each chunk.

### 7. Tile alignment + slate-level pruning
Two-step:
- **First** added per-fighter empty placeholders so column positions aligned across fighters (dashed border, `—` value).
- **Then** the user reviewed and the placeholders read as clutter. Reverted to no per-fighter placeholders, but kept the **slate-level pruning**: a one-pass scan computes which `(platform, stat)` slots have data anywhere on the slate, and `lineCell` skips slots not in that set.
- Net result: dead columns no one on the slate uses don't render at all (e.g. CTRL slots gone slate-wide if nobody has CTRL lines), but per-fighter empties also don't render.

State held in module-level `_slatePresentSlots: Set<string> | null` at [src/analyzer.ts:11917](src/analyzer.ts#L11917). Populated in render loop at [src/analyzer.ts:10617-10634](src/analyzer.ts#L10617-L10634). Read in `lineCell` at [src/analyzer.ts:11990](src/analyzer.ts#L11990).

### 8. Section dividers MAIN EVENT / CO-MAIN
Bigger labels + colored bars across the page:
- Badge: 9px → 12px font, padding 2×8 → 5×14, brighter backgrounds (opacity 0.12 → 0.20 for main, similar for co), colored glow shadow
- Divider lines: 1px → 2px on Main/Co-Main, color-tinted (gold/blue) with soft glow
- Header padding: 10/4 → 18/10

Section class added to header div: `fight-group-header fgh-${badgeCls}`. CSS for `.fgh-main .fight-group-line` etc. tints the bars. Both the base CSS at line 1652 AND the redesign-layer override at line 3137 needed updating — that override block (line 2893+) is unconditional, not media-queried, so it always wins.

---

## UI backlog still on the board (post-fight territory per user pref)

### Suggested next, high signal × medium effort:
- **Top KPI strip densification** — three cards (Calibrated Hit Rate, Avg Confidence, Actionable Leans) take ~140px vertical for one number each. Could become a single horizontal stat-strip freeing space for the main content.

### Medium signal × low effort:
- **Co-locate stale-age pills with platform pills** — `P6: 37m` / `UD: 37m` float right of Slate Check, disconnected from `Pick6 26` / `Underdog 26` pills above. Pull age inline on the pills (e.g. `Pick6 26 · 37m`).
- **Filter row simplification** — Sort + Trend (`L3 / L5 / Career`) feel set-once. Could collapse behind a "Sort & Trend" popover, leaving only action-filter chips visible.

### Polish:
- **`Showing PICK6 lines` label** — small grey text mid-row. Could become an active-state chip on the platform pill itself (`Pick6 26 · ACTIVE`).
- **`History: Compact` / `Compact View` density toggles** — float top-right awkwardly. Could move to a gear-icon density submenu.

---

## Backlog from prior sessions (unchanged)

- **Push commits** — currently 3 unpushed UI commits to make (this session). Plus the 3 predictor commits already pushed last session.
- **Pick6 pickGroup polling misses CTRL** — open since pre-Prates. Needs live Pick6 CTRL props to repro; can't debug until Pick6 posts CTRL for UFC 328. See [project_pick6_pickgroup_polling_pending.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md).
- **SS_R1 grader** — only worth it if next slate has many SS_R1 props. Defer.
- **Analyzer phase-2 split** — Betr IIFE + UI panels per [project_analyzer_split_progress.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md). Post-fight territory.
- **UFC 328 lift verification** — once card settles, re-run the lift snippet in [project_predictor_improvements_remaining.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_predictor_improvements_remaining.md). Watch whether `Book prior` fired on >0 fighters this time.

---

## Don't forget

- Don't propose Kelly stakes ([feedback_no_kelly_stakes.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_kelly_stakes.md))
- Don't recommend storage-mutating snippets without read-only diagnosis first ([feedback_no_destructive_snippets_without_verify.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_destructive_snippets_without_verify.md))
- Sanity-check fighter UFCStats history before flagging delta anomalies ([feedback_check_fighter_history_before_flagging_anomaly.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_check_fighter_history_before_flagging_anomaly.md))
- Reset Lines preserves Betr pre-fight-week, clears on/after event day ([feedback_betr_reset_rule.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_betr_reset_rule.md))

---

## Lessons banked from this session

- **Specificity check before button styling**: there's a global `.btn { background: linear-gradient(...) }` rule at [analyzer.html:2101](analyzer.html#L2101) that beats single-class custom button rules. Use multi-class selectors (e.g. `.btn.auto-fetch-btn`) or `!important`.
- **The "REDESIGN LAYER (2026)" block at [analyzer.html:2893+](analyzer.html#L2893)** is *not* media-queried. Its rules unconditionally override earlier definitions for the same selectors. When changing CSS that has both an early definition and a redesign-layer override, both must be updated.
- **Don't over-optimize for theoretical UX wins**: the per-fighter placeholder approach for column alignment seemed like the right call going in, but in practice the user found the empties cluttering. Slate-level pruning alone (drop dead columns no one uses) was the actual sweet spot. When in doubt, ship the smaller change first.
