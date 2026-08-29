# Resume Checkpoint

Last Saved: 2026-08-29 17:18:11 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 240fe65

## Last Notes
SESSION HANDOFF (2026-08-29, ~17:20). Tree clean. MODEL_VERSION 36 (NOT bumped this session - reporting change only).
Pushed: feature/sleek-theme-v1 240fe65, master a3da1f5 (cherry-picked, src verified identical between branches).

BOARD STATE RIGHT NOW: "Ready for Next Event", ALL FIGHTERS 0, 40031 records settled (was 38.7k).
Nurmagomedov vs Song finished and absorbed cleanly the morning of 2026-08-29. NO card is loaded, so
persistAiLeanSnapshot is early-returning (`if (!fighters.length) return` / `if (!eventName) return`) and
NO new snapshots are being written at all. Next card is UFC Paris = "UFC Fight Night: Hooker vs. Parnasse";
props have NOT dropped yet.

=== DONE THIS SESSION ===

1. MODEL v36 (1a24b53) VERIFIED ON SCREEN - see the full before/after below. Closed.
2. NEW: 240fe65 - the calibration curve was grading a confidence the board never showed. Shipped, read path
   verified on screen, write path NOT yet verifiable (needs a loaded card).

=== 240fe65 - displayedConfidence (VERIFIED HALFWAY, SEE GATES) ===

THE BUG: persistAiLeanSnapshot stored `confidence: el.conf` - RAW, before the CLV boost and before
recalibration - while the fighter row displays recalConf (analyzer.ts ~21807 / getDisplayedConf). So the
calibration curve and the grading panel graded a number that NEVER APPEARS ON SCREEN, and would have read
the same -5.1 pts over-confident however well the recalibration engine was working.

WHY IT WAS NOT DONE THE OBVIOUS WAY: storing the recalibrated value IN PLACE of raw would have broken the
engine. Of the FIVE readers of snapshot confidence, THREE are engine inputs:
  - initRecalibrationMap (~24861)              RAW - builds _recalibrationMap
  - the scope-2 calibration map build (~17569) RAW - builds _recalibrationMap / _recalibrationByType
  - deriveConfidenceMemoryTagsFromSnapshotPick (~3001) RAW - grade: tag, learning input
  - calibration curve readout (~16473)         SWITCHED to snapshotDisplayConf
  - grading panel readout (~16760)             SWITCHED to snapshotDisplayConf
The map's DOMAIN is raw confidence and its OUTPUT is the displayed value. Feeding it back would compound the
correction every cycle. All three raw sites now carry a "RAW, deliberately - NOT snapshotDisplayConf" comment
explaining why, so a later patch does not "align" them.

A RACE THAT WOULD HAVE POISONED THE DATA SILENTLY: the caller fires `void initRecalibrationMap()` and
`void persistAiLeanSnapshot()` as two un-awaited voids (~24735). On a cold load the map is still null, so
displayedConfidence would have stored the un-recalibrated value - recalibrated on a warm re-render, raw on a
fresh load, non-deterministically. persistAiLeanSnapshot now AWAITS initRecalibrationMap (it early-returns
once populated, so the warm path costs nothing) and records `recalibrationReady` on every pick.

NEW HELPERS
  isRecalibrationReady()            ~17439  map has >=2 buckets
  snapshotDisplayConf(pick)         ~17453  displayedConfidence ?? confidence  <- READOUTS ONLY
  snapshotUsesDisplayedConf(pick)   ~17460  does this pick carry a true displayed value
  displayedConfFor(f, lean)         ~18317  raw -> CLV boost -> clamp -> recalibration
getDisplayedConf(f) now delegates to displayedConfFor. The lean is passed EXPLICITLY because the snapshot
writers log a SPECIFIC column's lean, which is not always getEffectiveLean(f) - getDisplayedConf(f) would
have been wrong inside persistBestPicksSnapshot.

persistBestPicksSnapshot ALSO writes displayedConfidence now. NOTHING READS IT THERE YET - the placed ledger
still reports raw ("conf taken 63% / skipped 60%"). It is written because snapshots are write-once history
and cannot be backfilled; when the ledger finally gets audited the data will already be there.

NO MODEL_VERSION BUMP - engine inputs, board confidence, EV and candidate selection are all untouched.
Reporting change per the house rule.

