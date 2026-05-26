# Resume — Filled spine + pair-sync expansion

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-05-16 (~01:36 AM)
**Card:** Allen vs Costa (still loaded)
**Status:** Working. Build clean. No commit (branch carries dozens of uncommitted changes from prior sessions — user has been deliberate about not committing).

## TL;DR

Implemented the "filled spine" spec from `ui-handoff-spine-fill.md`. The narrow spine (130px) between paired fighter rows now widens to 220px when either row is expanded, and fills with three new sections: **MATCHUP**, **COMMON OPPS**, **L5 TRENDS**. Plus an unplanned UX follow-up: clicking one fighter in a pair now auto-expands the other so the bar grids show side-by-side for easy comparison.

## Spec deviations (called out before coding, user confirmed)

The spec assumed a `factors.*` namespace and an "expanded density" mode — neither exists. Real mapping:

| Spec name | Real source | Notes |
|---|---|---|
| `factors.avgSS` | `f.db.avgSigStr` | flat on the FighterDB |
| `factors.oppAbsorbsSS` | `mean(f.db.history[i].oppStats?.sigStr)` for samples ≥ 2 | not pre-computed; derived per fighter from their own history |
| `factors.pFinish` | `f.db.finishRate * 100` | already 0..1 |
| Common Opps bridge | `normalizeName()` first, alias map fallback | spec assumed `UFCSTATS_NAME_ALIASES` was the bridge — actually `normalizeName` is (alias map is for fetching by platform name, not for matching history opps which are already canonical) |
| Filled-mode trigger | `.fight-pair:has(.fighter-row.expanded)` | `currentDensity` is only `'compact'` \| `'detailed'`. The "bar grids visible" state in the spec actually means per-row click expansion. User picked: **either-row expanded** triggers fill (vs. both-row or new global density). |

## Files touched

### `src/analyzer.ts`

- **[15216-15247] `renderSparkline`** — added optional `opts?: { color?, w?, h? }` third arg. When `opts.color` provided, overrides direction-derived green/red. Existing 2-arg callers (line 10871, 15361) unchanged.
- **[10856-11041] new filled-spine helpers** — placed between `weightClassChip` and `buildFightSpine`:
  - `SPINE_COLOR_A = '#5ee5e0'` (cyan), `SPINE_COLOR_B = '#ffd24a'` (yellow) — constants
  - `spineFightTime(f)` — parses `f.date` to ms for sorting
  - `spineHistorySorted(db)` — returns history copy sorted newest-first
  - `spineOppAbsorbsSS(db)` — averages `history[i].oppStats?.sigStr` (≥2 samples or null)
  - `spineEscape(s)` — html-escapes opp names
  - `spineMethodShort(method)` — KO/TKO → KO, SUB → SUB, else DEC
  - `spineResultLetter(result)` — win → W, loss → L, draw → D
  - `spineFighterStatLine(f, color)` — emits `SS·FP·W/KO` colored span
  - `spineMatchupHTML(a, b)` — 3-row 1fr-auto-1fr grid: SS/fight, opp abs, P(fin). Missing values render as `—` (`<span class="spine-missing">`).
  - `spineCommonOppsHTML(a, b)` — slices each side's history to last 8, normalizes opp names, intersects, sorts shared by recency (max of both encounter dates), takes top 3. Empty path: italic `none in past 8 fights`.
  - `spineL5TrendsHTML(a, b)` — three rows (SS=sigStr, FP=fp, TD=td). Window = `min(5, smaller fighter's count)`. Slices newest-N then reverses to chronological asc so the polyline reads oldest→newest left-to-right. Sparkline w/h = 70/14. Section heading reads `L{n} TRENDS`. Suppress whole section if either fighter has < 2 history entries. Legend: last name of A (cyan) / last name of B (yellow).
  - `buildFilledSpineWrapper(a, b)` — wraps the three sections + `<div class="fight-spine-spacer"></div>` (flex:1 to push content to top, breathe at bottom). Returns `''` if either fighter is placeholder.
- **[~11078-11091] `buildFightSpine`** — appends `buildFilledSpineWrapper(fight.fighterA, fight.fighterB)` after the existing five chip blocks.
- **[~11341-11349] empty-spine branch in render loop** — also injects the wrapper so no-chip fights still fill when expanded (DOM must exist for the `:has()` rule to reveal it).
- **[13959-13977] `expandRowDetailPanel` + `toggleRow` refactor** — extracted the detail-panel build+animate logic into `expandRowDetailPanel(row)`. Then `toggleRow` mirrors expansion onto the partner inside the same `.fight-pair`, calling the helper for the partner too (so lazy detail builders fire and bar animations run). Solo rows (fighters with no partner) still toggle independently.

### `analyzer.html`

