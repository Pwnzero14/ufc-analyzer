# Resume — Fetch Recovery + Best Picks Placeability Marathon

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-06-11 (Thursday, evening session)
**HEAD:** `49650d0` — `master` == `feature/sleek-theme-v1` == `49650d0`, both pushed to origin (`Pwnzero14/ufc-analyzer`). All `dist/` committed.
**Working tree:** clean re: commits (only `.claude/settings.local.json` modified).

---

## TL;DR

Long debugging session triggered by "Underdog/DK not fetching." Root cause was **`chrome.storage.local` quota exhaustion** (writes rejected, fetches were fine). Fixed that + a stale Pick6 URL + a cascade of Best Picks placeability bugs. End state: all 4 platforms fetch live, storage self-heals, and Best Picks surfaces only **genuinely placeable** picks on the correct book per fighter. On the (over-heavy) UFC Freedom 250 card that's 7 overs / 5 unders — honest, not padded.

---

## What shipped this session (all pushed, in order)

- `c99f99f` — Pick6 SS/TD Less-availability gate + `plausibleTd()` TD sanitizer (kills "TD UNDER 59.5").
- `7b4917c` — **Self-healing storage** + **live Pick6 URL** + **UD resilience**:
  - `StorageService.chromeSet` auto-prunes old `*backup*` keys on a `kQuotaBytes` error and retries (`b86d51a` refined the family-matching to mirror `snippets/2026-06-09_backup_prune.js`). Never touches `prop_archive_v1` / `lines_*`.
  - Pick6 URL: `category/46?sport=UFC` was DEAD (redirected logged-out users to the World Cup homepage). Now `https://pick6.draftkings.com/?sport=UFC`.
  - Underdog: auto-fetch no longer pre-clears UD (failed write keeps last-good lines); UD API sends `credentials`.
- `dfb260c` — capture Pick6 `ss/td_under_available` on the `?sport=UFC` Secondary/Quaternary scrape paths.
- `b2c4e3a` — Pick6 **TD** unders suppressed unless a Less button is positively confirmed (suppress-by-default, like CTRL).
- `fd90d75` — Best Picks **backfill**: top sections toward 7 when the strict same-fight dedup leaves them sparse.
- `49650d0` — **Favorite-aware SS-under book selection** (the key fix): `bestSideLineForPick` + `isCandidateUsable` pick the right book per fighter's favorite/underdog status.

(Earlier same-day UI commits `39d0c66`→`c743eed` are covered in [RESUME_2026_06_11_UI_ARCHIVE_POLISH.md](RESUME_2026_06_11_UI_ARCHIVE_POLISH.md).)

---

## ⚠️ The platform placeability rules (now encoded — don't re-derive)

The real cause of "wrong/too-few unders" was the analyzer offering picks on books that don't sell that side for that fighter. Rules (see memory [[project_pickem_platform_rules]]):

- **FP unders:** underdogs have NO under side on Pick6 / Underdog / Betr (handled by `shouldSkipFpSideForFighter`). So `Derrick Lewis` (heavy underdog) FP-under correctly **does not appear** — verified live, his moneyline reads as underdog properly.
- **SS unders (favorite-dependent, asymmetric):** Pick6 / PrizePicks / Betr offer the SS UNDER **only to favorites**; **Underdog offers it only to underdogs**; **DK has both**. So a fighter's SS under is placeable on Pick6/PP/Betr if favorite, on UD if dog, on DK either way. `bestSideLineForPick` filters SS-under books via `isMoneylineUnderdog`.
- **TD unders:** Pick6 TD is suppressed unless a Less button is confirmed; but a TD under can still surface on the book that offers it (e.g. **Chandler's TD under shows on Underdog 1.5**, Bo Nickal's on PrizePicks 1.5).

**Net effect:** an over-heavy card legitimately has few placeable unders. **Do NOT force a fixed count** (e.g. "always 7") — that means padding with unbettable picks, which is the exact bug we removed.

---

## Live result on UFC Freedom 250 (this card)

- **Best Overs (7):** Gaethje SS (DK 36.5), Chandler SS (UD 18.5), Zahabi P6 FP 44.5, Hokit P6 FP 106.5 (🏪 UD 103.99), Gane SS (DK 50.5), Daukaus SS (DK 17.5), Ruffy SS (DK 27.5).
- **Best Unders (5):** Gane FP (P6 81.5), Lopes FP (P6 79.5), **Bo Nickal TD (PrizePicks 1.5)**, Ruffy FP (P6 102.5), **Chandler TD (Underdog 1.5)**. All placeable, correct books.

---

## Current state / health

- Pick6 (`/?sport=UFC`), DK Sportsbook, Underdog (API), PrizePicks (API) all fetching live.
- Storage self-heals on quota — no more manual `confirmPrune()` needed (manual snippets still in `snippets/` as backup).
- Data was ~111h old during the session (pre-fight-week); re-fetch closer to the card for fresh lines.

---

## Open / next-cadence

1. **Underdog FP-unders are only bettable on DK Sportsbook** (it has both sides), but DK isn't an FP source (`FP_BOOKS_FOR_BEST_PICKS` = pick6/ud/pp/betr; DK has no FP props anyway). So those dog-FP-unders stay excluded — a fuller under list would need a different mechanism. Optional, low priority.
2. **PrizePicks / Betr SS-under rule is ASSUMED same as Pick6** (favs-only) — unconfirmed by the user. Revisit if a PP/Betr SS under ever looks misplaced.
3. **UFC Freedom 250 settle after Sat Jun 14** — 20 unresolved props; settle, verify counter → 0.
4. Carried, non-blocking: FIX B ghost-archive ([src/background.ts](src/background.ts)), Betr auto-clear at [src/background.ts:1037](src/background.ts#L1037).

## Standing workflow rule

`dist/` is TRACKED and SHIPPED. After ANY `src/` change: `npm run build` → `git add dist` → commit with src → push BOTH branches. (This session commits `dist/analyzer.js` + map together.) Remote/identity + recovery: memory [[project_repo_git_recovery]].