*** TWO VERIFICATION GATES - ONE PASSED, ONE PENDING ***
GATE 1 (read path) PASSED 2026-08-29 17:16, user screenshot: Grading header reads
  "425 GRADED AI PICKS - 0/425 ON DISPLAYED CONF" (amber) and EVERY number below is unchanged
  (A 25/30 83%, B 101/156 65%, C 81/148 55%, D 44/91 48%, platform x stat and both combo lists identical).
  That is the CORRECT result: the badge existing proves the rewiring loaded; 0/425 proves the fallback works
  and that none of the 80 stored snapshots carry a displayed value. If the numbers HAD moved that would have
  been the bug. Calibration's own badge (0/383) uses a separate counter but the same helper - not separately
  screenshotted, low risk.
GATE 2 (write path) PENDING. Requires a LOADED CARD. When Paris props drop and the board renders fighters,
  a snapshot gets written carrying displayedConfidence + recalibrationReady. Verify READ-ONLY with:

chrome.storage.local.get('ai_lean_snapshots_v1', (r) => {
  const snaps = r.ai_lean_snapshots_v1 || [];
  const latest = [...snaps].sort((a,b)=>String(b.capturedAt||'').localeCompare(String(a.capturedAt||'')))[0];
  if (!latest) return console.log('no snapshots');
  const picks = latest.picks || [];
  const withNew = picks.filter(p => Number.isFinite(Number(p.displayedConfidence)));
  console.log('event:', latest.event, '| captured:', latest.capturedAt);
  console.log('picks:', picks.length, '| carrying displayedConfidence:', withNew.length,
              '| recalibrationReady:', picks[0] && picks[0].recalibrationReady);
  console.table(picks.slice(0,12).map(p => ({ fighter: p.fighter, stat: p.source, lean: p.lean,
    raw: p.confidence, displayed: p.displayedConfidence,
    delta: Number.isFinite(Number(p.displayedConfidence)) ? Number(p.displayedConfidence) - Number(p.confidence) : null })));
  console.log('TOTAL snapshots in store:', snaps.length);
});

  Expect recalibrationReady TRUE and a non-zero delta on most picks. If recalibrationReady comes back FALSE,
  the awaited initRecalibrationMap is failing to populate - investigate before trusting the stored values.
GATE 3 (the badge moves) is AFTER PARIS SETTLES. Calibration and grading only count picks from PAST events
  with archive rows, so the badge stays 0/N through all of fight week and jumps once Paris resolves. Do NOT
  read a stuck 0/N during fight week as a failure.

=== MODEL v36 (1a24b53) - VERIFIED, CLOSED ===
- AI PICK ACCURACY: FP 402/657 61% -> 138/221 62% (2.97x). SS 250/442 57% -> 85/163 52% (2.71x).
  TD 10/12 -> 4/6 (n=6, noise). FT 31/47 66% -> 23/34 68% (1.38x).
- BOARD CLV: FP +0.11 n=622 -> +0.34 n=193. SS +0.80 n=437 -> +1.31 n=158. TD +0.08 n=12 -> +0.17 n=6.
  FT +1.30 n=46 -> +1.44 n=33. n fell AND the deltas grew - that signature (n down, |delta| up) is what
  PROVES the 'earliest' switch took; a shrinking archive would shrink n WITHOUT inflating the deltas.
- GRADING 1161 -> 425 (2.73x). CALIBRATION 1061 -> 383, still across 34 events (2.77x). Event count
  correctly unchanged. Score 93/100 -4.2 -> 92/100 -5.1.
- FP's 2.97x drop matched the 3.06x inflation measured BEFORE the reload - a hit on a pre-registered number.
- Hand-reconciled: grade buckets 30+156+148+91=425. Calib buckets sum 383. Per-stat 203+142+6+32=383.
  Population-weighted bias replayed: sum(n*delta) = -1968, /383 = -5.14 -> displays -5.1 (b931b1f holds).
  conf>=50 gap reconciles per stat: FP 221->203, SS 163->142, TD 6->6, FT 34->32 = 41 of the 42-pick gap.
  Combos split at 59% = the real overall rate (251/425 = 59.06%), disjoint, min n=12 (f2c603b + floor-10 hold).

ONE v36 PREDICTION MISSED, STILL UNEXPLAINED
SS was expected to fall ~20.58x; it fell 2.71x. Does NOT undercut the fix. The 20.58x was measured over RAW
pick counts across all 80 snapshots, while the accuracy denominator also requires a past event, an archive
row, a finite result and conf>=50. PLAUSIBLE but UNVERIFIED. Treat as unexplained, not explained.