- **[2118-2237]** new CSS block before the mobile media query:
  - `.fight-pair:has(.fighter-row.expanded)` → 220px middle column + `align-items: stretch`
  - `.fight-pair.fight-pair-no-spine:has(.fighter-row.expanded)` → same widening + restore the dashed border/bg on the empty spine (since it now has content to show)
  - `.fight-spine-filled` → `display: none` by default, `display: flex` only inside `:has(.fighter-row.expanded)`
  - `.spine-section`, `.spine-section-head`, `.spine-matchup-row` (1fr auto 1fr grid), `.spine-val-a` (cyan, right-aligned), `.spine-val-b` (yellow, left-aligned), `.spine-row-label`, `.spine-missing`, `.spine-cmn-row`, `.spine-cmn-name`, `.spine-cmn-stats`, `.spine-cmn-sep`, `.spine-cmn-empty` (italic), `.spine-trend-row` (70px 26px 70px grid), `.spine-trend-cell`, `.spine-trend-label`, `.spine-trend-legend`, `.spine-legend-a`, `.spine-legend-b`, `.spine-spacer` (flex:1)
- **[mobile media query]** added rule that collapses the filled mode back to single column on narrow widths and hides the filled wrapper (spec out-of-scope: desktop-only).

### `dist/analyzer.js`

Rebuilt from `.ts` via `npm run build` (tsc → dist/). Clean compile.

## What's visually verified

User confirmed via screenshot at 01:36:
- Allen vs Costa: spine widens, MATCHUP shows `55.2 / 40.2` (SS), `48.7 / 27.2` (opp abs), `20% / 67%` (P(fin)) in correct cyan/yellow.
- COMMON OPPS: `none in past 8 fights` italic empty state.
- L5 TRENDS: three sparkline pairs (SS, FP, TD) render with Allen/Costa legend.
- Pair-sync works: clicking either fighter expands both — bar grids visible side-by-side.
- Spine bottom-aligns with the taller side (Costa, who has the right side's full panel grid showing).

## What's NOT visually verified

- **Populated COMMON OPPS** — Allen and Costa share zero opps. The populated layout (up to 3 rows: opp name on its own line, two stat lines below in cyan/yellow) hasn't been seen. Likely fine but if it looks off (alignment, clipping, sep dot) on a future card with shared veterans, that's where to look.
- **L{n} TRENDS for n < 5** — heading should read `L4 TRENDS` for a fighter with only 4 UFC fights. Not exercised this session.
- **Suppression with < 2 fights on one side** — trends section should be omitted entirely. Not exercised.
- **Other slate's main grid** — only Allen/Costa loaded.

## Process notes (for future Claude)

- Workflow used: spec drop → verify factor names + data shapes against actual code → propose plan + flag deviations → user confirms → implement → build. Worked well. The deviations table was load-bearing — the spec's `factors.avgSS / oppAbsorbsSS / pFinish` namespace literally doesn't exist in the codebase, and "expanded density" mode doesn't exist either. Catching these before coding saved a wrong implementation.
- Per `feedback_test_dense_grid_rewrites_visually.md`: I can't test UI from the CLI, so I explicitly told the user to verify and gave them a checklist. They iterated once (the pair-sync request) before approving.
- The `:has()` selector handles the trigger cleanly — no JS state coordination needed for the spine width/fill toggle. Only the bar-grid pair-sync needed JS (because lazy detail-panel builders have to fire for the partner row).

## Known followups / out of scope

- **Rematch row in COMMON OPPS** (spec marked optional/nice-to-have) — skipped for v1. Add as: when `normalizeName(a.opponent) === normalizeName(b.name)` or vice versa, prepend a `prior meeting: A's result · B's result` row with a distinct bg tint.
- **Sparkline hover tooltips** showing exact per-fight values — spec out-of-scope.
- **Click-through from COMMON OPPS row to opponent's prior fight detail** — spec out-of-scope.
- **Compact mode behavior when expanded** — current plan: spine still fills (spec didn't say otherwise). Not exercised this session, may want to revisit.
- **OVER-side correlation warning bug** — noted in spec as separate PR territory.
- **Best Picks podium treatment** — also separate PR territory.
- **No commit yet** — branch carries dozens of changes from many prior sessions. Don't commit unless asked.

## Next session prompt

> Continuing `feature/sleek-theme-v1`. Last session shipped the filled spine (per `ui-handoff-spine-fill.md`) — when either fighter in a pair is expanded, the 130px center column widens to 220px and fills with MATCHUP / COMMON OPPS / L5 TRENDS sections. Also added pair-sync: clicking one fighter auto-expands the partner so bar grids show side-by-side. See `RESUME_2026_05_16_FILLED_SPINE.md` for full file/line breakdown and the spec deviations (the `factors.*` namespace and "expanded density" mode in the spec don't exist — real mapping is documented). Allen vs Costa still loaded; populated COMMON OPPS hasn't been visually verified yet. Dozens of uncommitted changes carry over — don't commit unless asked.
