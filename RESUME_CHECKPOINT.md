# Resume Checkpoint

Last Saved: 2026-08-29 19:09:36 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 53d7560

## Last Notes
SESSION HANDOFF (2026-08-29, ~19:15). Tree clean. MODEL_VERSION 39.
Pushed: feature/sleek-theme-v1 53d7560, master d8d0e82 (cherry-picked; full parity verified).

BOARD STATE: "Ready for Next Event", ALL FIGHTERS 0, 40031 records settled. Nurmagomedov vs Song
finished and absorbed cleanly the morning of 2026-08-29. NO card loaded, so persistAiLeanSnapshot is
early-returning and NO snapshots are being written. Next card is UFC Paris = "UFC Fight Night: Hooker
vs. Parnasse"; props have NOT dropped.

=== THREE THINGS SHIPPED THIS SESSION ===
1. MODEL v36 (1a24b53) VERIFIED ON SCREEN. Closed.
2. 240fe65 displayedConfidence - calibration was grading a number the board never showed. Read path
   verified on screen; write path still pending a loaded card.
3. MODEL v37 (13f827b) SS market anchor - the projection was +6 high and the market wasn't.
4. MODEL v38 (9eba89b) SS +/-0.5 tier collapsed to a push.
5. MODEL v39 (d5e79b5) SS hit-rate term duration-normalised.
6. GLOW-UP 344-353 (765cf38) the two ledgers become navigable; 348 reverted (53d7560).

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

=== MODEL v38 (9eba89b) - SS +/-0.5 TIER COLLAPSED ===
|score| < 1.5 is now a push for full-fight SS. That tier fired a directional lean at a flat conf 54 off a
SINGLE weak factor ("slightly above line" is +0.5 on its own; so is "striker style"). Over the same 149
picks, conf<=55 ran 21/50 = 42% - OVER 40%, UNDER 45%, losing on BOTH sides against a 52.4% breakeven and
the ONLY cut in the whole diagnosis where the two directions agreed. calcSSR1Lean already collapsed this
exact tier; full-fight SS now matches. TD and FT KEEP their +/-0.5 tier - FT runs 68% and was never
implicated. Replayed in node: only the +/-0.5..1.5 band changes, every |score| >= 1.5 maps byte-identically.

*** v37 + v38 + v39 ALL STACK - THEY WILL BE MEASURED TOGETHER ***
The anchor independently cut fires 116 -> 85 and v38 cuts again on top, so SS lean VOLUME will drop
SHARPLY. That is the intent (SS was 52% vs a 52.4% breakeven, so less volume at higher quality is the
trade) but it means the two changes CANNOT be attributed separately after Paris. The 42% was measured
under PRE-v37 scoring: the anchor changes diff -> score -> which picks land in the band, so do NOT expect
42% to carry over. The user asked for v38 after I recommended holding it; that was their call, recorded
here so nobody "re-litigates" it next session. v39 was likewise requested after the same caveat.
THREE SS changes now land before Paris posts and CANNOT be attributed separately after it settles. v37 and
v38 both CUT volume; v39 moves scores in BOTH directions and may add some back. If SS comes back wrong
after Paris, the way to isolate is to revert them one at a time (they are separate commits: 13f827b,
9eba89b, d5e79b5) - not to re-derive from the archive, which will by then mix pre- and post-change picks.

=== MODEL v39 (d5e79b5) - SS HIT-RATE TERM DURATION-NORMALISED ===
history.filter(h => h.sigStr > line_ss) asked how often PAST fights cleared THIS fight's line using raw
strike counts, so 5R main-event output was measured against a 3-round line as if the fights were the same
length. Worth +/-2 (largest after diff) and the LAST duration-blind factor, beside a projection
duration-adjusted since v6 and market-anchored since v37. Each past fight is now scaled by
expMins/thatFightMins via marketExpectedFightMinutes, bounded 0.5-1.5.
NODE REPLAY - the distortion was NOT marginal:
  5R history (110 SS / 25m) into a 3R fight, line 60:  raw 5/5 -> +2   normalised 0/5 -> -2
  3R history (55 SS / 13m) into a 5R main event, line 70: raw 0/5 -> -2  normalised 5/5 -> +2
  A 4-POINT SWING on a term whose tier thresholds are 1.5 and 3.0.
