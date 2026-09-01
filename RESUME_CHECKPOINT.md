# Resume Checkpoint

Last Saved: 2026-09-01 02:20:28 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 60804b4

## Last Notes
################################################################################
##  START HERE - NEXT SESSION'S FIRST TASK                                     ##
################################################################################

GATE 2 IS CLOSED AND THE BOARD IS REGENERATED (v43, 28 fighters, 2026-09-01).
Items 1, 2 and 4 of the old list are DONE - see the 09-01 section at the bottom.
What is left off that list:

  3. Best Picks audit - STILL BLOCKED until TD + R1 SS + CTRL + FP are ALL
     posted (Friday). Only SS lines are in (Pick6 + Underdog). Do not audit early.

  NEW, IN ORDER:
   a. THE 50/50 OPPONENT BLEND in predictSS is the dispersion source. Books price
      the fighter's own rate (0.89-1.08 x career expectation); the model spans
      0.59-1.64 because oppRate is weighted equally with the fighter's own. n=7,
      one card - RE-RUN THE DECOMPOSITION ON 2-3 MORE CARDS before changing the
      weight. Full table in the 09-01 section.
   b. TWO BOOK LINES LOOK FAKE - Hooker P6 27.5 (0.45x his career-rate
      expectation, in a 5R fight) and Peek P6 24.5 (0.55x). Everyone else is
      0.89-1.08. Verify before trusting anything measured against them.
   c. The anchorShift sign IS negated (fair = posted - 3.3 on all 10 anchored
      rows). DO NOT FIX IT ALONE - and note the reason for that caution has
      CHANGED: the "+12 raw bias it was cancelling" was my own selection-bias
      artifact and is RETRACTED. The real reason to wait is (a) and (b).
   d. The learning loop IS structurally broken (runLearningCycle reads the
      calibrated line but tunes a term upstream of the calibration). That is a
      code fact, not a statistic, and it survives the retraction.

(B) OTHERWISE: THE ARCHIVE FP INVESTIGATION. 81 archive Fantasy rows disagree with
    FP recomputed from UFCStats components. This is the biggest open thread in
    the project right now and it is NOT a ledger problem - the archive feeds
    grading, calibration, FP hit rates and CLV. See the section below; the FIRST
    move is already identified and is cheap.

THE GLOW-UP LADDER IS DONE (354-360 shipped, 357 REVERTED as 361). Do not
re-open it. Remaining ledger ideas are at the bottom; none are required.

THE UI WORK IS DONE FOR NOW (362-367, 2026-08-31). The clipping sweep is MINED
OUT - do not re-run it as a source of work. The design system pass (365-367) is
also at a natural stop. Both are written up at the bottom, along with the
measurement traps they walked into, which are the reusable part.

################################################################################

SESSION HANDOFF (2026-08-31, ~12:35). Tree clean, both branches pushed, FULL
parity. feature/sleek-theme-v1 263f3a6, master 5f13525.
  Since the 08-30 handoff below: GLOW-UP 362/363/364 (UI clipping), the Duclos
  alias (2a7044e), and the DWCS overlap check - all detailed at the bottom.

--- previous handoff, still accurate for everything else ---
SESSION HANDOFF (2026-08-30, ~21:46). Tree clean, both branches pushed, FULL
parity (src/ dist/ analyzer.html all empty on the diff).
  feature/sleek-theme-v1  e004212
  master                  61918a9

=== MY PLACED LEDGER IS NOW AUDITED. IT IS CLEAN. ===
The "144 legs, YOU 76/144, BOARD 38/80, still NOT audited" line that rode in
this checkpoint for many sessions is CLOSED. All 144 legs re-graded against the
current archive with a faithful replay of resolveVsArchive:
  agree 136 | DISAGREE 0 | unmatched 8 | total 144, stored hits 76
The 8 unmatched were the REPLAY's own missing NAME_ALIASES (Myktybek Orolbai ->
...Uulu, the Sumudaerji family), not defects. YOU 76/144 is trustworthy.

ALL 144 legs are FROZEN verdicts (unpersisted 0). GLOW-UP 174 uses a persisted
rec.outcome verbatim and never re-resolves, so resolver fixes cannot reach them.
The re-grade proves they agree anyway - latent, not live.

=== SHIPPED (354-360), PLUS ONE REVERT (361) ===
354 BOARD chip tooltip: it is the closing BEST PICKS shortlist (<=8 OVER + <=8
    UNDER, one pick per fight, dedupeNegCorrelatedSameFight ~9567), NOT "the
    board's full suggested slate". Confirmed in storage: overs 8 / unders 8.
355 Header says BOARD top-16 and explains why YOU (every leg placed, 29-46 per
    event) and BOARD (16 per event) are NOT like-for-like. SELECTION below IS.
356 Drift marker on frozen actual values that no longer match the archive.
357 REVERTED - see the next section. Do not re-apply it.
358 BY BOOK / BY STAT breakdown strips, with a 1.5 SE bar before any cell takes
    a side (the GLOW-UP 310 rule). Everything currently reads FLAT.
359 Fighter search on BOTH ledgers, matching in CSS, both corners per row.
360 Concentration chip on the event head: "N FIGHTS - MAX M".

=== 357 WAS WRONG AND IS REVERTED. THE ARCHIVE IS NOT UNIFORMLY RIGHT. ===
357 displayed the archive's value on any drifted leg. It was built on TWO SS
cases where UFCStats agreed with the archive. It did not generalise. PER STAT:
  SS drifts -> ARCHIVE right (Douglas 7/14/14, Mederos 110/73/73).
  FP drifts -> STORED right, ARCHIVE WRONG. UFCStats components compute 117.5
    (Fantasy) / 66 (PP) on all three Makhachev rows, matching stored; the
    archive reads 127.5 / 76 - exactly +10 in BOTH scoring systems.
