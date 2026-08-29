# Resume Checkpoint

Last Saved: 2026-08-29 17:39:55 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 13f827b

## Last Notes
SESSION HANDOFF (2026-08-29, ~17:40). Tree clean. MODEL_VERSION 37.
Pushed: feature/sleek-theme-v1 13f827b, master e4e4977 (cherry-picked; src+dist parity verified).

BOARD STATE: "Ready for Next Event", ALL FIGHTERS 0, 40031 records settled. Nurmagomedov vs Song
finished and absorbed cleanly the morning of 2026-08-29. NO card loaded, so persistAiLeanSnapshot is
early-returning and NO snapshots are being written. Next card is UFC Paris = "UFC Fight Night: Hooker
vs. Parnasse"; props have NOT dropped.

=== THREE THINGS SHIPPED THIS SESSION ===
1. MODEL v36 (1a24b53) VERIFIED ON SCREEN. Closed.
2. 240fe65 displayedConfidence - calibration was grading a number the board never showed. Read path
   verified on screen; write path still pending a loaded card.
3. MODEL v37 (13f827b) SS market anchor - the projection was +6 high and the market wasn't.

=== MODEL v37 (13f827b) - SS MARKET ANCHOR ===
THE MEASUREMENT (149 settled SS picks from the snapshot store, 2026-08-29):
  proj - actual  = +6.32   <- model overshoots real SS by six strikes
  line - actual  = +0.29   <- market essentially unbiased
  proj - line    = +6.03 mean, +5.00 median, projection above line on 68% of picks
  MAE proj 27.29  vs  MAE line 25.90   <- the POSTED LINE predicts actual SS better than the model
Those three reconcile exactly (6.32 - 0.29 = 6.03), so it is not a join artifact. 149/149 verdicts parsed.

WHY IT MATTERED: diff = effectiveSS - line_ss is the biggest single score term (+/-2.5) and it was
comparing the line against an estimator strictly worse than the line. The +6 offset put the projection
above the line on 68% of picks, which IS the 2:1 OVER volume and IS the 47% OVER hit rate. UNDER had to
overcome the same +6 handicap before it could fire, so only genuinely strong cases survived - 60%.
ONE BIAS WITH A FILTER ON ONE SIDE, not two separate edges.

THE SPLIT THAT STARTED IT (SS, n=149, breakeven 52.4%):
  OVER  47/99 = 47%      UNDER 30/50 = 60%
  by tier: OVER 40/56/46 (weak/mid/strong) - FLAT-TO-INVERTED, strong 65+ is the WORST cell
           UNDER 45/65/77 - MONOTONIC, the model genuinely knows what it is doing on that side
  Raw split alone was NOT significant (two-proportion z=1.44, p=0.15). The mechanism is what made it
  actionable - do not quote the split on its own.

THE FIX:  effectiveSS = line_ss + 0.5 * ((effectiveSS - 6) - line_ss)
  == midpoint(line, proj) - 3. Applied AFTER durationAdjustProjection in calcSSLean.
  Constants exported from config/index.ts as SS_PROJECTION_BIAS=6, SS_MARKET_ANCHOR_WEIGHT=0.5.
  Verified in node before committing: shipped formula is byte-identical to swept candidate C, and the
  predicted mean gap drops +6.03 -> +0.015.

THE SWEEP (candidate table, same 149 rows; line-only MAE baseline = 25.90):
  today  (proj - 0)        MAE 27.29  bias +6.32  O:U 2.52  fires 116  dirHit 54%
  debias6 + k=0.5  <-WON   MAE 25.61  bias +0.30  O:U 0.81  fires  85  dirHit 59%
  Only candidate to BEAT the line-only MAE baseline, best dirHit, near-balanced O:U.
  Trade: 31 picks of volume for +5pts accuracy. 116 x 1.6pts ~ +1.9u today vs 85 x 6.6pts ~ +5.6u.

*** IN-SAMPLE CAVEAT - DO NOT FORGET ***
6 and 0.5 were chosen against the same 149 rows they are scored on. Expect worse than 59% live; Wilson
lower bound on 50/85 is ~48%, BELOW breakeven. Kept as round numbers (not 6.32) to limit the overfit.
This is mechanism-backed and the best available, NOT proven. RE-MEASURE AFTER PARIS.

