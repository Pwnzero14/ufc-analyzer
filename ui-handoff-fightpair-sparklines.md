# UI Handoff — Fight-Pair Layout + Line Movers Sparklines

**Branch:** `feature/sleek-theme-v1` (continue on this branch or fork)
**Primary file:** `src/analyzer.ts`
**Status:** Design approved, ready to implement

Two coupled features. Ship together — fight-pair is the structural change; sparklines piggyback on `line_history_v1` you already store.

---

## Feature 1: Fight-pair layout (upcoming-card view)

### Why

Today fighters render as a vertical list of individual cards. Same-fight opponents are visually disconnected, so the negative-correlation rule (don't double-dip same-fight UNDER SS / UNDER FP leans on opposing fighters) is invisible at the UI level — it lives only in the user's head. Putting opponents adjacent with a shared spine surfaces that correlation at read time.

### Data transformation

Group fighters into fight pairs before rendering. Each fight object:

```ts
type Fight = {
  fighterA: FighterRecord;          // may be placeholder
  fighterB: FighterRecord | null;   // null = late-cancellation / awaiting opponent
  weightClass: string;
  rounds: 3 | 5;
  cardPosition: 'main' | 'co-main' | 'main-card' | 'prelim';
  sharedLines: {
    ftLine?: number;                // fight time line — definitionally shared
    ctrlLine?: number;              // only if both fighters have a CTRL prop
  };
  correlation?: {                   // computed at render time
    type: 'neg-correlated-same-direction'; // both UNDER SS, both UNDER FP, etc.
    stat: 'SS' | 'FP' | 'FT';
    note: string;                   // human-readable for the warning pill
  } | null;
  isTopEdgeFight: boolean;          // does this fight contain the slate's top edge?
};
```

The pairing source is already implicit in the card snapshot — promote it to a first-class structure.

### DOM structure

Three-column CSS grid per fight, `1fr 110px 1fr`:

```
[ fighterA card ] [ shared spine ] [ fighterB card ]
```

At widths < 900px, collapse to stacked:

```
[ fighterA card ]
[ shared spine (horizontal) ]
[ fighterB card ]
```

### Fighter card contents (per side)

- Header row: name (14px), record + style chip, lean badge (▼ UNDER 67% with confidence)
- Line strip: 5-column grid (SS / FP / FT / TD / CTRL) × N rows (UD / PP / DK / Betr). Missing cells render `—` not blank.
- Projection row: PROJ stat, LINE, Δ (color-coded). Sub-text: L3 trend + PTD value.
- The top-edge cell (the one driving the slate's top-edge lean) gets a yellow tint to breadcrumb from headline → source.

### Spine contents

Render conditionally — most spines will be sparse. Hide the spine column entirely if all four blocks below are empty.

- Rounds + weight chip (always present)
- FT line value + sparkline if `line_history_v1` has movement on the FT line
- CTRL line value (only if both sides have a CTRL prop)
- Correlation warning pill — only when `fight.correlation` is non-null
- TOP EDGE callout — only when `fight.isTopEdgeFight`

The spine uses a dashed border to distinguish it from the two solid-bordered fighter cards.

### Edge cases

| Case | Behavior |
|---|---|
| Placeholder fighter | Dashed-border card, italic name, all projection cells `—`, no lean badge, no contribution to correlation calc |
| Both placeholders | Skip rendering the fight entirely — too speculative |
| One side null (late cancellation) | Single full-width card, greyed-out "awaiting opponent" spine |
| Missing line data on one side | That side's line strip cells are `—`, projection still renders if UFCStats history allows |
| No correlation, no top edge, no shared CTRL | Spine collapses to just rounds + weight chip + FT line |

### Backward compatibility — do NOT break

These views still iterate over fighters individually, not fights. Don't refactor them in this PR:

- AI BEST PICKS view
- Parlay Lab (left-column legs list, AI suggested parlays, SYNERGY PAIRS)
- DATA tab prop-line predictions table
- All `window.*` console overrides: `markMissedWeight`, `setFighterStyle`, `resetFighterBaseline`, `listFighterStyles` (not exposed yet — leave alone)

### Out of scope

- Density toggle (Compact / Default / Expanded) — separate PR
- Bar history charts inline in the pair card — keep as click-to-expand drawer or below the pair card, but don't try to fit them inside the pair grid

---

## Feature 2: Sparklines in LINE MOVERS

### Why

Current rows are text-only: `UD 27.5→35.5 ▲8 [RLM UNDER]`. The same delta value can come from a steady drift, a single jump, or a late surge — currently indistinguishable. A 90×18 sparkline next to the arrow makes the pattern legible at a glance.

### Data source

`chrome.storage.local['line_history_v1']` — already populated. Expected shape (verify against actual):

```ts
type LineHistory = {
  [fighterName: string]: {
    [stat: string]: {          // 'SS' | 'FP' | 'FT' | 'TD' | 'CTRL'
      [platform: string]: {    // 'UD' | 'PP' | 'DK' | 'Betr'
        points: Array<{ t: number; v: number }>;  // unix ts + line value
      };
    };
  };
};
```

### Render

Inline SVG, slot between the delta arrow and the RLM badge in each LINE MOVERS row.

```ts
function renderSparkline(points: Array<{t: number; v: number}>, direction: 'up' | 'down'): SVGElement {
  if (points.length < 2) return null;  // degrade to text-only
  const w = 90, h = 18, pad = 2;
  const values = points.map(p => p.v);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const stroke = direction === 'up' ? '#5ee589' : '#ff5a73';
  return svg`
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <polyline points="${coords}" stroke="${stroke}" stroke-width="1.5" fill="none"/>
      <circle cx="${pad}" cy="${coords[0].split(',')[1]}" r="1.8" fill="#6c7080"/>
      <circle cx="${w - pad}" cy="${coords[coords.length-1].split(',')[1]}" r="1.8" fill="${stroke}"/>
    </svg>
  `;
}
```

### Edge cases

| Case | Behavior |
|---|---|
| `points.length < 2` | Don't render the SVG; row stays text-only (current behavior) |
| `points.length === 2` | Render as straight diagonal — still informative (slope direction) |
| Flat line (no movement) | Render horizontal polyline — visually communicates "delta but no path" |
| Direction = down (drifter) | Use red stroke + red end-dot |
| Direction = up (steamer) | Use green stroke + green end-dot |

### Performance

`line_history_v1` could be large. Only build sparklines for fighters currently rendered in LINE MOVERS (not all stored fighters). Memoize by `name + stat + platform` if re-renders become a problem — but probably premature.

### Out of scope (phase 2)

- Inline sparklines next to each line value in the main fighter list row. Reasonable next step but defer until we see the LINE MOVERS version in use. Visual density on the main list is already high.

---

## Acceptance criteria

- [ ] Open `analyzer.html`, MAIN EVENT section renders Allen + Costa side-by-side with a spine between them
- [ ] Spine shows the negative-correlation warning (both UNDER SS) for Allen vs Costa
- [ ] TOP EDGE +74% surfaced in the spine, not buried in the stat-summary row
- [ ] Late-card fight with one placeholder renders cleanly (dashed card + no correlation calc)
- [ ] LINE MOVERS rows show a sparkline between the delta arrow and the RLM badge
- [ ] Sparkline visibly differs between a steady drift vs an early jump (eyeball test)
- [ ] AI BEST PICKS, Parlay Lab, DATA tab predictions all render unchanged
- [ ] `window.markMissedWeight`, `setFighterStyle`, `resetFighterBaseline` all still work via console
- [ ] No new writes to `lines_open_v1` or `line_history_v1` introduced anywhere
- [ ] Narrow window (< 900px) collapses pair cards to stacked layout without overlap

---

## Don't-do list

- Do NOT mutate `lines_open_v1` or `line_history_v1` from this code path. Line movement data is irreplaceable. Read-only access only.
- Do NOT remove or rename the existing console overrides — too much muscle memory invested.
- Do NOT change the predictor logic (duration model, book prior, RLM calibration, adaptive trend rate). This PR is presentation-layer only.
- Do NOT collapse the bar history charts in the same PR. Keep them where they are; the pair-card layout opens above them.

---

## Reference

- Pre-mockup screenshots: existing `analyzer.html` rendering, see chat history
- Approved layout direction: fight-pair with shared dashed-border spine; sparklines in LINE MOVERS slot between delta and RLM badge
- Colors used in mockup (match existing theme): bg `#0a0e16`, card `#11151f`, border `#1f2435`, text `#d4d8e0`, muted `#9aa0b4 / #6c7080`, green `#5ee589`, red `#ff5a73`, yellow `#ffd24a`, purple chip `#b78ff0`
