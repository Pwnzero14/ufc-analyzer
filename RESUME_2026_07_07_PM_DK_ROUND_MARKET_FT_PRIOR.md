# RESUME — 2026-07-07 (PM session)

## TL;DR
Shipped **MODEL v4**: DK's "To Start Round X" round market now feeds the FT lean as a
finish-timing prior, so no-history fighters priced as heavy early finishers finally
surface. Also fixed an FT unit bug, entered UFC 329 Betr SS lines, and fixed a
Chinese-name Betr ghost. All committed to **master + feature/sleek-theme-v1** and pushed.

Current tip: `master 2edceac` / `feature 6fd6847`.

## Card context
- Next card is **UFC 329 — Sat July 11** (a week out; McGregor vs Holloway 5R main).
- Betr **SS lines are in** (FP not posted yet — add FP later when it drops).
- Platform lines (P6/UD/PP/DK) loaded; DK round-market data captured.

## What shipped this session (in order)

1. **Run Learning Cycle handler fix** (`f7fea65` / master `77b3db0`)
   - Handler gate now honors `eventIsOver` like the button visibility. Absorbed the
     Baku/Fiziev card into the model (Grade C, Avg |Δ| 20.6).

2. **UFC 329 Betr SS entry** (console snippet → `lines_betr_manual_v1`, per
   [[feedback_betr_entry_workflow]]). 13 fights / 26 fighters, SS-only.
   - **Cong Wang ghost**: entered as "W. Cong" → spawned an orphan card. Root cause:
     `namesMatch` (analyzer.ts:15462) is surname-token based and NOT alias-aware, so
     order-swapped Chinese names never reconcile. Fix = match the platform's EXACT
     string ("**Cong Wang**", given-family order UD/PP use). See
     [[project_betr_entry_name_order_swap_ghost]].
   - PENDING (optional): add `'Cong Wang' → 'Wang Cong'` alias in config for clean
     post-event settling (namesMatch merge still needs the exact string; alias only
     helps the settle path).

3. **FT unit-confusion fix** (`5bb20e5` / master `58fbb93`... actually `5bb20e5`)
   - `normalizeFightTimeLineToMinutes` no longer ×5's sub-5-min values (McKinney's
     real 4.5-min PP line was becoming 22.5). Removed `'rounds'` from PrizePicks FT
     classification (Total Rounds was clobbering Fight Time). All books post MINUTES.

4. **MODEL v4 — DK round-market FT prior** (stage 1 `691fb59`, stage 2 `32e65ea`,
   line-selection fix `6fd6847`). Full detail in [[project_dk_round_market_ft_prior]].
   - **Scraper**: `refreshDKRoundStartFromApi` pulls `leagues/9034/categories/677/
     subcategories/5800` (event-agnostic), stores `fight_round_start_dk_v1`.
   - **Lean**: de-vig R2→R5 ladder → `marketFtUnderProb` → P(duration < line).
     History path nudges the score; no-history path emits a market-only FT lean
     (`buildMarketOnlyFtLean`), bypassing the `history<3` gate.
   - **FT line selection reordered PP-first** — UD posts genuinely different
     minutes lines (McKinney UD 2.5m vs PP 4.5m); the old p6-first order fed UD's low
     line and flipped PP unders into bogus overs.
   - **Verified working**: Gable Steveson (debut, no history) now surfaces
     **FT UNDER 4.25 — "DK round market 61% under"**; McKinney **FT UNDER 4.5 HIGH**.

## Known limitation / next-up ideas
- The FT prior **skips the final scheduled round** (3R: 12.5–15m lines; 5R: 20–25m)
  because the round ladder can't separate a late finish from a decision there. To
  cover deep lines, add DK's **"Fight to go the Distance"** market the same way
  (pins the decision probability). Easy follow-up if wanted.
- Optional durable Betr alias for Cong Wang (see #2 above).
- Betr **FP lines** for UFC 329 not entered yet (not posted on Betr at session end).

## Workflow reminders
- Build + commit `dist/` with every `src` change; push feature AND master
  (fetch + `merge --ff-only origin/master` before cherry-pick). Never stage
  `.claude/settings.local.json`. Co-Author trailer required.
- FT-lean / pick edits: the `ufc-lean-audit` skill house rules apply; bump
  `MODEL_VERSION` on lean-scoring changes.
- Betr clears automatically at full settlement (post-event); don't click
  RESET/DISMISS mid-fight-week.
