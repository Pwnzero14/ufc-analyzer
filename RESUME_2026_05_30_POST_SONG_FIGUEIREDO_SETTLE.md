# Resume — Post Song vs Figueiredo Settle + Learning Cycle

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-05-30 (Saturday morning, day after Song vs Figueiredo card)
**Next card:** Belal vs Bonfim (slate already loaded in analyzer)
**Working tree:** No new code commits this session — entirely settle/storage/cleanup operations. End-of-session housekeeping: full project snapshot taken + this resume + the 05-28 resume committed and pushed in `4f91acb`. `.claude/settings.local.json` and the two pre-existing untracked dirs still showing.

---

## TL;DR

Song vs Figueiredo card fully settled (all 282 archive rows resolved, green ✓) after an extended debug session uncovering two latent bugs and one chronic storage leak. Learning Cycle ran; predictor weights updated; next card slate already populated. Two **non-blocking code fixes** queued as follow-ups (worth doing this week before next fight week).

---

## What happened this session

### Symptom chain
1. Clicked SETTLE NOW after Song vs Figueiredo → returned `Settled 0, errors 0` (silent).
2. Force Backfill → claimed "255 results updated" but archive still showed 27 unresolved rows.
3. Storage diagnostic revealed **chrome.storage.local at 9.47 MB / 10 MB cap**.

