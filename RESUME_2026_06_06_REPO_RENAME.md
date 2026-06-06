# Resume — Repo Renamed to `ufc-analyzer`

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-06-06 (Saturday — Belal vs Bonfim card is TODAY)
**HEAD:** `03cf083` — unchanged this session (no code commits made).
**Working tree:** clean re: code. `.claude/settings.local.json` modified (pre-existing) + two long-standing untracked dirs still showing.

---

## TL;DR

Short admin session. Fixed the misspelled GitHub repo name and re-pointed the local remote. **No code changes, no commits.** The R1 SS / settle-watch items from the [2026-06-05 resume](RESUME_2026_06_05_R1_SS_LEAN_AND_REPO_SHIP.md) are still open and carry forward unchanged.

---

## What happened this session

### Repo renamed `ufc-analzyer` → `ufc-analyzer`

- The GitHub repo was misspelled (missing the **y**). Renamed via **repo Settings → General → Repository name → Rename** on GitHub.
- New URL: `https://github.com/Pwnzero14/ufc-analyzer`
- **Local remote updated:** `git remote set-url origin https://github.com/Pwnzero14/ufc-analyzer.git` — verified with `git ls-remote` (sees both `master` and `feature/sleek-theme-v1` at `03cf083`).
- GitHub **redirects** the old `ufc-analzyer` URL to the new one, so the download link already shared with the friend still works.
- ⚠️ **If the friend already cloned:** their local remote still points at the old URL (redirect covers it). They can clean it up anytime with `git remote set-url origin https://github.com/Pwnzero14/ufc-analyzer.git`.

---

## State of the project right now

- **Branch:** `feature/sleek-theme-v1` @ `03cf083`, in sync with `origin`. `master` also @ `03cf083`.
- **Remote:** `origin` → `https://github.com/Pwnzero14/ufc-analyzer.git` (corrected spelling).
- **Betr lines:** Belal vs Bonfim base lines still loaded in `lines_betr_manual_v1` (24 SS + 9 FP). Edit individual lines via BETR LINES modal row-edit; don't re-run the bulk snippet.
- **Card:** Belal Muhammad vs Gabriel Bonfim, Saturday 6/6 — happening today.

---

## ⚠️ Standing workflow rule (unchanged)

`dist/` is TRACKED and SHIPPED. After ANY `src/` change: **`npm run build` → `git add dist` → commit dist with the src change → push to BOTH `master` and `feature/sleek-theme-v1`.** See memory [[feedback_commit_dist_after_code_changes]].

---

## Open / next-cadence (carried over from 6/05 — nothing new blocking)

- **Watch the Belal/Bonfim settle** (~tonight/Sun) — first production test of the alias-aware settle path AND first real outcomes for R1 SS leans. R1 SS isn't auto-settled; eyeball whether Bruno Silva's R1 SS UNDER 23.5 (and Matt Schnell's R1 SS OVER) hit, to sanity-check `calcSSR1Lean` conviction. Dial thresholds if it felt too aggressive/soft.
- **R1 SS tuning knobs** if needed (all in `calcSSR1Lean`): extreme-clean bump (±3.0), conf cap (86), `sourceBonus` (1.5), diff/hit-rate tiers.
- **Pre-fight prediction work** for Belal vs Bonfim — normal fight-week cadence (card is today).
- `feature/sleek-theme-v1` and `master` are equal — decide whether to keep working on the feature branch or move to master.
