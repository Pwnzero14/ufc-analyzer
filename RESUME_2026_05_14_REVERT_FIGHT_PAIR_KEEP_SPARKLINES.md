# Resume — Revert fight-pair layout, keep LINE MOVERS sparklines

**Branch:** `feature/sleek-theme-v1`
**Date queued:** 2026-05-14
**Token budget:** start a fresh session; this is small and surgical

## Decision

User tested the dual-feature implementation (fight-pair side-by-side + LINE MOVERS sparklines). **Sparklines look good and stay.** Fight-pair side-by-side layout squishes the existing `.fighter-main` grid badly — projection cells overlap with the UNDER lean badge, spine column compresses fighters into unreadable strips. Revert that half.

## What to KEEP (sparklines — leave untouched)

- `renderSparkline(points, direction)` function — [src/analyzer.ts:14944](src/analyzer.ts#L14944) area
- `getSparklinePointsForPlat(name, stat, platKey)` helper — same neighborhood
- `sourcePlatKey: string` field on `SummaryEntry` type
- `maxPlatKey` tracking inside the LINE MOVERS stat-check loop
- Sparkline injection inside `rowHtml` (the `sparkHtml` const + `${sparkHtml}` slot in the row template)
- CSS in analyzer.html:
  - `.movement-summary-spark { ... }`
  - `.movement-summary-spark .line-sparkline { ... }`
  - `.line-sparkline { vertical-align: middle; overflow: visible; }`

## What to REMOVE (fight-pair — revert to original)

### [src/analyzer.ts](src/analyzer.ts)

1. **Remove the entire FIGHT-PAIR LAYOUT block** at ~line 10729 — everything from the `// ── FIGHT-PAIR LAYOUT ──` comment through `buildFightSpine()`. Types to delete:
   - `FightCardPosition`, `CorrelationStat`, `FightCorrelation`, `FightPair`
   - Functions to delete: `isPlaceholderFighter`, `fighterHasCtrlProp`, `pickFightTimeLine`, `computeFightCorrelation`, `cardPositionForFightIndex`, `buildFights`, `spineHasContent`, `weightClassChip`, `buildFightSpine`

2. **Revert `_renderFightersImpl` to original forEach** at ~line 11098. Replace the `buildRowForFighter` helper + `if (showFightGroups) { ... } else { ... }` block with the original inline `activeFighters.forEach((f, i) => { ... })` loop. The original is preserved in `git diff` — easiest restoration is `git show HEAD:src/analyzer.ts` to extract the pre-change region around the `// Filter out cancelled fighters from the display list` comment.

3. **Restore the `const totalFights = Math.ceil(activeFighters.length / 2);` line** — was deleted because `buildFights` consumed it; original forEach needs it for the prelim threshold check.

### [analyzer.html](analyzer.html)

Remove this entire CSS block (inserted after `.fight-restore-btn:hover`, before `.line-drop-banner`):
- `/* ── FIGHT PAIR (side-by-side opponents + shared spine) ── */` through the closing `@media (max-width: 900px) { ... }` rule
- Includes: `.fight-pair`, `.fight-spine`, `.fight-spine-chips`, `.fight-spine-rounds`, `.fight-spine-weight`, `.fight-spine-ft`, `.fight-spine-ft-label`, `.fight-spine-ft-value`, `.fight-spine-ft-plat`, `.fight-spine-ctrl`, `.fight-spine-corr`, `.fight-spine-top-edge`, `.fighter-row-placeholder`, the `@media (max-width: 900px)` rules
- Total: ~155 lines to delete

## Quick verification command (after revert)

```powershell
# Should return only sparkline-related symbols, NOT any fight-pair symbols
grep -E "fight-pair|FightPair|buildFights|buildFightSpine|fight-spine" src/analyzer.ts analyzer.html
# Should return matches (these stay)
grep -E "renderSparkline|sourcePlatKey|movement-summary-spark" src/analyzer.ts analyzer.html
```

Then `npm run build` and reload the extension in Chrome (↻ button in chrome://extensions).

## Acceptance after revert

- Fighters render as full-width stacked rows (original look — what was working before this session)
- LINE MOVERS sparklines still visible between delta arrow and RLM badge ✓
- AI BEST PICKS, Parlay Lab, DATA tab unchanged ✓
- All `window.*` console overrides still work ✓

## Context

Spec file was `ui-handoff-fightpair-sparklines.md` (in chat history). Implementation plan was Path A (pair-wrap existing rows). The side-by-side approach failed because `.fighter-main` is a fixed `220px 1fr 180px 180px 22px` grid (~620px minimum) — even with `minmax()` softening, halving its width to fit inside a `.fight-pair` 3-col grid (`1fr 130px 1fr`) crushed the projection cells and lean badge into each other. The "compact pair-card" path (Path B from planning) would have avoided this but was ~500 lines of net-new fighter rendering.

The sparklines came through clean because they slot into an already-working text-only row with explicit dimensions (90×18). Lesson: incremental visual changes that piggyback on existing dimensions ship; layout rewrites of densely-packed grids need a mockup test before code.
