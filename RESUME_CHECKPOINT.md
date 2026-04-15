# Resume Checkpoint

Last Saved: 2026-04-13 (Session bug-hunt: stale movement badges)
Branch: feature/sleek-theme-v1
HEAD: 90e58ac (+ uncommitted movement-badge fixes in src/analyzer.ts)
Build: dist/analyzer.js rebuilt at 13:11 (794852 bytes)

---

## RESUME CODE (paste this at the start of a new session)

```
Resuming UFC Fantasy Lines Grabber — PICK UP MID-BUG.

Repo: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
Today: 2026-04-13

THE UNRESOLVED BUG
User sees movement badges (e.g. Malott +2.4, Burns -8.3, Jourdain -12.7,
Phillips -15.0) on fresh platform lines for a NEW event. These are baselines
with no real movement. The badges persist EVEN IMMEDIATELY AFTER clicking
RESET LINES — the toast "Baselines re-anchored + Betr lines cleared (event
over)" is visible alongside the badges in screenshots.

Today is 2026-04-13. BETR_EVENT_DATE in src/background.ts is '2026-04-11'
(past). initializeBetrLines has wiped betr storage. _currentBetrEventDate
is '' in analyzer.ts.

ALL FIX ATTEMPTS IN THIS SESSION (all committed to src/, built to dist/)
1. Removed prev-refresh fallback from snapshotOpeningLines new-key handler
   (src/analyzer.ts:7591-7613). On new key, set baseline = current val. No
   fallback to _prevRefreshLines. Comment: "prev-refresh is within-session
   jitter, not authoritative opening."
2. Added 3-min session grace period. Constants at src/analyzer.ts:7313-7314:
   `let _sessionStartAt = Date.now();`
   `const BASELINE_GRACE_PERIOD_MS = 3 * 60 * 1000;`
   During grace, snapshotOpeningLines re-anchors existing baselines to
   latest values instead of keeping old ones.
3. Added final renderFighters()+renderLineMovementSummary() at end of
   processData AFTER snapshotOpeningLines runs (src/analyzer.ts around
   line 13221). Same fix in Betr save handler (around 15299).
4. Narrowed detectAndRecordMovements to delta-0 baseline repair only —
   does NOT create baselines from _prevRefreshLines anymore
   (src/analyzer.ts:7635-7677).
5. Suppressed movement badges in lineCell entirely during grace period
   (src/analyzer.ts:11383-11390). During first 3 min of session, lineCell
   returns movementHtml = '' regardless of baseline delta.
6. RESET LINES handler now resets _sessionStartAt = Date.now()
   (src/analyzer.ts:14796-14798). This restarts the 3-min grace window
   so subsequent data waves suppress badges AND re-anchor baselines.
7. Cross-event staleness wipe via forBetrEventDate tag on lines_open_v1
   and line_history_v1 (already in place from prior session). Wipes when
   stored tag ≠ _currentBetrEventDate. At src/analyzer.ts:7386-7403.

WHY IT SHOULD WORK IN THEORY
- Fresh tab load at T=0: loadOpeningLines wipes stale baselines (if tag
  mismatches) → _openingLines empty.
- First data arrival: mergeAndEnrich's internal renderFighters calls paint
  DOM between await boundaries. lineCell is WITHIN grace → movementHtml=''
  → no badges visible.
- snapshotOpeningLines runs → captures current values as baselines → final
  renderFighters → still within grace → no badges.
- User clicks RESET at any time: _sessionStartAt resets → next 3 min is a
  fresh grace window → subsequent LINES_UPDATED messages don't paint badges.

LIKELY ROOT CAUSE IF STILL BROKEN
Most likely: the extension isn't actually running the new dist/analyzer.js.
Browser cached the old bundle, or user reloaded the analyzer tab without
reloading the extension itself, or there's a service worker caching issue.

FIRST THING TO DO IN NEW SESSION — VERIFY THE NEW CODE IS LOADED
Ask user to open DevTools on the analyzer tab and run in the console:
  1. `typeof _withinBaselineGrace` — should be 'undefined' (it's a local const in lineCell scope) BUT this won't tell us anything. Better:
  2. `document.querySelector('.line-movement')` — if null, no badges rendered at all (bug is not in lineCell).
  3. `document.querySelectorAll('.line-movement').length` — how many badges are in DOM.
  4. Search the running analyzer.js bundle for the string '_withinBaselineGrace'. In DevTools Sources tab, open dist/analyzer.js and Ctrl+F for '_withinBaselineGrace'. If NOT found → old bundle is loaded.
  5. Ctrl+F for 'BASELINE_GRACE_PERIOD_MS' — should be present in the new bundle.
  6. Check `_openingLines.size` and `_sessionStartAt` — these are NOT on window, so run: search the compiled bundle for them instead.

OTHER HYPOTHESES TO INVESTIGATE IF THE NEW BUNDLE IS CONFIRMED LOADED
- Are badges coming from a DIFFERENT CSS class or HTML path? Only known
  renderer is lineCell at src/analyzer.ts:11373. Grep confirmed nothing
  else uses `.line-movement` / `mv-up` / `mv-down`.
- Is renderFighters actually being called after reset, or is there a
  debouncer/throttle swallowing the call?
- Does the user have a stale service-worker cached version of analyzer.js?
  chrome://serviceworker-internals/ or check dist timestamp inside the
  loaded extension folder.
- Is `let _sessionStartAt = Date.now()` actually reassignable, or is TypeScript
  compiling it to `const` somewhere? Double-check with: `grep _sessionStartAt dist/analyzer.js`
- Is the badge rendered once in the initial HTML (server-rendered string) and
  never re-rendered? Check that renderFighters() actually clears and rewrites
  card HTML rather than appending.
- Does anything hydrate badges from OUTSIDE renderFighters? Could be a
  separate summary pass — check renderLineMovementSummary.

KEY FILES
- src/analyzer.ts:11373 — lineCell (the only badge renderer)
- src/analyzer.ts:7295-7318 — opening line tracker module state
- src/analyzer.ts:7515-7629 — snapshotOpeningLines
- src/analyzer.ts:7635-7677 — detectAndRecordMovements
- src/analyzer.ts:7367-7509 — loadOpeningLines (staleness wipe)
- src/analyzer.ts:14758-14822 — RESET LINES handler
- src/background.ts:108-182 — initializeBetrLines (BETR_EVENT_DATE='2026-04-11')

RULES THAT MUST BE PRESERVED (see memory/feedback_betr_reset_rule.md)
- RESET LINES clears Betr iff betr_event_date (from storage) is past.
- During fight week, Betr lines + _openingLines betr baselines must be
  preserved across RESET.
- The rule is date-driven, never archive-driven, never upcomingEventTs-driven.

THIS IS FIX ATTEMPT #4+ FOR THIS BUG. User has said "still not fixed"
multiple times. Verify the new bundle is loaded BEFORE making more code
changes. If the new bundle IS loaded and badges still show, instrument
lineCell to log the grace-period check + what _sessionStartAt is + what
delta values are being computed, then ask user to paste console output.
```

