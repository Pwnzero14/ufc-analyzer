# Resume — Post-Prates Learning Cycle (2026-05-04 onward)

Branch: `feature/sleek-theme-v1` (40+ commits ahead of origin, 1 uncommitted edit in `src/background.ts`)
UFC Perth (Della Maddalena vs Prates) settled this session. Prates absorbed into learning weights. UFC 328 prep is the next move.

---

## What happened this session

### Settled the Prates card
- Yellow SETTLE NOW (banner button) → settled 152 of 170 props from UFCStats
- Hit a snag with 31 stragglers; diagnosed via DevTools snippet on `prop_archive_v1`:
  - 9× Cameron Rowston + 5× Wesley Schultz = 14 standard props blocked by **name-canonicalization gap** (archive held long form, UFCStats uses short form)
  - 13× Pick6 ctrl props = settle path never wired ctrl into `applyResult`
  - 4× SS_R1 props = `fetchFightDetails` only parses Totals tbody, never the per-round table

### Patches applied (uncommitted in `src/background.ts`)
1. **Name canonicalization** at [background.ts:828-839](src/background.ts#L828-L839) — added an archive-side last-name → fighter-names map per event, pulled into `namesToTry` so "Cam Rowston" (UFCStats) matches archive rows stored as "Cameron Rowston". **Verified working** — settled 14 rows on first reload (visible in SW console "17 unresolved" log after auto-settle dropped from 31 → 17).
2. **Ctrl wire-up** at [background.ts:875-882](src/background.ts#L875-L882) and [:984-990](src/background.ts#L984-L990) — added `applyResult(nameVariants, archiveEvent, 'ctrl', ctrlMins)` to both main and fallback settle paths. Convert `f.ctrlSecs / 60` since archive lines are in minutes. **INCONCLUSIVE** — Learning Memory jumped 959 → 973 (+14) which is consistent, but unresolved count never dropped from 17 in the user's view before they dismissed. Could be SW caching, could be a propType mismatch I didn't isolate. **Worth re-investigating cold.**

### Final state
- User dismissed the remaining 17 (13 ctrl + 4 SS_R1) → marked as PUSH (`result = line`). Slight calibration noise; not damaging.
- 990 records resolved total in archive
- **Prates absorbed into learning weights**: AVG |Δ| SS ±35.5, TD ±1.5, FP ±25.6. Best Junior Tafa ±14.9. Worst Louie Sutherland ±208.7 (he got blown out by Tuivasa, big delta).
- 24 trends added; weights updated across weight classes

---

## Key learning workflow gotcha (saved to memory)

The "▶ Run Learning Cycle" button in the Learning Summary panel is gated on `pendingLearn = preds.find(p => !p.settled && p.event !== upcomingEventName)` ([analyzer.ts:8166-8175](src/analyzer.ts#L8166-L8175)). If the next slate's lines aren't loaded yet, the system still treats the just-settled card as "upcoming" and the button stays hidden.

**Workflow:** AUTO-FETCH LINES (pull next event) → upcomingEventName flips → green banner appears → ▶ Run Learning Cycle → THEN GENERATE PREDICTIONS for new card. See [project_learning_cycle_workflow.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_learning_cycle_workflow.md).

---

## What to do this session (UFC 328 prep)

### 1. Generate UFC 328 predictions
The user already ran the learning cycle on Prates. UFC 328 lines should be loaded (or imminent). Just click **GENERATE PREDICTIONS** once the card is detected.

### 2. Decide on the uncommitted ctrl patch
Two options:
- **Keep both patches** — name canon definitely helps next slate, ctrl is harmless if it fires and harmless if it doesn't. Commit them.
- **Keep only name canon, revert ctrl** — cleaner if the inconclusive ctrl wire-up bothers you. Surgical revert at [:875-882](src/background.ts#L875-L882) and [:984-990](src/background.ts#L984-L990).

If keeping ctrl, **do a fresh diagnosis next slate**: when ctrl props are unresolved, run this snippet in analyzer DevTools:

```js
chrome.storage.local.get(['prop_archive_v1'], r => {
  const arr = r.prop_archive_v1 || [];
  const ctrl = arr.filter(x =>
    x.event && /* event substring */ &&
    x.propType && x.propType.toLowerCase() === 'ctrl' &&
    !Number.isFinite(Number(x.result))
  );
  console.table(ctrl.map(x => ({ fighter: x.fighter, propType: x.propType, line: x.line, result: x.result })));
});
```

If `propType` field is anything other than literal `'ctrl'` (e.g., `'Control'` or `'CTRL'`), that's why the patch missed — fix `_normProp` in [background.ts:683-690](src/background.ts#L683-L690) to canonicalize both forms.

### 3. SS_R1 grader (deferred)
4 SS_R1 props were dismissed. To grade them in the future, `fetchFightDetails` ([background.ts:595-661](src/background.ts#L595-L661)) needs to parse the per-round Sig Strikes table (a separate tbody on the UFCStats fight detail page). ~15-20 lines plus HTML structure verification. Bigger lift; defer unless slate has many SS_R1 lines.

### 4. Open follow-ups still on the board
- **Predictor v2 lift verification** — Prates was the first full slate after #1+#2 shipped (2026-04-27). Now have post-fight data to compare predicted vs actual finish times and book-prior-weighted probabilities. See [project_predictor_improvements_remaining.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_predictor_improvements_remaining.md).
- **Pick6 pickGroup polling** still misses CTRL ([project_pick6_pickgroup_polling_pending.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md)).
- **Analyzer phase-2 split** — Betr IIFE + UI panels still inline ([project_analyzer_split_progress.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md)). Pre-fight window is risky for UI work.

### 5. Push backlog?
Local is now 40+ ahead of `origin/feature/sleek-theme-v1`. No urgency, but if user wants to back it up, `git push` is fine (after deciding on the ctrl patch).

---

## Don't forget
- Don't propose Kelly stakes ([feedback_no_kelly_stakes.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_kelly_stakes.md))
- Reset Lines preserves Betr pre-fight-week, clears on/after event day ([feedback_betr_reset_rule.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_betr_reset_rule.md))
- **Don't burn user's tokens on redundant reload cycles** — when SW caching is suspect, write a one-shot `chrome.storage.local.get` diagnostic snippet to inspect actual state instead of asking for "click again and check"
- Backups in `backups/full_project_snapshot_20260430_135140/`

---

## Diagnostic snippets used this session (reference)

**Inspect unresolved archive rows for an event:**
```js
chrome.storage.local.get(['prop_archive_v1'], r => {
  const arr = r.prop_archive_v1 || [];
  const u = arr.filter(x =>
    x.event && x.event.toLowerCase().includes('prates') &&
    Number.isFinite(Number(x.line)) && Number(x.line) > 0 &&
    !Number.isFinite(Number(x.result))
  );
  console.table(u.map(x => ({ fighter: x.fighter, prop: x.propType, line: x.line, platform: x.platform || '' })));
});
```

**SW console — verify a code change deployed:**
1. `chrome://extensions` → click "service worker" link on extension card → opens DevTools
2. Look in Sources → background.js for the new symbol (e.g., `ctrlMins` or `archiveLastNameMap`)
3. Or click SETTLE FROM UFCSTATS in analyzer, watch for `[UFC Settle]` log lines with the new format
