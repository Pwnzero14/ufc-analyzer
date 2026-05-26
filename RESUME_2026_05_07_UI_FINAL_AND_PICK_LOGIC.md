# Resume — UFC 328 prep + UI sleek-theme finalization + Best Picks logic, session of 2026-05-07

**Branch:** `feature/sleek-theme-v1` — clean (no uncommitted work). 11 commits this session, all pushed to origin.

**Snapshot:** `backups/full_project_snapshot_20260507_115720/` (directory; zip failed on timestamp edge case but the directory is the authoritative copy).

**UFC 328 status:** Pick6, UD, PP, DK lines loaded. **Betr SS lines manually entered for all 26 fighters** via console snippet (line baseline anchored). Betr FP lines pending — user will use the screenshot-reader editor when Pick6/UD FP lines drop. User's lean: **Khamzat FP-OVER 110.5**.

---

## What shipped this session

### UI sleek-theme v1 — backlog cleared

All 5 items from the prior session's backlog + 4 net-new items shipped, in order:

1. **`a0eaa9e`** — RESET LINES safety move into More dropdown + wordmark subtitle dropped (cleanup of round 3 from prior session).
2. **`0394889`** — Learning Diagnostics 4-card grid → horizontal strip with internal wrap (label+value row 1, meta row 2, drilldown gets a 3rd row for `· Based on N tagged samples`).
3. **`b5cf7d0`** — Sources row collapsed behind a count chip (`SOURCES 5/5 ▾`). 5 toggle buttons hidden in default state; chip turns gold when filtered. `sourceVisibility` doesn't persist, so the chip provides the only path to re-toggle after collapse.
4. **`6a46691`** — Density gear ⚙ gets a small gold corner dot when Compact View OR History: Readable is on. Tooltip shows which non-default mode(s) are active.
5. **`8a1f17c`** — Stale pill saturation ramp via `--stale-intensity` CSS var. 0 at threshold, 1.0 at threshold + 10h. Background alpha 12% → 32%, plus an inset border ring scaling 0% → 18%.
6. **`a419404`** — Fighter card header gets subtle vertical column guides between FIGHTER · LINES · AVG FP · LEAN, plus a stronger sticky shadow when scrolling.
7. **`8c195a8`** — Slate Check ultra-compact mode: when ≤3 issues, render as inline chip-badges (`[4 books stale] [P6 missing 21] [PP missing 11]`) with hover-for-full-text. >3 issues falls back to the existing bullet list.
8. **`23e6486`** — Empty platform pills drop to 40% opacity, hover bumps to 70%. Live dot pulse softened to `pulse-live` keyframe (1.0 ↔ 0.75 opacity + 8px ↔ 14px halo, 2.4s ease-in-out) — the old `pulse` keyframe still serves another element.
9. **`c6de0c7`** — Status header chunks (`📍 X archived`, `🕒 Xh old`, `max ΔX.X`) → rounded pill row with subtle background + thin border. Harmonizes with platform pills + Sources chip.
10. **`d7d17c5`** — Best Picks logic overhaul (the big one this session). Two related fixes:
    - **Best-side line selection** for SS/TD/FT/CTRL picks. New `bestSideLineForPick` helper at [src/analyzer.ts:6233](src/analyzer.ts#L6233) — lowest line for OVER, highest for UNDER, across all books. Verdict text's embedded line value updates inline to stay consistent with the displayed line/book. Fixed Strickland row showing `Pick6 46.5` when `DK 26.5` was the better OVER number.
    - **Negatively-correlated same-fight pair drop** at [src/analyzer.ts:6634-6669](src/analyzer.ts#L6634-L6669). When two fighters from one fight surface in the same section on different stat types, only one survives. **FP wins the cross-stat tiebreaker** — FP captures total fight outcome and tracks the favorite's dominance scenario; the dog's high-edge SS/TD pick depends on a non-dominant fight (the less-likely outcome). User confirmed: keep Khamzat FP-OVER, drop Strickland SS-OVER.

### UFC 328 Betr SS line entry

11. Wrote and executed a console snippet against `lines_betr_manual_v1` populating SS values for all 26 fighters. Used Pick6/Underdog canonical names from the read-only diagnostic snippet (corrected my abbreviation guesses: "Ozzy Diaz" not Oban, "Ateba Gautier" not Azamat, "Clayton Carpenter" not Cody/Chris, "Waldo Cortes-Acosta" hyphenated, "Joel Alvarez"/"Mateusz Rebecki" no accents). Pre-write guard checked `lines_betr_manual_v1` was empty before overwriting. SS values are now the Betr SS opening-line baseline.

---

## Memories saved this session

- **`feedback_no_negatively_correlated_same_fight_overs.md`** — same-fight cross-stat OVERs (or UNDERs) are negatively correlated; pick ONE side, never both. FP wins cross-stat conflicts. Includes Khamzat datapoints (DDP 242.2, Burns 100.7, Usman 92.1, Holland 103.7) and the same-fighter positive-correlation patterns (FP-OVER + FT-UNDER finish path; both fighters SS-UNDER one-sided control fight).
- **`project_best_picks_line_side_selection.md`** — the line-selection observation. Now partially fixed in code (SS/TD/FT/CTRL picks select best-side line). FP still uses per-book candidate generation which already factors line value into confidence. Caveats noted re: DK -115 vs pick-em even-payout bet types.

---

## UFC 328 lean reasoning (saved for context)

**Khamzat FP-OVER 110.5 (-600 fav, 5-rd main event vs Strickland)**

Goes UNDER only if:
- Quick R1 finish with minimal ground-and-pound (Holland precedent: 0 SS, sub R1, 103.7 FP — strikes-light finish)
- He outright loses (extremely unlikely at -600)
- Difficult competitive decision (Burns 100.7 in 3-rd, Usman 92.1 in 5-rd) — but Strickland is meaningfully weaker than Burns or Usman; DDP beat Strickland twice and Khamzat hung 242.2 on DDP

Mechanism for OVER: extended grappling/ride accumulating ride time + ground-and-pound (DDP, McKee, Phillips, Meerschaert all OVER), or striking-active decision.

---

## Pending / known issues (not blocking UFC 328)

- **`⚡ corr` / `⬇ corr` badge after dedupe** — Khamzat keeps a corr badge in Best Overs even though Strickland was dropped; `corrPenaltyMap`/`conflictFighters` are built from the un-deduped sorted list. User confirmed this is *not* confusing because Khamzat ALSO appears in Best Unders (FT-UNDER), and the cross-section same-fighter pair is genuinely positively correlated (finish path). Badge stays as informative. **No action needed.**
- **AUTO-FETCH state-aware (`8a1f17c` siblings)** — implemented in code (data-freshness attribute set in `renderQAPanel`), but visual verification was inconclusive last check (button looked bright green even with fresh `5m` pills). May need investigation if the user revisits. Possibly a CSS specificity issue with the existing `.btn.auto-fetch-btn` selector.
- **Pick6 pickGroup polling misses CTRL** — open since pre-Prates, see [project_pick6_pickgroup_polling_pending.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md). Needs live Pick6 CTRL props to repro.
- **SS_R1 grader** — defer until next slate has many SS_R1 props.
- **Analyzer phase-2 split** — Betr IIFE + UI panels per [project_analyzer_split_progress.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md). Post-fight territory.
- **UFC 328 lift verification** — once card settles, re-run lift snippet from [project_predictor_improvements_remaining.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_predictor_improvements_remaining.md). Watch whether Book prior fired on >0 fighters.
- **FP Betr lines for UFC 328** — user will enter via screenshot reader once Pick6/UD post FP lines.

---

## UI suggestions still on the menu (low priority)

These came out of the round 4-5 UI pass but weren't pursued:

1. **AUTO-FETCH state-aware verification** — see pending list above.
2. **DEBUG button repositioning** — floating bottom-right; could move into More menu.
3. **Toast notification styling** — `Loaded 26 fighters with stats!` toast looks like a dim gray box; could match the design system better.
4. **Fighter card header alignment** — guides shipped, but could be made more visible (currently subtle 14% alpha).

---

## Don't forget

- Don't propose Kelly stakes ([feedback_no_kelly_stakes.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_kelly_stakes.md))
- Don't recommend storage-mutating snippets without read-only diagnosis first ([feedback_no_destructive_snippets_without_verify.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_destructive_snippets_without_verify.md)) — followed correctly this session for the Betr SS entry
- Sanity-check fighter UFCStats history before flagging delta anomalies ([feedback_check_fighter_history_before_flagging_anomaly.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_check_fighter_history_before_flagging_anomaly.md))
- Reset Lines preserves Betr pre-fight-week, clears on/after event day ([feedback_betr_reset_rule.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_betr_reset_rule.md))
- **Same-fight cross-stat OVERs (or UNDERs) are negatively correlated — lean ONE side, never both** ([feedback_no_negatively_correlated_same_fight_overs.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_negatively_correlated_same_fight_overs.md))
- Resume document at the start of session can be stale on uncommitted state — verify with `git status` before assuming work is unshipped

---

## Lessons banked from this session

- **Line-selection bug pattern**: when a section already exposes "the better thing exists" via a side badge (`🏪` lineshop / `[DK 26.5]` bias-edge tip) but still recommends the worse one, the surfaced badge is doing half the job — the system has the data but isn't using it for selection. Worth checking other "we noticed this elsewhere" badges to see if the recommendation logic should follow.
- **Statistical edge ≠ winning bet**: Strickland SS-OVER 26.5 had a bigger statistical edge (proj 69.3 vs line 26.5 = +42.8) than Khamzat FP-OVER 110.5 (proj ~140 vs line 110.5 = +30), so the system ranked Strickland higher. But qualitatively the bigger edge is illusory because Khamzat's dominance suppresses Strickland's volume — the projection model doesn't know the fighters are causally linked. The FP-priority dedupe is a structural fix that uses fight-outcome reasoning rather than per-pick statistics.
- **Same-FIGHT cross-stat = negative correlation; same-FIGHTER cross-stat = positive correlation (often)**. The corr badge surface is meaningful in both directions; don't strip it just because dedupe removed one half of the pair.
- **CSS keyframe sharing trap**: `pulse` was used by two different elements with different intent. Adding a second dedicated keyframe (`pulse-live`) is cleaner than mutating the shared one. Caught at the first attempt — Grep before Edit when changing global CSS animations.
- **Verify-first paid off again**: the read-only Pick6/Underdog name dump caught my abbreviation guesses for "Oban" → "Ozzy", "Azamat" → "Ateba", "Cody" → "Clayton" before I wrote them to storage and they failed to bind to fighter cards.