The ledger now MARKS the disagreement and picks NEITHER side; the archive's
number is named in the tooltip. DO NOT re-apply 357 on SS evidence alone - that
is precisely the reasoning that produced it.

=== (B) THE ARCHIVE FP INVESTIGATION - OPEN, AND THE BIGGEST THREAD ===
81 archive Fantasy/Fantasy_PP rows disagree with FP recomputed from UFCStats
components. Histogram is dominated by -5 (Fantasy, 19 rows), then -10 (8), with
a long one-off tail. The -5 cluster sits on THREE-ROUND DECISIONS and appears on
LOSSES as well as wins, so it is NOT a win-bonus effect. Mechanism UNKNOWN.

*** ONE MECHANISM IS NOW NAILED: THE ARCHIVE INTERMITTENTLY MISSES REVERSALS ***
28 of the 81 (35%) are EXACTLY -5 x rev; recomputing with rev forced to 0 gives
delta 0 on every one. rev 1 -> -5, rev 2 -> -10, rev 3 -> -15.
THE DISCRIMINATOR was scoring, not value: reversal is 5 in FANTASY and 0 in
PRIZEPICKS, so a missing reversal hits Fantasy rows ONLY. A missing TAKEDOWN
would hit both (5 and 5). The -5 cluster is 100% Fantasy, never Fantasy_PP.
INTERMITTENT, NOT SYSTEMATIC: 432 rows have rev>0 and only 28 are wrong (~93%
correct). NOT a code-path cutover either: clean before 2022-10, then misses
scatter to 2026-07 interleaved with clean months (2026-04 8/0, 2026-05 6/0,
2026-08 7/0), and they appear in BOTH settled and backfilled rows.
UNTESTED NEXT STEP: fightHistory is parsed from the FIGHTER page, the settle
path from the FIGHT DETAIL page - the two sources may disagree on reversals.
Needs a live UFCStats fetch. Treat as a starting point only; three hypotheses
on this thread already failed.
RESIDUAL after reversals: 53 rows - -60.01 Fantasy (4), -39.98 (3), +10 Fantasy
(3), -40.5 Fantasy_PP (2), long tail. The Makhachev +10 is in there, unexplained.

THE PLATFORM SPLIT WAS RUN AND WAS NOT THE ANSWER: SETTLED 340 compared / 19
disagree (6%); BACKFILLED 4185 / 62 (1%). Neither path is broadly broken.

TWO HYPOTHESES TESTED, BOTH FAILED - do not re-run them:
  (a) a miscounted knockdown; (b) the round-vs-decision win bonus. Neither is
  separable by VALUE anyway: each adds exactly 10 to both scoring systems, so
  the Makhachev +10 cannot discriminate them. The aggregate histogram matches
  neither prediction (predicted +15 Fantasy / +20 PP for 3R decisions; observed
  -5 dominant).

*** FIRST MOVE NEXT TIME ***
The platform split HAS been run (see above - it was not the answer) and the
reversal mechanism HAS been found. What is left is the 53-row residual and the
question of WHY reversals are missed intermittently. The one untested lead is
that fightHistory is parsed from the FIGHTER page while the settle path parses
the FIGHT DETAIL page; compare the two sources for one known-missed fight.
That needs a live UFCStats fetch, so it is not a five-minute job.

THE LIVE SCORER IS NOT THE BUG. The settle log reconciles by hand: Sumudaerji
SS=41 CTRL=0.23min W R3 over a 15.00min fight -> FP 70.6, which only works with
the DECISION bonus (16.4 + nonSig*0.2 + 0.41 + 30), and FP_PP 50.5 likewise.
So these are HISTORICAL writes. Note "re-applied N results" in the settle log
re-applies STORED results; it does NOT re-derive them from components.

WHY IT MATTERS BEYOND THE LEDGER: the archive feeds grading, calibration, the FP
hit rates and CLV. Nine ledger rows were the symptom, not the disease.

=== TWO MORE HYPOTHESES THAT DIED THIS SESSION - DO NOT RE-DERIVE ===
1. "boardStatsFor reads a field that does not exist (p.line / p.platform)."
   WRONG. TWO snapshot stores with DIFFERENT field names:
     best_picks_snapshots_v1 - picks carry date, line, platform. THIS is what
       boardStatsFor and the selection/ALPHA diagnostics read (~15557).
     ai_lean_snapshots_v1    - picks carry capturedAt, activeLine,
       activePlatform, and NO date/line/platform at all.
   Its Date.parse(s.date) collapse is CORRECT for its store. The house rule
   about collapseSnapshotsByEvent does NOT apply to the ledger. CHECK WHICH
   STORE BEFORE DIAGNOSING - this cost three wrong diagnoses in one session.
2. "archiveIdx first-row-wins over duplicate rows causes the drift." WRONG, and
   it was queued as priority 1. A key event|fighter|propType legitimately holds
   ONE ROW PER BOOK - same result, different line - so first-row-wins is
   harmless. All 32 rows behind the 9 drifts agree with each other and disagree
   with the frozen value. Do NOT change archiveIdx on a dupRows correlation.

