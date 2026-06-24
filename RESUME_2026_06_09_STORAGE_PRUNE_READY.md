# Resume — Storage Prune Snippets Ready (not yet run)

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-06-09 (Tuesday)
**HEAD:** `0350b5f` — unchanged from last session; **no code changes this session**.
**Working tree:** clean re: code. Only new files: two console snippets + this resume.

---

## TL;DR

Prepped (but did NOT run) the storage backup pruning from the 06-07 to-do list. Two console snippets are saved in `snippets/`. Next session: run audit → review plan → `confirmPrune()`. Storage is still near the ~10 MB `kQuotaBytes` limit until this is done.

---

## What was done this session

- Wrote `snippets/2026-06-09_storage_audit.js` — READ-ONLY. Lists every `chrome.storage.local` key with MB size, flags backup keys, prints total + exact `getBytesInUse` vs quota.
- Wrote `snippets/2026-06-09_backup_prune.js` — two-step. Pasting it only PRINTS the deletion plan (keeps newest 1 backup per family: ghostfix, bonfimclear, betr_backup, orphan_backup; never touches `prop_archive_v1` or any non-backup key). Deletion only happens on `confirmPrune()`. Optional `exportDoomed()` downloads a JSON of the keys being deleted (analyzer-page console only).
- **Nothing was executed. Storage untouched.**

## Next session — exact steps

1. Open the analyzer page → F12 → Console.
2. Paste `snippets/2026-06-09_storage_audit.js` → review output.
   - Check: did `prop_archive_backup_bonfimclear_*` actually save? (06-07 session hit `kQuotaBytes` mid-write — it may be missing.)
3. Paste `snippets/2026-06-09_backup_prune.js` → review the printed plan (KEEP vs DELETE lists).
4. Optional: `exportDoomed()` for a file copy.
5. `confirmPrune()` → verify new total is well under 10 MB.

## Remaining open items (carried from 06-07 resume)

1. ~~Prune storage backups~~ → snippets ready, execute next session (steps above).
2. **FIX B (code):** don't archive UD-only fighters absent from the P6-defined current card during event overlap — stops ghost rows at the source. Residual: abbreviated `C Chandler` (Betr) can still falsely match `Michael Chandler` when Chelsea isn't in the fetch.
3. **Betr auto-clear (code):** clear manual Betr lines (`lines_betr_manual_v1`) when current event moves past the Betr card date, instead of `stillUnresolved === 0` ([background.ts:1037](src/background.ts#L1037)).
4. **UFC Freedom 250 settle** — the 20 unresolved props settle after Saturday **Jun 14**. (If next session is after the card: settle, then verify counter → 0.)
5. Cosmetic: display-name prettifier ("Sean Omalley" → "Sean O'Malley"). Lookup already fixed; zero data impact.

## Reminders

- ⚠️ **AUTO-FETCH LINES button is a "fetch now" trigger, not a toggle** — don't click it expecting to stop churn.
- Backup-key writers: console snippets + `prop_archive_orphan_backup_<epoch>` in [background.ts:383](src/background.ts#L383). Main archive key: `prop_archive_v1`.

## Standing workflow rule (unchanged)

`dist/` is TRACKED and SHIPPED. After ANY `src/` change: `npm run build` → `git add dist` → commit dist with the src change → push BOTH branches (`feature/sleek-theme-v1` AND `master`).
