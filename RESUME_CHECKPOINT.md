# Resume Checkpoint

Last Saved: 2026-08-25 03:27:39 -04:00
Repository: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
HEAD: da8f644

## Last Notes
SESSION HANDOFF (2026-08-25, ~03:30). All work committed and pushed to master + feature/sleek-theme-v1 (master is cherry-picked, different SHAs); dist/ committed with every src change; tree clean.

SHIPPED THIS SESSION
- 15c8fc5 fix(underdog): line removals now propagate. reconcileRemovals extended to the UD path (UD is single-shot per endpoint and its parser drops status!=active, so absence is genuine). THREE things the PP fix did not have: (1) UD keeps per-side state beside the line (ud_<stat>_over/under_avail + <stat>_over/under_odds) so companion fields are now a LIST and go with their line - a stale avail flag is what keeps a dead line tappable in Best Picks; (2) both platforms poll TWO endpoints per pass and PP reconciled INSIDE that loop, so a subset payload from endpoint 2 could clear what endpoint 1 confirmed - both now accumulate the pass and reconcile ONCE against its union, folded non-null-wins; (3) nulling a fighter's last line left an empty record still counting toward the line badge - pruned after. pick6 + draftkings_sportsbook are scraped in pieces and MUST keep merge-don't-clear.
- 98d84f0 fix(names): reversed Chinese names split a fighter into a ghost row. Yan Xiaonan appeared twice (real row with Pick6 52.5, ghost with UD 52.5 + FT 12.5); Liu Ce had the same split vs UD "CE Liu". Together they were exactly the slate check "UD missing 2". Added NAME_ALIASES 'Xiaonan Yan' + 'Ce Liu' (the alias is what collapses the storage KEY and repairs the opponent strings the stale-opponent guard reads) AND gave namesMatch the exact two-token reversal rule that background.ts strictCardNameMatch has had since Cong Wang. Verified no collision on this card or across the alias table.
- da8f644 fix(names): a one-name fighter had every line thrown away. Aoriqileng read "No visible source lines" while BOTH books had him at SS 33.5 in storage. isValidFighterName validates the NORMALIZED name and required 2+ words, so his aliases ("Qileng Aori" UD, "Aori Aoriqileng" P6) resolved onto the mononym "Aoriqileng" and the validator rejected the alias own output. Sumudaerji escaped only because his alias points at the two-word "Su Mudaerji". Mononyms now admitted when isUpcomingCardFighter(norm); falls back to the old rejection with no card loaded. Future mononyms (Rongzhu, Shayilan) need no code change.

VERIFIED ON THE BOARD: 26 fighters (ghost gone), Yan Xiaonan has P6 52.5 / UD 52.5 / UD FT 12.5, Liu Ce has UD 18.5 / UD FT 7.5, Aoriqileng has P6 33.5 / UD 33.5 and now generates a lean (LEAN OVER 9 -> 10). Invariant snippet passed on BOTH platforms: no empty shells, no orphaned avail flags/odds.

ALSO DONE: recorded the placed Underdog Champions slip manually (2-leg, $15 -> 3.5x, entered 08/23 8:55 PM) at ENTRY lines - Su Mudaerji OVER 37.5 SS and Song Yadong OVER 55.5 SS, book-suffixed keys beside the existing Pick6 legs. Both ledgers render it.

NEXT UP - CROSS-PROMOTION CONTAMINATION (the one I would start with)
Both UD and PP pull ~12 non-UFC fighters into the "UFC" slate: Alex Apodaca, Bella Mir, Guilherme Uriel, Mario Piazzon, Gary Balleto Jr, Sean Clancy Jr, Alexis Miranda, Ronald Humphrey, Nick Galanti, Carlos Petruzzella. PP ENTIRE 10-record store is those names, which is what "PP none posted" actually means. Cause: both parsers keep any sport tag matching /ufc|mma/, not UFC specifically. This is what stamps unsettleable stragglers into the archive. Fix is a tighter sport filter at parse time in background.ts. NOTE: "CE Liu" and "Hector de Sousa Santiago" look off-card but are REAL card fighters - do not filter them.

OPEN MODEL QUESTION - UNCHANGED
Hernandez vs. Rodrigues settled with FP bias +8.3 at exactly 1.00 SE from zero = noise, so v30 -11 fair-line shift and v31 +/-15 cap were BOTH LEFT UNCHANGED. First positive against twelve negative event-clusters. IF THE NEXT SETTLED CARD IS ALSO POSITIVE, that is two in a row and the -11 shift needs re-measuring against recent clusters. Nurmagomedov vs. Song settles 2026-08-29.

CURRENT BOARD: Nurmagomedov vs. Song (Aug 29), 26 fighters, 50 lines. SS + FT posted on UD/P6; NO FANTASY (FP) LINES yet on any book, so FP columns read em-dash. Regenerate once FP lines land. Slate check still shows P6 missing 14, 2 warnings.

STILL OPEN / DELIBERATELY NOT DONE
- Best Picks levels 327-330; that surface has had six passes and returns thin.
- Untouched surfaces if more UI work is wanted: AI Accuracy, Grading, Platform Bias, Calibration, Backtest, fighter-card detail panels. Audit first, report what is actually wrong, then touch.
- GLOW-UP 343 known limit: a card TWO events out with lines posted still slips past the AWAITING SETTLEMENT guard, because archive records store the CAPTURE date not the fight date. Needs an event date on the record (data change).

HOUSE RULES THAT MATTERED TONIGHT
- Rebuild + commit dist with EVERY src change; cherry-pick to master and push BOTH branches.
- npm run build runs scripts/guard-invariants.js first (fails on four known regressions).
- Read-only diagnosis BEFORE any storage-mutating snippet, then backup, then write. Print a before/after count so a silent no-op is visible.
- Lines present in storage on EVERY book but missing from the row = a merge gate, not the scraper. Walk isValidFighterName / isStaleLineRow before suspecting the fetch.
- Placed legs entered at a stale line must be hand-written; the PLACED button stamps today number and destroys the CLV measurement.

## Resume Checklist
1. Run npm run build.
2. Check git status.
3. Continue the highest-priority task from your notes.

## Working Tree Status
~~~text
 M RESUME_CHECKPOINT.md
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