GUARDS VERIFIED in the same replay: a 1-minute finish does not extrapolate (1.5 cap holds it to 9 SS vs a
line of 40), and BOTH fallback paths - history with no timeSecs, and a null expMins - reproduce v38
byte-identically. calcTDLean has the same un-normalised pattern and was deliberately NOT changed (TD is
n=6 in the archive, far too thin).

*** ALL SS LOOSE ENDS FROM THE DIAGNOSIS ARE NOW CLOSED ***
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

=== GLOW-UP 344-353 (765cf38) + FIX (53d7560) - THE TWO LEDGERS ===
USER-VERIFIED BY SCREENSHOT after an extension reload. Placed ledger = 9 events / 149 legs, parlay
ledger = 42 slips, previously one uninterrupted column.
 344 EVENTS COLLAPSE. Head is a <button>, body wrapped in .plg-ev-inner. State lives in
     _ledgerCollapsedEvents, a session-scoped Set keyed `${ledger}|${evKey}` - same shape and
     lifetime as _archiveCollapsedSections (house pattern; NOT persisted, do not "fix" that).
     Newest event open, rest collapsed, via applyLedgerCollapseDefaults on FIRST render only.
 345 Collapsed head keeps the shape: one tick per leg (per SLIP on the parlay side) in display
     order, capped 32 with a +N tail. ledgerOutcomeStrip().
 346 COLLAPSE ALL / EXPAND ALL - one button whose label states which it does next.
 347 THE GRID HAD ONE MORE CHILD THAN TRACKS. .plg-leg emits ELEVEN children; the base rule
     declared 11 but the <=1500px and <=1180px breakpoints declared 10 and 9. Everything from
     `N legs` rightward sat one track LEFT of its heading and .plc-gap wrapped to an implicit row.
     It survived for months because head and rows shifted TOGETHER - aligned with each other, under
     the wrong labels. A/B in the preview: old 2 grid rows / 32px per leg, fixed 1 row / 24px, zero
     header-to-cell offset at 1600 / 1400 / 1100.
 348 REVERTED - see the sticky lesson below.
 349 Parlay legs got columns (.plp-leg is a 6-track grid). They rendered as an inline run, so on a
     7-leg slip no two lines started at the same x.
 350 Parlay events collapse on the same mechanism, keyed separately.
 351 RESULT FILTER, pure CSS off .lgr[data-filter] so 149 rows never enter a JS loop. Verified
     exact: 144 = 51 hit + 50 miss + 43 pending legs; 42 = 6 + 23 + 13 slips. :has() hides events
     the filter empties, and the filter OVERRIDES collapse - with !important, because a hand-
     toggled event carries an INLINE max-height that no selector can outrank.
 352 Leg/slip count chip on the head.
 353 aria-expanded, :focus-visible, reduced-motion; the stagger no longer replays on expand.
 PLUS empty-filter state ("Nothing matches this filter..."), since a filter matching nothing
     rendered a toolbar over blank space and read as a broken panel.

*** THE STICKY LESSON (348) - GENERALISE THIS ***
`position: sticky; top: 88px` on .plg-ev-head produced THREE symptoms from ONE cause: the head
overlapped the first parlay slip's legs; it painted BELOW content that follows it in the DOM; and
on the placed ledger it completely covered the FIGHTER/SIDE/LINE column header, so the first event
rendered with no headings at all.
CAUSE: .section-body carries `overflow: hidden` for the accordion, which makes it the nearest
SCROLLPORT. A sticky child positions against its SCROLLPORT, not the viewport - so top:88px pushed
every head 88px DOWN from the section's top edge, onto its own rows. Measured: headOffsetTop 58
against a flow position of 0, with the body correctly at 25. After revert: headOffsetTop 0 on both
ledgers, no overlap, colhead back at exactly the head's bottom edge (11190 = 11190).
Any future sticky inside an archive panel must solve the SCROLLPORT first - an offset alone cannot
work, there is no scrolling ancestor to stick to. The old note "sticky offsets 54/88px" applies to
the PAGE chrome, NOT to anything inside .section-body.

*** TWO ANIMATION TECHNIQUES THAT FAILED - DO NOT RETRY (also recorded in the CSS) ***
 - grid-template-rows 1fr -> 0fr with the rows as DIRECT children: 0fr sizes only the FIRST
   implicit row, so 43 of 44 children kept auto rows and the event never shrank (bodyH 1095 both
   collapsed and open).
 - the same after wrapping in a single .plg-ev-inner: collapse worked (rows resolved to 0px) but
   EXPAND did not - fr will not resolve back against an auto-height container mid-transition, so a
   re-opened event sat at 0px with its class and aria correctly flipped.
 SHIPPED: JS-measured max-height, exactly what the section accordion already uses - exact at any
 content height and it survives both directions.

