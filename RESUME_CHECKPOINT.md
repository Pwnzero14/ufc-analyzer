# Resume Checkpoint

Last Saved: 2026-08-30 21:28:10 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 0cccb56

## Last Notes
################################################################################
##  START HERE - NEXT SESSION'S FIRST TASK                                     ##
################################################################################

GATED ON PARIS PROPS. Board still reads ALL FIGHTERS 0 / "No extension data" as
of 2026-08-30 21:25. Predictions for UFC Paris (Hooker vs. Parnasse, 28
fighters) ARE generated under MODEL v43, but predicted lines live in a different
store and do NOT satisfy getSourceActiveLine. When props drop:
  1. GATE 2 (displayedConfidence write path) - needs only the FIRST book lines
     (Pick6/UD/Betr), not the full Friday set. Snippet is in the gate-2 section.
  2. Regenerate predictions.
  3. Best Picks audit once TD + R1 SS + CTRL + FP are ALL posted (Friday).
  4. Eyeball the Hooker/Parnasse rows for v39 (3R history moving up to a 5R main
     flips the SS hit-rate term by up to +4). Needs posted lines to fire.

THE GLOW-UP 354-363 LADDER IS DONE (354-360 shipped, seven levels). Do not
re-open it. Remaining ledger ideas are at the bottom; none are required.

################################################################################

SESSION HANDOFF (2026-08-30, ~21:25). Tree clean, both branches pushed and in
FULL parity (src/ dist/ analyzer.html all empty on the diff).
  feature/sleek-theme-v1  0cccb56
  master                  4dc19cc

=== MY PLACED LEDGER IS NOW AUDITED. IT IS CLEAN. ===
The "144 legs, YOU 76/144, BOARD 38/80, still NOT audited" line that rode in
this checkpoint for many sessions is CLOSED. All 144 legs were re-graded against
the current archive with a faithful replay of resolveVsArchive:
  agree 136 | DISAGREE 0 | unmatched 8 | total 144, stored hits 76
The 8 unmatched were the REPLAY's own missing NAME_ALIASES (Myktybek Orolbai ->
...Uulu, the Sumudaerji family), not defects. YOU 76/144 is trustworthy.

ALL 144 legs are FROZEN verdicts (unpersisted 0). A leg with a persisted
rec.outcome is used verbatim and never re-resolved (GLOW-UP 174), so resolver
fixes cannot reach them. The re-grade proves they agree anyway - latent, not live.

=== SHIPPED THIS SESSION (7 levels) ===
354 BOARD chip tooltip: it is the closing BEST PICKS shortlist (<=8 OVER + <=8
    UNDER, one pick per fight, dedupeNegCorrelatedSameFight ~9567), NOT "the
    board's full suggested slate". Confirmed in storage: overs 8 / unders 8.
355 Header says BOARD top-16 and explains why YOU (every leg placed, 29-46 per
    event) and BOARD (16 per event) are NOT like-for-like. SELECTION below IS
    like-for-like - both cohorts come from that same 16.
356 Drift marker: frozen actual values that no longer match the archive.
357 READ-TIME CORRECTION - the ledger now DISPLAYS the archive's value. Not a
    write-back: best_picks_placed_v1 is user data, and GLOW-UP 174's
    pruning-resilience survives because storage is still the fallback when no
    archive row exists. Verdict stays frozen; nothing in the totals reads actual.
358 BY BOOK / BY STAT breakdown strips.
359 Fighter search on BOTH ledgers, matching in CSS (one rewritten stylesheet
    rule per keystroke), both corners per row, slips match on any leg.
360 Concentration chip on the event head: "N FIGHTS - MAX M".

=== THREE HYPOTHESES THAT DIED TO MEASUREMENT - DO NOT RE-DERIVE ===
1. "boardStatsFor reads a field that does not exist (p.line / p.platform)."
   WRONG. There are TWO snapshot stores with DIFFERENT field names:
     best_picks_snapshots_v1 - picks carry date, line, platform. THIS is what
       boardStatsFor and the selection/ALPHA diagnostics read (~15557).
     ai_lean_snapshots_v1    - picks carry capturedAt, activeLine,
       activePlatform, and NO date/line/platform at all.
   Reading p.line looks like a bug only if you assume the ai_lean store. Its
   Date.parse(s.date) collapse is CORRECT for its store. The house rule
   "anything reading ai_lean_snapshots_v1 must go through
   collapseSnapshotsByEvent" does NOT apply to the ledger. CHECK WHICH STORE
   BEFORE DIAGNOSING - this cost three wrong diagnoses in one session.
