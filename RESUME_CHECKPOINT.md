# Resume Checkpoint

Last Saved: 2026-08-29 15:51:43 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: f2c603b

## Last Notes
SESSION HANDOFF (2026-08-29, ~15:50). All committed and pushed to master + feature/sleek-theme-v1 (master is cherry-picked, different SHAs); dist committed with every src change; tree clean. MODEL_VERSION 35.

THE ARCHIVE AUDIT IS COMPLETE AND USER-VERIFIED BY SCREENSHOT.
Every item from the previous checkpoint's audit list is closed. Verified on screen: Platform Bias "3770 markets priced"; Platform x Stat led by Pick6 FP (n=632) with DK TD 100% (n=4) demoted to 4th; Best Combos ABOVE 60% = UD A 82% 36/44, Pick6 A 82% 32/39, Pick6 B 66% 221/334; Worst Combos BELOW 60% = Pick6 D, Pick6 C, UD D, UD C, UD B; Calibration 93/100 with "-4.2 pts over-confident".

SHIPPED THIS SESSION (archive audit)
- f8796a2 fix: a null line was graded as a line of ZERO in ten places. Number(null) is 0, so a missing line silently became a real comparison. Introduced finiteLineOrNaN and applied it at every activeLine read, INCLUDING the recalibration engine.
- b931b1f fix(calibration): the Brier score counted BUCKETS, so an n=9 bucket weighed the same as an n=250 one and supplied 71% of total error - the headline was a readout of the thinnest cell. Now population-weighted, and paired with a SIGNED calibBiasPts, because magnitude alone cannot tell over- from under-confidence.
- fe3e3d8 fix(bias): the platform-bias aggregation existed in THREE copies and I had patched the one the panel does not render. Shared dedupeBiasRows keyed platform|propType|fighter|DATE (date, not event name - the name is the thing that varies). One of the three feeds _platformBiasCache -> leanBestBook, so this moved the MODEL, not just the panel: UD SS +0.7 -> -0.1, Pick6 SS +0.3 -> -0.6, DK SS +0.1 -> +1.5.
- edd6bd8 fix(grading): THE IMPORTANT ONE. c776f26 had sorted the leaderboards on shrunkHitRate and the rendered order did not move by a single row - Laplace (+1/+1) scores 4/4 at .833 against 392/632 at .620, far too light to discipline a small n and irrelevant at a large one. Replaced with wilsonBound (Wilson score interval). Best lists rank on the LOWER bound, worst lists on the UPPER - ranking both on the same bound hands one list to whichever cell is thinnest.
- 6af711e + f2c603b fix(grading): 75% rows were printed under "Worst Combos". Two causes: the sample floor was 3 (one Betr card qualified), and the lists took a FIXED five rows each - with ten combos total that is every row, so each list had to reach past its own name. Floor raised to 10; lists now split on the model's overall rate (60%) and are as long as they deserve, which also makes them disjoint by construction.
- 8c6ff97 fix(bias): the panel header still counted raw rows (5366) above five totals summing to 3770.

*** THE LESSON THAT COST A ROUND TRIP: c776f26 was reported as verified because grep found the code in dist/. Presence in the build proves the code RUNS, not that it CHANGED anything - it shipped two no-ops. Verify against the NUMBERS on screen. Cheapest form: replay the on-screen values through old and new formula in node; that reproduced the unchanged ordering exactly and would have caught it pre-commit. Saved to memory as feedback_verify_by_numbers_not_dist_presence. ***

ALSO CLOSED: the previous checkpoint's "UNKNOWN platform, avg edge +49.4" mystery was the null-line-as-zero bug (f8796a2). The 1061-vs-1161 count gap is BY DESIGN - calibration requires conf >= 50. The !isFinite(conf) guard in the grading loop fixed NOTHING (every snapshot pick carries a confidence, 1161 both ways); it stays as a guard and its comment now says so.

