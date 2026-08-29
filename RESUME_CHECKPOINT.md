# Resume Checkpoint

Last Saved: 2026-08-29 15:14:02 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: 346651e

## Last Notes
SESSION HANDOFF (2026-08-29, ~15:15). All committed and pushed to master + feature/sleek-theme-v1 (master is cherry-picked, different SHAs); dist committed with every src change; tree clean. MODEL_VERSION 34.

IN PROGRESS RIGHT NOW: AUDITING THE ARCHIVE SECTION
The user found the hit-rate counting bug themselves and wants the rest of the Archive audited for the same class of error. Remaining to audit: PLATFORM BIAS, CALIBRATION CURVE, PROP ARCHIVE GRADING. Things already spotted, NOT yet investigated:
- PROP ARCHIVE GRADING has an "UNKNOWN" platform bucket: UNKNOWN FP 14% n=21 avg edge +49.4, and in worst-combos "UNKNOWN B 0% 0/9", "UNKNOWN C 27% 3/11". A +49.4 average edge is not plausible - find out what those rows are.
- CALIBRATION says 88/100 "Excellent" but the mid buckets are consistently OVERCONFIDENT: 60-64% -9, 65-69% -5, 70-74% -10, 75-79% -11. Those four buckets hold n=611 of 1082 picks - the bulk of the sample. Check whether the 88 score is weighting thin high-confidence buckets (80-84% n=66 at 0, 90%+ n=9 at +8) over the mass.
- Count mismatch: CALIBRATION says "1082 picks resolved across 34 events", PROP ARCHIVE GRADING says "1182 graded AI picks". Reconcile.
- PLATFORM BIAS is row-based (UD 706/1698, Pick6 622/1687, Betr 20/74). Arguably CORRECT since each book's line is genuinely its own observation - but it still carries the duplicate-event-name double count. Decide deliberately rather than by default.
- Thin samples shown without shrinkage: DK TD 100% (n=4), Pick6 TD 100% (n=2).

TODAY'S CARD SETTLED (Nurmagomedov vs. Song) AND THE OPEN MODEL QUESTION IS CLOSED
v30's -11 FP fair-line shift STANDS - no change. Measured on the population the model actually learns from (propType 'Fantasy' only, FANTASY_SCORING_BOOKS only, settled on/after the 2026-08-16 scorer fix): n=93, empirical -9.16 (SE 4.44), prior -11 (K=80), SHIFT IN USE -10.01, data weight 54%. That is 0.4 sigma from the prior - no evidence to move it, and it self-corrects as samples accrue.
*** TRAP: a naive mean(result-line) over the WHOLE archive gives -14.60 (n=877, -11.75 sigma, 0 positive of 27 event clusters) and looks like damning proof the -11 under-corrects by 5 points. It is an artifact - ~90% of those rows predate the scorer fix. computeMarketFpShift filters propType + book set + SCORER_FIX_TS; any hand-rolled bias query MUST apply all three. ***
Also confirmed: PrizePicks needs NO shift (bias -1.36, SE 3.36, statistically zero) while pick6 -16.47 / underdog -14.20 / betr -17.20. The model already excludes PP correctly.

SHIPPED THIS SESSION
- 5494278 + 624499a + 8921d0b fix(settle): a placed leg whose book PULLED THE LINE before archiving could never grade. THREE stacked layers, each invisible from the one above, each reporting success: (1) applyResult only UPDATES rows, so a computed SS_R1=16 was discarded; (2) settle is driven off the unresolved set and hard-returns when it is empty, so the new code was unreachable on a settled card - forceEventName now survives that and pulls event names from the archive; (3) the writer re-reads a FRESH archive and re-applies resolvedKeys (a deliberate race guard) which only UPDATES existing rows, so created rows died at the storage boundary - they are now appended inside the same locked write. Verified: 39,882 -> 40,031 records, "added 149 result-only row(s) at write time", Xiong Jingnan UNDER 25.5 R1 SS flipped to HIT, ledger 9/41 -> 9/42.
  REPAIR A PAST CARD: chrome.runtime.sendMessage({type:'GRADE_ARCHIVE', forceEventName:'<substring>', allEvents:true}, r=>console.log(r))
- 73bad81 + 346651e fix(hit-rate): leaderboards counted archive ROWS and called them "events". Bilal Hasan's UFC DEBUT showed "9 events · 9/9". Inflation SS 4.67x / TD 2.31x / FP 1.80x. Worse, sorting on that count ranked fighters by HOW MANY BOOKS COVERED THEM. Now one entry per fighter per FIGHT, keyed fighter+DATE (immune to duplicate event names), outcome decided against the books' MEDIAN line. 346651e caught my own miss: TD read 195/281 - old row-based numerator over new per-fight denominator.
- 8a02d5b + 897b230 MODEL v33: FP picks surface the BEST-PRICED book across pick6/underdog/betr (shared FANTASY_SCORING). PRIZEPICKS EXCLUDED (different formula) - do not fold it in. TRAP: filter usability BEFORE comparing prices or a dog's FP UNDER (Underdog-only) gets dropped for a better-priced unplaceable line.
- 75d5971 + 658e340 + 21e0f2a MODEL v34: BETR IS NOW AUTO-FETCHED (was hand-typed). https://api.fantasy.betr.app/graphql, no auth. UFC events are TeamVersusEvent -> teams -> players (NOT IndividualVersusEvent - wrong shape returns empty with NO error). ASK ONLY FOR FIELDS YOU READ - non-null nulls bubble and kill the whole response. Origin+Referer required. allowedOptions gives side availability per prop: SS/FP/FT are MORE+LESS, TAKEDOWNS are MORE-ONLY on every prop (which refuted tdUnderBookOffered's blanket true for betr). Boosted props price on nonRegularValue, not value. Manual store is the OUTAGE FALLBACK only - it was overlaying stale rows on the live board (26 fetched rendered as 38). CREDIT: the user's DFS notifier at C:\Users\abdir\OneDrive\Desktop\projectX\src\adapters\betr.js supplied the shape, headers and the ask-only-what-you-read rule. READ IT FIRST if Betr breaks.
- 60a9794 + f023700 snapshot fixes: best_picks_snapshots_v1 logged picks the board never showed - first the LEAN, then the LINE and BOOK. Snapshots written before f023700 cannot be trusted for source/direction/line/book.
- 6e9d9d6 + 8107600 ARCHIVE toast repeat; 5cdde96 parlay dedupe now keys on book+line.

NEXT CARD: UFC Fight Night: Hooker vs. Parnasse, 28 fighters, predictions generated on MODEL v34. Salahdine Parnasse shows NO HISTORY on a 5R main event. MICHAEL PAGE is on this card vs Nursulton Ruziboev and the model has Ruziboev at 13.5 SS - that is the user's recorded MVP-opponents-go-SS-UNDER edge agreeing, not an outlier to fade. Audit when TD + R1 SS + CTRL + FP are ALL posted (typically Friday).

HOUSE RULES
- Rebuild + commit dist with EVERY src change; cherry-pick to master and push BOTH branches. `git cherry-pick -q` is NOT a valid flag.
- Bump MODEL_VERSION for lean scoring / tiering / correlation / EV / candidate selection. NOT for logging or reporting fixes.
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write, with a before/after count.
- VERIFY AGAINST THE BOARD, not a derived store or hand-rolled name matching. Ad-hoc dumps without NAME_ALIASES invent phantom gaps - four false findings this week.
- When changing a measurement, change EVERY path that reads it in the same commit (346651e was exactly this miss).
- When a fix "should already work", check WHICH CODE PATH IS LIVE before assuming the logic is wrong.

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