*** TWO THINGS LOOKED FOR AND NOT FOUND - DO NOT RE-TRY ***
- GAP SIZE IS NOT ANTI-SIGNAL FOR SS. OVER by |gap| runs 50% / 36% / 55% (<5 / 5-12 / 12+) -
  non-monotonic, small cells. FP v30/v31's "cap the gap at +/-15" does NOT transfer to SS.
- THE OPPONENT ADJUSTMENT ADDS NOTHING. Verdict kind split: opp-adjusted 'proj' 66/128 = 52% vs raw
  career 'avg' 11/21 = 52%. Identical. oppAvgSSAllowedLean is not earning its place.
- ALSO WRONG ON THE WAY: "shrink toward the line" was the first instinct and is BACKWARDS. Scaling
  preserves the gap's SIGN, so it cuts volume while leaving the skew intact - the sweep had it making
  O:U WORSE (2.52 -> 4.40 at k=0.5, and 12.67 at k=0.25) because only large POSITIVE gaps survive the
  +/-3 threshold. A systematic offset needs SUBTRACTION, not multiplication.

TWO SS LOOSE ENDS DELIBERATELY NOT BUNDLED (so attribution survives)
- THE +/-0.5 WEAK TIER. conf<=55 runs 21/50 = 42% (OVER 40%, UNDER 45% - bad on BOTH sides). calcSSR1Lean
  already collapses this exact tier to 'push' for exactly this reasoning, so the precedent is in-repo.
  NOT applied: the v37 anchor already cuts fires 116 -> 85, so it may now be redundant. Re-measure first.
- FINDING #3, THE DURATION-BLIND HIT-RATE TERM. history.filter(h => h.sigStr > line_ss) compares RAW
  career SS (mixed 3R/5R fights) against the current line and is worth +/-2 - the largest term after
  diff - while the projection beside it IS duration-adjusted. Untouched, and the sweep did not test it.
- Also noted: SS is the ONLY stat with a variance haircut (ssStdDev>14 -> conf-8, >7 -> -4, else +3).
  TD and FT have none. Not changed; it is honest damping, not the bug.

=== 240fe65 - displayedConfidence ===
THE BUG: persistAiLeanSnapshot stored `confidence: el.conf` - RAW, pre-CLV-boost, pre-recalibration -
while the fighter row displays recalConf. Calibration and grading were grading a number that never
appears on screen and would read the same -5.1 however well the engine worked.
NOT done by replacing raw: of the FIVE readers of snapshot confidence, THREE are ENGINE INPUTS -
initRecalibrationMap, the scope-2 map build, and deriveConfidenceMemoryTagsFromSnapshotPick. The map's
domain is raw confidence and its OUTPUT is the displayed value, so feeding it back compounds the
correction every cycle. All three now carry a "RAW, deliberately" comment.
A RACE THAT WOULD HAVE POISONED THE DATA: the caller fires initRecalibrationMap and
persistAiLeanSnapshot as two un-awaited voids, so on a cold load the map was null and displayedConfidence
would have silently stored the UN-recalibrated value. persistAiLeanSnapshot now AWAITS it and records
`recalibrationReady` per pick.
Helpers: isRecalibrationReady, snapshotDisplayConf (readouts ONLY), snapshotUsesDisplayedConf,
displayedConfFor(f, lean) - lean passed EXPLICITLY because the snapshot writers log a specific column's
lean, not always getEffectiveLean(f). persistBestPicksSnapshot writes the field too (nothing reads it
there yet; snapshots are write-once history and cannot be backfilled).
NO MODEL_VERSION bump for this one - reporting change.

*** THREE GATES - ONE PASSED, TWO PENDING ***
GATE 1 (read path) PASSED 2026-08-29 17:16 by screenshot: "425 GRADED AI PICKS - 0/425 ON DISPLAYED CONF"
  with EVERY number below unchanged. That is the CORRECT pass condition - the badge existing proves the
  wiring loaded, 0/425 proves the fallback works and no stored snapshot carries the field yet. If the
  numbers HAD moved that would have been the bug.
GATE 2 (write path) PENDING A LOADED CARD. Needs only the FIRST book lines (Pick6/UD/Betr), not the full
  Friday props - the gate is >=1 pick with a lean AND a finite activeLine. Roster alone is NOT enough:
  predicted lines live in a different store and do not satisfy getSourceActiveLine. Verify read-only:

