# Resume for Claude Desktop — UFC Fight Night: Allen vs Costa

**Date:** 2026-05-14
**Project:** UFC Fantasy Lines Grabber (Chrome extension; TS source in `src/analyzer.ts`)
**Branch:** `feature/sleek-theme-v1` @ `20e5304` (pushed)

Use this to seed a fresh Claude Desktop session. Desktop has no file/git access — keep questions to **analysis, strategy, picks review, brainstorming**. Code edits happen back in Claude Code.

---

## Who I am and how to help

I run a Chrome extension I built that scrapes UFC prop lines across 4 platforms (DraftKings Sportsbook, PrizePicks (Pick6), Underdog, Betr) and projects fighter stat lines (SS, FP, TD, FT, CTRL) from UFCStats history + matchup analysis. Output is a Best Picks list of OVER/UNDER leans with edge %.

When discussing picks:
- **No Kelly stakes** — I've declined twice; don't propose fractional sizing.
- **Negatively-correlated same-fight OVERs** (e.g. grappler FP-OVER + striker SS-OVER) → lean ONE side, never both.
- **Positively-correlated** (grappler TD-OVER + opponent SS-UNDER) → safe to combine.
- **Big |delta| ≠ data bug** — check the fighter's UFCStats record before suggesting attribution issues.
- Pick-em side rules: skip Pick6/UD/Betr underdog FP UNDERs, Betr underdog FP OVERs, Pick6 CTRL UNDERs (unless a Less button is confirmed).
- DK partial coverage is normal, not a scraper bug.

---

## Current slate state

**UFC Fight Night: Allen vs Costa** — 26/26 fighters paired, 5 placeholders for late additions.

**Top edge:** Melquizael Costa SS-UNDER **+76%** (79.5 line, ~66.8 proj SS, -12.7 PTD).

**Picks list status:** 19 actionable leans pre-fix. Three fighters (Tuco Tokkos, Dooho Choi, Tommy Gantt) just got name-alias fixes shipped — their UFCStats history is now resolvable, so a re-run of Best Picks may surface new leans in those three fights:

- Tokkos vs Ivan Erslan (LHW) — Erslan SS OVER 24.5 was sole lean
- Doo Ho Choi vs Daniel Gustavo Santos (FW) — both had no data
- Thomas Gantt vs Artur Minev (LW) — both had no data; Minev likely UFC debut

**Bukauskas vs Edwards:** Bukauskas baseline reset to 34.5 UD vs Edwards (was anchored to prior opponent before the swap) — projections need re-evaluation.

---

## Pre-existing leans (Best Picks list, current as of 2026-05-12 pull, with 05-13 caveat above)

(If we revisit picks today, ask me to paste the current Best Picks table. The 8 BEST OVERS / 8 BEST UNDERS list from 2026-05-12 still mostly applies.)

---

## What I shipped in the last few Claude Code sessions

- **`UFCSTATS_NAME_ALIASES`** map: platform name → UFCStats name. Latest commit added Tokkos/Choi/Gantt.
- **`window.markMissedWeight(name, lbsOver)`** — console override when news auto-detect misses a missed-weight fighter.
- **`window.setFighterStyle(name, 'striker'|'grappler'|'balanced')`** — console override for misclassified styles.
- **`window.resetFighterBaseline(name)`** — wipes `lines_open_v1` + `line_history_v1` for one fighter, used for mid-event opponent swaps (baselines key by name alone, don't auto-invalidate).
- **Placeholder injection** for late-addition card fighters so they show up in upcoming card UI before lines exist.
- **Predictor v2** (all 4 items done): duration model, book prior (dormant until archive >~6 events), RLM calibration, adaptive trend rate.

---

## Open carryover items (background only — don't suggest fixing in Desktop)

1. Long-form vs canonical event-name re-injection bug — past events flap
2. Pick6 pickGroup polling shipped but auto-fetch still misses CTRL props
3. REFRESH button doesn't force-refresh card snapshot
4. AUTO-FETCH state-aware styling
5. Analyzer phase-2 split (Betr IIFE + UI panels — post-fight territory)
6. `listFighterStyles` not exposed on window — trivial fix when convenient

---

## Useful things to ask Claude Desktop in this session

- Walk through current Best Picks output (I'll paste) and stress-test the top leans
- Discuss correlation structure across a multi-pick parlay
- Sanity-check a counterintuitive lean against a fighter's recent record
- Brainstorm what new diagnostic the extension is missing
- Review screenshots of platform lines for entry workflow

## Don't ask me to

- Run console snippets (I won't be at the rig)
- Edit code (no file access on this side)
- Propose Kelly sizing
- Recommend storage-mutating browser-side snippets without verifying state first — line movement data is irreplaceable, I've lost it before

---

## Today's quick-cite anchors

- Top edge: **Costa SS-UNDER +76%**
- 26 fighters paired, 5 placeholders, 3 fighters newly-resolvable post-alias-fix
- Top carryover risk to watch: Bukauskas drift after opponent change