THE ONE OPEN MODEL QUESTION (not a bug)
The model runs -4.2 pts OVER-CONFIDENT, concentrated in the 60-79% band across n=611 (56% of all graded picks, every bucket leaning the same way). The grading panel now says the same thing from a second angle: every C and D cell on both books sits below the 60% line, while only A grades and Pick6 B clear it. That is the recalibration engine not reaching the middle of its own distribution. Wants more settled cards before the per-bucket numbers hold still. No MODEL_VERSION change made for it.

IN PROGRESS RIGHT NOW: AUDITING THE AI ACCURACY SECTION
User asked for the same treatment the Archive just got. Panels in scope: AI PICK ACCURACY BY STAT TYPE (FP 402/657 61%, SS 250/442 57%, TD 10/12 83%, FT 31/47 66%), BOARD CLV MODEL LINE -> CLOSE (FP +0.11 n=622, SS +0.80 n=437, TD +0.08 n=12, FT +1.30 n=46), MY PLACED LEDGER (144 legs, YOU 76/144 53%, BOARD 38/80 48%), and the PER-EVENT list. Things to check first, NOT yet investigated:
- Two different events both report CLV numerator of EXACTLY 100 ("CLV 100/322", "CLV 100/396"). A pinned numerator across different denominators looks like a cap or a slice, not a measurement.
- A "DWCS 10.1" event renders in the per-event list with OVERS 0/0. DWCS contamination is a known archive issue; decide whether these belong in an AI-accuracy readout at all.
- Denominators disagree across panels for the same stat: accuracy FP n=657, board CLV FP n=622, calibration FP n=609, grading FP cells sum to 660. Some of that is by design (conf >= 50 for calibration) but not obviously all of it. Reconcile before assuming.
- Apply the audit's own lesson: does any of this count archive ROWS where it should count picks or fights?

NEXT CARD: UFC Fight Night: Hooker vs. Parnasse, 28 fighters, predictions generated on MODEL v34. Salahdine Parnasse shows NO HISTORY on a 5R main event. MICHAEL PAGE is on this card vs Nursulton Ruziboev and the model has Ruziboev at 13.5 SS - that is the user's recorded MVP-opponents-go-SS-UNDER edge agreeing, not an outlier to fade. Audit when TD + R1 SS + CTRL + FP are ALL posted (typically Friday).

ARCHIVE PANEL STATS CONVENTIONS (new, saved to memory as project_archive_panel_stats_conventions)
- Ranking cells with wildly different n: wilsonBound(hits, n, lower), display the RAW record. Do NOT reach for shrunkHitRate - that is Laplace +1/+1, correct for the lean ladders, useless for an n spanning 2 to 632.
- Best/worst lists split on the population rate, never on a fixed row count. Sample floor 10 for platform x grade combos.
- Bias dedupe keys on DATE, not event name. Per BOOK per market is correct for bias (each book pricing it is a real observation) but NOT for hit-rate leaderboards, which go one entry per fighter per fight and decide against the MEDIAN line.
- Calibration Brier is population-weighted and paired with a signed bias figure.
- Aggregations in analyzer.ts are frequently DUPLICATED. Grep for every occurrence before patching one.

HOUSE RULES
- Rebuild + commit dist with EVERY src change; cherry-pick to master and push BOTH branches. `git cherry-pick -q` is NOT a valid flag.
- Bump MODEL_VERSION for lean scoring / tiering / correlation / EV / candidate selection. NOT for logging or reporting fixes.
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write, with a before/after count.
- VERIFY AGAINST THE BOARD, not a derived store or hand-rolled name matching. Ad-hoc dumps without NAME_ALIASES invent phantom gaps - four false findings this week.
- When changing a measurement, change EVERY path that reads it in the same commit (346651e was exactly this miss).
- Write patch scripts to files in the scratchpad and run them with node. Heredoc backticks and escapes have mangled comments inside `node -e` twice.
- Do NOT call `npm run checkpoint:save -- -Notes "$notes"` with multiline notes; it collapses to the first line. Call `& .\resume.ps1 -Mode save -Notes $notes` directly.


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