DENOMINATOR DISAGREEMENT: effectively CLOSED, residue 2 rows (was tens)
platform x stat sums to 423 not 425 - two picks carry a platform that is neither Pick6 nor UD, one a TD
(TD splits 2+3=5 vs the accuracy panel's 6). Grading counts 425 vs the accuracy boxes' 424. Combos sum to
the same 423. Not structural.

=== THE OVER-CONFIDENCE PICTURE (RE-READ AFTER GATE 3) ===
Under v36 it is NO LONGER a uniform 60-79 band problem (that reading came from the inflated sample):
  70-74 (n=46) +2 and 80-84 (n=18) +1 -> well calibrated.
  60-64 (n=60) -9, 65-69 (n=76) -5 -> mild.
  75-79 (n=34) -18 <- one thin cell, 9% of the sample carrying 31% of the total signed error.
  85-89 (n=7), 90+ (n=5) -> noise.
CAVEAT: all of the above is still measured on RAW confidence, because every snapshot in the store predates
displayedConfidence. The whole picture must be RE-READ once the badge shows real coverage (gate 3) - it may
look very different once the engine's own correction is what is being graded.

REAL ACTIONABLE FINDING: SS, NOT THE CONFIDENCE CURVE
SS calibration 74/142 = 52% against a 52.4% breakeven - SS leans are NOT profitable in aggregate. Accuracy
panel agrees (SS 52%). Platform split UD SS 49% (n=83) vs Pick6 SS 55% (n=80). Consistent with fe3e3d8 having
moved UD SS +0.7 -> -0.1. DECIDE whether SS gets a model pass before Paris. NOT started.

=== STILL OPEN ===
- Two events STILL report a CLV numerator of EXACTLY 100: "CLV 100/322 |D| 3.18" (Hernandez vs Rodrigues)
  and "CLV 100/396 |D| 3.29" (Machado Garry vs Makhachev). CONFIRMED UNCHANGED by v36 - those chips read the
  ARCHIVE not the snapshots, which RULES v36 OUT as the cause. No cap exists in the code (eventMap clvMoved
  is a plain counter over allRows). Own thing to chase.
- "DWCS 10.1" renders in the per-event list at OVERS 0/0. Decide whether DWCS belongs in a UFC readout.
- MY PLACED LEDGER (144 legs, YOU 76/144 53%, BOARD 38/80 48%) still NOT audited. When it is, switch its
  confidence readout to displayedConfidence - the field is already being written.

=== ARCHIVE AUDIT: COMPLETE AND USER-VERIFIED ===
- f8796a2 a null line graded as a line of ZERO in ten places (Number(null) === 0). finiteLineOrNaN now guards
  every activeLine read. Also explained the old "UNKNOWN platform, avg edge +49.4" mystery.
- b931b1f calibration Brier counted BUCKETS (n=9 weighed as much as n=250, supplied 71% of total error). Now
  population-weighted + signed calibBiasPts. RE-VERIFIED BY HAND under v36.
- fe3e3d8 platform-bias aggregation existed in THREE copies; the first patch hit the one the panel does not
  render. Shared dedupeBiasRows keyed platform|propType|fighter|DATE. One copy feeds _platformBiasCache ->
  leanBestBook, so it moved the model: UD SS +0.7 -> -0.1, Pick6 SS +0.3 -> -0.6, DK SS +0.1 -> +1.5.
- edd6bd8 leaderboards sorted on shrunkHitRate did not move ONE ROW. Replaced with wilsonBound; best ranks on
  the LOWER bound, worst on the UPPER.
- 6af711e + f2c603b 75% rows printed under "Worst Combos" (floor was 3, lists took a fixed five each).
- 8c6ff97 bias header counted raw rows (5366) above five totals summing to 3770.

=== WHAT v36 FIXED (reference) ===
persistAiLeanSnapshot keys on `${eventName}|${eventDate}`, eventDate falls back to TODAY, so a snapshot is
stored EVERY CALENDAR DAY the board is open. Live store: 80 snapshots across 14 events; UFC 329 alone holds
11. SEVEN loops iterated all 80 and counted each pick once per day it survived - a weighting by how early the
line posted, not a sample. Only the per-event AI% badge was ever right (one snapshot per event), which is
exactly why it disagreed with the stat-type boxes. THREE of the seven are NOT readouts (initRecalibrationMap,
loadConfidenceMemoryEngine, scope-2 calibration) - hence a MODEL_VERSION bump, not a display fix.
collapseSnapshotsByEvent(snaps, keyOf, 'latest'|'earliest') folds to one synthetic snapshot per event then one
pick per fighter+stat. Accuracy/grading/calibration use 'latest'; Board CLV and AI x CLV use 'earliest'
(against the final snapshot the entry line IS the close, so CLV collapses to zero by construction).
Call sites: 3085, 15746/15747, 17494, 24779 (pre-240fe65 line numbers).

NEXT CARD: UFC Paris = "UFC Fight Night: Hooker vs. Parnasse". Predictions were generated on MODEL v34 -
REGENERATE UNDER v36. Salahdine Parnasse shows NO HISTORY on a 5R main event. MICHAEL PAGE is on this card vs
Nursulton Ruziboev and the model has Ruziboev at 13.5 SS - that is the user's recorded MVP-opponents-go-SS-
UNDER edge AGREEING, not an outlier to fade. Run the Best Picks audit when TD + R1 SS + CTRL + FP are ALL
posted (typically Friday).

=== ARCHIVE PANEL STATS CONVENTIONS (memory: project_archive_panel_stats_conventions) ===
- Ranking cells with wildly different n: wilsonBound(hits, n, lower), display the RAW record. NOT
  shrunkHitRate (Laplace +1/+1) - right for lean ladders, useless for an n spanning 2 to 632.
- Best/worst lists split on the population rate, never a fixed row count. Sample floor 10.
- Bias dedupe keys on DATE, not event name. Per BOOK per market is right for bias but NOT for hit-rate
  leaderboards, which go one entry per fighter per FIGHT and decide against the MEDIAN line.
- Calibration Brier is population-weighted and paired with a signed bias figure.
- AI snapshots are DAILY. Anything reading ai_lean_snapshots_v1 must go through collapseSnapshotsByEvent.
- Snapshots store BOTH: `confidence` is RAW (engine domain - map + memory engine), `displayedConfidence` is
  what the board showed (readouts). Never feed the engine its own output. Use snapshotDisplayConf for a
  readout, plain pick.confidence for anything that TRAINS.
- Aggregations in analyzer.ts are frequently DUPLICATED (bias had three copies, the snapshot loop had seven,
  the recal map is built in TWO places). Grep for EVERY occurrence before patching one.

=== HOUSE RULES ===
- VERIFY BY THE NUMBERS ON SCREEN, never by grepping dist/. Presence in the build proves the code RUNS, not
  that it CHANGED anything - c776f26 shipped two no-ops and was reported as working. Predict the numbers
  FIRST, then check them, and replay the weighted arithmetic by hand.
- A change can correctly produce NO movement. 240fe65 was designed to leave 425/383/-5.1 identical and prove
  itself via a new 0/N badge instead. State the expected outcome BEFORE the reload so "nothing moved" cannot
  be misread either way.
- Do not tell the user to check something that needs a loaded card when the board reads "Ready for Next
  Event" - check ALL FIGHTERS first.
- Rebuild + commit dist with EVERY src change; cherry-pick to master and push BOTH branches. Verify with
  `git diff master feature/sleek-theme-v1 -- src/analyzer.ts` (empty = parity). `git cherry-pick -q` is NOT a
  valid flag. Cherry-picking RESUME_CHECKPOINT.md conflicts because master skips some checkpoint commits -
  resolve by taking the newest version wholesale, it is a generated full-state file.
- Bump MODEL_VERSION for lean scoring / tiering / correlation / EV / candidate selection / anything feeding
  displayed confidence. NOT for logging or reporting fixes.
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write, with a before/after
  count. Line data is irreplaceable - four events were lost permanently once.
- VERIFY AGAINST THE BOARD, not a derived store or hand-rolled name matching.
- When changing a measurement, change EVERY path that reads it in the same commit - and check whether some of
  those paths are TRAINING inputs rather than readouts, because those must NOT change.
- Write patch scripts to FILES in the scratchpad and run them with node; heredocs and `node -e` have mangled
  comments three times. Small targeted edits are safer via the Edit tool directly on the source.
- Console snippets go to the user as a fenced javascript block to PASTE, not as a `cat` command.
- Do NOT call `npm run checkpoint:save -- -Notes "$notes"` with multiline notes; it collapses to the first
  line. Call `& .\resume.ps1 -Mode save -Notes $notes` directly.


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
