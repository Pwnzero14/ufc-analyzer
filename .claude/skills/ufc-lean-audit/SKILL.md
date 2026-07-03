---
name: ufc-lean-audit
description: Audit AI Best Picks / lean output and guard edits to the lean-model code in the UFC Fantasy Lines Grabber. Use this whenever the user asks to audit, sanity-check, or review picks, leans, the Best Picks board, EV numbers, or line selection — and whenever editing lean/pick logic in src/analyzer.ts (computeEffectiveLean, calcSS*, pickTier, best-picks builders). Also use when a pick or line "looks wrong", before locking entries on fight day, or when the user asks why a fighter is/isn't picked.
---

# UFC Lean Audit

House rules for this project's betting model. These were each learned the hard
way (lost entries, wrong lines, unplaceable picks). When auditing picks or
editing model code, check against every section below. When a rule conflicts
with something generic you know about betting, the rule here wins — it encodes
platform-specific reality, not theory.

## Placeability — a correct lean is worthless if the book blocks the side

- A **dog's FP UNDER is placeable ONLY on Underdog**. Pick6 blocks it (the
  `fp_under_available` Less-button flag), PrizePicks and Betr block it too.
  Never endorse a dog FP UNDER pick shown against any book but UD.
- Betr's dog FP OVER is inflated to +money — not true pick-em value. The user
  does not take those.
- PrizePicks and Betr offer SS both sides to all fighters — SS picks are safe
  on side availability.
- A rocket/boost icon on Betr/UD FP lines means OVER-only at +money. The
  line itself is still entered normally; skip logic handles it.
- Underdog's API returns symmetric multipliers even when the app UI is
  one-sided. Availability flags alone are not proof a side exists — the model
  uses chalk-band + plus-money-disagreement rejection for a reason. Don't
  "simplify" that away.

## Line-side selection — which book's number should be shown

- For an OVER pick the **lowest** line across books is the best entry; for an
  UNDER the **highest**. Stat picks (SS/TD/FT/CTRL) already display the
  best-side book via `bestSideLineForPick`; FP keeps its per-book platform.
- Audit check: if a pick shows a book whose line is beaten by 1.5+ points at
  another book in the pick's direction, flag it (the 🏪 tag should be doing
  this for FP; its absence on a beaten line is a bug).

## Correlation — same-fight picks

- Same-fight same-direction is negatively correlated. Both-OVER FP: only one
  fighter gets the win bonus. Both-UNDER FP: needs a fast finish. The board
  demotes these (⬇ corr) or flags them (↔ corr) — an audit should still call
  out any surviving pair as "lean ONE side".
- One FP pick per fight per section, ever (zero-sum stat). Non-FP same-stat
  pairs are allowed but demoted.
- Never recommend same-fight OVERs on opposite stat types either (grappler
  FP-OVER + striker SS-OVER) — negatively correlated, lean one side only.

## Data traps — when a line or delta looks wrong

- **Combo props**: PrizePicks/UD "(Combo)" props sum BOTH fighters. Diagnostic:
  a line roughly equal to the sum of both fighters' plausible individual lines
  is a combo leak (precedent: Bo Nickal shown 49.5 vs real 28.5).
- **Big |delta| is not a data bug** by default. Check the fighter's UFCStats
  log before suspecting result attribution — some fighters really do average
  40 over their line.
- **DK partial coverage is normal** — DK posts fighter props progressively.
  Missing DK lines are not a scraper failure.
- **UD cross-promotion ghosts**: UD sometimes serves MVP/BKFC/PFL fighters in
  the "UFC" slate. A fighter nobody's heard of with no UFCStats history is
  probably not on the card.
- **Pairing-shift diagnostic**: if every fight after slot N is paired wrong
  and one fighter is missing, a name-form mismatch dropped them (e.g.
  "Cong Wang" vs "Wang Cong"). Check platform spelling vs UFCStats first.

## Rounds & duration

- ONLY the title-matched main event is 5R. Co-mains and everything else are
  3R — never infer 5R from card position alone. All FT/duration reasoning and
  round-normalized projections must use the scheduled rounds.

## Model structure (stable facts for code edits)

- Lean sources: `fp`, `ss`, `ss_r1`, `td`, `ft`, `ctrl`. R1 SS comes from
  PP+UD and is a full lean source; extreme-clean records can overrule FT in
  Best Picks.
- Tiers via `pickTier`: labels are `'High' | 'Med' | 'Low'` (mixed case —
  uppercase on screen is CSS). Stat leans use stricter thresholds
  (78 conf/8 samples for High) than FP (72/7).
- EV: `leanEvDetail` uses assumed -110 vig when no book odds exist (shown
  with `~` prefix); actual-odds path carries real vig.
- Weight-miss adjustments mutate sub-leans before effective-lean computation.
- **Never propose Kelly or fractional-Kelly stake sizing.** Declined twice.
  Audits report edges and risks, not bet sizes.
- After any `src/analyzer.ts` change: `npm run build`, commit `dist/` with the
  src, push feature branch AND master.

## Audit procedure (when asked to audit the board / picks)

Work through, in order, reporting only violations and near-misses:

1. Same-fight conflicts: FP doubles in a section, same-direction pairs,
   opposite-stat over pairs.
2. Placeability: every dog FP UNDER on Underdog? Any pick on a blocked side?
3. Line-side optimality: each pick's shown book vs the best book for its
   direction; flag 1.5+ point giveaways.
4. Combo-prop sanity: any line ≈ sum of both fighters' plausible lines.
5. FT picks: scheduled rounds correct (5R only for the title main event)?
6. Tier consistency: High picks with thin samples or archive-note demotions.
7. Fighter flags: ⚠ NEWS or ⚖ MISS on any picked fighter — call it out with
   the direction of impact.

Close the audit with a one-line verdict per section (overs / unders): clean,
or the count of flags raised.
