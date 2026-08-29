# Resume Checkpoint

Last Saved: 2026-08-29 17:02:47 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 3c60654

## Last Notes
SESSION HANDOFF (2026-08-29, ~17:00). Tree clean, nothing new committed this session - this was a VERIFICATION session only. MODEL_VERSION 36.

*** MODEL v36 (1a24b53) IS VERIFIED ON SCREEN. Confirmed by user screenshot after extension reload + F5. ***

VERIFIED NUMBERS (before -> after, all four panels collapsed by the same ~2.7-3.0x factor)
- AI PICK ACCURACY BY STAT TYPE: FP 402/657 61% -> 138/221 62% (2.97x). SS 250/442 57% -> 85/163 52% (2.71x). TD 10/12 -> 4/6 (n=6, noise). FT 31/47 66% -> 23/34 68% (1.38x).
- BOARD CLV: FP +0.11 n=622 -> +0.34 n=193. SS +0.80 n=437 -> +1.31 n=158. TD +0.08 n=12 -> +0.17 n=6. FT +1.30 n=46 -> +1.44 n=33. n fell AND the deltas grew - that signature (n down, |delta| up) is what proves the 'earliest' switch took, because a shrinking archive or a stray filter would shrink n WITHOUT inflating the deltas.
- PROP ARCHIVE GRADING: 1161 -> 425 graded picks (2.73x).
- CALIBRATION CURVE: 1061 -> 383 picks resolved, still across 34 event(s) (2.77x). Event count correctly UNCHANGED - collapsing days changes picks-per-event, not event count.
- Calibration score 93/100 -4.2 pts -> 92/100 -5.1 pts over-confident.
- FP's 2.97x drop matched the 3.06x inflation measured BEFORE the reload - a quantitative hit on a pre-registered number, which is the strongest single piece of evidence.

INTERNAL RECONCILIATION (done by hand, all clean)
- Grade buckets 30+156+148+91 = 425 = header. 8c6ff97 holds.
- Calibration buckets 50+87+60+76+46+34+18+7+5 = 383 = header.
- Per-stat calibration 203+142+6+32 = 383.
- Population-weighted bias replayed by hand: sum(n*delta) = -1968, /383 = -5.14 -> displays -5.1. b931b1f still weights by population, not by bucket.
- conf>=50 gap now reconciles PER STAT: FP 221->203, SS 163->142, TD 6->6, FT 34->32 = 41 of the 42-pick gap.
- Best/worst combos split at 59% = the model's real overall rate (251/425 = 59.06%), lists disjoint, min n=12. f2c603b + floor-10 hold.

ONE PREDICTION MISSED, STILL UNEXPLAINED
SS was expected to fall ~20.58x; it fell 2.71x. Does NOT undercut the fix (SS clearly collapsed). The 20.58x was measured over RAW pick counts across all 80 snapshots, while the accuracy denominator also requires a past event, an archive row, a finite result and conf>=50. Those filters are a PLAUSIBLE but UNVERIFIED explanation. Treat 20.58x as unexplained, not explained.

