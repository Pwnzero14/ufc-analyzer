# Plan — Lean-cell compactness pass

**Branch:** `feature/sleek-theme-v1`
**Direction:** Keep the existing visual style (slab badge, animated meter, gradient `~EV`, colored chips). The visible problem is **horizontal overlap**, not aesthetics. This plan is a pure dimension + text-length pass.
**Supersedes:** `PLAN_2026_05_15_LEAN_CELL_QUIET_LINE.md` — delete that file once this is in flight.
**Verification requirement:** `.fighter-main` is grid-density-sensitive. Per memory `feedback_test_dense_grid_rewrites_visually.md`, browser-verify before declaring done.

---

## Diagnostic — why the cell looks like it's overlapping

The lean-cell column is fixed-width:

- `analyzer.html:437` (main grid): `grid-template-columns: 220px 1fr 180px 180px 22px` — lean-cell gets `180px`.
- `analyzer.html:1887` (fight-pair grid, the layout in the current screenshot): `minmax(160px, 1.1fr) minmax(0, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 22px` — lean-cell can shrink to `120px`.

Inside `.lean-cell`:

- The slab badge has `width: 100%` (`analyzer.html:2352`), so it fills the column exactly — no overflow there.
- Each chip below (`.conflict-warn`, `.consensus-lean`, `.archive-accuracy-badge`, `.ev-label`, `.weighted-avg-label`, `.fair-value-chip`) is sized by its text content.
- With `.lean-cell { align-items: flex-end }`, chips wider than the column overflow **leftward** — which lands them on top of the `.stats-mini` column to the left.

At ~120px column width, strings like `~EV: +36% (4%)`, `⚡ consensus`, `⚠ Stat split`, `📊 FT 60% · SS 55%` all exceed the column and clip into the previous column. That's the "overlap."

The fix: shorten the text, shrink the fonts, tighten the padding. Style stays.

---

## Changes

### 1. Shrink the slab proportionally — `analyzer.html:2338-2354`

```css
.lean-badge {
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: 12px;            /* was 13px */
  letter-spacing: 0.08em;     /* was 0.14em */
  padding: 5px 9px;           /* was 7px 12px */
  border-radius: 5px;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;                   /* was 8px */
  min-width: 0;               /* was 150px — let column size it */
  width: 100%;
  transition: background 0.4s;
}
```

Background, border, box-shadow on `.lean-over` / `.lean-under` / `.lean-push` (`analyzer.html:530-533`): leave untouched.

### 2. Pull the inline conf% tighter — `analyzer.html:2355-2362`

```css
.lean-conf-inline {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;           /* was 10.5px */
  font-weight: 600;
  opacity: 0.92;
  margin-left: auto;
  flex-shrink: 0;
}
```

Smaller font + tighter `gap` on the parent badge means the verdict text and `71%` stop fighting for the same row width.

### 3. Shrink the confidence meter — `analyzer.html:535`

```css
.confidence-meter {
  width: 110px;               /* was 138px */
  height: 6px;
  background: var(--border2);
  border-radius: 3px;
  overflow: hidden;
  margin-top: 2px;
}
```

Animations (shimmer + hologram) at `2646-2685` — **leave as-is** per user preference.

### 4. Drop colons + tighten text in the chip emitters — `src/analyzer.ts`

`~EV` chip at `:13626`:

```ts
${leanEvDetail != null ? `<div class="ev-label" title="${leanEvDetail.isAssumedVig ? 'Assumed -110 vig (no book odds for FP)' : `Actual odds · profit ${leanEvDetail.profit.toFixed(2)}x${leanEvDetail.vig != null ? ` · vig ${leanEvDetail.vig}%` : ''}`}">${leanEvDetail.isAssumedVig ? '~' : ''}EV ${leanEvDetail.ev > 0 ? '+' : ''}${leanEvDetail.ev}%${!leanEvDetail.isAssumedVig && leanEvDetail.vig != null ? `<span style="color:${leanEvDetail.vig > 5 ? 'var(--red)' : leanEvDetail.vig > 3 ? 'var(--amber)' : 'var(--green)'};font-size:7.5px;margin-left:3px">${leanEvDetail.vig}%</span>` : ''}</div>` : ''}
```

Changes:
- `~EV: +12%` → `~EV +12%` (dropped colon)
- `(4%)` parens → bare `4%` with smaller font (7.5px) and 3px left margin — saves ~10px width.

`W.Avg` chip at `:13627`:

```ts
${weightedAvg != null ? `<div class="weighted-avg-label">W.Avg ${weightedAvg.toFixed(1)}</div>` : ''}
```

Dropped the colon.

FV chip at `:13635`:

```ts
return `<div class="fair-value-chip" style="font-size:8.5px;padding:1px 6px;border-radius:5px;background:${bg};border:1px solid ${col}40;color:${col};letter-spacing:0.04em" title="Fair value ${fvVal.toFixed(1)} — edge ${fvEdge > 0 ? '+' : ''}${fvEdge.toFixed(1)} pts vs active line">FV ${fvEdge > 0 ? '+' : ''}${fvEdge.toFixed(1)}</div>`;
```

