# Resume — Post-Perth (2026-05-02 onward)

Branch: `feature/sleek-theme-v1` (40 ahead of origin, all clean — last commit `8d9c17f`)
UFC Perth (Della Maddalena vs Prates) fought Sat May 2 ~11 AM EST.

---

## What shipped end of last session

### Best Picks UD FT UNDER filter (`8d9c17f`)
Fixed: Tafa / Tuivasa / Salkilld FT UNDERs no longer surface in Best Unders. Three layers in [isCandidateUsable](src/analyzer.ts#L6199-L6228):
1. **Per-side UD availability flags** (`ud_ss_*_avail`, `ud_td_*_avail`, `ud_ft_*_avail`) — populated at UD ingest in [parseUnderdogApiFighters](src/background.ts#L1816-L1825), wired through [mergeFighters](src/background.ts#L1228-L1233) and [mergeAndEnrich](src/analyzer.ts#L13379-L13384). Catches Quillan-style explicitly missing sides.
2. **Tightened FT UNDER chalk threshold** to 0.55 implied (~-122). Catches Tai-style mild chalk (his 0.595 was sneaking past the old 0.6).
3. **+money disagreement reject**: UD FT UNDER with implied < 0.45 → reject. Catches Tafa-style (UD priced UNDER at 1.5x = +money, market saying UNDER is the unlikely side, model said strong UNDER → big disagreement = likely model error).

Also bundled in the commit: **per-book FP candidates** (PrizePicks support) so PP-specific FP scoring (sub attempts +4pt, no quick-win) surfaces as its own pick. See `FP_BOOKS_FOR_BEST_PICKS` and the per-book FP loop in [collectLeanCandidates](src/analyzer.ts#L6231-L6240).

Also: `parseOddsValue` now treats `0` as null ([src/background.ts:424-441](src/background.ts#L424-L441)) — was a UD placeholder for unoffered sides being misread as a real multiplier.

### Memory saved
- [project_underdog_api_quirks.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_underdog_api_quirks.md) — UD API returns symmetric multipliers even when UI is one-sided. Don't trust avail flag alone; pair with chalk band + +money disagreement.

---

## What to do this session (post-event)

### 1. Verify the new filter held under settled lines
Open Calibration view. Check archive of UD FT UNDER picks for Perth event. Expectations:
- Tafa, Tuivasa, Salkilld should NOT appear in archived Best Picks (they were filtered before the card)
- If any UD FT UNDER pick DID surface and got archived (i.e., there was a fighter on the card whose UD line passed the filter), check whether it hit. The filter trades coverage for quality — losing a real pick is the failure mode to watch for.

### 2. Predictor v2 lift verification (deferred from previous resumes)
Predictor improvements #1+#2 shipped 2026-04-27 (duration model + book prior). Perth was the first full slate to settle since. Compare:
- Predicted vs actual finish times (FT model #1 lift)
- Calibration of book-prior-weighted probabilities vs unweighted (book prior #2 lift)
- See [project_predictor_improvements_remaining.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_predictor_improvements_remaining.md) — #3 (RLM-as-calibration) and #4 (adaptive trend rate) are still pending.

### 3. Open follow-ups still on the board
- **Pick6 pickGroup polling** — auto-fetch still misses CTRL ([project_pick6_pickgroup_polling_pending.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md)). Worth checking now that the slate is settled and there's no rush.
- **Analyzer phase-2 split** — Betr IIFE + UI panels still inline ([project_analyzer_split_progress.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md)). Post-fight is the right window.

### 4. Push the branch?
Local is 40 ahead of `origin/feature/sleek-theme-v1`. No urgency, but if user wants to back it up to remote, `git push` is fine.

---

## Diagnostic snippet (kept handy in case the UD filter regresses)

If a Best Pick surfaces that the user thinks shouldn't be there, paste in DevTools console on the analyzer tab:

```js
// Need to temporarily expose allFighters first — uncomment near top of analyzer.ts:
//   (window as any).allFighters = allFighters;  // after `allFighters = mergedEntries.map(...)`
['Fighter Name 1', 'Fighter Name 2'].forEach(name => {
  const f = (window).allFighters?.find(x => x.name.includes(name));
  if (!f) return console.log(name, 'not found');
  console.log(name, {
    line_ud_ft: f.line_ud_ft, line_dk_ft: f.line_dk_ft, line_p6_ft: f.line_p6_ft,
    ft_over_odds: f.ft_over_odds, ft_under_odds: f.ft_under_odds,
    ud_ft_over_avail: f.ud_ft_over_avail, ud_ft_under_avail: f.ud_ft_under_avail,
  });
});
```

The window exposure was removed — re-add temporarily for debugging. Or add a `console.warn` block in `isCandidateUsable` like we did mid-session (gets stripped before commit).

---

## Don't forget
- Don't propose Kelly stakes ([feedback_no_kelly_stakes.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_kelly_stakes.md))
- Reset Lines preserves Betr pre-fight-week, clears on/after event day ([feedback_betr_reset_rule.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_betr_reset_rule.md))
- Backups in `backups/full_project_snapshot_20260430_135140/`