chrome.storage.local.get('ai_lean_snapshots_v1', (r) => {
  const snaps = r.ai_lean_snapshots_v1 || [];
  const latest = [...snaps].sort((a,b)=>String(b.capturedAt||'').localeCompare(String(a.capturedAt||'')))[0];
  if (!latest) return console.log('no snapshots');
  const picks = latest.picks || [];
  console.log('event:', latest.event, '| captured:', latest.capturedAt);
  console.log('picks:', picks.length,
    '| carrying displayedConfidence:', picks.filter(p=>Number.isFinite(Number(p.displayedConfidence))).length,
    '| recalibrationReady:', picks[0] && picks[0].recalibrationReady);
  console.table(picks.slice(0,12).map(p=>({fighter:p.fighter, stat:p.source, lean:p.lean,
    raw:p.confidence, displayed:p.displayedConfidence,
    delta: Number.isFinite(Number(p.displayedConfidence)) ? Number(p.displayedConfidence)-Number(p.confidence) : null})));
  console.log('TOTAL snapshots:', snaps.length);
});

  Expect recalibrationReady TRUE and a non-zero delta on most picks. FALSE means the awaited
  initRecalibrationMap is not populating - investigate before trusting the stored values.
GATE 3 (badge moves off 0/N) is AFTER PARIS SETTLES - calibration and grading only count picks from PAST
  events with archive rows. A stuck 0/N all through fight week is EXPECTED, not a failure.

=== MODEL v36 (1a24b53) - VERIFIED, CLOSED ===
- ACCURACY: FP 402/657 61% -> 138/221 62% (2.97x). SS 250/442 57% -> 85/163 52% (2.71x).
  TD 10/12 -> 4/6. FT 31/47 66% -> 23/34 68%.
- BOARD CLV: FP +0.11 n=622 -> +0.34 n=193. SS +0.80 n=437 -> +1.31 n=158. TD +0.08 n=12 -> +0.17 n=6.
  FT +1.30 n=46 -> +1.44 n=33. n fell AND deltas grew - that signature PROVES the 'earliest' switch;
  a shrinking archive would shrink n WITHOUT inflating deltas.
- GRADING 1161 -> 425. CALIBRATION 1061 -> 383, still 34 events. Score 93/100 -4.2 -> 92/100 -5.1.
- FP's 2.97x matched the 3.06x inflation measured BEFORE the reload.
- Hand-reconciled: grade buckets sum 425; calib buckets sum 383; per-stat 203+142+6+32=383;
  population-weighted bias sum(n*delta) = -1968 / 383 = -5.14 -> -5.1 (b931b1f holds); conf>=50 gap
  reconciles per stat (41 of 42); combos split at the real overall rate 59.06%, disjoint, min n=12.
- UNEXPLAINED: SS was predicted to fall ~20.58x, fell 2.71x. The 20.58x was measured over RAW pick
  counts across all 80 snapshots while the accuracy denominator also needs a past event + archive row +
  finite result + conf>=50. PLAUSIBLE but UNVERIFIED. Treat as unexplained.
- DENOMINATOR DISAGREEMENT effectively CLOSED, residue 2 rows: platform x stat sums 423 not 425 (two
  picks on a platform that is neither Pick6 nor UD, one a TD); grading 425 vs accuracy boxes 424.

=== OVER-CONFIDENCE PICTURE (RE-READ AFTER GATE 3) ===
Under v36, NOT a uniform 60-79 band problem: 70-74 (n=46) +2 and 80-84 (n=18) +1 are well calibrated;
60-64 (n=60) -9 and 65-69 (n=76) -5 are mild; 75-79 (n=34) -18 is one thin cell carrying 31% of the
total signed error on 9% of the sample; 85-89 (n=7) and 90+ (n=5) are noise.
CAVEAT: all of it is still measured on RAW confidence because every stored snapshot predates
displayedConfidence. Must be RE-READ once gate 3 gives real coverage.

=== STILL OPEN ===
- Two events STILL report a CLV numerator of EXACTLY 100: "CLV 100/322 |D| 3.18" (Hernandez vs
  Rodrigues) and "CLV 100/396 |D| 3.29" (Machado Garry vs Makhachev). CONFIRMED UNCHANGED by v36 -
  those chips read the ARCHIVE not the snapshots, which RULES v36 OUT. No cap exists in code (eventMap
  clvMoved is a plain counter over allRows).
- "DWCS 10.1" renders in the per-event list at OVERS 0/0.
- MY PLACED LEDGER (144 legs, YOU 76/144 53%, BOARD 38/80 48%) still NOT audited. When it is, switch its
  confidence readout to displayedConfidence - persistBestPicksSnapshot already writes the field.
