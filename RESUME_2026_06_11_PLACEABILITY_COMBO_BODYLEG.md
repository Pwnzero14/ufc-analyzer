# Resume — FP-Under Placeability, PrizePicks Combo Fix, Body/Leg Strikes (phase 1+2)

**Branch:** `feature/sleek-theme-v1` (== `master` == `efb5fc7`, both pushed to origin `Pwnzero14/ufc-analyzer`). All `dist/` committed.
**Date:** 2026-06-11 (Thursday, late session — follows `RESUME_2026_06_11_FETCH_AND_PICKS_FIXES.md`)
**Working tree:** clean except untracked stray `UsersabdirAppData…Opera…/` dir (ignore) and `.claude/settings.local.json`.

---

## TL;DR

Four things shipped, all verified live and pushed to both branches:
1. **FP-under placeability fix** — Pereira's unplaceable Pick6 FP-under removed; added an authoritative `fp_under_available` (Pick6 "Less" button) gate.
2. **Corrected platform rules** (per user + the UD/PP apps): Underdog DOES offer dog FP-unders; PrizePicks/Betr offer SS both sides to all.
3. **PrizePicks `(Combo)` SS fix** — combo line was clobbering individual SS (Bo Nickal 49.5 vs real 28.5).
4. **NEW PROPS: Significant Body & Leg Strikes** (Underdog + PrizePicks) — phase 1 (display lines) + phase 2 (per-fight history-vs-line charts). Verified populated and looking like every other prop.

---

## Commits this session (oldest → newest, all on master + feature)

- `11fdf8f` — **fix(picks): correct FP/SS under placeability per platform.** New `fp_under_available` flag (Pick6 Less-button) captured at scrape (content.ts + ScraperService), merged (background allowlist), gated in `isCandidateUsable`. `PICKEM_UNDER_FORBIDDEN_PLATFORMS` corrected to `{pick6, prizepicks, betr}` (Underdog REMOVED — it offers dog FP-unders; PP ADDED). `ssUnderBookOffered`: PP/Betr now both-sides-for-all. `shouldSkipFpSideForFighter` takes a `platformOverride` so each per-book FP candidate is judged on its own book.
- `2b84244` — **fix(prizepicks): skip "(Combo)" props.** `"Significant Strikes (Combo)"` (= sum of both fighters) matched `'significant strike'` and overwrote the individual SS line. Guard added in PrizePicks parser + both Underdog parsers ([[project_prizepicks_combo_props]]).
- `2eb605f` — **chore(snippets):** added `snippets/2026-06-11_targeted_prune.js` (export-first quota prune) + persisted the 06-09 audit/backup-prune snippets.
- `0fcbfab` — **feat(props): capture + display Body/Leg (phase 1).** Scrapers classify `line_ss_body`/`line_ss_leg` (UD + PP), plumbed through types/merge/analyzer.
- `25bff68` — **feat(props): Body/Leg as LINES-strip cells** (next to R1 SS) instead of a wrapping tile — visible/consistent with other per-book cells.
- `efb5fc7` — **feat(props): Body/Leg history-vs-line charts (phase 2).** `parseFightDetailStats` reads the UFCStats Head/Body/Leg breakdown table → `sigStrBody`/`sigStrLeg` per fight; threaded through history types + `buildFighterDB` + `HistoryRow`; **cache bumped v49→v50**; drilldown renders `Body/Leg Sig Strikes History vs Line` panels (mirror R1 SS).

---

## ⚠️ Platform rules now ENCODED (corrected — don't re-derive; see [[project_pickem_platform_rules]])

- **FP UNDER (dogs):** placeable ONLY on **Underdog**. Pick6/PrizePicks/Betr give underdogs a More/OVER-only FP prop. Pick6 now has the authoritative `fp_under_available` Less-button flag; null → moneyline fallback. (Confirmed against the UD app: every UD Fantasy Points card has both Higher AND Lower for ALL fighters.)
- **SS UNDER:** **PrizePicks + Betr = both sides for EVERY fighter.** **Pick6** = favorites-only. **Underdog** = dogs-only. **DK** = both. (`ssUnderBookOffered`.)
- **PrizePicks `(Combo)` props** = both fighters' totals summed; never an individual line. Skipped before classification. Diagnostic: a line ≈ 2× and ≈ sum of both fighters = a combo leak.

---

## NEW: Significant Body / Leg Strikes (Underdog + PrizePicks)