*** PREVIEW HARNESS - REAL LIMITS FOUND THIS SESSION ***
preview_start "analyzer-preview" serves analyzer.html with dev/chrome-shim.js seeded from the
newest ~/Downloads/ufc-storage-backup-*.json, so the ledgers render REAL data. dev/preview-view.txt
holds "viewName" or "viewName|scrollY" and the shim clicks that tab (restore it to "parlaylab" when
done). BUT the pane goes OCCLUDED constantly, and when it does:
 - it stops COMPOSITING. Screenshots come back solid black even though the DOM is positioned
   correctly (measured evTop 0 while the capture was blank), and CSS TRANSITIONS freeze mid-flight
   so an element reads as its start value forever. A collapse test looked like a FAILURE until the
   transition was neutralised with an injected `transition:none` style - then all five bodies
   correctly read 0.
 - it THROTTLES TIMERS, so a long `await new Promise(setTimeout)` inside one javascript_tool call
   blows the 45s budget. Split into several SHORT calls instead of one long one.
 - wheel scrolling via the computer tool went the wrong way / erratically, and window.scrollTo was
   ignored; scrollIntoView({block:'start'}) worked.
CONCLUSION: measure with javascript_tool (track counts, offsets, rects, computed styles) - that is
reliable. Do NOT rely on screenshots from this harness, and SAY SO rather than implying a visual
check happened.

*** THE LESSON THE NUMBERS MISSED ***
Every 348 symptom passed numeric verification: track counts, alignment deltas, row heights and
x-offsets were all correct. Measurement proves GEOMETRY, not OCCLUSION - an element painted on top
of another measures perfectly. The user's screenshots caught all three. This is
feedback_test_dense_grid_rewrites_visually from a new angle: for any change touching stacking,
position or z-index, a human eyeball is not optional.

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
- SS diagnosis loose ends: ALL CLOSED (v37/v38/v39). Next SS question is whether the three
  together over-corrected - answer only after Paris settles.

=== NEXT CARD: UFC PARIS (Hooker vs. Parnasse) ===
- Predictions were generated on MODEL v34 and are now FIVE versions behind. REGENERATE UNDER v39.
- Salahdine Parnasse shows NO HISTORY on a 5R main event.
- MICHAEL PAGE vs Nursulton Ruziboev: the model has Ruziboev at 13.5 SS. That is the user's recorded
  MVP-opponents-go-SS-UNDER edge AGREEING, not an outlier to fade. The v37 anchor shifts projections
  DOWN, which makes UNDERs easier to fire - consistent with that edge, no conflict. v38 then requires
  |score| >= 1.5, so the Ruziboev UNDER must clear a real bar rather than the old conf-54 tier.
- PARIS HAS A 5R MAIN EVENT. v39 flips the hit-rate term by up to +4 for fighters with 3R history moving
  UP to five rounds - exactly the Hooker/Parnasse main. Eyeball those two rows first when the board loads.
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
  config comment block; v37, v38 and v39 are.)
- When changing a measurement, change EVERY path that reads it in the same commit - and check whether
  some of those paths are TRAINING inputs rather than readouts, because those must NOT change.
- Do not bundle two behavioural changes that would need separate attribution.
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write, with a before/after
  count. Line data is irreplaceable - four events were lost permanently once.
- Write patch scripts to FILES in the scratchpad and run with node; heredocs and `node -e` have mangled
  comments three times. Small targeted edits are safer via the Edit tool directly on the source.
- PYTHON HEREDOCS ALSO REWRITE LINE ENDINGS. io.open(...,'w') on Windows turned src/analyzer.ts
  CRLF, and guard-invariants.js then reported a FALSE storageSet violation: it slices the function
  body with fn.indexOf of a LF-only delimiter, which never matches CRLF, so it tested an empty
  string. Repair with sed stripping trailing \r. Pass newline='' to BOTH io.open calls, and a
  heredoc containing quotes will also break bash outright - write the script to a FILE.
- A UI change touching position / z-index / stacking CANNOT be signed off by measurement alone.
  See the 348 lesson: ask for a screenshot from the real extension.
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
