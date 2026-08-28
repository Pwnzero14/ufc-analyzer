# Resume Checkpoint

Last Saved: 2026-08-28 12:52:59 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 897b230

## Last Notes
SESSION HANDOFF (2026-08-28, ~13:00). All committed and pushed to master + feature/sleek-theme-v1 (master is cherry-picked, different SHAs); dist committed with every src change; tree clean. MODEL_VERSION is now 33.

NEXT SESSION: RE-RUN THE BEST PICKS AUDIT WHEN PRIZEPICKS FANTASY LANDS
The full audit ran 2026-08-28 on everything except PP fantasy. Re-run when PP FP posts. PP will add a fourth FP book but on its OWN scoring axis (PRIZEPICKS_SCORING), so it will NOT compete for best line against pick6/underdog/betr. User initiates; trigger is prop completeness, not the calendar.

SHIPPED THIS SESSION
- 6e9d9d6 + 8107600 fix(ui): ARCHIVE click replayed the "Loaded N fighters" toast 2-3x. TWO defects: showToast queued a hide timeout without clearing the pending one (overlapping toasts hid at the FIRST timer, then got re-shown = the flicker), and there was no repeat suppression. First attempt used a 10s suppression window that SLID on every call, which swallowed the message entirely — worse than the bug. Window is now DATA_RELOAD_MIN_GAP_MS * 2 (2.4s): covers a reload burst, nothing longer.
- 5cdde96 fix(parlay): PLACE PARLAY refused a second slip as "ALREADY PLACED". Dedupe signature was fighter|stat|dir sorted+joined — no book, no line — so the same sides on Betr (99.5/96.5) and Pick6 (95.5/90.5) collapsed to one signature. Leg COUNT was the only separator, which is why that pair plus a third leg saved fine. Signature now fighter|stat|dir|book|line. NOTE: this makes the old note in project_manual_placed_leg_entry STALE — any hand-written dedupe check must include book and line.
- 60a9794 fix(snapshot): best_picks_snapshots_v1 logged picks the board never showed. The board builds columns with getBestPickLeanForDir(f, dir); persistBestPicksSnapshot re-derived with getEffectiveLean(f), which is direction-agnostic. Wrong in direction, stat AND line at once — the board rendered FT/SS/R1 SS/FP but the snapshot logged all 16 as FP, three with a verdict contradicting their own column. That is the data the learning engine grades accuracy against. Snapshots written BEFORE this commit cannot be trusted for source/direction.
- 8a02d5b feat(picks) MODEL v33: FP picks now surface the best-priced book. FP builds one candidate per book and sortCandidates ranks on confidence alone, so a worse-priced book could win — Rei Tsuruya showed OVER Betr 99.5 while UD had 88.99, rendering "PROJ SAYS UNDER 18.7" because the shared projection 92.6 sat BELOW the shown line. pick6/underdog/betr share FANTASY_SCORING so their projections are identical and lines comparable; a worse-priced same-direction sibling is now dropped. PRIZEPICKS EXCLUDED ON PURPOSE (different scoring formula).
- 897b230 fix(picks): the v33 prune ran BEFORE isCandidateUsable, so it could keep a better-priced UNPLACEABLE line and drop the placeable one — a dog's FP UNDER is placeable on Underdog alone, so Pick6 holding the higher under line would have killed the pick entirely. Usability now filtered FIRST, then prices compared.

AUDIT RESULT (2026-08-28, 16 picks, MODEL v32 board)
Standing flags after the line fixes:
1. Umar SS UNDER 82.5 — WIN 49%, EV -8%. Below coin-flip. Already on DK 82.5, the highest line, so nothing left to improve.
2. Andre Lima FP UNDER 86.99 — 50% / -5%, and now carries a NEW "⚠ MISS" (weight miss, detected 08-28). The miss argues FOR the under, but it is the same premise as Batbayar R1 SS OVER 15.5 in the same fight — two picks, one assumption.
3. Julia Polastri FT OVER 14.99 — 58% / -3%, needs a full 3 rounds vs a 13.9m average.
4. Rei Tsuruya FP OVER — improved to UD 88.99 (contradiction shrank 18.7 -> 8.2) but still 50% / -5%, and the board's own "⇅ 1 MORE CONFIDENT" says Kevin Borjas SS 71% was cut for him.
CLEAN: placeability (no dog FP UNDER on a blocked book, NO dog FP OVER exists), duration coupling (Asakura 6.2m career = finish-driven, and the pick is the UNDER = coherent side), FT exclusivity, scheduled rounds (Umar 5R MAIN, rest 3R), best-shop badges.
STRUCTURAL: "⚠ 10 shared fights" across 43 placed legs.

FOUR OF MY OWN AUDIT FINDINGS WERE FALSE — READ THIS BEFORE TRUSTING A DUMP
I audited the snapshot and ad-hoc storage dumps instead of the board, and manufactured four findings that did not exist: "all 16 picks are FP" (board actually ran FT/SS/R1 SS/FP), "Batbayar is a dog FP OVER" (it is an R1 SS OVER; no dog FP OVER exists), "Su Mudaerji has no moneyline", and "his rounds are unknown". Causes: the snapshot bug above, and hand-rolled name matching WITHOUT NAME_ALIASES. A diagnostic snippet that lowercases and compares to raw storage keys invents phantom gaps every time. The app's own confidence memory tags are the cheap cross-check — moneyline:favorite is only emitted for a finite moneyline, rounds:3/5 only when the card resolved.

OPEN MODEL QUESTION - UNCHANGED
Hernandez vs. Rodrigues settled FP bias +8.3 at exactly 1.00 SE from zero = noise, so v30's -11 fair-line shift and v31's +/-15 cap were BOTH LEFT UNCHANGED. First positive against twelve negative event-clusters. IF NURMAGOMEDOV VS SONG ALSO SETTLES POSITIVE, that is two in a row and the -11 shift needs re-measuring against recent clusters. Settles 2026-08-29 (fights 3:20-7:40 AM EDT Saturday).

CURRENT BOARD: Nurmagomedov vs. Song, 26 fighters, 114 lines, 16 Best Picks. Posted: FP, SS, R1 SS, TD, CTRL, FT across Pick6/Underdog/Betr/DK. MISSING: PrizePicks fantasy only. MY SLATE 43 legs all placed (P6 21, UD 8, PP 4, BTR 6, DK 4).

STILL OPEN
- Best Picks levels 327-330; six passes already, returns thin.
- Untouched surfaces: AI Accuracy, Grading, Platform Bias, Calibration, Backtest, fighter-card detail panels.
- GLOW-UP 343 limit: a card TWO events out with lines posted still slips past the AWAITING SETTLEMENT guard (archive rows store CAPTURE date, not fight date). Needs an event date on the record.

HOUSE RULES
- Rebuild + commit dist with EVERY src change; cherry-pick to master and push BOTH branches. `git cherry-pick -q` is NOT a valid flag.
- Bump MODEL_VERSION on any change to lean scoring, tiering, correlation passes or EV math. Do NOT bump for a logging/recording fix (60a9794 correctly did not).
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write, with a before/after count.
- Lines in storage on EVERY book but missing from the row = a merge gate, not the scraper.
- When a fix "should already work", check WHICH CODE PATH is live before assuming the logic is wrong.
- Verify against the BOARD, not against a derived store or a hand-rolled name match.

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
