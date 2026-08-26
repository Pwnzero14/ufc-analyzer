# Resume Checkpoint

Last Saved: 2026-08-26 13:23:50 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 06852fc

## Last Notes
SESSION HANDOFF (2026-08-26, ~13:30). All committed and pushed to master + feature/sleek-theme-v1 (master is cherry-picked, different SHAs); dist committed with every src change; tree clean.

NEXT SESSION: THE BEST PICKS AUDIT, TRIGGERED BY PROP COMPLETENESS
The user will say when. Trigger is TD + R1 SS + CTRL + FP all actually posted (typically Friday, even though this card runs 3:20-7:40 AM EDT Saturday - do NOT reason from the card time that props land earlier; the user confirmed the books still wait). Mid-week is for infrastructure work, not pick audits. First item when it runs: Su Mudaerji SS - Betr 44.5 vs UD 41.5 vs Pick6 41.5. A single book 3 points high is the cross-book outlier guard's shape, and the user HOLDS him at 37.5 from an Underdog slip, so whether 44.5 is real changes how that entry looks. See feedback_audit_timing_full_props_friday memory.

SHIPPED THIS SESSION
- 06852fc fix(prizepicks): the removal fix was live on a code path that 403s. reconcileRemovals sat in fetchPrizePicksFromBackground, which DataDome 403s from the service worker (verified by running its exact fetch in the SW console). PP lines actually arrive via the MAIN-world executeScript path (background.ts ~4023) which calls handleLinesCaptured - which merged and never reconciled. So the 08-21 PP removal fix was DEAD FROM DAY ONE. Now handleLinesCaptured reconciles when the caller passes fullBoard:true, and only the MAIN-world PP capture sets it (opt-in, NOT by platform name - the PP DOM crawl also sends platform=prizepicks and may be partial). Second bug same trace: a pass that parsed NOTHING still rewrote the store, re-stamping capturedAt and re-running archivePlatformPropLines - that is why PP read "4m old" while holding the previous day's DWCS card. Both UD and PP writes now require freshThisPass.length.

DIAGNOSTIC FINDINGS WORTH KEEPING
- THE CROSS-PROMOTION / SPORT-FILTER THEORY WAS WRONG. Underdog's league tag is a generic "MMA" for every promotion; there is NO promotion field on the player or appearance object. A tighter filter is not constructible from that payload. UD's contamination was already gone anyway (reconcile swept 36 -> 26 records). Untested lead if it recurs: the v1 payload's top-level games / solo_games.
- UD v2 endpoint returns 400, v1 returns 200 - the background has been running on the v1 fallback. That is why the multi-endpoint union reconcile mattered.
- THE ARCHIVE WAS ALREADY CLEAN - I claimed the re-archive bug was "the engine behind the unsettleable stragglers" and that is DISPROVEN. Full prop_archive_v1 dump (39,391 rows, no event filter): the ONLY event with unresolved rows is the upcoming card itself, and the DWCS fighters appear exclusively under DWCS event names (10.3 / 9.2 / 7.8), all SETTLED. Nothing to clean up.
- Auto-backup writes a FILE to downloads, not a storage key. prop_archive_backup* returning 0 keys is EXPECTED; check the [UFC Auto-Backup] log line instead.
- DWCS history STAYS. User asked whether it is worth keeping: yes - DWCS is the UFC audition circuit, those fighters graduate onto UFC cards, and without it a debutant is a NO HISTORY row. Consistent with the WEC / Strikeforce / Road to UFC / TUF data already in the archive. Known caveat (modelling note, not a reason to delete): competition level is not adjusted for, so a DWCS graduate's SS volume prior will skew high on debut; duration/pace transfer better than raw volume.

DATA ACTIONS TAKEN
- Betr manual entry: 17 SS lines for this card via the lines_betr_manual_v1 + lines_betr path. Baseline check PASSED on the exact danger configuration (betr_event_date unset, both Betr stores empty, both baseline tags forBetrEventDate=""): tags MIGRATED to "2026-08-29", line_history_v1 held at 42 keys, lines_open_v1 grew 53 -> 78, LINE MOVERS repopulated (20 movers). af32041/12c7adf proven in the wild. NOTE: lines_betr reading 0 afterwards is EXPECTED (initializeBetrLines clears it as the legacy seed and re-hydrates store.betr from manual_v1) - confirm against the BOARD, not that key.
- Cleared 10 stale DWCS rows from lines_prizepicks (yesterday's card). Key removed entirely; PP has posted nothing for this event.
- 9 Betr rows have no line at all (Umar Nurmagomedov, Song Yadong, Yan Xiaonan, Aoriqileng, Kai Asakura, Lawrence Lui, Hector Santiago, Ding Meng, Cameron Nelson). Betr has not posted them - ACK the slate-check blocker rather than chasing them.

OPEN MODEL QUESTION - UNCHANGED
Hernandez vs. Rodrigues settled FP bias +8.3 at exactly 1.00 SE from zero = noise, so v30's -11 fair-line shift and v31's +/-15 cap were BOTH LEFT UNCHANGED. First positive against twelve negative event-clusters. IF NURMAGOMEDOV VS SONG ALSO SETTLES POSITIVE, that is two in a row and the -11 shift needs re-measuring against recent clusters. Settles 2026-08-29.

CURRENT BOARD: Nurmagomedov vs. Song (Aug 29, APAC card, fights 3:20-7:40 AM EDT Sat), 26 fighters, 75 lines. Posted: SS + FT on P6/UD/Betr. MISSING: TD, R1 SS, CTRL, FP on every book. PP has nothing. DK none posted. Regenerate MODEL once FP lands.

STILL OPEN
- Best Picks levels 327-330; six passes already, returns thin.
- Untouched surfaces: AI Accuracy, Grading, Platform Bias, Calibration, Backtest, fighter-card detail panels. Audit first, report what is actually wrong, then touch.
- GLOW-UP 343 limit: a card TWO events out with lines posted still slips past the AWAITING SETTLEMENT guard (archive rows store CAPTURE date, not fight date). Needs an event date on the record.

HOUSE RULES
- Rebuild + commit dist with EVERY src change; cherry-pick to master and push BOTH branches. Note: `git cherry-pick -q` is NOT a valid flag.
- npm run build runs scripts/guard-invariants.js first.
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write, and print a before/after count so a silent no-op is visible.
- Lines present in storage on EVERY book but missing from the row = a merge gate, not the scraper.
- When a fix "should already work", check WHICH CODE PATH is live before assuming the logic is wrong - the PP reconcile was correct code on a dead path for five days.

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
