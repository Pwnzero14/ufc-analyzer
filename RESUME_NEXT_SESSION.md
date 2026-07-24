# RESUME — 2026-07-24 (fight day is SAT 2026-07-25, ~19:00)

Card: **UFC Fight Night: Ankalaev vs Guskov** (26 fighters, 13 fights).

## State
- Branch `feature/sleek-theme-v1`, **clean, 0 unpushed**. `master` mirrored (trees identical).
- Head: `c9f2eef`. MODEL_VERSION **9**.
- Books loaded: P6 26, UD 26, PP 26, Betr 26, DK 4. **Still missing: TDs and Underdog fantasy.**

## ⚠️ TOP PRIORITY NEXT SESSION — Pick6 Less-button scraper is broken

`fp_under_available` is **`undefined` for all 26 Pick6 fighters**, so every dog FP UNDER
currently **fails OPEN** and can reach the board as an unplaceable pick.

**Root cause:** the tertiary scrape path in `src/content.ts` (~line 239) only sets the flag
when `findCardText(name)` locates the card:

```ts
const cardText = findCardText(name);
if (cardText != null) {
  const less = /\bLess\b/i.test(cardText);
  if (isFp) fighters[name].fp_under_available = less;
  ...
}
```

`findCardText` is returning null on Pick6's **current** layout. The user is now on
`pick6.draftkings.com/category/74` — the code was written for an earlier URL/DOM
(memory `project_dk_pick6_mma_consolidation` records a prior reshuffle to `category/129`).
Lines still scrape fine; only the card-text lookup fails.

**Fix requires the live page** — inspect Pick6's current card DOM, repair `findCardText`,
confirm `fp_under_available` comes back true/false per fighter, and verify the
More-only fighters listed below get `false`.

### Why the other two guards can't cover for it
`shouldSkipFpSideForFighter` has three checks; on this card all three miss:
1. `fp_under_available` — undefined ⇒ fails open (above).
2. `moneylineRole(f)` — returns **`'fav'`** for Steve Erceg. The bout is near pick-em and the
   ML flip-flops, so neither the `'dog'` nor the dead-even branch fires.
3. `pick6FpInflatedVsUnderdog(f)` — needs an Underdog FP line to compare; none exists for him.

**Key insight:** Pick6 chooses More-only from *their own* pricing, which can disagree with the
sportsbook. A sportsbook favourite can be Pick6's structural dog. No moneyline-derived
inference fully substitutes for the scraped Less flag.

### Stopgap in place (commit `c9f2eef`)
Storage-backed manual override, checked FIRST in `shouldSkipFpSideForFighter`:

```js
window.blockFpUnder('Steve Erceg')     // mark Pick6 FP UNDER unplaceable
window.unblockFpUnder('Steve Erceg')   // clear when Pick6 adds a Less button
window.listFpUnderBlocks()
```

Key `manual_fp_under_blocked_v1`, reloaded at startup — no rebuild needed to flip.

**Pick6 More-only (no Less button) as of 2026-07-24 FP tab** — confirmed from user screenshot:
`Erceg, Saidov, Bonfim, Petersen, Davis, Fortune, Izagakhmaev`
Have Less: `Sola, Kuniev, Aliev, Jacoby, Temirov`.

⚠️ **Verify whether the user actually ran `blockFpUnder('Steve Erceg')`** — it was
recommended at end of session but not confirmed.

## Other open items
- **Run `/ufc-lean-audit`** against the full slate before entries lock. Not yet run on the
  complete board.
- **Sam Patterson SS UNDER 26.5 (proj 43.0)** — `⚠ PROJ SAYS OVER`, ~16.5 gap, and the
  board's highest EV (+38%). Largest projection contradiction; wants a manual look.
- **Ankalaev appears in both columns** — FP UNDER 94.5 (top pick) and SS OVER 37.5. The SS
  over carries BOTH `PROJ SAYS UNDER` and `NEEDS ROUNDS`; it's the weaker of the two.
- **Ponzinibbio double-flag decision: CLOSED** — he fell off the board organically as the
  slate filled. The 8pt duration-coupling demote was sufficient; no hard drop needed.

## Shipped this session (all pushed, both branches)
| | |
|---|---|
| 182 | line-movement sparklines in platform chips |
| 183 | DATA tab sub-nav rail (+ sticky collision fix) |
| 184 | structured factor rows on stat panels (+ **inverted-polarity fix**) |
| 185 | semantic color mapping (stat owns board color; one book palette) |
| 186 | FP lean panel chips + Pro/Risk un-inverted; panel title from `lean._source` |
| 187 | Best Picks five-level pass (row reason, archive chip, n=, deck, EV split) |
| 188 | `⚠ PROJ SAYS` flag — projection opposing its own lean |
| 189 | duration coupling → `⚠ NEEDS ROUNDS` (**MODEL v9**) |
| 190 | Betr Screenshot Reader save attaches opponent |
| 191 | Parlay Lab five-level pass |
| 192 | Best Picks exposure + audit pass |
| — | NAME_ALIAS `Muhammad Said`→`Muhammad Saidov`; Mike Davis pinned to UFCStats ID |

## Betr gotchas (hard-won — see `feedback_betr_entry_workflow`)
1. Console snippets must write **BOTH** `lines_betr` **and** `lines_betr_manual_v1` — the
   board renders from the base key; the manual override only applies in the fetch path.
2. Every Betr row needs an **`opponent`** — `pruneOrphanFighters` drops opponent-less rows
   once a payload has ≥10. Fixed at source in 190, but hand-written rows still need it.
3. Use **UFCStats-canonical spellings** or the reader's card-filter silently drops them.
