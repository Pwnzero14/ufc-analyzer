# RESUME — 2026-07-08 (session 2: near-pick-em fix, calibration #4, cosmetics)

## TL;DR
Follow-up session after the v4–v7 market-model run. Fixed the UFC 329 near-pick-em
dog-detection leak, shipped **model-improvement #4 (empirical calibration via Bayesian
shrinkage)**, and cleared the two cosmetics. Everything committed to **master +
feature/sleek-theme-v1** and pushed.

Current tip: `master 011bb68` / `feature 273b9b1` (this resume doc commits on top).

## Card context
- Next card: **UFC 329 — Sat July 11** (McGregor vs Holloway 5R main). Betr **SS in, FP not yet**.
- Board is clean: Cong Wang ghost fixed (alias, prior session), Tracy Cortez unplaceable
  Pick6 FP UNDER now dropped.

## What shipped this session
1. **Near-pick-em dog detection** (`220d396`/`9e7ee5e`): `isMoneylineUnderdog` only flagged
   plus-money dogs (`own > 0`). In a near-pick-em BOTH fighters carry negative juice
   (Tracy Cortez -110 vs Wang Cong -114), so the slight dog read as a favorite and her
   unplaceable Pick6 FP UNDER leaked to #1 Best Under. Fix: resolve opponent ML up front;
   when both present, dog = higher/less-negative American (`own > oppMl`). Placeability-only,
   no MODEL_VERSION bump. See [[project_pickem_platform_rules]].
2. **Model #4 — empirical calibration (Bayesian shrinkage)** (`113e8e5`/`c4565a1`): the
   recalibration engine (per source-type × conf bucket; drives displayed conf + EV + parlay
   probs) built map cells from raw `hits/total` with only a `>=3` gate → thin cells overfit
   (3/3→"100%", 0/3→"0%"). Added `shrunkRecalRate()`: shrink toward the bucket's own
   confidence-midpoint prior by `RECAL_SHRINK_K = 6` (`(hits+K*prior)/(total+K)`). Applied at
   BOTH build sites (`renderCalibrationPanel` + `initRecalibrationMap`). Panel "Recalibrated"
   column + per-stat summary now show the APPLIED (shrunk) value with raw rate visible;
   diagnostic cards stay raw. No MODEL_VERSION bump (runtime archive-derived display
   transform). K=6 tunable. See [[project_confidence_recalibration_engine]].
3. **Cosmetics** (`273b9b1`/`011bb68`):
   - SS/TD Best-Picks headline used `projSSLean`/`projTD` (pre-v6) while the reason + score
     used duration-adjusted `effectiveSS`/`effectiveTD` (McGregor "proj 59" headline vs
     "SS proj 59→70" reason). Headline now shows the effective projection. Display-only.
   - `.pss-corr` 🔗 parlay chip had no CSS (bare text) → added a calm violet "link" chip
     style in analyzer.html, distinct from amber WEAKEST / red CONTRADICTORY.

## NEXT UP — v8 (start of next session)
- **First Minute Finish market → FT prior (v8).** DK `categories/556/subcategories/17646`
  ("First Minute Finish", seen-but-uncaptured, noted in [[project_dk_round_market_ft_prior]]).
  Adds finer EARLY finish shape to the FT prior — complements the Time-of-Finish (v7,
  main-event-only) and round-ladder paths. Pattern to follow: mirror
  `refreshDKTimeOfFinishFromApi` (background.ts) → new storage key → analyzer FT helpers
  (`marketFtUnderProbDirect`/`marketExpectedFightMinutesDirect` family). Bump MODEL_VERSION
  (FT lean scoring changes). Likely also main-event-only like ToF — verify capture breadth.

## Deferred / follow-ups (non-blocking)
- **#4b over/under directional calibration**: split the recal key by over/under — deferred,
  would over-thin the pool; per-book over/under archive-note trimming already covers
  direction. Revisit once the archive grows a lot.
- Betr **FP entry** for UFC 329 when it drops (SS already in).
- **#4-empirical per-source calibration vs full archive**: the recal engine now shrinks
  correctly, but a broader per-source×tier audit of realized accuracy could still tune K or
  thresholds once more events settle.

## Workflow reminders
- Build + commit `dist/` with every `src` change; **analyzer.html (CSS/markup) is loaded from
  repo ROOT, not dist/** — dist only holds compiled JS (`dist/analyzer.js`). Commit
  analyzer.html directly when styling.
- Push feature AND master (`git fetch && git merge --ff-only origin/master` before cherry-pick).
  Never stage `.claude/settings.local.json`. Co-Author trailer.
- PowerShell here-string commit messages break on inner `"`/unicode — use `git commit -F <file>`
  for multi-line messages with quotes or arrows.
- Bump `MODEL_VERSION` on lean-scoring/tiering/correlation/EV changes; NOT for
  display/recalibration/parlay/name-resolution changes.
- FT/SS/TD lean edits: `ufc-lean-audit` skill house rules apply.
