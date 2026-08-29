# Resume Checkpoint

Last Saved: 2026-08-29 16:01:15 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 1a24b53

## Last Notes
SESSION HANDOFF (2026-08-29, ~16:10). All committed and pushed to master + feature/sleek-theme-v1 (master is cherry-picked, different SHAs); dist committed with every src change; tree clean. MODEL_VERSION 36.

*** FIRST THING NEXT SESSION: VERIFY 1a24b53 (MODEL v36). NOT YET CONFIRMED ON SCREEN. ***
The user was about to reload + F5 when this session ended. Ask for a screenshot of ARCHIVE > AI Accuracy and ARCHIVE > Grading/Calibration and check the numbers below MOVED. Do NOT report v36 as working on the strength of it being in dist/ - that exact mistake cost a round trip earlier today (see the "verify by numbers" rule at the bottom).

EXPECTED AFTER RELOAD (state these, then check):
- AI PICK ACCURACY BY STAT TYPE: was FP 402/657 (61%), SS 250/442 (57%), TD 10/12 (83%), FT 31/47 (66%). Denominators MUST fall hard - FP toward ~250, SS far lower. Percentages should stay in roughly the same neighbourhood; a big % swing means a pick that flipped direction across days, which is worth looking at rather than assuming a bug.
- PROP ARCHIVE GRADING: was "1161 graded AI picks" -> must drop.
- CALIBRATION CURVE: was "1061 picks resolved across 34 event(s)" and "93/100 Â· -4.2 pts over-confident" -> both restate. Do NOT quote the old -4.2 as if it survived.
- BOARD CLV: was FP +0.11 (n=622), SS +0.80 (n=437), TD +0.08 (n=12), FT +1.30 (n=46). n falls; the DELTAS SHOULD GROW, because CLV now measures from the first day the model flagged a pick instead of averaging every day's re-observation.
- Per-event AI% badges should be UNCHANGED - that panel was already correct, and that is the control.

WHAT v36 FIXED (1a24b53)
persistAiLeanSnapshot keys on `${eventName}|${eventDate}` and eventDate falls back to TODAY, so a snapshot is stored EVERY CALENDAR DAY the board is open. Live store: 80 snapshots across 14 events; "UFC 329: McGregor vs. Holloway 2" alone holds 11 (2026-06-30 .. 07-11). SEVEN loops iterated all 80 and counted each pick once per day it survived - a weighting by how early the line posted, not a sample. Measured inflation vs one-per-event: FP 3.06x, SS 20.58x, TD 4.00x.
Only the per-event AI% badge was ever right (it alone took one snapshot per event) - which is exactly why it disagreed with the stat-type boxes.
THREE OF THE SEVEN ARE NOT READOUTS: initRecalibrationMap (rewrites displayed confidence + EV on every pick), loadConfidenceMemoryEngine (learned input), and the scope-2 calibration that feeds both. That is why this is a MODEL_VERSION bump and not a display fix.
New module-level helper collapseSnapshotsByEvent(snaps, keyOf, 'latest'|'earliest') folds the history to one synthetic snapshot per event, then one pick per fighter+stat. Accuracy / grading / calibration use 'latest' (the pick as it finally stood, the one you would have acted on). Board CLV and AI x CLV use 'earliest' (measured against the final snapshot the entry line IS the close, so CLV collapses to zero by construction).
Call sites: aiSnapsFinal / aiSnapsFirst in the Archive scope; inline calls in the AI-accuracy scope, initRecalibrationMap, and loadConfidenceMemoryEngine.

STILL OPEN IN THE AI ACCURACY AUDIT (not yet investigated)
- Two events both report a CLV numerator of EXACTLY 100: "CLV 100/322 Â· |D| 3.18" (Hernandez vs Rodrigues) and "CLV 100/396 Â· |D| 3.29" (Machado Garry vs Makhachev). Chasing this is what found v36. There is no cap in the code (eventMap clvMoved is a plain counter over allRows). Re-check after reload - the per-event chips read the ARCHIVE not the snapshots, so v36 may not have moved them at all.
- "DWCS 10.1" renders in the per-event list at OVERS 0/0. DWCS contamination is a known archive issue; decide whether it belongs in a UFC accuracy readout at all.
- Denominators disagree across panels for the same stat and some of that is by design (calibration requires conf >= 50). Reconcile the rest AFTER v36 is verified, since v36 changes all of them.
- MY PLACED LEDGER (144 legs Â· YOU 76/144 53% Â· BOARD 38/80 48%) has not been audited yet.

