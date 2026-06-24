# RESUME — 2026-06-18 — 5R/3R main-event detection fix

## TL;DR
The main event (**Kape vs. Horiguchi**) was showing **3R** projections while a random
prelim (**Allan Nascimento**) showed **5R** — backwards. Root-caused and fixed after the
prior 4 attempts had stalled. Verified live (Kape/Horiguchi = 5R↑, co-main + all prelims =
3R). Two commits:

- **`edced19`** (master `5c99189`) — `fix: 5R/3R — stop line-inferred title clobbering real headliner`
- **`63030c0`** (master `3a52fd2`) — `chore: gitignore stray Opera storage dir + .claude/launch.json`

Both pushed to `feature/sleek-theme-v1` AND `master` (dist included).

## THE root cause (why the prior 4 attempts missed it)
All earlier attempts focused on `findHeadlinerPair()` (analyzer.ts ~703) — but that function
was already **correct**. Proven two ways: a storage dump of `upcoming_ufc_card` (event name +
the 12 fights) AND a standalone node-trace of `normalizeName`/`strictCardNameMatch`/`namesMatch`
both showed it cleanly matches the Kape pair via the surname-suffix fallback.

The real bug was **upstream**, at [analyzer.ts:15766](src/analyzer.ts#L15766): after loading
platform lines, `upcomingEventName` was **unconditionally overwritten** with
`inferEventNameFromPayloads()`. That helper returns the fighter pair with the **highest
line-count across platforms** — typically a fully-covered **PRELIM**, not the headliner. So the
real UFCStats title `"...: Kape vs. Horiguchi"` got clobbered by a prelim-named title;
`findHeadlinerPair()` then parsed the prelim surnames and returned the **prelim** as the main
event → prelim got 5R↑, real main event fell to 3R↓.

> Hand-traces "worked" because they used the *stored* title; the running code used the
> *clobbered* one. That gap is what burned the prior attempts. Lesson: when render output
> contradicts a hand-trace, dump the **actual module state at render time**, don't re-trace.

## The three fixes (all in `edced19`)
1. **[analyzer.ts ~15766]** — only adopt the line-inferred name when there's **no** real
   UFCStats card title (`if (!upcomingEventName) upcomingEventName = inferredEventNameFromLines`).
   Never clobber a real headliner title. The inferred name stays available as
   `findHeadlinerPair`'s documented fallback (`upcomingEventName || inferredEventNameFromLines`).
2. **[analyzer.ts `buildFights` ~11306]** — the 5R/3R **badge** now uses headliner detection
   (`fightIsMainEvent(a,b)` comparing normalized names to `findHeadlinerPair()`), not
   `fightIndex === 0`. UFCStats upcoming-card order is NOT reliably main-first, so position 0
   was a prelim getting the 5R badge.
3. **[background.ts scraper ~3486]** — mark the main event `scheduledRounds: 5` from the event
   title. KEY FINDING from the dump: UFCStats **upcoming** event pages don't expose round counts
   in a parseable cell, so the old `clean === '5'` loop left **every** fight (incl. the main
   event) at 3R — `scheduledRoundsMap` was effectively empty. Now the title surnames promote the
   matching fight to 5R, so the existing 5R fallbacks (`buildEventDisplayName`,
   `findHeadlinerPair`) finally have real data.

## Current round-logic map (all paths now agree)
- `findHeadlinerPair()` (analyzer ~703) = single source of truth; title-parse + surname-suffix
  fallback + scraped-5R fallback (now populated by fix #3).
- Consumers: predictor (~8757), per-fighter projection normalization (~13618),
  `getScheduledRoundsContext` (~2045), and the fight-card badge (`buildFights`, fix #2). All four
  resolve the main event the same way now.

## State / housekeeping
- Working tree clean except local-only `.claude/settings.local.json` (tracked but NEVER staged).
- `.gitignore` now covers the stray `Users*Opera*Extension Settings*/` storage folder and
  `.claude/launch.json` (commit `63030c0`).
- Local `master` had drifted **27 commits behind** origin earlier this session — fast-forwarded
  to sync before cherry-picking. If a cherry-pick to master conflicts again, first
  `git fetch && git merge --ff-only origin/master`.
- Memory: `project_co_main_5r_inference.md` predates this; the canonical rule now is
  **only the title-matched main event gets 5R; co-mains and prelims are 3R** (Fight Night
  co-mains are 3R). Scraped rounds are unreliable on pre-fight pages — trust the title.
