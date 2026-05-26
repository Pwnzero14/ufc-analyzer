# UI Handoff — Expanded-View Spine Fill

**Builds on:** Already-shipped fight-pair layout (`feature/sleek-theme-v1`).
**Primary file:** `src/analyzer.ts`
**Status:** Design approved with three confirmed choices (per-fighter color, show empty Common Opps, L5 window).

## Problem

When the user expands a fight-pair card to show the bar-history panels, the center spine column doesn't extend. There's a tall empty corridor between the two fighters' bar grids. The spine column is also where shared / comparative fight information would most naturally live — there's nowhere else in the UI today that surfaces head-to-head context.

## Goal

Fill the spine in expanded mode with four stacked sections of comparative fight information. Keep compact/default mode unchanged.

## Mode trigger

The spine has two states, switched by whether the fight pair is expanded:

| State | Trigger | Spine width | Spine content |
|---|---|---|---|
| Narrow (current) | Compact or default density, OR fighter cards collapsed | 110px | Only the shared header chip (rounds, weight, FT line, correlation warning, top-edge callout) |
| Filled (new) | Expanded density on the fight pair (bar grids visible) | 220px | Shared header chip + three new sections |

Grid changes: `1fr 110px 1fr` (narrow) → `1fr 220px 1fr` (filled). The fighter cards still flex at `1fr` either side.

## Spine sections (top to bottom, filled mode)

### 1. Shared header (already shipped, unchanged)

Rounds + weight class + FT line value, with optional correlation warning pill and optional top-edge callout. No work needed here — keep as-is.

### 2. MATCHUP

Three rows in a `1fr auto 1fr` grid. Left column = fighter A value (cyan `#5ee5e0`), middle = label (muted `#6c7080`), right = fighter B value (yellow `#ffd24a`).

| Row | Label | Source |
|---|---|---|
| 1 | `SS/fight` | Each fighter's avg significant strikes per UFC fight (already computed by predictor v2 — `factors.avgSS`) |
| 2 | `opp abs` | Each fighter's average SS absorbed by their opponents per fight (`factors.oppAbsorbsSS`) |
| 3 | `P(fin)` | Each fighter's predictor v2 finish probability, as integer percent (`factors.pFinish * 100`) |

Numbers right-aligned for fighter A column (so the digit columns line up against the label), left-aligned for fighter B column.

If any factor is missing for either fighter, render `—` in that cell. Don't skip the row.

### 3. COMMON OPPS

Section heading: `COMMON OPPS`. Body:

- Build the set of UFC opponents each fighter has faced. Use `UFCSTATS_NAME_ALIASES` to normalize names so that platform-rendered names don't fail to match canonical UFCStats names.
- Intersect the two sets, limited to each fighter's last 8 UFC fights.
- Take up to 3 most recent shared opponents (by fight date).
- For each shared opponent, render one row:

```
[opponent name (left-aligned, 12px, muted)]
  cyan: A's SS · A's FP · A's result(W/L/D, KO/SUB/DEC)   yellow: B's SS · B's FP · B's result
```

**Empty state** (decided): render the section heading then an italic muted line `none in past 8 fights`. Section stays visible — don't hide it. This communicates "the analyzer checked and the answer is zero," which is more useful than the section disappearing.

### 4. L5 TRENDS

Section heading: `L5 TRENDS`. Three rows, one per stat: SS, FP, TD.

Each row is a `70px 26px 70px` grid:

- Left cell: fighter A's last-5-fight sparkline of that stat, cyan stroke `#5ee5e0`, end-dot at the latest value
- Middle cell: stat label (`SS` / `FP` / `TD`), 11px muted, centered
- Right cell: fighter B's last-5-fight sparkline, yellow stroke `#ffd24a`, end-dot at latest value

After the three rows, a small footer row: `Allen` (cyan) left-aligned · `Costa` (yellow) right-aligned. This is the legend for the color choice — without it, a returning user has to remember which color is which.

**Window adjustment:** If a fighter has fewer than 5 UFC fights, use whatever they have (minimum 2 points to render a polyline). Relabel the section heading to `L{n} TRENDS` where n = the smaller fighter's count. If either fighter has <2 UFC fights (true UFC debut), suppress the section entirely — there's nothing to chart.

## Visual spec (recap)