- The two SS loose ends above (weak tier, duration-blind hit rate).

=== NEXT CARD: UFC PARIS (Hooker vs. Parnasse) ===
- Predictions were generated on MODEL v34 and are now TWO versions behind. REGENERATE UNDER v37.
- Salahdine Parnasse shows NO HISTORY on a 5R main event.
- MICHAEL PAGE vs Nursulton Ruziboev: the model has Ruziboev at 13.5 SS. That is the user's recorded
  MVP-opponents-go-SS-UNDER edge AGREEING, not an outlier to fade. The v37 anchor shifts projections
  DOWN, which makes UNDERs easier to fire - consistent with that edge, no conflict.
- Run the Best Picks audit when TD + R1 SS + CTRL + FP are ALL posted (typically Friday).
- FIRST THING when props drop: run gate 2, then regenerate predictions, then audit.

=== ARCHIVE PANEL STATS CONVENTIONS ===
- Ranking cells with wildly different n: wilsonBound(hits, n, lower), display the RAW record. NOT
  shrunkHitRate (Laplace +1/+1) - right for lean ladders, useless for an n spanning 2 to 632.
- Best/worst lists split on the population rate, never a fixed row count. Sample floor 10.
- Bias dedupe keys on DATE, not event name. Per BOOK per market is right for bias but NOT for hit-rate
  leaderboards, which go one entry per fighter per FIGHT against the MEDIAN line.
- Calibration Brier is population-weighted and paired with a signed bias figure.
- AI snapshots are DAILY. Anything reading ai_lean_snapshots_v1 must go through collapseSnapshotsByEvent.
- Snapshots store BOTH: `confidence` is RAW (engine domain), `displayedConfidence` is what the board
  showed (readouts). Use snapshotDisplayConf for a READOUT, plain pick.confidence for anything that
  TRAINS. Never feed the engine its own output.
- Aggregations in analyzer.ts are frequently DUPLICATED (bias had three copies, the snapshot loop had
  seven, the recal map is built in TWO places). Grep for EVERY occurrence before patching one.

=== HOUSE RULES ===
- VERIFY BY THE NUMBERS ON SCREEN, never by grepping dist/. c776f26 shipped two no-ops and was reported
  as working. Predict the numbers FIRST, then check, and replay the arithmetic by hand or in node.
- A change can correctly produce NO movement. 240fe65 was designed to leave 425/383/-5.1 identical and
  prove itself via a new 0/N badge. State the expected outcome BEFORE the reload.
- Ad-hoc console dumps must ANCHOR to a number the board already published (the SS dump matched 149 vs
  the panel's 163 and the 14 missing rows were all Pick6, with both book rates matching the board
  exactly - that is what made the splits trustworthy). Without an anchor these invent phantom findings.
- Do not tell the user to check something that needs a loaded card when the board reads "Ready for Next
  Event" - check ALL FIGHTERS first.
- A systematic OFFSET needs subtraction; SHRINKAGE only scales and preserves the sign. Check which one
  the defect actually is before choosing a fix.
- Rebuild + commit dist with EVERY src change; cherry-pick to master and push BOTH branches. Verify with
  `git diff master feature/sleek-theme-v1 -- src/ dist/` (empty = parity). `git cherry-pick -q` is NOT
  valid. Cherry-picking RESUME_CHECKPOINT.md conflicts because master skips some checkpoint commits -
  resolve by taking the newest version wholesale, it is a generated full-state file.
- Bump MODEL_VERSION for lean scoring / tiering / correlation / EV / candidate selection / anything
  feeding displayed confidence. NOT for logging or reporting fixes. (v27-v36 were never logged in the
  config comment block; v37 is.)
- When changing a measurement, change EVERY path that reads it in the same commit - and check whether
  some of those paths are TRAINING inputs rather than readouts, because those must NOT change.
- Do not bundle two behavioural changes that would need separate attribution.
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write, with a before/after
  count. Line data is irreplaceable - four events were lost permanently once.
- Write patch scripts to FILES in the scratchpad and run with node; heredocs and `node -e` have mangled
  comments three times. Small targeted edits are safer via the Edit tool directly on the source.
- Console snippets go to the user as a fenced javascript block to PASTE, not as a `cat` command.
- Do NOT call `npm run checkpoint:save -- -Notes "$notes"` with multiline notes; it collapses to the
  first line. Call `& .\resume.ps1 -Mode save -Notes $notes` directly.


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