=== UFCSTATS CACHE SHAPE (cost FOUR wrong joins - do not guess it again) ===
key ufcstats_v51_<name_lower_underscored>; top level is
{careerStats, detailUrl, fetchedAt, fightHistory, name}.
  - the array is **fightHistory**, NOT history
  - each entry's opponent field is **opponent**, NOT opp
  - date is human format ("Aug. 22, 2026"), NOT ISO - slicing it against an ISO
    date never matches. Join on evKeyOf(entry.event) instead.
  - entries carry sigStr/sigStrR1/sigStrBody/sigStrLeg/td/kd/ctrlSecs/sub/rev/
    totStr/timeSecs/round/method/result - and NO fp. FP must be recomputed via
    calcFPForPlatform (src/analyzer/fantasy-scoring.ts).
  - method is short form ('U-DEC', 'S-DEC', 'KO/TKO'), not the fight-page wording
Caches can be STALE: Kaue Fernandes held 4 fights ending Sep 2025, so his Aug
2026 bout was simply absent.

=== LESSONS THIS SESSION RE-TAUGHT ===
- DO NOT GENERALISE FROM TWO DATA POINTS. 357 shipped on two SS cases and was
  contradicted by the FP check within the hour. If a rule is about to drive
  DISPLAY logic, test it on every stat it will touch first.
- MEASUREMENT PROVES GEOMETRY, NOT OCCLUSION (the 348 lesson, again). The first
  drift marker appended a glyph after the value. .plg-actual is nowrap in a
  fixed track, so the extra width did not overflow the ROW - the left neighbour
  painted over the text and "actual 110" rendered "ual 110". scrollWidth never
  moved; a screenshot caught it. Fix was a ZERO-WIDTH signal (class +
  border-bottom + title). SIBLING OVERLAP *IS* measurable if you compare EDGES
  (kids[i].right > kids[i+1].left) - reuse that on any dense-grid change.
- A CELL MUST NOT TAKE A SIDE IT CANNOT SUPPORT (358, per GLOW-UP 310's 1.5 SE
  bar).
- COMMIT MESSAGES GO TO A FILE. git commit -m with backticks let bash
  command-substitute them and silently ate words. Use git commit -F.
- BASH HEREDOCS CONTAINING QUOTES BREAK THIS TOOL OUTRIGHT, even quoted ones.
  Two attempts died at the same line. Write the file with the Write tool.
- A python heredoc that does not CLOSE the file may not flush. Use with-blocks.

=== WHAT THE BREAKDOWN SAYS (nothing is actionable yet) ===
BY BOOK  PICK6 27/54 50% | UNDERDOG 24/43 56% | BETR 9/22 41% | DK 9/14 64% |
         PRIZEPICKS 7/11 64%
BY STAT  FP 28/55 51% | SS 23/44 52% | R1 SS 15/22 68% | TD 4/11 36% |
         CTRL 3/7 43% | KD 2/4 50% | FT 1/1 100%
NOT ONE separates from the 53% overall at 1.5 SE. Watch R1 SS (best cell, 1.4
SE, nearly there). Pick6 carries 54 of 144 legs at exactly 50% - largest
exposure on the weakest non-thin book. Do NOT act on Betr 41%; it is the cell
most likely to tempt a change and has the least support.
CONCENTRATION: 7 legs on ONE fight on the Nurmagomedov card (16% of it).

=== REMAINING LEDGER IDEAS (none started, none required) ===
- Per-event P/L was DELIBERATELY SKIPPED at rung 4: pick-em legs are not
  independently priced, so 1u-per-leg P/L is hits-minus-misses restated. Needs
  stake entry, which changes how legs are RECORDED, not just displayed.
- The CONFLICT CHIP is still unimplemented and LINE-BLIND.
- The 2-row archive-audit residue: platform x stat sums to 423 not 425.

################################################################################
##  2026-08-31 SESSION - UI CLIPPING + THE DWCS CHECK                          ##
################################################################################

BOARD STATE AT HANDOFF: Paris props are only PARTIALLY in. Underdog has FT lines
(13 archived, "Partial - 13 lines"); Pick6, Betr, PrizePicks and DK Sportsbook
all still WAITING. 28 fighters, 6 actionable leans, TOP EDGE Michael Page
FT-OVER, 11 unresolved records. Gate 2 may already be satisfiable - its bar is
>=1 pick with a lean AND a finite activeLine, not full coverage - but the Best
Picks audit still needs TD + R1 SS + CTRL + FP.

