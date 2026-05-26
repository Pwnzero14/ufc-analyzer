# Resume — Predictor v2 Backlog Complete (2026-05-05 onward)

Branch: `feature/sleek-theme-v1` (44 commits ahead of origin, working tree clean except `.claude/settings.local.json` and a few untracked resume markdown drafts in project root).

This session closed out the four-item predictor v2 backlog from 2026-04-27. UFC 328 (Chimaev vs Strickland) lines are loaded and predictions have been generated. The card settles and absorbs into learning weights once it happens.

---

## What shipped this session (3 commits)

### 1. Settle path: ctrl props + archive-side long-name resolution — `231eda6`
[`src/background.ts`](src/background.ts) — fixed two gaps that blocked 17 props on the Prates card from auto-settling:
- **Ctrl wire-up**: `applyResult(..., 'ctrl', ctrlMins)` added to both main UFCStats path and surname-fallback path. `line_ctrl` writes archive rows with `propType: 'ctrl'` (lowercase, falls through `toArchivePropTypeFromLineKey`); `_normProp('ctrl')` also falls through. Both sides land on `'ctrl'` so they match. Verified by code trace, not live test (Prates ctrl rows had been dismissed as PUSH before the patch was committed).
- **Archive-side long-name map**: `archiveLastNameMap` pulls archive fighters whose last name matches a UFCStats result's last name, covering the reverse direction of the existing namesToTry. Verified live — 14 rows on Prates resolved on first reload.

### 2. Predictor #4 — adaptive trend learning rate — `0cca531`
[`PropLinePredictorService.ts`](src/services/PropLinePredictorService.ts) `runLearningCycle`. Replaced fixed 0.8/0.2 EWMA with `α = clamp(1/(n+2), 0.10, 0.50)` where n is pre-update sampleCount. First sample → 50%, n=3 → 20%, n=8+ → 10%. Lift is gradual across events (trends are persistent state shaped by historical α=0.20 cycles).

### 3. Predictor #3 — RLM-as-calibration — `cc63b64`
[`PropLinePredictorService.ts`](src/services/PropLinePredictorService.ts) `runLearningCycle` + new `effectiveDelta` field on [`LearningPredictionResult`](src/types/index.ts) interface. When closing line moved meaningfully from open on a fighter prop:
- `effectiveActual = 0.7 × actual + 0.3 × closingLine` (only if `|rlm| > threshold`)
- Per-stat thresholds: FP=5, SS=3, TD=0.5
- Trend EWMA + per-class `proportionalStep` use `effectiveDelta`
- UI fields (`actual`, `delta`, `avgAbsDelta*`, best/worst) keep using raw `delta` for display

`getMarketSignal(fighter, propType)` returns median closing line + median RLM across platforms from archive records that have both `openLine` and `line`. Robust to single-platform anomalies. Fighters with no openLine data fall through to raw delta (no behavior change).

---

## Predictor v2 lift verification (the headline)

Compared Sterling/Zalal (pre-v2) vs Prates (post-#1+#2) via DevTools snippet joining `prop_predictions_v1` × `prop_archive_v1`:

```
Sterling/Zalal baseline: avg |Δ| FP = ±31.5
Prates (post #1+#2):    avg |Δ| FP = ±28.6 (snippet) / ±25.6 (Learning Summary panel)
```

~10–19% drop, but with a critical caveat: **#2 (book prior) fired 0/24 fighters on Prates**. The archive is too thin — book prior requires ≥5 prior Betr FP samples per fighter, and only ~6 events are archived. The lift is attributable to #1 (duration model) plus noise.

**Don't lower #2's threshold reflexively.** 3-sample medians are noisy. The fix is to wait for the archive to grow naturally.

---

## What's still on the board for next session

### Push backlog (low effort, low urgency)
44 commits ahead of `origin/feature/sleek-theme-v1`. No pressure but it's a lot. `git push` is fine if the user wants the backup.

### Steve Erceg SS=96.5 anomaly (worth a quick look)
On the Prates lift snippet, Steve Erceg's row showed `ssAbsDelta = 96.5`. SS lines are 20–80 typically; results 0–150 max. A delta of 96.5 implies either:
- Erceg actually had ~125 sig strikes (unlikely at flyweight)
- The result was stored in the wrong format (maybe seconds instead of strike count, or was paired with the wrong fight)
- Erceg's *opponent's* result got attributed to him

If the result-row attribution is broken, every learning cycle absorbs poisoned data. **Worth investigating** before the next absorb. Read-only diagnosis first:

```js
chrome.storage.local.get(['prop_archive_v1'], r => {
  const arr = r.prop_archive_v1 || [];
  const erceg = arr.filter(x =>
    x.event && x.event.toLowerCase().includes('prates') &&
    x.fighter && x.fighter.toLowerCase().includes('erceg')
  );
  console.table(erceg.map(x => ({
    fighter: x.fighter, propType: x.propType, line: x.line, openLine: x.openLine,
    result: x.result, platform: x.platform || ''
  })));
});
```

If `result` for SS looks like a fight-time-in-seconds number (e.g., 870 ≈ 14.5min) or matches the opponent's strike count, that's the bug. Then trace back to the settle-path code in [background.ts:839-877](src/background.ts) to see where SS gets attributed.

### SS_R1 grader (deferred from Prates)
4 SS_R1 props were dismissed last session because `fetchFightDetails` ([background.ts:595-661](src/background.ts#L595-L661)) only parses Totals tbody, not the per-round Sig Strikes table. ~15-20 lines plus HTML structure verification on UFCStats fight-detail page. Defer unless the next slate has many SS_R1 props.

### Pick6 pickGroup polling still misses CTRL
Per [project_pick6_pickgroup_polling_pending.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md). Open since pre-Prates session.

### Analyzer phase-2 split (post-fight territory)
Betr IIFE (~230 LOC) + UI panels (~1,300+ LOC) per [project_analyzer_split_progress.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md). Pre-fight window is risky for UI work — defer until after UFC 328 settles.

### UFC 328 lift verification (after the card)
Once Chimaev/Strickland settles, re-run the lift verification snippet (template in [project_predictor_improvements_remaining.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_predictor_improvements_remaining.md)) and look at:
- Did `Book prior` fire on more than 0 fighters? (Archive growth check)
- Did avg |Δ| FP drop from Prates' ±28.6?
- Are the worst-prediction fighters from Prates (Louie Sutherland, Brando, Quillan) carrying meaningful trend updates that helped on UFC 328?

---

## Don't forget
- Don't propose Kelly stakes ([feedback_no_kelly_stakes.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_kelly_stakes.md))
- Don't recommend storage-mutating snippets without read-only diagnosis first ([feedback_no_destructive_snippets_without_verify.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_no_destructive_snippets_without_verify.md))
- Reset Lines preserves Betr pre-fight-week, clears on/after event day ([feedback_betr_reset_rule.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_betr_reset_rule.md))
- Backups in [backups/full_project_snapshot_20260430_135140/](backups/full_project_snapshot_20260430_135140/)