---

## Recent Commits
```
90e58ac fix: stale-detect infinite loop + Betr modal shows stale lines after clear
d6a8274 checkpoint: line shop diff, style matchup, news flag, FT suite, finish split, opp quality
91f3b50 update RESUME_CHECKPOINT with paste-ready resume code block
4bfb6da snapshot: add compiled analyzer.js and RESUME_CHECKPOINT.md
43c6fa2 checkpoint: H2H modal, ML-adj FP, trend arrows, line movement tracker, Betr manual persist
```

## Uncommitted changes in src/analyzer.ts
- snapshotOpeningLines: removed prev-refresh fallback, added grace-period re-anchor (7589-7613)
- lineCell: grace-period badge suppression (11383-11390)
- _sessionStartAt declared `let` instead of `const` (7313)
- RESET LINES handler: resets _sessionStartAt = Date.now() (14796-14798)
- processData: renderFighters+renderLineMovementSummary after snapshot (~13221)
- Betr save handler: same re-render after snapshot (~15299)

## Quick Commands
```bash
npm run build
git log --oneline -5
git status
grep -n _withinBaselineGrace src/analyzer.ts
grep -n _sessionStartAt src/analyzer.ts
grep -n 'const _sessionStartAt\|let _sessionStartAt' dist/analyzer.js
```
