# Resume Checkpoint

Last Saved: 2026-08-28 18:53:58 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: f023700

## Last Notes
SESSION HANDOFF (2026-08-28, ~19:00). All committed and pushed to master + feature/sleek-theme-v1 (master is cherry-picked, different SHAs); dist committed with every src change; tree clean. MODEL_VERSION is now 34.

*** THE CARD SETTLES OVERNIGHT — Nurmagomedov vs. Song, fights 3:20-7:40 AM EDT Sat 2026-08-29. ***

FIRST THING NEXT SESSION: THE FP-BIAS QUESTION RESOLVES
Hernandez vs. Rodrigues settled FP bias +8.3 at exactly 1.00 SE from zero = noise, so v30's -11 fair-line shift and v31's +/-15 cap were BOTH LEFT UNCHANGED. That was the first positive against twelve negative event-clusters. IF THIS CARD ALSO SETTLES POSITIVE, that is two in a row and the -11 shift needs re-measuring against recent clusters rather than the April-August set. The Learning Summary surfaces the bias directly — no console snippet needed.

BIGGEST CHANGE TODAY: BETR IS NOW AUTO-FETCHED (was hand-typed)
- 75d5971 feat(betr) MODEL v34. Betr had NO ingest code at all; every line came via lines_betr_manual_v1 console snippet. picks.betr.app exposes a public GraphQL board, so the manual path was a leftover, not a constraint.
- Endpoint https://api.fantasy.betr.app/graphql, NO AUTH. Query LeagueUpcomingEvents(league: UFC).
- *** UFC events are TeamVersusEvent -> teams -> players. NOT IndividualVersusEvent. *** Querying the wrong shape returns an empty list with NO error, which looks exactly like an auth wall — I lost half an hour to that.
- *** ASK ONLY FOR FIELDS WE READ. *** Betr declares much of its schema non-null, so ONE null record bubbles up and nulls the WHOLE response. Their board died for 3h on 2026-08-27 from a team with a null id.
- Origin + Referer headers required. `errors` alongside `data` is a PARTIAL board worth keeping; only null `data` is a failed poll. Betr 401s under heavy polling — one fetch per auto-fetch, never looped, no browser tab needed.
- Stat keys: FANTASY_POINTS / SIG_STRIKES / TAKEDOWNS / FIGHT_TIME -> line_betr / _ss / _td / _ft. DECISION_WIN + FINISHES exist but are not analyzer stats. BETR HAS NO R1 SS PROP.
- allowedOptions[].outcome gives side availability PER PROP. Verified across the whole board: SS/FP/FT carry MORE+LESS, TAKEDOWNS came back MORE-ONLY on every one — which refuted tdUnderBookOffered's blanket `return true` for betr. Now gated on a confirmed Less side.
- Boosted props are priced on nonRegularValue, NOT value (mirrors the app's own getPickInfo). Reading value there posts a line the book is not offering.
- CREDIT: the user's own DFS notifier at C:\Users\abdir\OneDrive\Desktop\projectX\src\adapters\betr.js has been polling this in production and its comments supplied the TeamVersusEvent shape, the headers, and the ask-only-what-you-read rule. READ IT FIRST if Betr ever breaks.
- 658e340 + 21e0f2a: manual is now the OUTAGE FALLBACK, not an overlay. applyBetrManualOverrides was merging 27h-old typed rows on top of the fresh board (26 fetched rows rendered as 38) and re-adding fighters Betr had taken down — removals-never-propagate through the back door, on the one book with no second source to contradict it. Manual applies ONLY when the fetch is empty. The payload also stamps whichever store supplied the rows, so a live board no longer reports a 27h age. initializeBetrLines no longer deletes lines_betr on startup (it used to treat that key as the legacy seed).

ALSO SHIPPED
- 8a02d5b + 897b230 MODEL v33: FP picks surface the BEST-PRICED book. pick6/underdog/betr share FANTASY_SCORING so their projections are identical and lines comparable; a worse-priced same-direction sibling is dominated and dropped. PRIZEPICKS EXCLUDED (different scoring formula) — do not fold it in. TRAP: usability must be filtered BEFORE comparing prices, or a dog's FP UNDER (placeable on Underdog alone) gets dropped in favour of a better-priced unplaceable Pick6 line.
- 60a9794 + f023700 snapshot fixes. best_picks_snapshots_v1 is what the learning engine grades against. It logged picks the board never showed: first the LEAN (getEffectiveLean is direction-agnostic; the board uses getBestPickLeanForDir), then the LINE and BOOK (getSourceActiveLine / formatSourcePlatformLabel likewise). Six of sixteen picks logged a line contradicting their own verdict. THREE surfaces of one bug. SNAPSHOTS WRITTEN BEFORE f023700 CANNOT BE TRUSTED for source, direction, line or book.
- 6e9d9d6 + 8107600 toast repeat on ARCHIVE click; 5cdde96 parlay dedupe now keys on book+line.

AUDIT RESULT (2026-08-28 evening, MODEL v34, 16 picks) — TWO DURATION CONFLICTS
1. Aoriqileng FT OVER 7.5 (49% / -6%, BTR ONLY, +360 dog) vs Kai Asakura SS UNDER 34.5 — SAME FIGHT. The over needs the fight past 7.5m; Asakura averages 6.2m and is finish-driven, so it bets against his likeliest outcome, and if it wins the extra rounds push Asakura toward the under's 32.0 projection. WORST PICK ON THE BOARD.
2. Umar FT OVER 24.99 (57% / +1%) vs Umar SS UNDER 82.5 (47% / -12%) — same fighter, both DUAL. The SS under already scaled his projection to 69.8 assuming ~19.8m; the FT over needs the full 25m, which breaks it. They cannot both cash.
Negative EV: Umar SS -12%, Aoriqileng FT -6%, Andre Lima FP -5% (board itself prints LEAN OK / VALUE X, and he now carries a weight-miss MISS flag), Julia Polastri FT -3%.
Rank inversion persists: Kevin Borjas SS 67% cut for Rei Tsuruya, who surfaces as CTRL OVER 3.5 at 59% with his own projection 3.1m BELOW the line, -850 chalk, Pick6-only, zero source bonus.
STRONGEST: Ding Meng UNDER 74%/+41%, Bilal Hasan FP OVER UD 95.99 73%/+39%, Yan Xiaonan UNDER 67%/+28%, Sean Woodson UNDER 66%/+26%, Su Mudaerji UNDER 65%/+24%.
CLEAN: placeability everywhere, rounds (Umar 5R MAIN, rest 3R), no dog FP OVER, best-line selection confirmed working (Lui->Betr 81.5, Hasan->UD 95.99, Asakura->DK 34.5, Umar->DK 82.5).

STILL OPEN
- PrizePicks FANTASY never posted for this card (PP has SS etc, no FP). Re-run the audit if it lands, though the card is hours away.
- Slate check's last blocker is "Betr 24/26 — enter 2 missing rows or ACK". The API confirms Betr genuinely has not posted them; ACK is the honest close.
- MY SLATE: 43 legs all placed, "10 shared fights" concentration warning.
- Best Picks levels 327-330; untouched surfaces AI Accuracy / Grading / Platform Bias / Calibration / Backtest.
- GLOW-UP 343 limit: a card TWO events out still slips past the AWAITING SETTLEMENT guard (archive rows store CAPTURE date, not fight date).

HOUSE RULES
- Rebuild + commit dist with EVERY src change; cherry-pick to master and push BOTH branches. `git cherry-pick -q` is NOT a valid flag.
- Bump MODEL_VERSION for changes to lean scoring, tiering, correlation, EV math or CANDIDATE SELECTION. Do NOT bump for a logging/recording fix (60a9794 and f023700 correctly did not).
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write, with a before/after count.
- VERIFY AGAINST THE BOARD, not a derived store or a hand-rolled name match. Four audit findings this week were false because an ad-hoc dump lacked NAME_ALIASES. The app's confidence memory tags are the cheap cross-check.
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