- Spine outer: `background: #0d101a; border: 1px dashed #2a3145; border-radius: 8px; padding: 10px 10px 12px;`
- Section dividers: thin `1px solid #1f2435`, with `padding-top: 10px; margin-top: 10px` on each new section (not the first)
- Section headings: 11px, `color: #6c7080`, `letter-spacing: 0.12em`, centered. Match the existing uppercase style used elsewhere in the analyzer.
- Number text: 11-12px, `color: #d4d8e0` for white, per-fighter color for trend / matchup values.
- Allen color: `#5ee5e0` (cyan).
- Costa color: `#ffd24a` (yellow) — same yellow already used for top-edge callouts, intentionally.

## Sparkline rendering (per-fighter color)

Reuse the sparkline renderer from the LINE MOVERS feature. Add a `color` parameter so it stops being hard-coded to green/red:

```ts
function renderSparkline(values: number[], opts: { color: string; w?: number; h?: number }): SVGElement {
  if (values.length < 2) return placeholderDash();  // render "—" instead
  const w = opts.w ?? 70, h = opts.h ?? 14, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = coords[coords.length - 1].split(',');
  return svg`
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <polyline points="${coords.join(' ')}" stroke="${opts.color}" stroke-width="1.3" fill="none"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="1.6" fill="${opts.color}"/>
    </svg>
  `;
}
```

## Edge cases

| Case | Behavior |
|---|---|
| Placeholder fighter on one side | Spine shows only the shared header. Suppress matchup / common opps / trends sections entirely — no meaningful comparison possible. |
| Both fighters have no projection factors yet | Matchup section renders all `—`. Don't hide. |
| Fewer than 3 last fights for one fighter | Trends section relabels to `L{n}` based on the smaller count. |
| Fewer than 2 fights for one fighter | Trends section suppressed entirely. |
| Name in card snapshot doesn't match UFCStats canonical | Pass through `UFCSTATS_NAME_ALIASES` before intersecting for common opps. Should already be working from the existing alias map work. |
| Fighter A and B in same fight have an existing head-to-head (rematch) | Add a special row at the top of Common Opps: `prior meeting: A's result · B's result` with a distinct background tint. Optional / nice-to-have. |

## Bottom-alignment rule

The spine column should stretch vertically to match the height of the taller of the two fighter cards (with their expanded panel grids). All three columns bottom-align — no dangling content, no asymmetric whitespace.

CSS approach: `align-items: stretch` on the outer grid, `display: flex; flex-direction: column` inside the spine, `flex: 1` on a final spacer div at the bottom of the spine so it pushes content up. This keeps the spine sections at the top and lets the bottom breathe rather than awkwardly stretching the last section.

## Don't-do list

- Do NOT change the narrow-mode (collapsed / compact / default) spine. This is additive — purely a filled-mode treatment.
- Do NOT mutate `lines_open_v1` or `line_history_v1` (the read-only constraint stays).
- Do NOT recompute predictor v2 factors here — read what's already on the fighter record from the prior projection pass. If a factor is missing, render `—`, don't trigger a recompute.
- Do NOT widen the spine to >220px in this PR. If it feels too tight in production, that's a follow-up.
- Do NOT add any tooltips that mutate state. Hovers can show extra info but stay read-only.

## Acceptance criteria

- [ ] Expand Allen vs Costa fight pair: spine widens to 220px and shows four sections.
- [ ] Spine bottom-aligns with both fighter panels — no dangling content corridor.
- [ ] Matchup section: three rows render with cyan A values, yellow B values, centered labels.
- [ ] Common Opps section: shows italic `none in past 8 fights` for Allen vs Costa (they have no shared opponents).
- [ ] Find another fight on the slate where common opponents exist; verify the populated state renders one row per shared opponent with both fighters' stat lines.
- [ ] L5 Trends: three sparkline pairs render, each in correct color, with `Allen` / `Costa` legend at the bottom of the section.
- [ ] Collapse the fight pair (default density): spine returns to narrow 110px and shows only the shared header.
- [ ] Placeholder fighter case: spine in expanded mode shows only the shared header, no new sections.
- [ ] Fighter with 4 UFC fights: trends section heading reads `L4 TRENDS` and renders fine.
- [ ] No console errors. No mutations to stored line data.

## Out of scope (for follow-up PRs)

- Hovering a sparkline to see exact values per fight.
- A click-through from a Common Opps row to that opponent's prior fight detail.
- Mobile / narrow-window collapse rules for the filled spine — stick with desktop-only for now.
- Additional spine sections (predictor-confidence comparison, round-by-round split, etc.).
- The OVER-side correlation warning bug noted separately — different PR.
- Best Picks podium treatment and archive-text collapse — different PR.

## Reference

- Approved mockup of the filled spine: see chat session prior to this spec.
- Decisions confirmed: per-fighter color (cyan/yellow), show empty Common Opps, L5 window.