DENOMINATOR DISAGREEMENT: effectively CLOSED, residue is 2 rows (was tens)
- platform x stat sums to 423, not 425: TWO picks carry a platform that is neither Pick6 nor UD, one of them a TD (TD splits 2+3=5 vs the accuracy panel's 6).
- grading counts 425 vs the accuracy stat boxes' 424 (221+163+6+34).
- Combos sum to the same 423, so the 2 strays are consistently the ones missing wherever the panel keys on platform.
Not structural. Chase only if you want the last 2 rows.

*** THE OPEN MODEL QUESTION WAS MIS-FRAMED - CORRECTED HERE ***
The old note read the over-confidence as "the recalibration engine not reaching the middle of its own distribution". IT CANNOT BE. The engine's output never enters this measurement.
- persistAiLeanSnapshot stores `confidence: el.conf` (analyzer.ts ~11126) = the RAW lean confidence, BEFORE the CLV boost and BEFORE recalibration.
- The fighter row displays recalConf (analyzer.ts ~21729); getDisplayedConf does the same (~18251).
- getRecalibratedConfidence has exactly FOUR consumers - evWinProb/EV (~7293), parlay legs (~12106/12109), and those two display paths. NONE of them is the snapshot writer.
So the calibration curve grades a number that never appears on the board, and would read the same -5.1 however well the engine were working. -5.1 is the RAW model's over-confidence; the engine already corrects it downstream in displayed conf, the grade letter, and EV. The grading panel is consistent with calibration (its confidenceGrade also comes off raw el.conf) - both panels agree with each other, both measure PRE-engine.
DECISION PENDING: whether to snapshot the DISPLAYED (recalibrated) confidence so calibration grades what is actually on screen. Not done - user's call. Note it would be a measurement change, so per house rules it must change EVERY path that reads it in the same commit.

THE OVER-CONFIDENCE SHAPE CHANGED UNDER THE HONEST SAMPLE
It is NO LONGER a uniform 60-79 band problem (that reading came from the inflated sample):
- 70-74 (n=46): +2 and 80-84 (n=18): +1 -> well calibrated.
- 60-64 (n=60): -9, 65-69 (n=76): -5 -> mild.
- 75-79 (n=34): -18 <- one thin cell, 9% of the sample carrying 31% of the total signed error.
- 85-89 (n=7), 90+ (n=5) -> noise at those n.

REAL ACTIONABLE FINDING: SS, NOT THE CONFIDENCE CURVE
SS calibration 74/142 = 52% against a 52.4% breakeven - SS leans are NOT profitable in aggregate. Accuracy panel agrees (SS 52%). Platform split: UD SS 49% (n=83) vs Pick6 SS 55% (n=80). Consistent with fe3e3d8 having moved UD SS +0.7 -> -0.1. Decide whether SS gets a model pass before the Hooker/Parnasse card.

STILL OPEN IN THE AI ACCURACY AUDIT
- Two events STILL report a CLV numerator of EXACTLY 100: "CLV 100/322 |D| 3.18" (Hernandez vs Rodrigues) and "CLV 100/396 |D| 3.29" (Machado Garry vs Makhachev). CONFIRMED UNCHANGED by v36 - expected, those chips read the ARCHIVE not the snapshots. That RULES v36 OUT as the cause and leaves the exact-100 coincidence as its own thing to chase. There is no cap in the code (eventMap clvMoved is a plain counter over allRows).
- "DWCS 10.1" still renders in the per-event list at OVERS 0/0. Decide whether DWCS belongs in a UFC accuracy readout at all.
- MY PLACED LEDGER (144 legs, YOU 76/144 53%, BOARD 38/80 48%) still NOT audited.

ARCHIVE AUDIT: COMPLETE AND USER-VERIFIED BY SCREENSHOT
- f8796a2 a null line was graded as a line of ZERO in ten places (Number(null) === 0). finiteLineOrNaN now guards every activeLine read, including the recalibration engine. Also explained the old "UNKNOWN platform, avg edge +49.4" mystery.
- b931b1f calibration Brier counted BUCKETS, so an n=9 bucket weighed as much as an n=250 one and supplied 71% of total error. Now population-weighted, plus a SIGNED calibBiasPts. RE-VERIFIED BY HAND under v36 (see above).
- fe3e3d8 the platform-bias aggregation existed in THREE copies and the first patch hit the one the panel does not render. Shared dedupeBiasRows keyed platform|propType|fighter|DATE. One copy feeds _platformBiasCache -> leanBestBook, so this moved the model: UD SS +0.7 -> -0.1, Pick6 SS +0.3 -> -0.6, DK SS +0.1 -> +1.5.
- edd6bd8 c776f26 had sorted the leaderboards on shrunkHitRate and the order did not move ONE ROW. Replaced with wilsonBound. Best lists rank on the LOWER bound, worst on the UPPER.
- 6af711e + f2c603b 75% rows printed under "Worst Combos": sample floor was 3 AND the lists took a fixed five rows each. Floor now 10; lists split on the model's overall rate and are as long as they deserve. RE-VERIFIED under v36.
- 8c6ff97 the bias header counted raw rows (5366) above five totals summing to 3770. RE-VERIFIED under v36.

WHAT v36 FIXED (1a24b53) - kept for reference
persistAiLeanSnapshot keys on `${eventName}|${eventDate}` and eventDate falls back to TODAY, so a snapshot is stored EVERY CALENDAR DAY the board is open. Live store: 80 snapshots across 14 events; "UFC 329: McGregor vs. Holloway 2" alone holds 11. SEVEN loops iterated all 80 and counted each pick once per day it survived - a weighting by how early the line posted, not a sample.
Only the per-event AI% badge was ever right (it alone took one snapshot per event) - which is exactly why it disagreed with the stat-type boxes.
THREE OF THE SEVEN ARE NOT READOUTS: initRecalibrationMap, loadConfidenceMemoryEngine, and the scope-2 calibration that feeds both. That is why this was a MODEL_VERSION bump and not a display fix.
collapseSnapshotsByEvent(snaps, keyOf, 'latest'|'earliest') folds history to one synthetic snapshot per event, then one pick per fighter+stat. Accuracy / grading / calibration use 'latest'. Board CLV and AI x CLV use 'earliest' (against the final snapshot the entry line IS the close, so CLV collapses to zero by construction). Call sites: analyzer.ts 3085, 15746/15747, 17494, 24779.

NEXT CARD: UFC Fight Night: Hooker vs. Parnasse, 28 fighters, predictions generated on MODEL v34 - REGENERATE UNDER v36. Salahdine Parnasse shows NO HISTORY on a 5R main event. MICHAEL PAGE is on this card vs Nursulton Ruziboev and the model has Ruziboev at 13.5 SS - that is the user's recorded MVP-opponents-go-SS-UNDER edge AGREEING, not an outlier to fade. Run the Best Picks audit when TD + R1 SS + CTRL + FP are ALL posted (typically Friday).

ARCHIVE PANEL STATS CONVENTIONS (in memory as project_archive_panel_stats_conventions)
- Ranking cells with wildly different n: wilsonBound(hits, n, lower), display the RAW record. NOT shrunkHitRate (Laplace +1/+1) - correct for lean ladders, useless for an n spanning 2 to 632.
- Best/worst lists split on the population rate, never a fixed row count. Sample floor 10 for platform x grade combos.
- Bias dedupe keys on DATE, not event name. Per BOOK per market is correct for bias but NOT for hit-rate leaderboards, which go one entry per fighter per FIGHT and decide against the MEDIAN line.
- Calibration Brier is population-weighted and paired with a signed bias figure.
- AI snapshots are DAILY. Anything reading ai_lean_snapshots_v1 must go through collapseSnapshotsByEvent first.
- Snapshots store RAW confidence, the board shows RECALIBRATED. Do not assume a panel reading pick.confidence is grading what the user saw.
- Aggregations in analyzer.ts are frequently DUPLICATED (bias had three copies, the snapshot loop had seven). Grep for EVERY occurrence before patching one.

HOUSE RULES
- VERIFY BY THE NUMBERS ON SCREEN, never by grepping dist/. Presence in the build proves the code RUNS, not that it CHANGED anything - c776f26 shipped two no-ops and was reported as working. Cheapest check: replay the on-screen values through old and new formula in node before committing. This session's verification is the model: predict the numbers FIRST, then check them, and replay the weighted arithmetic by hand.
- Rebuild + commit dist with EVERY src change; cherry-pick to master and push BOTH branches. `git cherry-pick -q` is NOT a valid flag.
- Bump MODEL_VERSION for lean scoring / tiering / correlation / EV / candidate selection / anything feeding displayed confidence. NOT for logging or reporting fixes.
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write, with a before/after count. Line data is irreplaceable - four events were lost permanently once.
- VERIFY AGAINST THE BOARD, not a derived store or hand-rolled name matching. Ad-hoc dumps without NAME_ALIASES invent phantom gaps.
- When changing a measurement, change EVERY path that reads it in the same commit.
- Write patch scripts to FILES in the scratchpad and run them with node. Heredocs and `node -e` have mangled comments three times; use the Write tool for the patch script.
- Console snippets go to the user as a fenced javascript block to PASTE, not as a `cat` command.
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
