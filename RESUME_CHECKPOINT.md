# Resume Checkpoint

Last Saved: 2026-09-01 03:37:00 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 09ab93c

## Last Notes
################################################################################
##  START HERE - NEXT SESSION'S FIRST TASK                                     ##
################################################################################

RESUMING FRIDAY 2026-09-04/05. UFC Paris (Hooker vs. Parnasse) is Saturday.
Everything from the 09-01 session is SHIPPED, PUSHED and VERIFIED - nothing is
half-done. There is exactly ONE blocked task waiting and it unblocks Friday.

*** FIRST MOVE: THE BEST PICKS AUDIT. ***
  It was blocked all of 09-01 because only SS lines were posted. Full props
  (TD / R1 SS / CTRL / FP) land FRIDAY - see [[feedback_audit_timing_full_props_friday]].
  BEFORE AUDITING:
    1. AUTO-FETCH LINES, then confirm the board actually has TD + R1 SS + CTRL +
       FP, not just SS. If any are missing it is still too early - do not audit.
    2. GENERATE PREDICTIONS. The stored board is from 09-01 03:39 and the lines
       will have moved all week. MODEL v44 is current; the panel chip must say v44.
    3. THEN invoke the ufc-lean-audit skill. That is what it is for.

*** SECOND: THE v39 CHECK, WHICH HAS BEEN WAITING SINCE 08-29. ***
  calcSSLean's duration-normalised hit rate needs DK ROUND MARKETS and DK had
  posted nothing all week, so v39 has never actually fired in production. Once DK
  is in, look at Hooker's SS lean reason for the note "(N/24 scaled to ~Xm)".
  Present = the term fired. Absent = DK still is not resolving for his name.
  The EFFECT is already measured out-of-band (RAW 50% -> v39 67% on Hooker, and
  the reverse on short-priced fights: Bukauskas 54% -> 23%). Friday only has to
  confirm production matches. HOOKER ONLY - Parnasse is a debut and calcSSLean
  bails at history.length < 3, so he can never exercise it.

*** THIRD, AND ONLY AFTER THE CARD SETTLES: RUN 19. ***
  The next learning cycle will be the FIRST that is both line-trained (v40) and
  post-v41/v44. Every loop claim in this file is about CODE, not measured
  behaviour, until it exists. Re-run BOTH probes after settling:
    snippets/2026-09-01_learning_log_readonly.js   (SS)
    snippets/2026-09-01_fp_loop_readonly.js        (FP)
  What to look for: does mean effectiveDelta.ss flip POSITIVE (18 runs of history
  were negative), and does targetKind finally read line-open/line-close instead
  of 'none'? Also run the Learning Cycle in the right order -
  [[project_learning_cycle_workflow]]: load the NEXT slate's lines BEFORE
  absorbing the finished card.

BOARD STATE AT HANDOFF (2026-09-01 03:41): 28 fighters, MODEL v44, 40807 archive
records / 41 unresolved. Pick6 + Underdog SS only; Betr, PrizePicks and DK all
still WAITING. Lines were ~1.9h old and SLATE CHECK had drifted 68% -> 53%, which
is just staleness - re-fetch on Friday, do not read it as a defect.

MY PLACED: the 09-01 Underdog "Champions" 2-legger is recorded at its ENTRY lines
(Ruziboev UNDER 22.5, Page UNDER 31.5, placed 08-31 15:15) alongside the 4-leg
Pick6 slip. Both fighters are the same fight, both UNDER - that is POSITIVE
correlation and effectively one wager. Stake/payout are NOT stored; PlacedParlay
has no such field.

--- WHAT IS CLOSED. DO NOT RE-DERIVE ANY OF THIS. ---
 * anchorShift sign: FIXED and VERIFIED in MODEL v44. Details below.
 * The book lines are ALL REAL - 12/12 against the live Pick6 board.
 * FOUR of my own hypotheses were retracted after measurement on 09-01: the "+12
   raw bias" (selection bias - measured only anchored rows), "books are 5x
   tighter" (built on excluding two rows that turned out to be real lines), the
   SS ratchet (dead on timing AND the trajectory ran the opposite way), and FP's
   long-running corruption (dead on timing again). All four are written up as
   RETRACTIONS in the 09-01 section. Read them before re-proposing any of them.
 * STANDING RULE: check the SHIP DATE before building a story about long-running
   corruption. That check killed two stories on 09-01, both times only after the
   reasoning had already been written down.
 * The raw SS estimator has a MAGNITUDE problem, not a side problem (direction
   agrees with normalised history on 6/8). Do NOT hunt for a bias fix inside
   predictSS, and do not expect a single multiplicative term to fix a spread.

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