=== THE DWCS OVERLAP: CHECKED, AND THERE IS NO CONTAMINATION ===
Underdog captured 23 names, ~10 of them OFF-CARD (Patrick Rivera, Adam Darby,
Modestino Rodrigues, Brandon Holmes, Adam Livingston, Hunter Smith, Silvestre
Sanchez, Liam McCracken, Charlie Cleveland, Gabriel Lourenco). Only the 13
ON-ROSTER fighters reached the archive, matching the "13 archived" chip. ZERO
DWCS rows carry a UFC event name. DWCS results archive under their own label
("DWCS 8.3", results, no lines). That is the desired split - keep the data, skip
the fight card - and it is ALREADY the behaviour. Do not "fix" it.
lines_underdog shape is {capturedAt, fighters:[...]}; entries carry
name/opponent/line_*/*_avail/*_odds and NO promotion or slate field, so any
attribution rule would have to be roster-based, not source-based.

METHOD TRAP: the ghost detector reported 1 ghost and the true count was 0. It
compared a DOM-scraped roster name against an archive name WITHOUT
alias-normalising either side, so "Matthieu Letho Duclos" (UD) looked off-card
against "Matthieu Duclos" (roster). ALIAS-NORMALISE BOTH SIDES or a sweep
invents contamination.

That variant WAS a real latent bug for a different reason, now fixed (2a7044e):
namesMatch is surname-token based so archiving worked, but resolveVsArchive uses
an EXACT event|normalizedName|propType key - a leg placed on "Matthieu Duclos"
would never have found a row filed under "Matthieu Letho Duclos". Same shape as
the 8 legs (Orolbai, Sumudaerji) the 08-30 audit could not re-grade.

=== THE CLIPPING SWEEP: WHAT IT PRODUCED, AND ITS ONE BIG MISTAKE ===
*** MEASUREMENT TRAP - READ BEFORE ANY LAYOUT WORK ***
Every measurement in the first half of this session was taken at 827px, with
DevTools DOCKED beside the page. That is UNDER the 1100px breakpoint and NOT a
width this board is ever used at (normal use is ~1707px, DevTools closed).
It caused a defect to be flagged that does not exist in normal use, and caused
a real one to be both oversold and then undersold. UNDOCK DEVTOOLS (its menu ->
Dock side -> undock) before any layout sweep, or the results describe a layout
nobody sees.

362 pred-factor - REAL, the big one. v41's "Book calibration: ..." reason was
    registered in NEITHER table that owns chip rendering: FACTOR_SHORT had no
    rule so compressFactor fell through to `return r` and rendered the whole
    sentence (326px over, on 28 chips), and FACTOR_LANES had no matching test
    (^Book prior does not cover ^Book calibration) so it drew with NO lane class
    and was absent from the legend. BOTH tables match the RAW reason. Now
    compressed to "BCAL 71->78.5" and joined to the existing pf-cal lane.
    THE TWO-TABLE TRAP IS REAL - a new reason string needs an entry in both.
363 pf-vs - REAL but small. It was one nowrap+ellipsis run of
    "vs {opponent} - {rounds}R", so overflow ate the TAIL: the round count,
    which drives 5R/3R inference and v39's duration-normalised hit-rate term.
    Now an inline-flex with a shrinkable .pf-vs-name and a flex:0 0 auto
    .pf-vs-r. Still 11 rows clipping at full width - by design; the name
    truncates and the marker survives. No child-count change (the 347 rule).
364 bias-platform - REAL. Printed the raw storage key DRAFTKINGS_SPORTSBOOK.
    Fixed with a TRANSFORM, deliberately not a sixth lookup table:
    BP_SLATE_BOOK_ABBR, BOOK_ABBR, BOOK_NAME, BP_BOOK_SHORT and BP_BOOK_FULL are
    already five copies of the same book-label map.
fighter-name - NON-ISSUE. Its truncation lives only inside
    @media (max-width: 1100px) with max-width 260px. No cap above that, and the
    board is used at ~1707px. Do not "fix" it.
pred-gen - FALSE POSITIVE. The sweep reported 196px; it does not reproduce.
    vOverflow is 0, scrollW/clientW differ by 19px of phantom trailing advance
    (padding 5px 14px + letter-spacing 0.44px), and the label renders in full.

THE SWEEP IS SPENT. Down to phantom 19px readings and enum labels. If you want
more UI, pick it from something annoying in daily use, not another sweep.

################################################################################
##  2026-08-31 PM - THE DESIGN SYSTEM PASS (365-367)                           ##
################################################################################

feature/sleek-theme-v1 a1dbd48 | master ce42c13 | full parity, tree clean.

365  COMMAND HUD over the header + both filter bars. NO new palette - the tokens
     already in the sheet were the brief (--bg near-black navy, --gold, --cyan
     mint, --green, --red, --text3). Status pills became ONE bounded cluster;
     AUTO-FETCH LINES became the primary CTA at 14.02:1 with a CONTAINED glow;
     REFRESH/MORE demoted to ghosts; four-state status set with a pulse that
     fires ONLY when live (a pulse on a dead feed is a lie); tab bar unified with
     an underline active state rather than a fill, because a filled tab competes
     with the CTA. Search placeholder fixed, operators preserved on the title.
365b SCANLINE at 0.15. Safe to push ~9x because it paints at z-index 0 with all
     children at 1 - it never overlays text, so it costs nothing in contrast.
     PICKED BY LOOKING: a 1px line at a 3px period blurs toward flat grey on a
     HiDPI panel, so the value is a property of the display, not the CSS. Stepped
     0.045/0.075/0.11/0.15/0.20 live. Retune the same way, do not reason at it.
366  ONE RADIUS SCALE. Measured four radii on one screen - .header 12, .filter-bar
     10, slate row 8, eight fighter panels 14 - and TWO were introduced by 365.
     The pass meant to unify the chrome had added a fourth dialect to a board
     that already had a coherent one. So the chrome YIELDED to the board:
     --r-panel 14px / --r-inset 8px, and .header/.filter-bar adopt 14. Changed my
     two surfaces instead of eight-plus, and stayed out of .fighter-main.
     Also: .fighter-header-row measured border 0 / radius 0 - the only major
     surface with neither - and got a BASELINE RULE, not a panel (it spans full
     width; a border and corners would read as a card wedged under the bar).
     Also: TABULAR FIGURES, 40 -> 0. Verified by rendering "111" vs "000" at 40px:
     Space Grotesk 54.3/77.8, Sora 51.4/91.6, JetBrains Mono 72.0/72.0.
367  HERO TILES equal height. TOP EDGE has no .mh-meter so it measured 86px
     against 100px - exactly the meter's footprint (6px + 1px margins + the 6px
     flex gap). Fixed by stretching the row, NOT by a 14px shim (magic number)
     and NOT by giving it a gauge ("+40%" is unbounded - inventing a scale to
     tidy a layout is inventing data). Also caught a FIFTH radius: .mh-stat at
     10px, now on the inset step.

=== THE REUSABLE PART: MEASUREMENT OVERRULED THE PLAN FOUR TIMES ===
Every one of these was a confident read that the numbers reversed. Expect the
same next time and measure first.
 1. "Extend the chrome down onto the board." BACKWARDS. The board already had a
    language (8 of 9 panels at 14px); my pass had disrupted it. The fix was to
    ADOPT, not impose.
 2. "Don't put tabular-nums in the dense fighter cards, it will cause clipping."
    UNFOUNDED. Applied live to all 41 and re-measured: clipped 0 before, 0 after,
    29 grew, widest growth 7px. The caution was right to have and wrong to keep.
 3. "75-110px of dead vertical space in the chrome." INFLATED. Exactly ONE gap
    over 24px (54px), total chrome before the first metric 222px, and NO empty
    containers. Dropped as not worth doing. The 54px has no identified cause -
    neither neighbour has margins - if anyone cares enough to look.
 4. "The hero trend line rides up inside its tile." WRONG CAUSE, right complaint.
    The tiles distribute correctly internally; the tile itself was smaller. The
    wrong cause would have produced a hand-tuned shim.

=== TWO RULES THAT EARNED THEIR KEEP TODAY ===
 * UNDOCK DEVTOOLS BEFORE ANY LAYOUT SWEEP. Docked beside the page it puts the
   board at 827px, UNDER the 1100px breakpoint, which is not a width this app is
   used at (normal is ~1707px). It made me flag fighter-name as broken when it
   is not, and both oversell and then undersell pf-vs.
 * CHECK A NUMBER THAT SHOULD MOVE. The first tabular-nums block left prose as
   raw text between a stray */ and the real one; the parser discarded through the
   rule. It survived a reload looking fine. What exposed it was the check
   reporting "still proportional: 40 (was 40)" - unchanged after a change that
   should have moved it. Verifying only the things that DID work would have
   shipped a dead rule. Same shape as c776f26.

