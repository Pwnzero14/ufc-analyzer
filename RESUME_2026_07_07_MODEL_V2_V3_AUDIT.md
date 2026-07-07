# RESUME 2026-07-07 — Full System Audit → MODEL v2 + v3 Shipped

Session arc: full multi-layer engineering audit of the analyzer (architecture,
betting logic, weaknesses, roadmap) → user said "not a month, evolve NOW" →
shipped the P0 batch as **MODEL v2**, then calibrated EV + payout slip EV as
**MODEL v3**. All verified live via user screenshots. Both branches pushed.

## Commits (all on feature/sleek-theme-v1 AND master)

| Commit | What |
|---|---|
| `3b8672a` | MODEL v2 — hit-rate shrinkage, backfill projection floor, MODEL_VERSION stamping, backup staleness nudge (GLOW-UP 150) |
| `7f89a3d` | Skill doc: shrunkHitRate semantics + MODEL_VERSION bump rule |
| `f744492` | MODEL v3 — calibrated EV (evWinProb) + payout-aware Parlay Lab slip EV (GLOW-UP 151) |

## MODEL_VERSION system (new — the big meta-upgrade)

- `MODEL_VERSION` lives in `src/config/index.ts` (currently **3**), imported by
  analyzer.ts + PropLinePredictorService.
- Stamped into: best-picks snapshot header + every pick row
  (`persistBestPicksSnapshot`), and every `PropPrediction` from `predictFighter`.
- Rows without the field ≙ v1. After the NEXT settled event the Archive data can
  compare hit rate per version (no UI for it yet — candidate next step).
- **RULE (also in the ufc-lean-audit skill): bump it on ANY change to lean
  scoring, tiering, correlation passes, or EV math.**
- v2 = shrinkage + backfill floor. v3 = calibrated EV + slip payout EV.

## MODEL v2 details

- `shrunkHitRate(hits, n) = (hits+1)/(n+2)` (Laplace) — defined just above
  `calcLean` in analyzer.ts. All SIX hit-rate score ladders (FP / SS / R1 SS /
  TD / FT / CTRL) now compare `rateAdj`, not raw rate. Thresholds retuned
  0.75→0.72, 0.6→0.58, 0.25→0.28, 0.4→0.42 (R1 SS: 0.8→0.78, 0.2→0.22) so deep
  records land in their old tiers while thin ones (3/4) drop a tier.
  **Reason text still prints the RAW record on purpose** — "75%" text beside a
  mid-tier score is shrinkage working, not a bug.
- R1 SS structural-clean branches (perfect 0% / 100% over n≥8) stay RAW —
  shrinkage never returns 0/1 so they'd be unreachable otherwise.
- **Backfill projection floor** (in `dedupeNegCorrelatedSameFight`'s top-up
  loop): a backfilled pick whose own `lean.avg` sits on the wrong side of its
  line is skipped. This was the queued "Whittaker case" bug — now closed.
- **Backup staleness nudge**: successful 💾 Backup stamps `ufc_last_backup_ts`;
  amber dot (GLOW-UP 150 CSS) on the ⋯ More trigger when >7d old or missing.
  Backup/Restore buttons already existed — only the age tracking was new.

## MODEL v3 details

- **Discovery**: a recalibration engine ALREADY existed
  (`initRecalibrationMap` → `_recalibrationMap`/`_recalibrationByType`,
  conf-bucket midpoints → realized hit %, interpolated by
  `getRecalibratedConfidence`). Row confidence chips already used it (the ↻
  marker) — but EV was still priced off RAW conf, so chip and EV could
  disagree. v3 closes that.
- `evWinProb(f, el)` (just above `computeDetailedEV`): raw conf → CLV boost →
  clamp 25-90 → recalibration — the EXACT displayed-confidence pipeline. Used
  by `computeDetailedEV` AND `computePerBookEV`. EVResult gained
  `prob`/`recalibrated`; the EV chip shows ↻ when recalibrated and its tooltip
  states the win prob used ("EV from 52% win prob (recalibrated…)").
- **Parlay Lab slip EV**: `PICKEM_PAYOUTS` in config — UD standard (2-5 legs),
  PP Power (2-6), PP Flex (3-6 with partial payouts). Per-leg probs =
  recalibrated conf clamped 0.35-0.85; exact P(k hits) via subset enumeration
  (n≤6 → ≤64 terms) so Flex partials price correctly; stake-inclusive
  EV = Σ P(k)·mult(k) − 1. Chips `pss-ev pos/neg` sorted best-first
  (GLOW-UP 151 CSS at stylesheet end). Contradictory slips (⛔) show NO EV.
  COMBINED chip now multiplies calibrated probs (was raw conf product).
- **Betr + Pick6 payout tables intentionally ABSENT** — user will read the
  multipliers from his apps; adding one `PICKEM_PAYOUTS` entry each lights
  them up. ← **user said "will do" — expect these numbers next session.**

## Verified live (user screenshots, math checked)

- Slip: 3 legs (BSD FT-U 92%, Holloway FT-O 84%, Sandhagen SS-O 81%) →
  COMBINED ~16% (recalibration compressing raw conf hard), chips
  `UD 6x −3% · PP Flex 2.25x −7% · PP Power 5x −19%` — all arithmetic
  reproduces exactly. Flex above Power = partial-payout cushion, correct.
- Board: Holloway chip OVER 52% ↻ and EV tooltip "from 52% win prob" — the
  coherence guarantee on screen. 52%→−1%, 57%→+9%, 61%→+16% all match the
  −110 formula. Push lean (BSD) correctly has no EV chip. ✗-vs-slip conflict
  chip fired on McGregor FT-U vs slip's Holloway FT-O (shared-stat guard).
- Expected user-visible drift: EVs on high-conf picks DROP once the recal map
  loads (honesty, not regression); some picks show ↻ and others raw-fallback
  (recal bucket needs ≥3 graded picks — coverage grows per settled event).

## Audit findings still open (the backlog, roughly prioritized)

1. **Per-version accuracy readout** in Archive (data now exists via stamping).
2. **Per-source reliability weights** — feed archive stat-type splits back as
   priors in best-pick lean selection (FT overs 77% vs FP overs 42% asymmetry).
3. **Variance/risk profiles + confidence bands** per prop (P25/P75 from history).
4. **Prop-vs-ML divergence alert** (ML steams one way, prop line drifts other).
5. **Scraper health strip** (per-source freshness + row-count delta alarms).
6. Effective-lean priority chain (fp>ss>td>ft>ss_r1, ctrl absent) vs
   getBestPickLean dual-source-of-truth — unify behind a version bump.
7. Phase-2 module split + golden-fixture tests (vitest) from archived events.
8. CSS extraction to analyzer.css (25.9k-line HTML, 151 GLOW-UP layers).
9. UI queue: briefing bar (oldest surface), Calibration Curve one-level.
10. Watch: FP-overs 42% vs Learning Drilldown "Lean into FP OVER" tension.

## House rules (unchanged, restated for cold start)

- After any src change: `npm run build`, commit `dist/` WITH src, push
  feature/sleek-theme-v1 AND master. Never stage `.claude/settings.local.json`.
- New CSS goes at the stylesheet END (before `</style>`), GLOW-UP numbered
  (next: 152). Bump `MODEL_VERSION` on any scoring/EV logic change.
- No Kelly sizing, ever. No storage-mutating snippets without read-only
  diagnosis + backup first. Betr base lines via console snippet only.
- Extension verified by ↻ reload in Chrome; ufc-lean-audit skill before/after
  model-logic edits.