SESSION HANDOFF (2026-09-01, ~03:37). Tree clean, both branches pushed, FULL
parity. feature/sleek-theme-v1 09ab93c, master 6c86c68.
  This session: Gate 2 closed, v43 board audited end to end, MODEL v44 shipped
  (the negated anchorShift), a 2-leg Underdog slip recorded at its entry lines,
  and FOUR of my own hypotheses retracted after measurement. The retractions are
  written up as retractions - read them before re-deriving any of them.

--- previous handoff ---
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

  *** PARTIALLY ANSWERED ALREADY, 03:01, WITHOUT DK ***
  The hit-rate tool reproduces the v39 arithmetic using the PREDICTOR's
  career-based expMin instead of DK's market minutes, and the effect the original
  item predicted is real and large: Hooker RAW 12/24 = 50% -> v39 16/24 = 67%,
  the biggest upward move on the card, on the exact fighter named. It also cuts
  the other way harder than expected - Bukauskas 54% -> 23%, Pinto 50% -> 25% -
  because those fights are priced SHORT, so duration is a two-sided correction
  and not a 5R-main special case. Friday's DK run only needs to confirm that
  production v39 fires and lands near these figures; the mechanism is no longer
  in question.

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

  *** THE "BOOKS ARE 5x TIGHTER" CLAIM IS RETRACTED. IT WAS THE EXCLUSION. ***
  I originally read book/careerExp as a 0.89-1.08 band against a model spanning
  0.59-1.64 and called it five times the dispersion. That band existed ONLY
  because Hooker (0.45) and Peek (0.55) were dropped as "suspect books" - and
  both lines are now confirmed real. Put them back and the comparison dies:
      book   n=8  range 0.45-1.08  IQR 0.255  sd 0.251
      model  n=8  range 0.59-1.64  IQR 0.285  sd 0.341
  Nearly the same spread. The model's sd is ~36% higher, which is a whisper in
  the same direction at n=8 and nothing more. THE 50/50 BLEND HYPOTHESIS IS NOT
  SUPPORTED BY THIS DATA. Do not act on it, and do not re-derive it from the
  monotonic table above - that table is arithmetic, as noted.

  THE DEEPER LESSON: careerExp is too noisy to adjudicate. It misses the BOOK by
  up to 0.55, so it cannot be used to convict the model of anything. Excluding
  the rows where a reference disagrees most, then reporting how tight the
  remainder is, MANUFACTURES the result. That is what happened here.

  WHAT SURVIVES, REFERENCE-FREE: model minus book, per fighter, needs no
  careerExp at all -
      Cornolle +25.5  Hooker +24.5  Parnasse +21  Peek +8  Ziam +7.5
      Pinto -3  Sy -5  Bukauskas -11  Charriere -12
  A -12 to +25.5 disagreement with the market is real and large. WHOSE error it
  is remains open, and settling it needs a better reference than careerExp.
  THE HIT-RATE TOOL BELOW IS THAT REFERENCE - it asks an empirical question
  (did this fighter's own past fights clear this number) instead of comparing
  against a constructed expectation.

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

=== RETRACTED: "TWO BOOK LINES DO NOT LOOK REAL". THE SCRAPE IS PERFECT. ===
USER CHECKED THE LIVE PICK6 BOARD 2026-09-01 02:55. Hooker 27.5 IS a real Pick6
Significant Strikes line. So is every other one - all TWELVE stored P6 SS lines
match the board exactly:
  Charriere 38.5  Ziam 38.5  Sygula 37.5  Parnasse 36.5  Lima 35.5  Page 31.5
  Cornolle 30.5   Hooker 27.5  Campbell 24.5  Peek 24.5  Sola 24.5  Ruziboev 22.5
No junk lines anywhere. The scraper is not the problem and never was.

WHAT WAS WRONG WAS MY TEST. It scored the posted line against the fighter's CAREER
MEAN SS scaled to expected minutes. A mean is the wrong reference for a line: it is
dragged up by high-volume outliers, while a line is priced near an outcome the book
expects beaten about half the time. Hooker read 0.45x and got flagged. DO NOT
REUSE THAT RATIO TEST - it is removed in favour of the hit-rate tool below.

FROM THE BOARD, AN OBSERVATION WORTH KEEPING: Hooker, Peek, Charriere, Sygula,
Sola and Ruziboev are all MORE-ONLY on Pick6 (no Less button). Charriere sits at
1.06 on the old ratio and Hooker at 0.45, so MORE-ONLY DOES NOT EXPLAIN A LOW
LINE and must not be treated as a tell. It is recorded because a one-sided market
is priced differently from a two-sided one, and ss_under_available already carries
the flag through to storage.

  *** RUN 2026-09-01 03:01 - THE HOOKER LINE IS PERFECT, AND MEAN/MEDIAN IS WHY ***
    Hooker  line 27.5 | mean 48.8 | MEDIAN 26.5 | RAW 12/24 = 50%
  The book posted a textbook 50/50 line and my ratio test called it fake because
  it read the MEAN of a violently skewed distribution (25-min wars at 95+ against
  quick finishes). MEAN 48.8 vs MEDIAN 26.5 on the same fighter. Whenever a
  fighter's mean and median separate like that, ANY mean-based reference is junk.

  FULL RUN (9 rows with one agreed book line):
    fighter      R  line  n   expMin  mean  median  RAW      v39      sides
    Peek         3  24.5   6   10.1   53.2   52.5   6/6 100% 6/6 100% P6 More-only
    Hooker       5  27.5  24   12.7   48.8   26.5  12/24 50% 16/24 67% P6 More-only
    Cornolle     3  30.5   6   12.5   30.8   31.5   3/6  50% 3/6  50%  P6 both
    Ziam         3  38.5  11   13.5   35.4   35.0   5/11 45% 5/11 45%  P6 both
    Charriere    3  38.5   6    9.0   34.2   34.0   3/6  50% 2/6  33%  P6 More-only
    Pinto        3  21.5   4    7.0   22.5   21.5   2/4  50% 1/4  25%  P6 both
    Bukauskas    3  27.5  13    8.9   31.6   36.0   7/13 54% 3/13 23%  UD
    Sy           3  38.5   5   10.7   29.2   17.0   1/5  20% 1/5  20%  UD
    Parnasse     -  36.5   0      -      -      -   no history (UFC debut)

  *** THIS IS THE v39 ANSWER, ARRIVED AT SIDEWAYS ***
  Checkpoint item 4 predicted that 3R history moving up to a 5R main would flip
  the SS hit-rate term, and named Hooker. MEASURED: RAW 50% -> v39 67% on Hooker,
  the largest upward move on the board, on exactly the fighter predicted.
  The term also works the OTHER way and harder: Bukauskas 54% -> 23% and Pinto
  50% -> 25%, because their fights are priced SHORT (expMin 8.9 and 7.0) so their
  history scales DOWN. Duration is not a Hooker-only correction.
  CAVEAT THAT MATTERS: production v39 in calcSSLean is gated behind DK round
  markets and is still DORMANT. This tool used the PREDICTOR's career-based
  expMin instead, so the numbers above are what v39 WOULD say, not what the board
  is currently doing. Re-check on Friday once DK posts.

  *** THE MODEL'S DIRECTION IS MOSTLY RIGHT; ITS MAGNITUDE IS NOT ***
  model-book direction vs the v39-normalised hit rate, 6/8 agree:
    Hooker +24.5 OVER / 67% OVER    agree      Charriere -12 UNDER / 33%  agree
    Peek    +8.0 OVER / 100% OVER   agree      Pinto      -3 UNDER / 25%  agree
    Ziam    +7.5 OVER /  45% UNDER  DISAGREE   Bukauskas -11 UNDER / 23%  agree
    Cornolle +25.5 OVER / 50% COIN  (no side)  Sy         -5 UNDER / 20%  agree
  SUPERSEDED - this used RAW-book. Redone on the SHIPPED number further down;
  see THE AGREEMENT TEST, REDONE. Kept only because the raw-vs-final contrast
  is the point. Original reading follows:
  So the estimator picks the SIDE well and overstates the DISTANCE badly:
  Hooker +24.5 against a 67% history, Cornolle +25.5 against a coin flip. That
  is a magnitude problem, and it is why the anchor's clamp makes the board look
  sane. It also means "fix the raw model" is the wrong framing - the side is
  already there.

  NO SINGLE REFERENCE EXPLAINS THE BOOKS. book/median runs 0.47 (Peek), 0.76
  (Bukauskas), 0.97, 1.00, 1.04 (Hooker), 1.10, 1.13, 2.26 (Sy). Books price
  opponent, style and matchup, not just the fighter's own log. Stop looking for
  one ratio that convicts them.

  STANDOUT, NOT A RECOMMENDATION: Peek 6/6 with a median of 52.5 against a 24.5
  More-only line is the largest apparent gap on the card. n=6, not
  opponent-adjusted (he faces Campbell), and the printed caveat applies in full.

=== *** THE ZIAM DISAGREEMENT WAS MY TEST READING THE WRONG NUMBER *** ===
ZIAM IS NOT A DISAGREEMENT. His SHIPPED line is 38.5 and the book is 38.5 -
final-book = 0.0, the board takes NO position on him. The "DISAGREE" came from
comparing the RAW estimator (46.0) against his history, and raw is not what
ships: 46 -> prior 44 -> anchor 41.5 -> calibration 38.5, landing on the book.

  Where the raw +7.5 comes from is plain: Ziam's own rate is 2.68 SS/min but
  Sola absorbs 4.53, so the 50/50 blend multiplies his own rate by 1.35. His
  own-rate-only projection is 34.4, his median is 35.0, the book is 38.5 - so the
  BOOK also adjusts up for Sola, by about +10%, where the model adjusts +35%.

  THAT STILL DOES NOT GENERALISE - I checked before believing it. Solving each
  book line for the opponent weight it implies, book = (own*(1-w) + opp*w)*K
  where K = expMin * ssMod * style:
      Hooker 2.80 | Sy 1.70 | Pinto 1.00 | Peek 1.00 | Ziam 0.17
      Cornolle -0.18 | Bukauskas -0.76 | Charriere -0.89
  Range -0.89 to +2.80 against the model's fixed 0.50. NO CONSISTENT WEIGHT. The
  books are not doing this calculation at all. Ziam is one row where the blend
  happens to push hard, not evidence of a pattern. The blend hypothesis stays
  dead - this is the THIRD time it has been offered and refused.

=== *** THE AGREEMENT TEST, REDONE ON THE SHIPPED NUMBER *** ===
The 6/8 figure recorded above used RAW-book. Wrong number - `final` is what the
board displays and what runLearningCycle reads. Redone on final-book:

  fighter     raw-book  final-book  side    v39    verdict
  Hooker        +24.5      -1.0    UNDER    67%    DISAGREE
  Peek           +8.0      -1.0    UNDER   100%    DISAGREE
  Ziam           +7.5       0.0    none     45%    (no side taken)
  Cornolle      +25.5      -1.0    UNDER    50%    (coin flip)
  Charriere     -12.0     -15.0    UNDER    33%    agree
  Pinto          -3.0      -6.0    UNDER    25%    agree
  Sy             -5.0      -8.0    UNDER    20%    agree
  Bukauskas     -11.0     -10.0    UNDER    23%    agree
  ON THE SHIPPED NUMBER: 4 agree, 2 disagree, 3 no-side.

  *** 8 OF 9 SHIPPED LINES SIT AT OR BELOW THE BOOK. *** That is the negated
  anchor sign, now visible in OUTPUT rather than inferred from code. It
  manufactures UNDER-side numbers across the board, and on the two rows with the
  strongest historical OVER case - Hooker 67%, Peek 100% - it produces the
  OPPOSITE side. This is the best argument yet for fixing the sign, and it
  arrived from a question about a different fighter.

=== *** THE RATCHET IS DEAD. ALL THREE CHECKS, AND ONE REVERSED MY SIGN. *** ===
LEARNING LOG READ 2026-09-01 03:12, 18 runs stored.
  1. TIMING     : 0 runs on/after v43 shipped. Decisive on its own.
  2. TRAJECTORY : UP 8 / DOWN 10, net -0.122. NOT monotone, and it moved DOWN.
  3. SIGNAL     : effectiveDelta.ss n=354, mean -2.555, pos 165 / neg 187.
                  The ratchet needed this POSITIVE. It is NEGATIVE.

  MY READING OF 1.056 WAS BACKWARDS. I argued "default sits above 1.0, so it is
  being pushed up". The trajectory shows it STARTED at 1.181 and has been coming
  DOWN ever since; 1.056 is a waypoint on a descent, not evidence of a climb.

  AND THE NUMBERS RECONCILE WITH bookCalibration, which is the reassuring part:
  mean effectiveDelta.ss -2.555 means predicted - posted ~ +2.55, and
  bookCal.global.SS reads +3.3. Same sign, same rough magnitude, two independent
  paths. Historically the stored SS line ran ABOVE the posted line and the
  learner was correctly damping it - slowly (-0.122 over 18 events), but in the
  right direction.

=== *** THE BROKEN LOOP IS TWO DAYS OLD, NOT LONGSTANDING - THIS IS THE FIX *** ===
For SS, EVERY correction layer between the estimator and the stored line arrived
on 2026-08-30:
    v41 calibrateToBooks          2026-08-30
    v43 applyBookPrior (SS)       2026-08-30  } "were FP-ONLY" - the v43 comment
    v43 applyMarketAnchorFor (SS) 2026-08-30  }  says so outright