=== SMALL AND OPEN (neither is required) ===
 - The 54px gap after .filter-bar-top has no identified cause.
 - Fighter cards look empty on the right, but that is likely PARTIAL-DATA state
   (only UD FT lines are in) and may fill in when props land. Do not treat a
   partial board as a layout problem.
 - .fighter-main is the remaining big surface. It is also the one this repo has
   broken before by editing ahead of a browser check - test in the browser FIRST.


################################################################################
##  2026-09-01 - GATE 2 CLOSED, v43 BOARD REGENERATED, AND THE ANCHOR SIGN     ##
################################################################################

BOARD STATE: UFC Fight Night: Hooker vs. Parnasse, 28 fighters, MODEL v43,
regenerated 2026-09-01 ~01:55. 40807 archive records, 41 unresolved.
LINES IN: Pick6 and Underdog SS only. Betr, PrizePicks and DK Sportsbook all
still WAITING. No TD / FP / CTRL / R1 SS book lines anywhere on the board.

=== GATE 2: CLOSED ===
  event: UFC Fight Night: Hooker vs. Parnasse
  picks: 9 | carrying displayedConfidence: 9 | recalibrationReady: true
All nine picks carry the field and the raw->displayed deltas are non-zero, so
initRecalibrationMap is populating and the stored number IS the displayed one.
This is the first card where the graded number and the shown number are the same
thing (240fe65). Gate 3 grades it after Paris settles.

=== (4) THE v39 5R CHECK: CANNOT BE RUN YET, AND HALF OF IT NEVER CAN ===
This was the "eyeball Hooker/Parnasse for v39" item. The answer is that v39 is
DORMANT on this board, for two independent reasons - neither of which is a bug.

  v39 IS GATED BEHIND DK, NOT BEHIND THE 5R INFERENCE. calcSSLean's hit-rate
  term calls marketExpectedFightMinutes(name, schedRounds) (analyzer.ts ~5680).
  That function needs resolveRoundStartFromMap / resolveDistanceDecisionProb /
  finishHistogramConditional, and ALL THREE read dk*ByName maps - DK Sportsbook
  is the only source. DK has posted nothing. So expMinsSS is null, clearedSSLine
  falls back to the raw `ss > line_ss` comparison per fight, ssNormalisedFights
  stays 0 and the hrNote is empty. The normaliser is not running.
  durationAdjustProjection is gated on the same call, so the "Duration-adjusted"
  reason is absent for the same reason. Neither is a 5R problem.

  PARNASSE CAN NEVER EXERCISE v39. calcSSLean bails at `history.length < 3`
  before it ever reaches the hit-rate term, and Parnasse has NO UFCStats history
  (UFC debut - the board shows the no-history badge and the NO HISTORY chip).
  He gets no SS lean at all. Only the HOOKER side of this main event can ever
  test v39, and only once DK posts.

  WHAT IS CONFIRMED GOOD: the 5R inference itself. Hooker and Parnasse are the
  ONLY two rows marked 5R; all 26 others read 3R. That is exactly the headliner
  rule and it matches the event title, so getScheduledRoundsContext reached both
  the predictor and the lean path correctly.

  RE-RUN THE v39 CHECK ON FRIDAY, ON HOOKER ONLY, once DK is in. Look for the
  "(N/24 scaled to ~Xm)" note on his hit-rate reason - its presence is the proof
  the term fired; its absence means DK still is not resolving for his name.

