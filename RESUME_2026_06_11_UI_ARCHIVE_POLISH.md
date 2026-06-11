# Resume — UI/Archive Polish Blitz (levels 4-8 + briefing)

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-06-11 (Thursday)
**HEAD:** `c743eed` — `master` == `feature/sleek-theme-v1` == `c743eed`, both pushed to origin.
**Working tree:** clean re: commits. Only `.claude/settings.local.json` modified (intentional carry-over).

---

## TL;DR

Pure UI/archive polish session — six commits shipping the "GLOW-UP" levels 4-8, a drilldown restructure, archive table redesigns, and a "since you were away" briefing. No predictor/scraper/settle logic touched. All open data-cadence items from the 06-10 resume carry forward unchanged. Repo is healthy (top-level `.git` was rebuilt last session — see [RESUME_2026_06_10_UI_OVERHAUL_SHIPPED_AND_GIT_RECOVERY.md](RESUME_2026_06_10_UI_OVERHAUL_SHIPPED_AND_GIT_RECOVERY.md)).

---

## Shipped this session (6/11), on top of the `39d0c66` overhaul

- `df50ae5` — **levels 4-6 + drilldown restructure:** paired stat Head-to-Head panels (fighter vs opponent side-by-side), Models & Career pairing, count-up metric tickers, Parlay Lab avatars, form dots (last-5 W/L), country mini-badges, keyboard shortcuts ("/" search, 1-5 views), back-to-top button, "?" help overlay.
- `8bcf64b` — sync `analyzer.js.map` (one-off; see workflow note below).
- `b85ed9f` — **levels 7-8 + archive table:** `jumpToFighterCard()` cross-nav (click Best Picks/Line Movers/Archive pred rows → jump to expanded card), K command palette (fuzzy fighter search), Archive Prop Line Predictions `.pred-row` grid; fix: scoped Best Picks 5-col avatar grid with `:has(.bp-avatar)` so it stops leaking into archive `.best-pick-row` sections.
- `8008807` — **archive evolution:** Platform Bias `.bias-row` layout, hit-rate pct heroes + fill bars, per-event color-graded results, Platform×Stat color bars, Learning Summary weights in `<details>`, backtest metric glow.
- `c743eed` — **"since you were away" briefing:** line moves + lean flips since last visit; plus skeleton loaders (archive/calibration), staleness-graded data-age chip (green <6h / gold <48h / red beyond), calibration curve bar glow.

---

## Workflow note (changed this session)

Now committing `dist/analyzer.js` **and** `dist/analyzer.js.map` **together** in each build commit — no more stale-map follow-up commits. Standing rule otherwise unchanged:

`dist/` is TRACKED and SHIPPED. After ANY `src/` change: `npm run build` → `git add dist` → commit dist with the src change → push BOTH branches (`feature/sleek-theme-v1` AND `master`). See memory [[feedback_commit_dist_after_code_changes]].

Repo: `origin` → `https://github.com/Pwnzero14/ufc-analyzer.git`. Commit identity (repo-local) `Abdir Local <abdir.local@users.noreply.github.com>`. If `.git` ever vanishes again, recovery steps are in memory [[project_repo_git_recovery]] / the 06-10 resume.

---

## Current state

- **Uncommitted (intentional):** `.claude/settings.local.json` only.
- **Untracked (expected):** `RESUME_2026_06_09_STORAGE_PRUNE_READY.md`, `RESUME_2026_06_10_UI_OVERHAUL_SHIPPED_AND_GIT_RECOVERY.md`, this file, `snippets/`, the long `Usersabdir…Opera GX…` settings dir.

---

## Open / next-cadence (no code work on these this session — all UI)

1. **Prune storage backups** — snippets ready in `snippets/` (audit → review plan → `confirmPrune()`). Storage near ~10 MB quota. Steps in [RESUME_2026_06_09_STORAGE_PRUNE_READY.md](RESUME_2026_06_09_STORAGE_PRUNE_READY.md).
2. **FIX B (code):** don't archive UD-only fighters absent from the P6-defined current card during event overlap (stops ghost rows at source). Residual `C Chandler` (Betr) abbrev false-match risk.
3. **Betr auto-clear (code):** clear `lines_betr_manual_v1` when current event passes the Betr card date, not on `stillUnresolved === 0` ([src/background.ts:1037](src/background.ts#L1037)).
4. **UFC Freedom 250 settle** — 20 unresolved props settle after **Sat Jun 14**. If next session is after the card: settle, verify counter → 0.
