# Resume Checkpoint

Last Saved: 2026-08-25 02:56:17 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 93ed7fc

## Last Notes
SESSION HANDOFF (2026-08-25). All work committed and pushed to master + feature/sleek-theme-v1; dist/ committed with every src change; tree clean at GLOW-UP 343.

WHERE THINGS STAND
- Learning Summary pass complete: GLOW-UP 331-343. The panel now shows SIGNED bias per stat (SS/FP chips), normalises SS/TD/FP by each stat's own scale before combining, caps any one stat at 200% so a low-denominator stat cannot swamp a fighter's score, marks capped rows with a TD flag, and uses ONE measure (perFighterNormOf) for hero/trend/trajectory/table.
- GLOW-UP 343: the AWAITING SETTLEMENT banner no longer fires for the upcoming card. Known limit: a card TWO events out with lines posted would still slip through, because archive records store the CAPTURE date, not the fight date. Fixing that needs an event date on the record (data change, not a guard change).

OPEN MODEL QUESTION - THE ONE THING TO WATCH
The Hernandez vs. Rodrigues card settled with FP bias +8.3 at exactly 1.00 SE from zero. That is noise, so v30's -11 fair-line shift and v31's +/-15 cap were BOTH LEFT UNCHANGED. But it is the first positive result against twelve negative event-clusters. IF THE NEXT SETTLED CARD ALSO COMES BACK POSITIVE, that is two in a row and the -11 shift needs re-measuring against recent clusters rather than the April-August set. The Learning Summary now surfaces this bias directly, so no console snippet is needed.

CURRENT BOARD
Nurmagomedov vs. Song, 26 fighters, MODEL v32 regenerated with real lines. Only SS x13 and FT x10 have posted; NO FANTASY LINES yet, so every FP column reads em-dash and there is no BOARD skew chip. Regenerate once FP lines land.

OPEN / DELIBERATELY NOT DONE
- Underdog has the same latent merge bug PrizePicks had (single-shot API, mergeFighters can add or change a line but never REMOVE one). Left until the PP fix proves out over a card or two.
- Four levels left on the Best Picks pass (327-330); that surface just had six, returns thinner.
- Untouched surfaces if more UI work is wanted: AI Accuracy, Grading, Platform Bias, Calibration, Backtest, fighter-card detail panels. Audit first, report what is actually wrong, then touch.

HOUSE RULES THAT BIT THIS SESSION
- Rebuild and commit dist/ with every src change; push BOTH branches (master is cherry-picked, different SHAs).
- npm run build runs scripts/guard-invariants.js first; it fails the build on four regressions (allRows.find, the duplicated event filter, storageSet dropping lastError, manifest missing unlimitedStorage).
- Read-only diagnosis BEFORE any storage-mutating snippet, always.
- When changing a measurement, change every path that reads it in the same commit. Five levels this session were repairing a sibling path left on the old maths.

## Resume Checklist
1. Run npm run build.
2. Check git status.
3. Continue the highest-priority task from your notes.

## Working Tree Status
~~~text
(clean working tree)
~~~

## Diff Summary
~~~text
(no unstaged diff)
~~~

## Quick Commands
~~~powershell
npm run checkpoint:resume
npm run build
git status
~~~