=== *** THE v43 ANCHOR SHIFT IS NEGATED - CONFIRMED BY THE AUDIT, NOT FIXED *** ===
RUN 2026-09-01 02:26. 79 stat rows, 10 anchored (all SS - TD and R1 SS measure
S=0 so their anchor is inert, and no FP line is posted to anchor against).
MEASURED S: SS 3.3 | TD -0.0 | R1 SS 0 | FP -7.7.

  ON ALL 10 ANCHORED ROWS, fair = posted - 3.3, EXACTLY.
    Hooker fair 24.2 / book 27.5 | Ziam 35.2 / 38.5 | Sola 21.2 / 24.5
    Charriere 33.2 / 36.5 | Peek 21.2 / 24.5 | Campbell 21.2 / 24.5
    Cornolle 27.2 / 30.5 | Sygula 31.2 / 34.5 | Lima 32.2 / 35.5
    Parnasse 30.2 / 33.5
  `fair` is quoted verbatim in the stored reason and the book line comes from the
  RAW line store, which nothing in the anchor path writes. fair = posted + shift,
  so shift = -3.3 = -S. Confirmed, not inferred. calibrateToBooks then subtracts
  S a second time.

DO NOT FIX THE SIGN ON ITS OWN. See the next section - the negation is currently
compensating for something bigger, and correcting it alone makes the board worse.

  analyzer.ts ~14564:  const anchorShift = (stat) => -(bookCal?.global?.[stat] ?? 0);

  bookCal.global[stat] is (predicted - posted) - stated outright in
  expectedLineAtBook: "bias is (predicted - posted), so the posted number is
  predicted MINUS the bias". It is POSITIVE for SS (comment says 4.1; the
  PREDICTOR VS POSTED LINES panel currently reads SS bias +3.0, n=229).

  applyMarketAnchorFor computes `fair = postedLine + shift`, and it runs INSIDE
  the pair loop - so sp.line is still on the MODEL scale, uncalibrated.
  calibrateToBooks runs AFTER the loop and subtracts the same offset again.

  Let S = bookCal.global.SS > 0 and P = the posted line. Then:
    intended   shift = +S -> band after calibration = [P - cap, P + cap]
    as written shift = -S -> band after calibration = [P - 2S - cap, P - 2S + cap]
  With S ~ 3 and cap = max(6, 0.18*fair), an ANCHORED SS line can land anywhere
  from ~12 under the book to, at best, level with it. It is structurally
  incapable of finishing above the posted line. The offset is applied twice in
  the same direction.

  THE BOARD IS CONSISTENT WITH THIS. Of the 16 rows carrying a book SS line,
  15 sit at or below it and only ONE is above: Parnasse at +6.0 - and Parnasse's
  number is set by applyDebutMoneylineSplit, which v43 deliberately runs AFTER
  the anchor. The big unders are the anchored rows (Charriere -13.0,
  Ruziboev -10.0, Bukauskas -10.0, Sy -8.0, Pinto -6.0); the ten -1.0 rows are
  just calibrateToBooks removing a +3 bias from a board whose real gap is ~+2.5
  and snapping to the .5 grid. Those -1.0s are FINE. The tail is the question.

  THIS IS ONE DAY OLD. anchorShift arrived with v43 SUGGESTION 2 (2026-08-30);
  this is the first board generated under it with book lines present, so nothing
  settled has ever been priced this way. FP is NOT affected - it uses
  computeMarketFpShift, a different quantity, applied consistently as
  `fair = book + fpShift` in both the anchor and the display.

  BEFORE CHANGING IT: this is a numbers claim reconstructed from the code plus
  a screenshot of the board, not from instrumented output. Confirm S and confirm
  which rows actually carry an `anchoredFrom` field before touching the sign -
  the house rule is verify by numbers, and "13 of 16 negative" is a correlation.
  THE CONFIRMATION IS ALREADY WRITTEN AND IS READ-ONLY:
    snippets/2026-09-01_anchor_sign_readonly_audit.js
  Paste it in the ANALYZER page console. It only calls chrome.storage.local.get.
  It recovers the posted line from the stored REASON STRINGS rather than from the
  line stores - the anchor reason carries `fair` and `cap`, the calibration reason
  carries the measured offset S, so P = fair + S - and then cross-checks that
  against the raw stores as an independent column. Verdict logic was dry-run in
  node against fabricated boards and correctly separates "consistent with the
  sign error" from "one anchored row finished ABOVE the book, drop the claim".
  IF NOTHING IS ANCHORED, the script says so and the claim stays UNPROVEN - the
  band argument only bites when applyMarketAnchorFor actually fires.

=== *** RETRACTED: "THE RAW SS PREDICTOR RUNS ~+12 ABOVE POSTED LINES" *** ===
THAT NUMBER WAS SELECTION BIAS AND IT IS WRONG. It was the median of
(anchoredFrom - book) over the ANCHORED rows only - and the anchor fires PRECISELY
on the rows where the model disagrees most. Conditioning on "the anchor fired" and
then measuring disagreement measures the selection, not the model. Textbook, and I
walked straight into it.