### Root cause #1 — debug HTML storage bloat (chronic, write-only leak)
`debug_fight_html_*` keys at [src/analyzer.ts:1055-1057](src/analyzer.ts#L1055-L1057) write a 20 KB HTML slice per fighter on every UFCStats lookup. **Nothing in the codebase reads them.** They had accumulated to **190 keys (~4 MB)** across fight cards.

At 9.47 MB total, `chrome.storage.local.set` of `prop_archive_v1` (3.06 MB) silently raised `kQuotaBytes` errors visible only in the analyzer-tab console — never bubbled to the settle toast. So settle "succeeded" but never persisted.

**Fix applied this session:** deleted all 190 keys via console snippet (safe — write-only artifacts). Storage dropped from 9.47 MB → ~5.5 MB. SETTLE NOW then resolved 255 rows on the next click.

**Follow-up (NOT done yet):** gate or remove the write at [src/analyzer.ts:1055-1057](src/analyzer.ts#L1055-L1057). Cheapest fix: delete the three lines entirely. Slightly more polite: gate behind a `?debug=1` URL param check. Either way, ~3 lines edited; eliminates the chronic leak.

### Root cause #2 — settle path ignores NAME_ALIASES
After the 255 settle, **27 rows still unresolved**. All were platform-spelling duplicates whose canonical-name siblings *had* settled. Example: Pick6 stored "Yadong Song"; UFCStats parsed "Song Yadong"; analyzer's NAME_ALIASES would have bridged them, but settle's normalizer doesn't apply them.

The settle path at [src/background.ts:695](src/background.ts#L695) defines a local `_normName` that only lowercases + trims whitespace. It does NOT cross-reference [src/analyzer.ts NAME_ALIASES](src/analyzer.ts#L14166-L14208).

**Worked around tonight:** ran a sibling-backfill snippet that matched 21 of the 27 via the alias map, then hardcoded the remaining 6 from the `[UFC Settle]` log + a manual UFCStats lookup for Su Mudaerji (SS R1 = 16 from his fight against Alex Perez, which ended NC R2 1:45 via low blow). All 27 now resolved.

**Follow-up (NOT done yet):** patch [src/background.ts:695, 727-741](src/background.ts#L695) to inline the analyzer's alias map at settle time. ~10 lines. Eliminates this whole 27-row manual-cleanup ritual per event.

### Learning Cycle run
After full settle, ran Learning Cycle. Predictor weights updated; AI Pick Accuracy by Stat Type refreshed; per-event grading green; next-card slate (Belal vs Bonfim) already populated *before* absorbing the just-finished card (correct workflow per [project_learning_cycle_workflow.md](.claude/projects/c--Users-abdir-Downloads-ufc-project-v2/memory/project_learning_cycle_workflow.md)).

User's one question post-cycle: why is Aoriqileng labeled "Best" in the Learning Summary panel when he lost via R2 KO and was 10-8'd in R1?

**Answer (already given):** "Best" in that panel = smallest prediction-residual delta, not best fight outcome. Aoriqileng's total `|Δ|` was ±14.6 (lowest on card). Model predicted he'd score low; he scored low (because he got KO'd); residual was negligible. Sergei Pavlovich was "Worst" at ±133.0 because the model expected a heavyweight grind and got a one-punch finish. The panel feeds the weight-tuning step — labels are about *prediction accuracy*, not athletic performance.

---

## Open follow-ups (non-blocking, do before next fight week)

### A. Remove debug_fight_html_* write (15 sec edit)
[src/analyzer.ts:1055-1057](src/analyzer.ts#L1055-L1057) — delete or gate the `chrome.storage.local.set({ ['debug_fight_html_' + ...]: html.slice(0, 20000) })` call. Nothing reads these. Chronic 4 MB leak every fight card.

### B. Apply NAME_ALIASES in settle path (~10 lines)
[src/background.ts:695, 727-741](src/background.ts#L695) — inline the analyzer's `NAME_ALIASES` map into `_normName` and `applyResult`. Eliminates the per-event 27-row manual sibling-backfill ritual. Both functions are local-only — no other call sites to worry about.

Both fixes are low-risk and self-contained. Could ship together as one `fix(settle)` commit.

---

## State of the project right now

- **Branch:** `feature/sleek-theme-v1` — clean, no uncommitted code changes; in sync with `origin`.
- **Last committed work:** `4f91acb docs(resume): 2026-05-28 fight week stabilization + 2026-05-30 post-card settle` (this session). Prior code commit: `dda8d67 fix(pick6): restore CTRL auto-fetch` (2026-05-28).
- **Snapshot:** `backups/full_project_snapshot_20260530_214754/` — 7.4 MB lean snapshot (source + dist + docs + configs + `_memory_snapshot/` with all 32 auto-memory files). Skips node_modules, .opera-* profiles, .git.
- **Archive:** all Song vs Figueiredo rows resolved, green ✓. Storage at ~5.5 MB / 10 MB.
- **Predictor:** Learning Cycle absorbed Song vs Figueiredo. Weights updated.
- **Next card:** Belal vs Bonfim slate loaded — lines already being scraped per platform schedules.

---

## Memory updates this session

- **Created** [project_debug_fight_html_storage_bloat.md](.claude/projects/c--Users-abdir-Downloads-ufc-project-v2/memory/project_debug_fight_html_storage_bloat.md) — documents the 190-key leak + symptom signature (SETTLE NOW returns 0 with no toast error).
- **Created** [project_settle_path_no_alias_resolution.md](.claude/projects/c--Users-abdir-Downloads-ufc-project-v2/memory/project_settle_path_no_alias_resolution.md) — documents the alias gap in `background.ts:695` and the sibling-backfill workaround pattern.
- **MEMORY.md** index updated to include both.

---

## Quick-reference: tonight's diagnostic workflow (reuse for future settle failures)

1. **First sign of trouble:** SETTLE NOW returns `Settled 0` with no error toast.
2. **Check storage size** via analyzer tab DevTools:
   ```js
   chrome.storage.local.get(null, d => {
     const sizes = Object.entries(d).map(([k,v]) => [k, JSON.stringify(v).length]).sort((a,b)=>b[1]-a[1]);
     console.table(sizes.slice(0, 30));
     console.log('TOTAL:', sizes.reduce((a,[,n]) => a+n, 0) / 1024 / 1024, 'MB');
   });
   ```
3. **If near 10 MB:** look for `debug_fight_html_*` keys. Delete with:
   ```js
   chrome.storage.local.get(null, d => {
     const k = Object.keys(d).filter(x => x.startsWith('debug_fight_html_'));
     chrome.storage.local.remove(k, () => console.log('removed', k.length));
   });
   ```
4. **Re-click SETTLE NOW** — should resolve most rows.
5. **If residual orphans remain** (platform-spelling rows whose canonical siblings settled): run sibling-backfill snippet (alias-aware lookup, copy `result` from canonical sibling). Past pattern: 21/27 resolved by sibling-backfill; remaining few need manual UFCStats lookup or hardcoded values from settle log.

---

## What's NOT done and intentionally left

- Both code follow-ups (A + B above) — small fixes, but didn't want to ship code during settle/Learning-Cycle window.
- No pre-fight prediction work for Belal vs Bonfim — that's normal-cadence work for fight week (Tuesday-Friday).
- Aoriqileng "Best" question fully resolved in chat — no follow-up needed.
