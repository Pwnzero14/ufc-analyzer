# Resume — Post Allen/Costa settle + UD ghost-fighter diagnosis

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-05-17 (Sunday afternoon, day after Allen vs Costa)
**Working tree:** Same dozens-of-uncommitted-changes carry that's been in flight for many sessions. No commits this session.

---

## TL;DR

Allen vs Costa fully settled and absorbed into model weights. **14 "stragglers" turned out to be ghost fighters from Mike Perry's MVP card the night before** — Underdog's "UFC" scraper pulled cross-promotion fighters (Ronda Rousey, Ngannou, Perry, Bellato, Salahdine, Despaigne, Fazil) and the archive write path stamped them with the Allen vs Costa event name. Dismissed via the banner. Next UFC event is **Song vs. Figueiredo on 2026-05-30** — UFCStats hasn't posted that card yet (too far out), so predictor work is paused until ~May 23–25.

---

## What happened this session

1. **Settle workflow ran fine** — 291 → 14 after the first non-racing settle call. The first Settle from UFCStats click hit `_settleInProgress = true` ([background.ts:672](src/background.ts#L672)) because the 28h post-event alarm was already executing. Worth knowing: that's the "Settled 0 records" with **no** "(N events not found yet)" suffix signature. Wait ~1 min and retry.

2. **Diagnosed the 14 stuck records** as ghost fighters via read-only console snippet on `prop_archive_v1`. Confirmed cause: [background.ts:1108-1136 archive write](src/background.ts#L1108-L1136) filters against the platform roster UNION ([getRosterNameSet](src/background.ts#L1050-L1060)), which includes every UD fighter scraped — not against `card.pairs`. Fighters appeared twice each due to the long-form vs canonical event-name re-injection bug flagged in [RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md](RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md).

3. **Memory written:** [project_underdog_cross_promotion_ghost_lines.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_underdog_cross_promotion_ghost_lines.md) — added to MEMORY.md index. Future Claude will recognize the pattern.

4. **DISMISS clicked** — 14 ghosts marked as push (result = line). Archive shows `All records settled ✓`.

5. **Learning Cycle ran successfully** for Allen vs Costa. Big-Δ tail (Wellmaker ±107, Tuco ±106, Allen ±88, Costa ±85) is the 5R main event + early-finish pattern blowing up per-fight totals — card-level avg ±28.8 SS / ±28.7 FP is in the normal band. Adaptive trend rate folds these in.

6. **GENERATE PREDICTIONS for Song vs Figueiredo failed** — "No upcoming card detected — no events found on UFCStats". May 30 is too far out for UFCStats's schedule page. Deferred.

---

## Next session priorities

### Option A — Ship the ghost-fighter fix (high-value, 2-week window)

Natural fit since there's no event next week. One-function change at [background.ts:1108](src/background.ts#L1108):

- Replace `getRosterNameSet()` check with a filter against the current card's fighter pairs (from `fetchUpcomingUFCCard().pairs` flattened to a name set).
- This prevents archive writes for fighters not on the canonical UFCStats card — kills the cross-promotion ghost line problem at source.
- Likely also kills the duplicate-event-name records since the long-form fighters would never reach the archive in the first place.
- Add a test fixture if there's one (or smoke-check by mocking a UD scrape that includes a non-card fighter).
- Acceptance: re-run settle on an old card with known ghosts — should now have zero unsettleable stragglers.

### Option B — Predictor decoupling UI work

Still listed as pending in [RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md](RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md). `generatePredictions` is already decoupled from platform lines model-side ([analyzer.ts:8207](src/analyzer.ts#L8207)), but the UI gates Generate on `allFighters.length`. Worth ~30-45 min to land. Verify in next session whether the "No upcoming card detected" toast today was the card-cache gate, not the lines gate — different problem if so.

### Option C — Just wait

Hit AUTO-FETCH around **2026-05-23–25** to detect Song vs Figueiredo. Generate predictions then. Capture the pre-line forecast for CLV comparison once openers drop.

---

## Sticky context for next session

- **No event 2026-05-23 weekend.** Next UFC card is **UFC Fight Night: Song vs. Figueiredo on 2026-05-30**.
- **Branch carries dozens of uncommitted changes** from many prior sessions (last several resume files have this same caveat). Don't commit anything broadly unless the user explicitly asks.
- **Build clean as of last `npm run build`.**
- **Filled-spine work from 5/16 still uncommitted** — see [RESUME_2026_05_16_FILLED_SPINE.md](RESUME_2026_05_16_FILLED_SPINE.md). Populated COMMON OPPS layout still visually unverified (Allen/Costa shared zero opps).

---

## Don't-forgets (unchanged)

- Don't propose Kelly stakes
- Don't recommend storage-mutating snippets without read-only diagnosis first
- Reset Lines preserves Betr pre-fight-week, clears on/after event day
- Same-fight cross-stat OVERs/UNDERs are negatively correlated — lean ONE side
- Big |Δ| ≠ data bug; check fighter UFCStats history before flagging delta anomalies
- Resume document at start of session can be stale on uncommitted state — verify with `git status` before assuming work is unshipped

---

## Next session opener

> Continuing `feature/sleek-theme-v1`. Last session: Allen vs Costa fully settled (with 14 UD ghost-fighter records dismissed — see [project_underdog_cross_promotion_ghost_lines](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_underdog_cross_promotion_ghost_lines.md)) and Learning Cycle ran. Next UFC card is Song vs Figueiredo 2026-05-30, but UFCStats hasn't posted it yet (too far out). Two productive paths: ship the archive-write filter fix at [background.ts:1108](src/background.ts#L1108) (prevents the ghost-fighter recurrence at source) OR finish predictor UI decoupling per [RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md](RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md). Dozens of uncommitted changes still carry — don't commit unless asked.
