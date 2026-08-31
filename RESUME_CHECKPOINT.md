# Resume Checkpoint

Last Saved: 2026-08-31 12:36:16 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 6b8769b

## Last Notes
################################################################################
##  START HERE - NEXT SESSION'S FIRST TASK                                     ##
################################################################################

TWO THREADS. Pick by whether props have dropped.

(A) IF PARIS PROPS HAVE DROPPED (board still read ALL FIGHTERS 0 at 21:45):
  1. GATE 2 (displayedConfidence write path) - needs only the FIRST book lines
     (Pick6/UD/Betr), not the full Friday set.
  2. Regenerate predictions.
  3. Best Picks audit once TD + R1 SS + CTRL + FP are ALL posted (Friday).
  4. Eyeball Hooker/Parnasse for v39 (3R history moving up to a 5R main flips
     the SS hit-rate term by up to +4).

(B) IF NOT: THE ARCHIVE FP INVESTIGATION. 81 archive Fantasy rows disagree with
    FP recomputed from UFCStats components. This is the biggest open thread in
    the project right now and it is NOT a ledger problem - the archive feeds
    grading, calibration, FP hit rates and CLV. See the section below; the FIRST
    move is already identified and is cheap.

THE GLOW-UP LADDER IS DONE (354-360 shipped, 357 REVERTED as 361). Do not
re-open it. Remaining ledger ideas are at the bottom; none are required.

THE CLIPPING SWEEP IS ALSO DONE AND MINED OUT (362-364, 2026-08-31). Do not
re-run it as a source of work - see the section near the bottom for what it
produced and, more importantly, the measurement trap it walked into first.

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
