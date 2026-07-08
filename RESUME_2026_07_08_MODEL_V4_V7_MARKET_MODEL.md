# RESUME — 2026-07-08 (overnight session)

## TL;DR
Big model-upgrade run. Turned DK's exotic markets into a **market-derived model**: the
FT lean, SS/TD projections, and Parlay Lab EV are now all driven by DK's implied
fight-duration distribution. Model went **v4 → v7** plus the parlay copula. Everything
committed to **master + feature/sleek-theme-v1** and pushed.

Current tip: `master 5e72bf1` / `feature e9c8763` (correlation-aware parlays) — plus
this resume doc commit on top.

## Card context
- Next card: **UFC 329 — Sat July 11** (McGregor vs Holloway 5R main). Betr **SS in, FP not yet**.
- All the new DK market data (round/distance/time-of-finish) captured and flowing.

## What shipped (full arc — see [[project_dk_round_market_ft_prior]] for detail)
All three DK markets come from the sportscontent JSON API, event-agnostic
(`leagues/9034/categories/{cat}/subcategories/{sub}`), fetched on startup + auto-scrape.

1. **v4 — round-market FT prior** (`691fb59`/`32e65ea`): DK "To Start Round X"
   (677/5800) → de-vig ladder → `marketFtUnderProb`. History path nudges; no-history
   path emits a market-only FT lean (Gable Steveson surfaces).
2. **v5 — final-round coverage** (`92ce517`): "Fight to Go the Distance" (556/17644) →
   P(decision) pins the last-round split. Final-round lines are **market-LED**
   (`43b10e6`), killing bogus grinder unders (Sandhagen).
3. **v6 — duration-adjusted SS/TD** (`06cfd3b`): scale SS/TD projection by
   E[fight length]/career-avg. **Asymmetric** (`2784983`): downward full, upward
   damped+capped 1.2× (field feedback — Krylov was over-projected).
4. **v7 — Time of Finish** (`04d5c51`): 1-minute finish distribution (556/7096) is the
   PREFERRED FT source (round ladder = fallback). **⚠ MAIN-EVENT-ONLY** — DK only posts
   it on the marquee fight.
5. **FT confidence cap** (`3a100f1`): FT confidence can't exceed the market P(under);
   market contradiction (<50%) drops the lean. McGregor's stat-overconfident under → gone.
6. **Correlation-aware parlays** (`5e72bf1`, no version bump): same-fight legs share
   duration → Gaussian-copula joint via `correlatedHitCounts`, replacing independence.
   Adds 🔗 correlated/redundant flags. Verified working in Parlay Lab.

Also fixed early in the run: FT unit bug (`normalizeFightTimeLineToMinutes` no ×5,
`5bb20e5`) and FT line selection PP-first (`6fd6847`).

## Open cosmetics / small follow-ups (non-blocking)
- **McGregor SS proj display mismatch**: best-picks headline `proj` doesn't show the v6
  duration adjustment its own reason describes (`59→70`). The lean is correct
  (hit-rate-driven under); the display-path proj just isn't duration-scaled. Tidy later.
- **🔗 parlay chip is unstyled** (plain text, no chip background). Style to match `.pss-*`.
- Betr **FP entry** for UFC 329 when it drops.
- Durable Betr alias `'Cong Wang' → 'Wang Cong'` for clean settling ([[project_betr_entry_name_order_swap_ghost]]).

## Suggested next (model-improvement list, from the session)
- **#4 empirical per-source calibration** against the 2,554-sample archive (do "70%"
  FT/SS leans actually hit 70%? recalibrate per source×tier). Not started.
- FT prior could ingest **First Minute Finish** (556/17646) for even finer early shape.

## Workflow reminders
- Build + commit `dist/` with every `src` change; push feature AND master
  (`git fetch && git merge --ff-only origin/master` before cherry-pick). Never stage
  `.claude/settings.local.json`. Co-Author trailer.
- Bump `MODEL_VERSION` on lean-scoring changes (config/index.ts). Parlay Lab / display
  changes do NOT bump it.
- FT/SS/TD lean edits: the `ufc-lean-audit` skill house rules apply.