WHAT THE CLEAN DECOMPOSITION SAYS (2026-09-01 02:48, 28/28 chain intact,
zero formula mismatches, 9 rows carrying a usable single-book line):
  median raw-book   +7.5   (the estimator's own error)
  median final-book -1.0   (what the learner sees)

  DO NOT QUOTE +7.5 AS A BIAS. It is unstable: drop the two rows whose BOOK is
  suspect (Hooker +24.5 at ratio 0.45, Peek +8.0 at 0.55) and the median falls to
  -3.0. What is stable is the SPREAD, and it is enormous:
      raw-book   -12, -11, -5, -3, +7.5, +8, +21, +24.5, +25.5   IQR 26
      final-book -15, -10, -8, -6, -1, -1, -1, 0, +3             IQR  7
  THE ANCHOR IS A CLAMP, NOT A CALIBRATION. It compresses the IQR from 26 to 7 -
  location AND spread - and the clamped result is what runLearningCycle reads.
  A single multiplicative ss_pace_modifier cannot fix a variance problem, so
  "retune the pace term" was never the answer.

  ss_pace_modifier IS NOT SATURATED either, which was the other thing I expected:
  default 1.056, bantam 1.032, feather 0.972, heavy 0.888, FLY 1.275 - all well
  inside [0.70, 1.40] and mostly ABOVE 1.0. The learner is not straining downward.
  That is consistent with the broken loop below - it is not straining at all.

  S IS STILL THE PIPELINE'S RESIDUAL, NOT THE MODEL'S. bookCalibration measures
  (predicted - posted) on STORED predictions, i.e. after anchoring and calibration.
  That part of the earlier note stands and is worth keeping.

=== *** WHERE THE DISPERSION COMES FROM: THE 50/50 OPPONENT BLEND *** ===
predictSS is  ((fighterRate + oppRate) / 2) * expectedMin * ssMod * style.
oppRate is the OPPONENT'S ABSORBED rate (SAPM), weighted EQUALLY with the
fighter's own output rate. Score each row against the fighter's OWN career-rate
expectation (career SS/min x this fight's expectedMin - an independent reference
from UFCStats, not from any book):

   fighter      own   opp   opp/own   raw    careerExp   raw/careerExp
   Cornolle    2.73  5.50    2.01    56.0      34.2          1.64
   Ziam        2.68  4.53    1.69    46.0      36.2          1.27
   Pinto       2.85  3.92    1.38    18.5      20.0          0.93
   Sy          3.40  3.86    1.14    33.5      36.5          0.92
   Hooker      4.80  3.90    0.81    52.0      61.2          0.85
   Charriere   4.02  2.91    0.72    26.5      36.2          0.73
   Peek        4.40  2.63    0.60    32.5      44.4          0.73
   Bukauskas   3.13  1.87    0.60    16.5      27.9          0.59

  MONOTONIC IN opp/own. That is partly ARITHMETIC, not discovery - by construction
  raw - careerExp ~ expectedMin x (opp - own)/2 - so do NOT present it as a
  correlation finding. The DESIGN question is what matters: is a 50/50 weight
  right? The books say no.

  BOOKS PRICE THE FIGHTER'S OWN RATE AND LARGELY IGNORE OPPONENT ABSORPTION.
  book / careerExp on the seven rows whose book is not suspect:
      Ziam 1.06 | Charriere 1.06 | Pinto 1.08 | Sy 1.06 | Bukauskas 0.98 |
      Cornolle 0.89   (Hooker 0.45 and Peek 0.55 excluded as suspect)
  Books sit in a 0.89-1.08 band. The MODEL spans 0.59-1.64 against the same
  reference - roughly FIVE TIMES the dispersion. The opponent-absorption term is
  injecting variance the market does not price.

  CAVEATS, AND THEY ARE REAL:
   - n = 7-9. Thin. One card.
   - careerExp ignores opponent quality by construction, so it is a reference that
     structurally favours whoever else ignores it. It is independent of the book
     (UFCStats history) but it is NOT a neutral arbiter of who is right.
   - The two suspect book lines are still unverified.
  NEXT: re-run this on the next 2-3 cards before touching the blend weight. If it
  holds, the change is a WEIGHT on oppRate, not a pace-modifier retune - and it
  should be measured against careerExp AND the book, not either alone.

=== THE 9 CHAIN BREAKS WERE MY BUG - RESOLVED. round1 IS NOT ONE DECIMAL. ===
*** PropLinePredictorService:59  round1(v) = Math.round(v * 2) / 2  — NEAREST 0.5 ***
The name is a lie and it is the single most misleading identifier in this file.
EVERY stage output goes through it. Reconstructing with true 1dp puts the rebuilt
value up to 0.25 off, which reported a CHAIN BREAK on any row whose arithmetic did
not already land on the .5 grid - 9 of 28. Proven on the dumped strings:
    Hooker    fair 24.2 + cap 6.0 = 30.2 -> round1 30.0 = logged cal.before 30.0
    Charriere fair 33.2 - cap 6.0 = 27.2 -> round1 27.0 = logged cal.before 27.0
    Bukauskas .74x16.5 + .26x34.5 = 21.18 -> round1 21.0 = logged 21.0
NO unmodelled transform exists. The five known stages account for the whole move.
The same bug caused the lone formula MISMATCH (Bukauskas): a point estimate was
compared against a grid-snapped stored value. The check is now an INTERVAL derived
from each input's printed precision, snapped to the grid.
FIXED in the snippet, and there is now a REGRESSION FIXTURE built from the verbatim
dumped strings (scratchpad dryrun4) - all three rows read chain ok / formula ok,
and table 3 reproduces the live ratios exactly (0.45 / 1.06 / 0.98).
RE-RUN THE DECOMPOSITION. Trusted rows go 19 -> 28 and rows carrying a usable book
line go 4 -> ~13, so BOTH medians will move. The -4.0 / -7.0 pair above was
computed on the four survivors of a bug and should not be quoted.

=== TABLE 3 EARNED ITS PLACE: TWO BOOK LINES DO NOT LOOK REAL ===
  Dan Hooker   P6 27.5  vs career 48.8 avg / 4.82 per min  -> ratio 0.45
  Trevor Peek  P6 24.5  vs career 53.2 avg / 4.39 per min  -> ratio 0.55
Everyone else lands 0.89-1.08, i.e. the books are sane across the board. HOOKER IS
THE ROW THE WHOLE "+12" STORY WAS BUILT ON, and his line is the most suspicious on
the card - 0.45x his own career-rate expectation in a FIVE-ROUND fight, where it
should if anything be higher. This repo has a documented junk-low-SS-line trap
(plausibleSs guard, cross-book outlier guard v18). Check whether 27.5 is a real
Pick6 full-fight SS line before ANY conclusion that rests on Hooker.

  *** WHY THE LEARNER NEVER CORRECTS IT - THE LOOP IS BROKEN IN THE MIDDLE ***
  GENERATION: predictSS -> applyBookPrior -> applyMarketAnchorFor ->
    applyDebutMoneylineSplit -> calibrateToBooks -> savePredictions.
  LEARNING:   runLearningCycle -> getPredictions() -> `predicted = pred.ss.line`
    -> effectiveDelta = postedLine - predicted -> updates ss_pace_modifier
    -> which feeds predictSS, i.e. STEP ONE.
  The gradient is measured AFTER three market-correction layers and applied to a
  term BEFORE all of them. On this board effectiveDelta is about +1.0 (book 27.5,
  stored 26.5): relErr 3.6%, step +0.36%. The learner concludes it has CONVERGED,
  and on its own measurement it has. The estimator's error is corrected away
  before it is ever observed, so it is structurally unlearnable.
  Two more things would bite even if it could see it:
   - ss_pace_modifier is clamped [0.70, 1.40] with MAX_STEP_PER_EVENT 0.08. Taking
     12 off ~52 needs x0.77 - inside the clamp but near the floor. The v13 note at
     PropLinePredictorService ~230 records this EXACT saturation happening once
     already (lightHeavyweight pinned at 0.70) before being renormalised to 1.0.
   - `rate x expectedMin x mod` estimates E[STRIKES LANDED]. v40 changed the
     learning TARGET to the posted line and left the FORMULA estimating output.
     A multiplicative pace term can rescale an output estimator; it cannot turn it
     into a line estimator, and asking it to absorb a market convention destroys
     what the pace term means.

  DECOMPOSITION TOOL (read-only):
    snippets/2026-09-01_ss_decomposition_readonly.js
  Reconstructs every SS row as raw -> prior -> anchor -> debut -> calibration ->
  final purely from the stored reason strings, and SELF-CHECKS it: each stage's
  `after` must equal the next stage's `before`, so an unmodelled transform shows up
  as a CHAIN BREAK instead of being averaged in. Then recomputes the raw formula
  from its own logged inputs (rate / opp rate / expected minutes / ssMod / style /
  trend) to confirm the attribution, and finally checks each POSTED LINE against
  the fighter's UFCStats career rate. Medians are taken over unbroken rows only.

  DO NOT SKIP TABLE 3. The +12 is only predictor error if the lines are real.
  Hooker at Pick6 27.5 in a 5R main is about 0.55x his own career-rate expectation,
  and this repo has a documented junk-low-SS-line trap. If the line is wrong, the
  gap measured against it means nothing.

  WHAT FLIPPING THE SIGN ALONE WOULD DO: every anchored SS line moves +2S = +6.6.
  Hooker 26.5 -> 33.5 (+6.0 OVER the book). Charriere 23.5 -> 29.5. The board goes
  from systematically under the book to systematically over it. The negation is
  currently cancelling roughly half of the raw +12. FIX THE PREDICTOR FIRST, OR
  FIX BOTH TOGETHER AND RE-MEASURE - never the sign by itself.

=== THE FIRST VERDICT RULE WAS WRONG, AND HOW ===
The snippet's original headline test (the delta band) returned "NOT consistent -
drop the claim" on a board that does carry the defect. Two faults, both mine:
  1. applyDebutMoneylineSplit runs AFTER the anchor and moves sp.line while leaving
     anchoredFrom stale. Parnasse was anchored to 36.2, debut-split +6.7 to 42.9,
     calibrated -3.3 to 39.5 - 6.0 ABOVE his book line, which the band said was
     impossible. Reconstructs to the displayed 39.5 exactly. Now excluded and
     reported, never counted.
  2. The band's "posted" input was itself fair + S, so it could not disagree with
     the sign it was testing. CIRCULAR. Replaced with shift = fair - (RAW book
     line), which reads one number from the reason string and one from a store the
     anchor never writes.
The lesson is the 357 lesson from the other direction: a test built on the
mechanism it is testing will confirm or deny whatever you built into it. The
snippet is amended and both scenarios (negated / corrected) were dry-run in node.

=== SMALLER, WORTH ONE CHECK ===
Ruziboev's SS resolved to NO raw book line (exact name match, all five stores) at
02:26, while the board painted a "P6 22.5" chip for him at 01:56 and he sits in
DRIFTERS. That is the shape of the known line-removals-never-propagate bug -
mergeFighters can add or change a line but never remove one, so a pulled line
keeps rendering. It could also just be a re-fetch between the two timestamps.
One check, not a conclusion.

=== WHAT THE BOARD SAYS THAT IS NOT ABOUT THE ANCHOR ===
The five big model-vs-book unders are all FINISHERS or short-fight profiles.
estimateExpectedMinutes is pFinish*avgFinishMin + (1-pFinish)*fullLength, so a
high finish rate pulls expected minutes down hard and SS scales with it; books
do not discount that steeply. That is a real disagreement worth grading after
Paris, and it is SEPARABLE from the anchor question - do not fold them together.

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