2. "archiveIdx first-row-wins over duplicate rows causes the drift." WRONG, and
   it was queued as priority 1. A key event|fighter|propType legitimately holds
   ONE ROW PER BOOK - same result, different line - so first-row-wins is
   harmless: every candidate returns the same number. Measured: all 32 rows
   behind the 9 drifts agree with each other and disagree with the frozen value.
   Do NOT change archiveIdx on the strength of a dupRows correlation.
3. "Pre-existing crowding between the CLV badge and the actual cell." WRONG - a
   screenshot-downscaling artifact. Measured 0 sibling overlaps across 144 rows.

=== THE DRIFT QUESTION IS ANSWERED: THE ARCHIVE IS RIGHT ===
The settle path re-applies results every run ("re-applied 47 results" in its own
log) and frozen legs never saw the new value. UFCStats ground truth agreed with
the ARCHIVE on both checkable SS cases:
  Lerryan Douglas  stored 7   / archive 14 / ufcstats 14
  Marquel Mederos  stored 110 / archive 73 / ufcstats 73
So settle CORRECTS results, it does not corrupt them. 357 acts on this.
STILL OPEN: the 6 FP drifts are unverified - fightHistory stores NO fp field, so
FP must be recomputed from components. Nothing contradicts the SS finding.

=== UFCSTATS CACHE SHAPE (cost FOUR wrong joins - do not guess it again) ===
key ufcstats_v51_<name_lower_underscored>; top level is
{careerStats, detailUrl, fetchedAt, fightHistory, name}.
  - the array is **fightHistory**, NOT history
  - each entry's opponent field is **opponent**, NOT opp
  - date is human format ("Aug. 22, 2026"), NOT ISO - slicing it against an ISO
    date never matches. Join on evKeyOf(entry.event) instead.
  - entries carry sigStr/sigStrR1/sigStrBody/sigStrLeg/td/kd/ctrlSecs/sub/rev/
    totStr/timeSecs/round/method/result - and NO fp.
Caches can also be STALE: Kaue Fernandes held 4 fights ending Sep 2025, so his
Aug 2026 bout was simply absent.

=== LESSONS THIS SESSION RE-TAUGHT ===
- MEASUREMENT PROVES GEOMETRY, NOT OCCLUSION (the 348 lesson, again). The first
  drift marker was a small glyph appended after the value. .plg-actual is
  white-space:nowrap in a fixed track, so the extra width did not overflow the
  ROW - the left neighbour painted over the start of the text and "actual 110"
  rendered "ual 110" on three-digit actuals. .plg-leg scrollWidth never moved.
  A screenshot caught it. The fix was to make the signal ZERO-WIDTH (a class +
  border-bottom + title). SIBLING OVERLAP *IS* measurable if you compare EDGES
  (kids[i].right > kids[i+1].left) rather than widths - reuse that check on any
  dense-grid change.
- A CELL MUST NOT TAKE A SIDE IT CANNOT SUPPORT. 358's first cut coloured every
  breakdown cell green/red against the population rate; on the live ledger the
  widest split (Betr 41% vs 53%) is only 1.1 SE out and R1 SS 68% is 1.45. Same
  1.5 SE bar as the ALPHA chip (GLOW-UP 310). Everything currently reads FLAT and
  the strip says "no split has separated yet" outright.
- COMMIT MESSAGES GO TO A FILE. git commit -m with backticks in the message let
  bash command-substitute them and silently ate words. Use git commit -F.
- BASH HEREDOCS CONTAINING QUOTES BREAK THIS TOOL OUTRIGHT, even quoted ones.
  Two attempts died at the same line. Write the file with the Write tool.
- A python heredoc that does not CLOSE the file may not flush. Use with-blocks.

=== WHAT THE BREAKDOWN SAYS (nothing is actionable yet) ===
BY BOOK  PICK6 27/54 50% | UNDERDOG 24/43 56% | BETR 9/22 41% | DK 9/14 64% |
         PRIZEPICKS 7/11 64%
BY STAT  FP 28/55 51% | SS 23/44 52% | R1 SS 15/22 68% | TD 4/11 36% |
         CTRL 3/7 43% | KD 2/4 50% | FT 1/1 100%
NOT ONE separates from the 53% overall at 1.5 SE. Watch R1 SS (best cell, 1.4 SE,
nearly there) and note Pick6 carries 54 of 144 legs at exactly 50% - largest
exposure on the weakest non-thin book. Do NOT act on Betr 41%; it is the cell
most likely to tempt a change and has the least support.
CONCENTRATION: 7 legs on ONE fight on the Nurmagomedov card (16% of it).

=== REMAINING LEDGER IDEAS (none started, none required) ===
- Per-event P/L was DELIBERATELY SKIPPED at rung 4: these are pick-em legs, not
  independently priced, so 1u-per-leg P/L is hits-minus-misses restated. It would
  need stake entry, which changes how legs are RECORDED, not just displayed.
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