**Status: phase 1 + phase 2 COMPLETE and verified.** Display-only / history-only — **NOT yet projection/lean/Best-Picks eligible** (that's the natural phase 3).

**Data flow (mirrors `ss_r1`, the existing UD+PP-only prop — use it as the template for any extension):**
- Scrape: `line_ss_body`/`line_ss_leg` classified in [src/injected.ts](src/injected.ts) (UD page-context), `parseUnderdogApiFighters` + `parsePrizePicksApiFighters` ([src/background.ts](src/background.ts)). Body/Leg checked BEFORE the generic SS branch.
- Plumb: [src/types/index.ts](src/types/index.ts) `Fighter` + `FightResult`; background `mergeFighters` allowlist; analyzer `RawLineFighter`, `MergedLineEntry` (`line_{ud,pp}_ss_{body,leg}`), `createMergedLineEntry`/placeholder defaults, `mergeAndEnrich` UD+PP assignment, `AnalyzerFighter` type, `HistoryRow` type.
- Per-fight history: `parseFightDetailStats` ([src/analyzer/parsers.ts](src/analyzer/parsers.ts)) reads the **Head/Body/Leg breakdown table** (cols: Sig.str, Sig%, Head, **Body=4, Leg=5**, …) → `sigStrBody`/`sigStrLeg`; `buildFighterDB` copies them into `FightResult`.
- **Cache: `ufcstats_v50_` (was v49).** A fresh fetch re-fetches all histories to populate body/leg. Old `ufcstats_v49_*` keys are now orphaned — prune snippet `CURRENT_UFCSTATS_VERSION` should be bumped to 50 to reclaim them.
- UI: LINES-strip cells (`UD Body`/`UD Leg`/`PP Body`/`PP Leg`) + drilldown `Body/Leg Sig Strikes History vs Line` panels via `buildHistoryBars(fights, h => h.sigStrBody|sigStrLeg, line, …, 'ss')`.

**Deliberately NOT done (future):**
- ⭐ **Opponent-scored body/leg panels — TOP NEXT-SESSION ITEM (user-requested).** Currently the SELF `Body/Leg Sig Strikes History` panels exist, but the matching `⚔️ Opp Body/Leg Scored vs <fighter>` panels do NOT (the self-only screenshots show the gap). To add (mirror how `oppSSR1History` works):
  1. **Parser:** add body/leg to `parseFightDetailStatsOpponent` ([src/analyzer/parsers.ts](src/analyzer/parsers.ts) ~184) — same Head/Body/Leg table, take the OTHER fighter's column (`fIdx` flipped).
  2. **Types:** add `sigStrBody`/`sigStrLeg` to `OppStats` (parsers.ts) and `OppFightResult` ([src/types/index.ts](src/types/index.ts) ~118).
  3. **Build:** thread them where `db.oppHistory` is built (the opp-history mapping in [src/analyzer.ts](src/analyzer.ts), near the `oppStats`/`sigStrR1: os.sigStrR1 ?? null` block ~lines 970-980).
  4. **Cache:** bump `ufcstats_v50_` → `v51` (opp parse changes the cached shape) so histories re-fetch.
  5. **Charts:** add `oppBodyHistory`/`oppLegHistory` via `buildHistoryBars(oppFights, h => h.sigStrBody|sigStrLeg, oppBodyLine, …, 'ss')` (oppBodyLine = `oppEntry?.line_ud_ss_body ?? oppEntry?.line_pp_ss_body`), and render `⚔️ Opp Body/Leg Scored vs ${f.name}` panels next to the self Body/Leg panels (the stat-pair added at ~14328).
- Projection/lean (`calcSSBodyLean` etc.) + Best-Picks eligibility — later phase.

---

## Health / current state

- All 4 platforms fetch live; storage recovered to ~5.8/10 MB this session (was 10.0 full → quota storm). Prune tooling in `snippets/`.
- Body/leg charts verified populated for the Freedom 250 card (Topuria, Gane, Pereira, Gaethje, etc.).
- ⚠️ **v49→v50 cache bump orphans old keys** — storage may climb on the rebuild; prune v49 if quota tightens.

## Open / next-cadence

1. ⭐ **Opponent body/leg stat panels (user-requested top item)** — add `⚔️ Opp Body/Leg Scored vs <fighter>` charts to match the self panels. Full 5-step plan above ("Deliberately NOT done").
2. **Body/Leg phase 3** (later): projection + lean + Best-Picks eligibility.
3. **UFC Freedom 250 settle after Sat Jun 14** — unresolved props; settle + verify counter → 0.
4. Carried, non-blocking: FIX B ghost-archive ([src/background.ts](src/background.ts)), Betr auto-clear.

## Standing workflow rule

`dist/` is TRACKED + SHIPPED. After ANY `src/` change: `npm run build` → `git add dist` → commit with src → push BOTH branches. Remote/identity + recovery: [[project_repo_git_recovery]].
