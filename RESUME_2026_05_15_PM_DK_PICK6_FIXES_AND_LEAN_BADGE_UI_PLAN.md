# Resume — DK + Pick6 URL fixes shipped; UI planning for the lean-badge overlay next

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-05-15 (PM session)
**Card:** Allen vs Costa (main) + Choi vs Santos (co-main)
**Status:** Working. No commit yet.

## What landed this session

### 1. DraftKings restructured fighter-props URLs (2026-05-15)
DK Sportsbook changed query params under the same `/leagues/mma/ufc` path:

| Old | New |
|---|---|
| `category=fighter-props&subcategory=significant-strikes-o-u` | `category=fights&subcategory=fighter-props&nav_1=significant-strikes-o-u` |
| `category=fighter-props&subcategory=takedowns-landed-o-u`     | `category=fights&subcategory=fighter-props&nav_1=takedowns-landed-o-u` |

Auto-fetch was silently failing because it opened the stale URLs (which redirected to a default tab without the relevant props). Fixed in three places:

- [src/background.ts:1632-1637](src/background.ts#L1632-L1637) — auto-fetch URLs updated
- [src/content.ts:641-643](src/content.ts#L641-L643) — `preferSS` / `preferTD` detection accepts `nav_1=...` OR legacy `subcategory=...`
- [src/popup.ts:171](src/popup.ts#L171) — "Fetch DK TDs" popup button URL

The URL gate at [src/content.ts:992](src/content.ts#L992) (`pathname.includes('ufc')`) still passes because the path is unchanged.

### 2. Pick6 collapsed UFC into a unified MMA category
- `?sport=UFC` now returns "SOMETHING WENT WRONG" on DK's side.
- `?sport=MMA` homepage works **but** doesn't render stat-tab pills for guests — only sample cards. SPA doesn't auto-navigate to the deep category for logged-out users.
- Stat-tab pills (Significant Strikes / Takedowns / Fantasy Points / Fight Time / Knockouts / Control Time) live on `category/129?sport=MMA[&pickGroup=...]`. DK fills in `pickGroup` for the current event automatically.
- A `Featured | UFC | MVP` sub-tab row sits above the stat pills; UFC sub-tab filters to UFC fighters.

**Critical silent killer last session:** the pickGroup detector at [src/content.ts:893-896](src/content.ts#L893-L896) had a hardcoded `sport === 'UFC'` check — even after URL flip it rejected every capture.

Fixed in three places:

- [src/config/index.ts:8-15](src/config/index.ts#L8-L15) — `CONFIG.platforms.pick6.url` → `https://pick6.draftkings.com/category/129?sport=MMA`
- [src/background.ts:1631-1639](src/background.ts#L1631-L1639) — auto-fetch URLs collapsed to a single MMA-category URL (dropped stale `category/46` and `category/47` deep links)
- [src/content.ts:893-896](src/content.ts#L893-L896) — pickGroup detector accepts UFC OR MMA

### 3. Pick6 scraper updated for the new layout
[src/content.ts:282-340](src/content.ts#L282-L340) in `scrapePick6AllStats`:

- Clicks UFC sub-tab first to filter to UFC fighters.
- Control Time is now a top-level pill (no longer nested under a "Time" parent tab); click directly.
- Bumped post-click waits from 350ms → 700ms for SPA re-render.

### 4. Result
All five sources populated cleanly: Pick6 26 / Underdog 26 / Betr 20 / DK Sportsbook 16 / PrizePicks 26. Slate Check down to 2 expected issues (BT missing 6, Betr 20/26).

### 5. Memory saved
- `project_dk_pick6_mma_consolidation.md` — captures the URL behavior and the "homepage lacks stat tabs for guests" gotcha so future Claude can recognize a similar URL drift quickly.

## Carryover (still uncommitted)

From prior sessions (no commit this entire arc):
- `analyzer.html` — fight-pair layout + spine + sparkline CSS
- `src/analyzer.ts` — FIGHT-PAIR LAYOUT block + pair-wrap + sparklines (~370 lines)
- `RESUME_2026_05_*.md` pile (~25 files)
- Betr lines for this card already entered via `lines_betr_manual_v1`

From this session:
- DK + Pick6 URL fixes (3 files: `src/background.ts`, `src/content.ts`, `src/config/index.ts`, `src/popup.ts`)
- This resume file

When ready to commit: one `feat(scrape)` commit for the DK/Pick6 URL adaptation, separate `feat(ui)` commit for the layout/sparklines carryover, and add `RESUME_*.md` to `.gitignore`.

---

## Next focus — visually polish the lean-badge / delta overlay

**What the user wants:** the colored UNDER / OVER / PUSH overlay tile that sits in each fighter's `.lean-cell` column (the one with the delta value, confidence bar, ~EV, W.Avg, FV chip, etc.) looks visually noisy and not aligned with the sleek-theme direction. User is going to Claude Desktop to plan visual adjustments and will return with a markdown plan.

### Where the lean-cell lives

Rendered inline in `renderFighterRow` at [src/analyzer.ts:13603-13637](src/analyzer.ts#L13603-L13637):

```ts
<div class="lean-cell">
  <div class="lean-badge ${leanClass}" style="${leanGradStyle}" title="${lean.verdict}">
    ${leanText}${confInlineLabel}
  </div>
  ${confPct > 0 ? `<div class="confidence-meter">
    <div class="confidence-fill" data-fill-width="${displayConf}%" style="..."></div>
  </div>` : ''}
  ${hasCrossStatConflict(f) ? `<div class="conflict-warn">⚠ Stat split</div>` : ''}
  ${hasConsensusLean(f) ? `<div class="consensus-lean">⚡ consensus</div>` : ''}
  ${lean.rivalryDissent ? `<div class="conflict-warn" ...>⚔ Rival models dissent</div>` : ''}
  ${archive accuracy badge -- inline IIFE}
  ${leanEvDetail != null ? `<div class="ev-label">...~EV: ±X% (vig%)</div>` : ''}
  ${weightedAvg != null ? `<div class="weighted-avg-label">W.Avg: X</div>` : ''}
  ${fair-value chip -- inline IIFE}
</div>
```

### Stacking order of indicators (top → bottom)
1. `.lean-badge` — primary verdict tile: UNDER / OVER / PUSH text + delta number + optional inline conf% label
2. `.confidence-meter` — thin progress bar tinted by lean color
3. `.conflict-warn ⚠ Stat split` — FP leans one way, SS+TD the other
4. `.consensus-lean ⚡ consensus` — all three stats align
5. `.conflict-warn ⚔ Rival models dissent` (amber variant)
6. `.archive-accuracy-badge 📊 FT 60% · SS 55%` — per-prop archive hit rate
7. `.ev-label ~EV: +12% (4%)` — fair-value-based EV with vig
8. `.weighted-avg-label W.Avg: 73.2`
9. `.fair-value-chip FV +5.2` — green if positive ≥4, red if negative ≥4, amber otherwise

### CSS for these classes lives in `analyzer.html`
Search anchors that should locate them:
- `.lean-cell`, `.lean-badge`, `.lean-over`, `.lean-under`, `.lean-push`
- `.confidence-meter`, `.confidence-fill`
- `.conflict-warn`, `.consensus-lean`, `.archive-accuracy-badge`
- `.ev-label`, `.weighted-avg-label`, `.fair-value-chip`

The row container is `.fighter-main` (3-column grid: `.fighter-info` | `.platform-lines` | `.stats-mini` | `.lean-cell` | `.row-expand-slot`). Touching the lean-cell width affects the whole grid — recall memory `feedback_test_dense_grid_rewrites_visually.md`: **halving the width of `.fighter-main` rows needs a browser test BEFORE locking the CSS** — a clean TypeScript build is not enough.

### What the user is signaling visually
From the screenshot they annotated with blue arrows, the pain points appear to be:
- The slab-style colored verdict tile (`.lean-badge`) feels heavy and overlaps the lines column visually.
- The verdict % label baked into the right edge of the tile competes with the delta number.
- The stacked smaller chips below the tile (~EV, W.Avg, FV) feel cramped and inconsistent.

User is going to Claude Desktop to mock up the redesign — wait for the markdown plan they bring back. Do **not** make speculative CSS changes before that plan lands.

### When the plan arrives
1. Confirm exactly which elements move/restyle vs which disappear.
2. Identify the CSS blocks in `analyzer.html` and the inline `style="…"` strings in `src/analyzer.ts:13603-13637` that need to change.
3. Make CSS-only changes first where possible, then markup tweaks if the plan demands restructuring.
4. **Reload the analyzer in Chrome and visually verify before declaring done** — the existing rule from memory applies here, this layout is grid-density-sensitive.

## Quick verification on resume

```powershell
# Confirm URL changes
grep -n "sport=MMA" src/config/index.ts src/background.ts
grep -n "nav_1=" src/background.ts src/content.ts

# Build still clean
npm run build
```

```js
// Confirm Pick6 + DK + Betr stores intact
chrome.storage.local.get(['lines_pick6_latest','lines_dk_sportsbook_latest','lines_betr_manual_v1'], r => {
  console.log('p6 fighters:', r.lines_pick6_latest?.fighters?.length);
  console.log('dk fighters:', r.lines_dk_sportsbook_latest?.fighters?.length);
  console.log('betr manual:', r.lines_betr_manual_v1?.fighters?.length);
});
```

## Context for future Claude

- The session arc was: DK fix → Pick6 URL fix → Pick6 scrape fix → confirmed working → user pivoted to UI planning.
- User's working style this session: "Pick the safe path, walk it step-by-step, one ask per turn." Honor that.
- Don't pre-emptively restyle the lean-cell. Wait for the Claude Desktop markdown plan.
- The `.fighter-main` grid is touchy. CSS changes that look fine in DevTools may break the row layout — always browser-verify on the real analyzer page, not just on a clean build.
- If the user comes back and Pick6 has stopped fetching again, first check whether `?sport=MMA` still resolves to a stat-tab-bearing page (`category/129` or wherever DK lands it). The most common failure mode here is URL-pattern drift, not selector breakage.