BEFORE THAT, pred.ss.line WAS the raw estimator's output. The loop was SOUND for
all 18 logged runs, which is exactly why the learner tracked the error correctly.
So the broken-loop finding is real but it has NEVER YET AFFECTED A LEARNING RUN -
same timing as the sign bug, same first exposure: the Paris settle.

  FORWARD-LOOKING, AND THIS ONE IS A PREDICTION NOT A FINDING:
  current final-book median is -1.0, so the FIRST v43 settle will feed the learner
  effectiveDelta ~ +1.0 - positive, where 18 runs of history were negative. That
  is when the modifier starts being pushed UP against a raw estimator that is
  already hot. TEST IT AFTER PARIS: re-run this probe and check whether run 19
  flips the sign of mean effectiveDelta.ss. Do not assert it before then.

  *** THE FP HYPOTHESIS IS ALSO DEAD ON TIMING. TWO FOR TWO. ***
  I claimed FP's loop had been broken "since v22" and that the v27
  fp_global_modifier saturation was what that looks like. BOTH HALVES WRONG.

  A CORRECTION INSIDE THE ESTIMATOR DOES NOT BREAK THE LOOP. computeBookPriorFP
  is passed INTO predictFighter and runs inside predictFantasy, so the learner
  sees the number it produced. Only POST-HOC layers - ones sitting between the
  estimator and the stored line - break it. FP has exactly two:
      2026-04-27  FP book prior        INSIDE predictFantasy   loop SOUND
      2026-08-20  v27 renormalisation  fp_global_modifier -> 1.0
      2026-08-21  v31 applyMarketAnchor  POST-HOC   <- the break starts HERE
      2026-08-30  v41 calibrateToBooks   POST-HOC
  THE v27 SATURATION PREDATES THE FIRST POST-HOC LAYER BY ONE DAY. No such layer
  existed during those 18 cycles, so a broken loop cannot explain it. v27's own
  account stands: a genuinely over-predicting baseline the learner correctly
  damped, which became a double-correction once Step 2b fixed the bias at source.

  *** MEASURED 2026-09-01 03:32. TWO RUNS OF EXPOSURE, NO DETECTABLE EFFECT. ***
    runs loop SOUND (pre 08-21) : 16
    runs in the BROKEN window   : 2  - Hernandez vs. Rodrigues, Nurmagomedov vs.
                                      Song. Both post-v31 anchor; NEITHER post-v41.
    mean effectiveDelta.fp      : SOUND -0.747 (n=306) | BROKEN +0.105 (n=51)
    fp_global_modifier          : default 0.997, net -0.111 over the log,
                                  9 up / 8 down. NOT saturated (floor is 0.75).

  THE SIGN FLIP IS AN ARTIFACT - DO NOT REPORT IT AS ONE. The broken window is
  literally two runs whose means CANCEL: +8.274 (n=26) and -8.391 (n=25), giving
  +0.105. Sound-era per-run means span -25.1 to +7.6 with a run-level SD of 10.19,
  so the SE of a two-run mean is 7.21. The observed era difference is 0.85 -
  0.12 SE. Nothing. n=51 looks like a sample; it is two events.

  *** AND THE METRIC CANNOT TEST THE CLAIM ANYWAY ***
  targetKind reads 'none' on ALL 18 runs. Its own comment (types/index.ts:459)
  says it exists "so a later session can tell line-trained cycles from the older
  result-trained ones" - it was added by v40 on 2026-08-30, and the last run was
  08-29. So EVERY stored run is RESULT-trained: effectiveDelta.fp here measures
  `RLM-blended result - predicted`, not `posted line - predicted`. The broken-loop
  story is about the LINE target. This dataset cannot speak to it in either era.
  The probe's targetKind column was added for exactly this and earned its place.

  CONCLUSION: FP's loop break is REAL IN CODE, has TWO runs of exposure, shows no
  detectable effect, and the only available metric could not have detected one.
  Treat FP as untouched. Re-measure after Paris - run 19 will be the first
  line-trained AND post-v41 cycle, for FP and SS alike.

  THE TOOL: snippets/2026-09-01_fp_loop_readonly.js

  *** THE PATTERN TO STOP REPEATING ***
  Twice now I have proposed "an invisible correction has been quietly corrupting
  the learner for a long time", and twice the ship dates have killed it outright -
  the SS ratchet and this. BOTH breaks are days old and neither has touched a
  single learning run. CHECK THE SHIP DATE BEFORE BUILDING THE STORY, not after.