Changes: `font-size:9px` → `8.5px`, `padding:2px 7px` → `1px 6px`, `border-radius:6px` → `5px`.

### 5. Shrink the secondary chip fonts — `analyzer.html`

`.ev-label` / `.weighted-avg-label` base block at `538-539`:

```css
.ev-label { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: var(--text2); margin-top: 1px; }
.weighted-avg-label { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: var(--text2); margin-top: 1px; }
```

`.weighted-avg-label` override at `1663-1668`:

```css
.weighted-avg-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px;             /* was 8.5px */
  color: var(--text3);
  margin-top: 2px;
}
```

`.consensus-lean` at `1576-1583`:

```css
.consensus-lean {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8.5px;           /* was 9px */
  font-weight: 700;
  letter-spacing: 0.04em;     /* was 0.06em */
  color: var(--gold);
  margin-top: 2px;
}
```

`.archive-accuracy-badge` at `1585-1591`:

```css
.archive-accuracy-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8.5px;           /* was 9px */
  margin-top: 2px;            /* was 3px */
  color: var(--text3);
  letter-spacing: 0.02em;
}
```

`.conflict-warn` at `4318`:

```css
.conflict-warn { font-size: 8.5px; font-weight: 600; color: #f0c040; opacity: 0.85; margin-top: 2px; letter-spacing: 0.02em; cursor: default; }
```

`.ev-label` sleek-theme override at `2749-2774` (gradient bg + hover lift): **leave as-is** per user preference. The smaller base font carries through.

### 6. Tighten the cell gap — `analyzer.html:522`

```css
.lean-cell { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
```

`gap: 4px` → `gap: 2px`. Stacks chips closer so the column reads as one block.

### 7. Audit compact-view + `@media` overrides

Re-read these blocks and confirm they don't re-inflate the dimensions:

- `analyzer.html:3879-3889` — `@media` with `.lean-badge` + `.confidence-meter { width: 100% }`. If `.lean-badge` here sets `font-size` or `padding`, reduce proportionally.
- `analyzer.html:4199-4212` — `@media` with `.lean-badge`, `.confidence-meter`, `.ev-label`. Same audit.
- `analyzer.html:4238-4251` — `body.compact-view` block with `.weighted-avg-label`, `.ev-label`, `.lean-cell { align-items: flex-start }`. Compact-view already prioritizes density; reduce font sizes here too if they're above 8px.

Don't blanket-edit — read each block, adjust only the dimensions that don't already follow the new pattern.

---

## What's NOT changing

- Slab tinted background, border, glow — kept.
- Confidence meter `::before` shimmer + `::after` hologram animations — kept (user prefers current style).
- `.ev-label` gradient background + hover-lift transform — kept.
- `.fair-value-chip` inline-styled pill — kept (just smaller).
- Color treatment of every chip — kept.
- Markup structure (no new wrappers, no removed elements) — unchanged.

---

## Verification — mandatory

1. `npm run build` — clean.
2. Reload extension, open `analyzer.html` with Allen vs Costa loaded (fight-pair mode, ~120px lean-cell column).
3. **Visually check each fighter row's `.lean-cell`**:
   - `~EV +12% 4%` fits inside the column without clipping left into `.stats-mini`.
   - `W.Avg 73.2` fits.
   - `⚡ consensus` / `⚠ Stat split` / `⚔ Rival models dissent` / `📊 FT 60% · SS 55%` all fit.
   - `FV +5.2` chip fits with the smaller padding.
   - Slab still reads as a slab — just smaller.
4. Toggle compact-view — confirm the cell still reads at higher density (font shouldn't be below 8px in any state).
5. Test main-grid layout (single-fighter wide view) — confirm the 180px lean-cell column still looks balanced with the smaller slab.
6. Hover `~EV` — gradient + lift still fires (preserved by design).

**Per memory `feedback_test_dense_grid_rewrites_visually.md`: build success ≠ done. Open the page.**

If overlap persists at 120px column width after these changes, the next lever is widening the column: change `analyzer.html:1887` from `minmax(120px, 1fr) minmax(120px, 1fr)` to `minmax(110px, 1fr) minmax(140px, 1.1fr)` (stealing 10px from `.stats-mini` and giving 20px to `.lean-cell`). Don't do this preemptively — only if step 3 still shows clipping.

---

## Rollback

```
git checkout -- src/analyzer.ts analyzer.html
```

All changes are in those two files.

---

## Suggested commit message

```
fix(ui): compact lean-cell to stop horizontal overlap into stats-mini

- Shrink .lean-badge font (13→12px), padding (7/12→5/9px), letter-spacing
  (0.14→0.08em); drop min-width so column drives sizing
- Pull .lean-conf-inline font to 9.5px, badge gap to 4px
- Confidence meter width 138→110px (animations preserved)
- Drop colons from "~EV:" and "W.Avg:"; shrink vig% inline span
- Reduce font-size on .consensus-lean / .archive-accuracy-badge /
  .conflict-warn / .ev-label / .weighted-avg-label / .fair-value-chip
  to 8–8.5px
- Tighten .lean-cell gap 4→2px
- Audit compact-view + @media overrides for dimension consistency

No structural changes; slab, animations, gradient ~EV, and chip colors
all preserved per user direction.
```
