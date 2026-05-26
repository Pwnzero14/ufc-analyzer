# Resume — 2026-05-01 EOD

Branch: `feature/sleek-theme-v1` (39 ahead of origin after weight-miss fix commit, +1 uncommitted = 40)
UFC Perth fight: Sat May 2 ~11 AM EST settle window.

---

## Shipped this session

### 1. Weight-miss badge attribution — DONE (committed `b89bf4b`)
- Per-fight-pair article-count comparison in `fetchAllFighterNews` ([src/analyzer.ts:10556-10645](src/analyzer.ts#L10556-L10645))
- Word-form lbs extraction (four-pound, 4-pound, etc.) in [src/analyzer/weight-miss.ts](src/analyzer/weight-miss.ts)
- Description-aware name matching in [src/analyzer/news.ts](src/analyzer/news.ts)
- Verified live: Gerald Meerschaert shows `⚖ MISS 4 LB`, no false positives.

### 2. Best Picks: per-book FP candidates (PrizePicks support) — UNCOMMITTED
- `calcLean` accepts optional `platformOverride: SourcePlatformKey` ([src/analyzer.ts:4072-4136](src/analyzer.ts#L4072-L4136))
- When called with override, uses platform-specific avgFP (`db.avgFP_pp` etc.) instead of cross-platform average — PP scoring (sub attempts +4pt, no quick-win) is now correctly evaluated
- `EffectiveLean` augmented with `_platform?: SourcePlatformKey`
- Best Picks `collectLeanCandidates` generates one FP candidate per book that has a line (`FP_BOOKS_FOR_BEST_PICKS = ['pick6','underdog','prizepicks','betr']`)
- Render path (`lineForLeanSource`, `formatSourcePlatformLabel`, archive lookup) honors `_platform`
- SS/TD/FT unchanged (same scoring across books)

### 3. Best Picks: chalk + side-availability filters — UNCOMMITTED, **PARTIALLY BROKEN**
- Added `isCandidateUsable` in `collectLeanCandidates` ([src/analyzer.ts:6169-6207](src/analyzer.ts#L6169-L6207))
- Reject SS/TD/FT candidates where:
  - Platform is UD/DK and `*_under_odds`/`*_over_odds` is null (side not offered)
  - Implied probability > 0.667 (= worse than -200 American / under 0.5x payout — chalk)
- FP unaffected (no side odds on pick-em props)

---

## OPEN BUG — chalk filter not catching all targets

### Symptom
After build + reload, Best Unders still shows:
- **Junior Tafa UNDER FT 12.5** with "Underdog 12.5" tag
  - Underdog UI confirmed Lower side is "—" (not offered) at 12.5
- **Tai Tuivasa UNDER FT 14.99** with "Underdog 14.99" tag
  - User confirms ~-300 chalk to finish inside distance

Filter code IS in `dist/analyzer.js` (verified via grep `CHALK_IMPLIED_PROB_LIMIT`).

### Hypothesis to investigate next session

The filter is wired correctly but `f.ft_under_odds` for these fighters is probably:
- **Not null** (so the "side not offered on UD/DK" check passes), AND
- **Not chalk-priced** by our threshold (so the implied-prob > 0.667 check passes)

Likely causes:
1. **Cross-source pollution**: `ft_under_odds` may be set from DK or another source even when UD doesn't offer the Lower side. Check `mergeFighters` allowlist behavior in `background.ts`.
2. **Token "missing" value**: Underdog API may return a placeholder (e.g., 0 or 0.01) instead of null when side is not offered. Our `sideOdds == null` check wouldn't catch it.
3. **The displayed `_platform` doesn't match the source of the odds**: Best Picks shows "Underdog" but the odds in `ft_under_odds` may have come from DK (which posts both sides at chalk prices). Then platform check `=== 'underdog'` doesn't match what populated the odds field.

### Diagnostic snippet for next session

In analyzer console after fetch:
```js
['Tai Tuivasa', 'Junior Tafa', 'Quillan Salkilld'].forEach(name => {
  const f = window.allFighters?.find(x => x.name.includes(name)) || null;
  if (!f) return console.log(name, 'NOT FOUND');
  console.log(name, {
    line_p6_ft: f.line_p6_ft,
    line_ud_ft: f.line_ud_ft,
    line_dk_ft: f.line_dk_ft,
    ft_over_odds: f.ft_over_odds,
    ft_under_odds: f.ft_under_odds,
  });
});
```

(`window.allFighters` may not be exposed — if not, add `(window as any).allFighters = allFighters` temporarily near top of analyzer.ts for debugging, or use the existing debug API.)

### Proposed fix paths

**A. Track odds source per side** — store `ft_under_odds_source: 'underdog'|'draftkings'|null` so the filter knows which book the odds came from. Then check: if displayed platform === underdog AND odds source !== underdog → reject (side not on UD).

**B. Tighten chalk threshold for FT specifically** — fight-time UNDER (finish-inside-distance) is structurally chalk-prone. Maybe FT chalk threshold should be 0.60 (= -150 American) instead of 0.667.

**C. Hard-reject pick-em platform-tagged stat picks if the side has no separate odds entry** — but this conflicts with P6/PP pick-em which have no odds at all.

Recommendation: start with **A** (tracking odds source). It's the cleanest signal — "did UD actually offer this side, or are we just inheriting chalk DK odds?"

---

## Other context

- DM vs Prates settle gate Sat May 2 ~11 AM EST — predictor v2 lift verification still pending after settle
- Don't propose Kelly stakes (memory: `feedback_no_kelly_stakes`)
- Best Picks PP candidates now eligible — verify some appear after the chalk-filter bug is fixed
- Backups in `backups/full_project_snapshot_20260430_135140/`

---

## Quick reference — key code locations

- `calcLean` with platformOverride: [src/analyzer.ts:4072](src/analyzer.ts#L4072)
- Best Picks per-book FP: [src/analyzer.ts:6147-6178](src/analyzer.ts#L6147-L6178)
- Chalk + availability filter: [src/analyzer.ts:6169-6207](src/analyzer.ts#L6169-L6207)
- `lineForLeanSource` (Best Picks scope, platform-aware): [src/analyzer.ts:6072](src/analyzer.ts#L6072)
- `formatSourcePlatformLabel` (with platformOverride): [src/analyzer.ts:1942](src/analyzer.ts#L1942)
- `EffectiveLean` interface (with `_platform`): [src/analyzer.ts:102](src/analyzer.ts#L102)
- `mergeFighters` allowlist: `src/background.ts` (~line 1226)
