# Resume — Lean-cell overlap fixed (real cause) + stats-mini revamped to 2 grouped cards

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-05-15 (late PM)
**Card:** Allen vs Costa (still loaded for visual verification)
**Status:** Working. No commit yet. Build clean.

## TL;DR

The `PLAN_2026_05_15_LEAN_CELL_COMPACT.md` plan had a **wrong root-cause diagnosis** — applying it made the UI worse, so I reverted everything and chased the actual cause. Then the user asked for a real revamp of the projected-lines display, so I replaced the 4-cell `stats-mini` with 2 grouped cards.

---

## What the plan got wrong

The plan blamed font sizes + `min-width: 0` on `.lean-badge` for the "overlap" with SS DELTA. After applying it the slab actually got worse:

- `min-width: 0` let the slab collapse below content width — for fighters with `(SS)` suffix (like Costa), text wrapped onto a 2nd line inside the slab.
- Smaller fonts made the slab look hollow without addressing the visual collision.

I reverted ALL plan changes (src/analyzer.ts emitters and analyzer.html CSS) before continuing.

## The actual root causes (3 things, not 1)

1. **`box-shadow: 0 0 10px ...` on `.lean-over` / `.lean-under`** (analyzer.html:530-531) — a 10px red glow that bled in every direction, including LEFT into the SS DELTA cell. Both cells were red → visually fused.
2. **`.lean-badge { width: 100% }` filled the entire lean-cell column** so the slab sat right against the SS DELTA cell with no breathing room.
3. **`.stats-mini` cells had non-zero `min-width`** (38/42/44px depending on rule) — combined 4 cells × ~50px border-box + gaps = ~215px, which exceeded the fight-pair col 3 track width (`minmax(120px, 1fr)` ≈ 200px at narrow viewport). Cells overflowed rightward INTO col 4 where the slab lives.

## What actually fixed the overlap

In `analyzer.html`:

- **Removed `box-shadow`** on `.lean-over` and `.lean-under` (kept the colored bg + border for identity).
- **`.lean-cell { padding-left: 12px }`** — gives the slab breathing room from the SS DELTA cell next to it.
- **`.lean-badge`** changed from `width: 100%` to `max-width: 100%; align-self: flex-end` so the slab now sits at its content width on the right edge of the lean-cell column, leaving ~30-50px of empty space on its left.
- **`.lean-badge { white-space: nowrap; overflow: hidden }`** so the `(SS)` suffix can't wrap to a 2nd line — if it ever overflows it gets clipped (hasn't happened yet at user's viewport).
- **`.stats-mini`** + `.stat-mini-cell` got `min-width: 0` so they can shrink within the grid track. Removed the 38/42/44px hard floors.

These 5 changes together: no more visual overlap, no more wrap-into-2-lines slab, no more grid overflow.

## Then the user asked to revamp the projected lines

The 4 vertical strips (PROJ FP / PROJ SS / SS LINE / SS DELTA) were still cramped — labels stacked vertically inside narrow cells because each cell was ~40-50px wide. The user said "lets revamp it make it look even better visually." I proposed 4 layouts via `AskUserQuestion` with ASCII previews and picked **2 grouped cards** (semantic grouping, matches existing card aesthetic).

### Refinement: grouped by stat-type, not by purpose

My original mockup was "PROJ block + vs-LINE block" — but that duplicates SS (44.8 appears in both). Better grouping: **FP card** (FP-only) + **SS card** (proj/line/delta all together). The user gave me full control, so I shipped this refined version.

### New emitter — `src/analyzer.ts:13593-13629`

Replaces the 4-cell `<div class="stat-mini-cell ...">` blocks with:

- `<div class="stat-card stat-card-fp">` — header label + big 18px value + meta chips inline + floor-ceiling footer.
- `<div class="stat-card stat-card-ss">` — header + `proj` row + `line` row + `.stat-delta-block` at bottom (the punchline: colored bg, delta value, PTD/ATD subscript).

The delta block carries the green/red bg (was on the whole 4th cell before). Cleaner visual signal — green/red now means "delta" specifically.

### New CSS — `analyzer.html:496-616`

Block of ~120 lines: `.stat-card`, `.stat-card-fp` (cyan tint), `.stat-card-ss` (neutral), `.stat-card-head/label/big/num/meta/foot`, `.stat-row`, `.stat-row-label/val`, `.ss-spread-inline`, `.stat-delta-block` with `.delta-plus`/`.delta-minus` variants, `.stat-delta-val`, `.stat-delta-td`.

