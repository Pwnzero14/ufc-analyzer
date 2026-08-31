# Resume Checkpoint

Last Saved: 2026-08-30 21:46:57 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: e004212

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

################################################################################

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

TWO HYPOTHESES TESTED, BOTH FAILED - do not re-run them:
  (a) a miscounted knockdown; (b) the round-vs-decision win bonus. Neither is
  separable by VALUE anyway: each adds exactly 10 to both scoring systems, so
  the Makhachev +10 cannot discriminate them. The aggregate histogram matches
  neither prediction (predicted +15 Fantasy / +20 PP for 3R decisions; observed
  -5 dominant).

*** FIRST MOVE NEXT TIME - CHEAP AND NOT YET DONE ***
The scan MIXED two populations: SETTLED rows carry `platform` AND `line`;
BACKFILLED rows carry NEITHER. They are written by different code paths. Re-run
the histogram SPLIT on platform presence before reasoning any further - the -5
cluster may resolve into one population entirely.

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
