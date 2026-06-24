# RESUME — 2026-06-15 — Settle reliability + ghost contamination fixes

## TL;DR
Settled the **UFC Freedom 250** (White House) event and fixed a cascade of settle/archive
bugs that surfaced along the way. All shipped in one commit on `feature/sleek-theme-v1`:

- **`737920a`** — `fix: settle reliability — body/leg, race-safe writes, recentOnly, ghost purge`

Verified live in the loaded extension. End state: archive is healthy — only this week's
**UFC Fight Night: Kape vs. Horiguchi (2026-06-20)** pending lines are unresolved (legit),
zero Max/Conor ghosts.

## ⚠️ Not done yet (do next session)
- **Propagate to `master` + push.** Per the dist-ship convention (commit dist to master AND
  feature, or the downloadable goes stale), this commit still needs to reach `master`.
  Suggested: `git checkout master && git cherry-pick 737920a && git checkout feature/sleek-theme-v1`,
  then push both. I did NOT push (outward-facing — wanted confirmation first).

## What was wrong & what changed (files: src/background.ts, src/analyzer.ts, src/services/PropArchiveService.ts)
1. **Original ask:** "UFC Freedom 250 won't settle." Root: it actually settled fine on manual
   SETTLE NOW (303 records); the *startup* auto-settle was silently losing its write to a race.
2. **`ss body`/`ss leg` never settled** — fetchFightDetails didn't parse the Sig-Strikes
   Body/Leg columns; applyResult/_normProp didn't handle them. Now they do (archive stores
   propType with a SPACE: "ss body"/"ss leg").
3. **Startup settle write race** — settle wrote a stale snapshot; now re-reads fresh and merges
   resolved results by key (`resolvedKeys`).
4. **SETTLE NOW slow** — re-walked ~13 events each run. Added `recentOnly` (default on
   GRADE_ARCHIVE). KEY: it anchors on the most recent **PAST** event (date <= now+12h), NOT the
   newest date overall — otherwise this week's not-yet-fought card (pending lines = newest date)
   becomes the anchor and the real graded card gets skipped. `allEvents:true` = full sweep.
5. **"Back to 29/6" oscillation** — finished-event lines re-archived under the NEXT card's date
   → result:NaN dupes the settler resolves and the next fetch recreates. Guard:
   `eventHasSettledRows()` skips re-archiving an event that already has graded rows.
6. **Max/Conor (UFC 329, next month) + stale PP lines on the slate/archive** — `getRosterNameSet`
   was self-referential (built from the loaded lines), so it filtered nothing. Fix: **card is
   the authority.** `archivePlatformPropLines` gates each fighter on `onCard()` (surname-tolerant,
   from card.fighters) + early-bails foreign batches; analyzer prune (~analyzer.ts:15409) keeps
   only `isUpcomingCardFighter()` when the card is known.
7. **Foreign-ghost auto-purge** — settle records each graded event's UFCStats roster
   (`eventRosterSurnames`) and drops unresolved rows whose fighter isn't on it (size>=2 guard).
   Returns `purged`; GRADE_ARCHIVE notifies tabs when settled OR purged > 0.
8. **THE fix that made purge stick — archive write lock.** Console deletes + the settle purge
   kept getting clobbered by the continuously-running auto-scrape `addProps` (unsynchronized
   full-array read-modify-write; stale snapshot restored ghosts → `23319→23325`). Added
   `PropArchiveService.runExclusive()` (promise-chain mutex) + `.mutate(fn)`. addProp/addProps/
   updateResult/backfill wrap read+write in it; the settle write goes through `.mutate`. All
   share one `_writeChain`, each reads fresh INSIDE its lock turn.

## How to verify (read-only, analyzer or service-worker console)
```js
(async () => {
  const all = (await chrome.storage.local.get('prop_archive_v1')).prop_archive_v1 || [];
  const u = all.filter(r => Number.isFinite(Number(r.line)) && Number(r.line) > 0 && !Number.isFinite(Number(r.result)));
  console.log(`total=${all.length} unresolved=${u.length}`);
  console.table(u.map(r => ({ fighter:r.fighter, event:r.event, prop:r.propType, line:r.line, date:r.date })));
})();
```
Healthy = unresolved rows are ALL current/future-card fighters (e.g. Kape vs. Horiguchi
2026-06-20). Any Max/Conor under "UFC Freedom 250"/"Topuria vs Gaethje" = a ghost that should
have purged — click SETTLE NOW.

## Known-still-direct writers (low risk, lock them only if they ever cause churn)
`rewriteRecentArchiveEventName` and the DELETE_ARCHIVE_EVENT / CLEANUP_ORPHAN_CARD_ROWS message
handlers in background.ts still write `prop_archive_v1` directly (bypass the lock). They're
gated/manual, so not racing the auto-scrape loop — but route them through
`PropArchiveService.mutate` if churn reappears.

## Other notes
- Cosmetic only: PROP LINE PREDICTIONS panel still shows old Topuria/Gaethje preds (203h old);
  hit Generate Predictions for the Kape card. The popup's raw capture view still lists Max/Conor
  (harmless — both gates filter them out of slate + archive).
- Dual event-name issue persists in the archive (same card under "UFC Freedom 250" AND
  "UFC Fight Night: Ilia Topuria vs Justin Gaethje"); settle handles it via the surname fallback.
- Memory written: `project_settle_rearchive_oscillation_and_fixes.md`.
