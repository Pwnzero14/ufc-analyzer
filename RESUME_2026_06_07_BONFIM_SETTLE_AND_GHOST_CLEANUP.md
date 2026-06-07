# Resume — Bonfim Settle, Ghost Contamination Fix + Cleanup

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-06-07 (Sunday, ~12:50 AM — night after the Belal/Bonfim card)
**HEAD:** `0350b5f` — three code fixes shipped tonight (src + dist), all pushed to `feature/sleek-theme-v1` AND `master`.
**Working tree:** clean re: code (`.claude/settings.local.json` + 2 untracked dirs pre-existing).

## Code fixes shipped this session
- `bc46e43` — namesMatch false surname-only merge (Michael ≠ Chelsea Chandler)
- `0350b5f` — UFCStats fighter lookup strips apostrophes (Sean Omalley ↔ Sean O'Malley); **verified live** — O'Malley's stats panel now populates. Covers all apostrophe names (D'Angelo, O'Neill, etc.).
- Console (storage, backup-first): Bonfim ghost/dead-row cleanup (279→20) + Betr Bonfim manual-line clear.

---

## TL;DR

Settled the Belal/Bonfim card and chased down why the AWAITING-SETTLEMENT counter wouldn't drop. Root causes: (1) an **event-flip overlap** — Underdog flipped to UFC Freedom 250 while P6/PP/DK still served the finished Bonfim card, so the analyzer merged both cards and stamped UFC 250 lines under the Bonfim event = **ghost rows that can never settle**; (2) a **false fuzzy merge** collapsing `Michael Chandler` (UFC 250) into `Chelsea Chandler` (Bonfim); (3) the counter looked stuck because **auto-fetch re-archived dupe snapshots** faster than settling, and (4) **storage is near the 10 MB quota** (`kQuotaBytes` warning).

Outcome: shipped the merge fix, cleared the dead rows via backup-first console cleanup. Counter went **279 → 20** (the 20 are legit UFC Freedom 250 future props). R1 SS lean validated live (Bruno Silva R1 SS UNDER 23.5 hit, SS_R1=17).

---

## What happened this session

### 1. The settle actually worked — it was UFCStats lag, then dupe churn
- First settle attempts stalled (302→268→263→256) because **UFCStats hadn't posted full fight stats yet**. Once it had, a settle run did `settled=304, skipped=0, errors=0` (SS, SS_R1, TD, FP, CTRL all resolved).
- The counter still looked stuck because **auto-fetch keeps re-snapshotting current lines as new unresolved rows** (total records climbed 20418→20572). FT lines were even *moving* (UD 12.5→14.99), creating fresh unresolved FT rows. So settle resolves old rows; auto-fetch adds new ones. **Not a settle failure — a treadmill.**
- ⚠️ The **AUTO-FETCH LINES button is a "fetch now" trigger, not an on/off toggle.** Clicking it adds rows. Don't click it expecting to stop the churn.

### 2. Event-flip contamination → 46→256 ghost rows
- Underdog had **both cards live** (UFC 250 fighters: Topuria, Gaethje, Pereira, Gane, O'Malley, Lopes, Ruffy, M. Chandler, Nickal, Lewis, Hokit, Garcia, Zahabi, Daukaus). P6/PP/DK were still on the finished Bonfim card. Current event name stayed "Belal Muhammad vs Gabriel Bonfim" (P6-driven), so UFC 250 UD lines got **stamped under the Bonfim event** → unsettleable ghosts. Confirmed: `GHOST ROWS {Belal Muhammad vs Gabriel Bonfim: 22, Muhammad vs. Bonfim: 24}` (two event-name variants).
- This matches memory [[project_underdog_cross_promotion_ghost_lines]].

### 3. FIX A (shipped, `bc46e43`) — false surname-only fuzzy merge
- `namesMatch` in [src/analyzer.ts](src/analyzer.ts) had `if (aLast === bLast && aLast.length > 4) return true;` — merged ANY two fighters sharing a surname >4 chars. `Michael Chandler` → `Chelsea Chandler`, poisoning Chelsea's UD line (showed `ud=21.5` vs real 52–57).
- Fix: surname match now only counts as identity when one first name is an abbreviation/initial OR the initials agree. Built + committed src **and** dist, pushed to both branches. **Verified live**: Michael Chandler now a separate entry paired with Mauricio Ruffy.

### 4. Cleanups (backup-first console snippets, storage-mutating)
- Two backups created: `prop_archive_backup_ghostfix_*` and `prop_archive_backup_bonfimclear_*` (NOTE: the second may not have saved — `kQuotaBytes quota exceeded`).
- **Bonfim cleanup result:** removed **256 dead unresolved rows**, KEPT **211 settled Bonfim results** (learning data safe). Archive 20553 → 20297. Banner dropped **279 → 20**.
- The 20 remaining = **UFC Freedom 250** props (next week's card) — correctly unresolved until that event happens.

### 5. R1 SS lean validation
- Bruno Silva **SS_R1=17** → his R1 SS **UNDER 23.5 HIT** ✓ (calcSSR1Lean #1 Best Under was right). Matt Schnell SS_R1=8 (note for OVER review).

---

## ⚠️ Storage near quota (`kQuotaBytes` warning) — address next session
`chrome.storage.local` is near the ~10 MB limit. Per [[project_debug_fight_html_storage_bloat]] this causes silent settle problems and likely contributed tonight. Culprits: piling-up `prop_archive_backup_*` full-archive snapshots (each huge) + auto-backups.
- **Next session: write a backup-pruning snippet** to delete old `prop_archive_backup_*` keys (keep the most recent 1–2) and reclaim space. Read-only audit first (list keys + sizes), then prune.

---

## Betr Bonfim manual lines — CLEARED (was the late-session issue)
The 24 Bonfim Betr manual entries (`lines_betr_manual_v1`) wouldn't auto-clear. Root cause: they only auto-clear via `handleClearBetrLines()` after a settle when `stillUnresolved === 0` ([background.ts:1037](src/background.ts#L1037)) — which never hit because of the ghosts/dupes. `BETR_EVENT_DATE` (hardcoded `2026-04-18`) only clears the seed, not manual entries. Cleared via backup-first console snippet (removed `lines_betr` + `lines_betr_manual_v1`, backup `betr_backup_bonfim_*`). Slate now clean on UFC Freedom 250.
- **Deferred code fix:** make Betr manual lines auto-clear when the *current event* moves past the Betr card's date, instead of depending on `stillUnresolved === 0`.

## Open / next-session work

1. **Prune storage backups** — highest priority; storage near `kQuotaBytes`. Multiple `prop_archive_backup_*` + `betr_backup_*` keys created tonight are huge. Read-only audit (list keys + sizes), then keep most-recent 1–2, delete the rest.
2. **FIX B (deferred, code):** don't archive UD-only fighters who aren't on the P6-defined current card during an event overlap — stops ghosts at the source. (Natural card-flip resolved it this time, but it'll recur every overlap.) Note residual: during overlap, abbreviated `C Chandler` (Betr) can still match `Michael Chandler` when Chelsea isn't in the fetch — Fix B would also help here.
3. **Betr auto-clear code fix** (above) — date-driven instead of `stillUnresolved===0`.
4. **UFC Freedom 250 settle** — the 20 remaining props settle after next Saturday's card (Jun 14).
5. Minor/cosmetic: O'Malley **lookup** is fixed; the **display name** still shows "Sean Omalley" (platform spelling, no apostrophe). Optional display-name prettifier — zero data impact.

---

## Standing workflow rule (unchanged)
`dist/` is TRACKED and SHIPPED. After ANY `src/` change: `npm run build` → `git add dist` → commit dist with the src change → push BOTH branches. See [[feedback_commit_dist_after_code_changes]].