THE ARCHIVE AUDIT IS COMPLETE AND USER-VERIFIED BY SCREENSHOT (earlier today)
- f8796a2 a null line was graded as a line of ZERO in ten places (Number(null) === 0). finiteLineOrNaN now guards every activeLine read, including the recalibration engine. This also explained the old "UNKNOWN platform, avg edge +49.4" mystery.
- b931b1f calibration Brier counted BUCKETS, so an n=9 bucket weighed as much as an n=250 one and supplied 71% of total error. Now population-weighted, plus a SIGNED calibBiasPts.
- fe3e3d8 the platform-bias aggregation existed in THREE copies and the first patch hit the one the panel does not render. Shared dedupeBiasRows keyed platform|propType|fighter|DATE (date, not event name - the name is the thing that varies). One copy feeds _platformBiasCache -> leanBestBook, so this moved the model: UD SS +0.7 -> -0.1, Pick6 SS +0.3 -> -0.6, DK SS +0.1 -> +1.5.
- edd6bd8 c776f26 had sorted the leaderboards on shrunkHitRate and the order did not move ONE ROW - Laplace (+1/+1) scores 4/4 at .833 vs 392/632 at .620. Replaced with wilsonBound. Best lists rank on the LOWER bound, worst on the UPPER (same bound for both hands one list to the thinnest cell).
- 6af711e + f2c603b 75% rows were printed under "Worst Combos": the sample floor was 3 AND the lists took a fixed five rows each, which over ten combos is every row. Floor now 10; lists split on the model's overall rate (60%) and are as long as they deserve, which makes them disjoint by construction.
- 8c6ff97 the bias header counted raw rows (5366) above five totals summing to 3770.

OPEN MODEL QUESTION (not a bug, and its numbers will restate under v36)
Pre-v36 the model read -4.2 pts OVER-CONFIDENT, concentrated in the 60-79% band across n=611, and the grading panel agreed from a second angle (every C and D cell on both books below the 60% line; only A grades and Pick6 B clear it). That is the recalibration engine not reaching the middle of its own distribution. RE-MEASURE UNDER v36 BEFORE ACTING - the old figure was computed on the inflated sample.

ALSO CLOSED EARLIER: the 1061-vs-1161 count gap is BY DESIGN (calibration requires conf >= 50). The !isFinite(conf) guard in the grading loop fixed NOTHING - every snapshot pick carries a confidence, 1161 both ways; it stays as a guard and its comment says so.

NEXT CARD: UFC Fight Night: Hooker vs. Parnasse, 28 fighters, predictions generated on MODEL v34 (regenerate under v36). Salahdine Parnasse shows NO HISTORY on a 5R main event. MICHAEL PAGE is on this card vs Nursulton Ruziboev and the model has Ruziboev at 13.5 SS - that is the user's recorded MVP-opponents-go-SS-UNDER edge AGREEING, not an outlier to fade. Run the Best Picks audit when TD + R1 SS + CTRL + FP are ALL posted (typically Friday).

ARCHIVE PANEL STATS CONVENTIONS (saved to memory as project_archive_panel_stats_conventions)
- Ranking cells with wildly different n: wilsonBound(hits, n, lower), display the RAW record. Do NOT reach for shrunkHitRate - that is Laplace +1/+1, correct for the lean ladders, useless for an n spanning 2 to 632.
- Best/worst lists split on the population rate, never a fixed row count. Sample floor 10 for platform x grade combos.
- Bias dedupe keys on DATE, not event name. Per BOOK per market is correct for bias (each book pricing it is a real observation) but NOT for hit-rate leaderboards, which go one entry per fighter per FIGHT and decide against the MEDIAN line.
- Calibration Brier is population-weighted and paired with a signed bias figure.
- AI snapshots are DAILY. Anything reading ai_lean_snapshots_v1 must go through collapseSnapshotsByEvent first.
- Aggregations in analyzer.ts are frequently DUPLICATED (bias had three copies, the snapshot loop had seven). Grep for EVERY occurrence before patching one.

HOUSE RULES
- VERIFY BY THE NUMBERS ON SCREEN, never by grepping dist/. Presence in the build proves the code RUNS, not that it CHANGED anything - c776f26 shipped two no-ops and was reported as working. Cheapest check: replay the on-screen values through old and new formula in node before committing.
- Rebuild + commit dist with EVERY src change; cherry-pick to master and push BOTH branches. `git cherry-pick -q` is NOT a valid flag.
- Bump MODEL_VERSION for lean scoring / tiering / correlation / EV / candidate selection / anything feeding displayed confidence. NOT for logging or reporting fixes.
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write, with a before/after count. Line data is irreplaceable - four events were lost permanently once.
- VERIFY AGAINST THE BOARD, not a derived store or hand-rolled name matching. Ad-hoc dumps without NAME_ALIASES invent phantom gaps - four false findings this week.
- When changing a measurement, change EVERY path that reads it in the same commit.
- Write patch scripts to FILES in the scratchpad and run them with node. Heredocs and `node -e` have mangled comments three times; use the Write tool for the patch script.
- Console snippets go to the user as a fenced javascript block to PASTE, not as a `cat` command - they pasted the cat line into the console once.
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