Also updated:
- `.stats-mini` switched from 4-cell flex to 2-column grid `minmax(0, 0.85fr) minmax(0, 1.15fr)` — FP card smaller, SS card bigger because it has 3 rows.
- Redesign-layer override (analyzer.html:3986+) and the 1786-1792 expanded block both updated. Orphan `.stat-mini-cell.delta-*` rules at 4009-4019 deleted.
- `compact-view` rule that hid `.stat-mini-cell:nth-child(3)` and `:nth-child(4)` removed (those cells no longer exist; SS LINE + SS DELTA now live inside the SS card).

### Grid track tweak — `analyzer.html:1894`

The fight-pair grid was `1.1fr 2fr 1fr 1fr 22px`. Bumped col 3 (stats-mini) to fit 2 cards, trimmed col 2 (platform-lines) and col 4 (lean-cell) slightly:

```
minmax(160px, 1.1fr) minmax(0, 1.7fr) minmax(180px, 1.3fr) minmax(150px, 0.95fr) 22px
```

The `minmax(150px, ...)` on col 4 guarantees the lean-cell stays wide enough for the 150px-min slab.

## Files touched this session

- `src/analyzer.ts` — stats-mini emitter rewrite (lines 13593-13629)
- `analyzer.html` — significant CSS changes:
  - Removed `box-shadow` on `.lean-over` / `.lean-under` (line 530-531)
  - `.lean-cell { padding-left: 12px }` (line 522)
  - `.lean-badge` switched to `max-width: 100%; align-self: flex-end` + `white-space: nowrap; overflow: hidden` (lines 2339-2356)
  - Stats-mini revamp: new `.stat-card*` block (lines 496-616), deleted orphan `.stat-mini-cell` rules, updated redesign-layer override, removed compact-view nth-child hides
  - Fight-pair grid column template (line 1894)
- `analyzer.js` — rebuilt from .ts

## Stale plan file — delete or annotate

`PLAN_2026_05_15_LEAN_CELL_COMPACT.md` is now misleading. Its diagnosis was wrong (font sizes weren't the problem) and the prescriptions made things worse. **Recommend deleting** when convenient — or at minimum, annotate at the top with "SUPERSEDED — diagnosis was wrong, see RESUME_2026_05_15_LATE_LEAN_OVERLAP_AND_STATS_CARD_REVAMP.md".

## What's still rough / known unknowns

- **Main-event (non-fight-pair) layout** wasn't checked this session. The main grid `220px 1fr 180px 180px 22px` (analyzer.html:437) hasn't changed and the 2-card stats-mini might look different there. Worth a glance.
- **Compact-view** lost its "hide SS LINE + SS DELTA cells" rule. Those stats are now baked into the SS card so they can't be hidden independently. If compact-view should hide the entire SS card to save space, that's a future rule.
- **Sort buttons** for `ssline`/`avgss`/`delta` (analyzer.html:3714-3719 area) still work because they target sort comparators, not DOM classes — verified by grep.
- **`.ss-spread-label`** class still exists in CSS (analyzer.html:1731) as an orphan rule with no consumers. Harmless. Cleanup-on-touch.
- **No commit yet** — entire branch is uncommitted dating back several sessions. User has been deliberate about not committing.

## Process learning (for future Claude)

When a written plan exists, **don't trust its diagnosis blindly** — verify the root cause first. The plan here pointed at fonts/min-width when the actual issue was a 10px box-shadow + a grid-overflow + a 100%-width slab. Three separate causes, none of which the plan named. Per memory `feedback_test_dense_grid_rewrites_visually.md`: build clean ≠ correct layout. Same logic applies to clean-looking plans.

When the user says "fix all together it looks terrible" after a plan-driven attempt made things worse — **revert first**, then investigate. That's what saved this session.

## Next session prompt

> I'm continuing on `feature/sleek-theme-v1`. Last session shipped a stats-mini revamp (4 vertical strips → 2 grouped cards: FP card + SS card with delta block) and fixed the real cause of the lean-cell overlap (box-shadow glow + width:100% slab + stats-mini grid-track overflow, not the font-size stuff the old PLAN_2026_05_15_LEAN_CELL_COMPACT.md claimed). The plan file is stale — feel free to delete it. Check `RESUME_2026_05_15_LATE_LEAN_OVERLAP_AND_STATS_CARD_REVAMP.md` for full context. Allen vs Costa is still loaded. The branch has dozens of uncommitted changes from prior sessions — don't commit unless explicitly asked.
