# Resume — R1 SS Lean Engine + Repo Shipped for Sharing

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-06-05 (Friday, fight week — Belal vs Bonfim card Saturday 6/6)
**Card in analyzer:** Belal Muhammad vs Gabriel Bonfim (Live · 106 lines)
**HEAD:** `e9181b2` — pushed to `origin` on BOTH `feature/sleek-theme-v1` and `master` (they're now identical).
**Working tree:** clean re: code. `.claude/settings.local.json` modified (pre-existing) + two long-standing untracked dirs still showing.

---

## TL;DR

Two things shipped this session:
1. **Round-1 Significant Strikes is now a full feature** — fetched from Underdog (not just PrizePicks), source-aware in the UI, and wired into the lean engine as a first-class Best Picks source with best-line selection across PP/UD and an extreme-clean-record conviction rule. Verified live: Bruno Silva's R1 SS UNDER 23.5 (0/11 historically) correctly took #1 in Best Unders.
2. **The repo is now shareable** — a friend (and anyone) can download → unzip → Load unpacked with no build step. Added a README, committed the compiled `dist/`, and fast-forwarded the 3-month-stale `master` up to current.

---

## What happened this session

### 1. Underdog R1 SS fetching — commit `309fefc`

R1 SS ("Round 1 Significant Strikes") used to be PrizePicks-only and display-only. Both Underdog parsers were *dropping* it (background `parseUnderdogApiFighters` explicitly `continue`d on round-titled SS; injected fetch-intercept misclassified it as regular SS). Now:
- Both UD parsers + the DOM fallback route round-titled SS to its own `line_ss_r1` bucket via regex `\bround\b|\brd\.?\s*\d|\br\d\b`, so it never overwrites the total-fight SS line.
- Field flows scraper `line_ss_r1` → `mergeFighters` (already allowlisted) → analyzer namespaced `line_ud_ss_r1` / `line_pp_ss_r1`.
- UI panels are source-aware: badge shows `UD-only` / `PP-only` / `PP+UD`, meta lists each book's line. Added a UD R1 SS line cell next to the PP one.

Files: [src/injected.ts](src/injected.ts), [src/background.ts](src/background.ts), [src/content.ts](src/content.ts), [src/analyzer.ts](src/analyzer.ts), [src/types/index.ts](src/types/index.ts).

### 2. R1 SS wired into the lean engine — same commit `309fefc`

New `calcSSR1Lean` in analyzer.ts (modeled on `calcSSLean`, uses `sigStrR1` history). Wired through: `LeanSource` type, `lean_ss_r1` field, `getSourceLineEntries`, `lineForLeanSource` (PP/UD only — returns null for other books on explicit-platform to avoid phantom candidates), `collectLeanCandidates`, `isCandidateUsable` (early `return true` — no scraped side-odds), `_computeEffectiveLean`, `pickTier` statLean, weight-miss targets/deltas, snapshots.

- **Best-line selection:** when PP and UD differ, picks the easiest line for the projected direction (lowest OVER / highest UNDER).
- **Conviction tuning (the key design call):** confidence is hit-rate-driven. An "extreme-clean" record (0/N never-covered or N/N always-covered over ≥8 fights) gets a strong score bump, raised conf cap (86 vs 80), and skips the volatility haircut. `sourceBonus` = 1.5 (between SS/TD 1.2 and FT 1.8). Rationale: a never-covered *bounded* single-round under is lower-variance than a fight-time under (FT has binary decision-risk), so a clean R1 SS lean SHOULD overrule FT for a fighter's single Best-Picks slot.
- **Validated:** Bruno Silva (0/11 R1 SS, opp Chairez allows only 2/7) flipped from showing FT-under to **R1 SS UNDER 23.5 at #1 Best Under (HIGH)** — exactly what the user expected.
- **"Don't force" preserved:** extreme tier only fires on genuinely elite records; ordinary R1 SS leans go through normal conservative gating (weak ±0.5 tier collapses to push). Not archived/settled, so no Bayesian prior / recalibration (falls back to 0.55).

### 3. Repo made shareable — commits `f65789d`, `e9181b2`

User wanted a friend to download and run it. Problems found + fixed:
- **`master` was 3 months / 94 commits stale.** A clone gets `master` by default → friend would get old code. Fast-forwarded remote `master` up to the feature branch (`1feb17e..e9181b2`). master == feature now; keep them in lock-step going forward.
- **`dist/` was gitignored** but the manifest + both HTML pages load from `dist/*.js`. A plain download wouldn't run. → **Un-ignored and committed `dist/`** (`e9181b2`) so download → unzip → Load unpacked works with zero tooling.
- **Added [README.md](README.md)** — simple install guide (download/unzip/load), usage, optional Anthropic key, updating, troubleshooting, plus a "for developers" build section.
- **Remote moved:** updated `origin` URL to `https://github.com/Pwnzero14/ufc-analzyer.git` (was redirecting from AbdiSF).

---

## ⚠️ NEW WORKFLOW RULE (important)

`dist/` is now TRACKED and SHIPPED. After ANY `src/` change: **`npm run build` → `git add dist` → commit dist with the src change → push to BOTH `master` and `feature/sleek-theme-v1`.** Committing only `src/*.ts` (the old habit, correct pre-`e9181b2`) now leaves the downloadable copy stale and the friend runs old code. See memory [[feedback_commit_dist_after_code_changes]].

Push pattern used this session (FF master without checkout, to avoid disturbing the modified settings.local.json):
```
git push origin feature/sleek-theme-v1
git push origin feature/sleek-theme-v1:master
git update-ref refs/heads/master feature/sleek-theme-v1
```

---

## State of the project right now

- **Branch:** `feature/sleek-theme-v1` @ `e9181b2`, in sync with `origin`. `master` also @ `e9181b2` (remote + local).
- **Betr lines:** Belal vs Bonfim base lines still loaded in `lines_betr_manual_v1` (24 SS + 9 FP from the 6/4 session). Edit individual lines via BETR LINES modal row-edit; don't re-run the bulk snippet.
- **Card:** Belal Muhammad vs Gabriel Bonfim, Saturday 6/6. Lines loaded across all 5 platforms (106 live).

## Memory updates this session

- **Created** [[project_r1_ss_underdog_and_lean]] — full R1 SS subsystem design (fetch + lean engine + conviction tuning).
- **Created** [[feedback_commit_dist_after_code_changes]] — the rebuild-and-commit-dist rule.
- MEMORY.md index updated for both.

## Open / next-cadence (nothing blocking)

- **Watch the Belal/Bonfim settle** (~Sat night/Sun) — first production test of the 6/4 alias-aware settle path AND first real outcomes for R1 SS leans. R1 SS isn't auto-settled, but eyeball whether Bruno's R1 SS UNDER (and Matt Schnell's R1 SS OVER) hit, to sanity-check `calcSSR1Lean` conviction. Dial thresholds if it felt too aggressive/soft.
- **R1 SS tuning knobs** if needed (all in `calcSSR1Lean`): the extreme-clean bump (±3.0), conf cap (86), `sourceBonus` (1.5), diff/hit-rate tiers.
- **Pre-fight prediction work** for Belal vs Bonfim — normal fight-week cadence.
- `feature/sleek-theme-v1` and `master` are now equal — decide if you want to keep working on the feature branch or just use master going forward.