=== SUPERSEDED: A RATCHET, CONSISTENT WITH EVERY NUMBER BUT NOT PROVEN ===
(Kept for the reasoning trail. The probe above killed it on all three checks.)
median final-book = -1.0, so effectiveDelta = posted - predicted is systematically
about +1.0. The learner reads that as "predicting too low" and nudges
ss_pace_modifier UP. Observed default: 1.056 - ABOVE 1.0, when nothing else on
this board suggests the estimator runs cold.
  So: negated sign biases the stored line low -> learner pushes the pace modifier
  up -> the raw estimator runs hotter -> the anchor clamps harder. A loop that
  quietly ratchets. CONSISTENT with everything measured; NOT proven, because the
  causal chain needs the learning-log history (prop_predictor_learning_log_v1)
  and that has not been read. Do not state it as fact without that.

=== SCOPE CORRECTION - THE SIGN BUG DOES NOT REACH THE PICKS ===
All of the above is the PREDICTOR path: the displayed line, the delta-BOOK chips,
the PREDICTOR VS POSTED LINES panel, and runLearningCycle's target. BEST PICKS
leans come from calcSSLean, a SEPARATE engine that never reads PropPrediction
(see [[project_fp_moneyline_guard]]). So the sign bug is NOT currently producing
bad picks - it is corrupting the predictor's output and its own training signal.
That lowers the urgency and it should be stated whenever the sign comes up.

  THE TOOL:
    snippets/2026-09-01_ss_line_hitrate_readonly.js
  Asks what fraction of the fighter's OWN logged fights actually cleared the
  posted line - raw, and MODEL v39 duration-normalised to this fight's expected
  minutes, with mean beside median so an outlier-driven mean cannot hide. Also
  prints the More-only flag per book. Skips any fighter whose books disagree
  rather than averaging them. Dry-run verified: normalisation demonstrably moves
  a row (short-KO scaling took a 5/6 to 6/6), split-book rows are skipped.
  CAVEAT BUILT INTO THE OUTPUT: a high hit rate is the fighter's own past, not an
  opponent-adjusted forecast. It bounds the question. It does not settle it.

=== ALSO RETRACTED: THE RUZIBOEV "PULLED LINE" ===
Flagged at 02:26 as a possible line-removals-never-propagate case (no raw book
line, but a P6 chip on the board). The 02:48 run shows P6 22.5 present for him
and it matches the live board. A re-fetch landed between the two runs. NOT a bug.

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
npm run checkpoint:resume   # READ-ONLY, safe
npm run build
git status
~~~

*** DO NOT RUN `npm run checkpoint:save` WITHOUT -Notes. ***
resume.ps1 save mode REGENERATES THIS WHOLE FILE from a template and writes
`## Last Notes` = `(none)` when -Notes is empty (resume.ps1:138-158). That would
delete every line above this - the entire accumulated project record. The Last
Notes section is maintained BY HAND and always has been.
If you ever do want the script's header refresh, pass the full notes body:
  npm run checkpoint:save -- -Notes "..."
Otherwise edit this file directly, which is what every session has done.
