# RESUME — 2026-06-20 — Ghost-event archiver guard + Kape/Horiguchi settle cleanup

## TL;DR
Settled the **UFC Fight Night: Kape vs. Horiguchi** card and root-caused/fixed why its 125 props
were archived under a bogus event name (**"UFC Fight Night: Conor McGregor vs Max Holloway"** —
next-month UFC 329 ghosts). One code commit + a manual archive cleanup. End state: **all records
settled ✓, 0 unresolved.**

Commit:
- **`2b7d423`** (master `93d49b6`) — `fix: archiver ghost-event guard — stop mislabeling card under far-future bouts`

## The bug
The whole Kape card's archive rows were stamped with `"UFC Fight Night: Conor McGregor vs Max
Holloway"`. Settle matches an archive event to a completed UFCStats event by **surname** — `{mcgregor,
holloway}` matches no real card, so the 125 props wouldn't settle. Worse, every manual rename/delete
got **regenerated**.

### Root cause (background.ts `archivePlatformPropLines`)
- `inferEventFromSlate` returns the **highest-count fighter pair** in the slate. Stray high-coverage
  ghost lines (next month's Conor/Max marquee bout, posted early on UD/PP) outvoted the real card.
- When `overlap < 4`, the archiver used that inferred ghost name as `archiveEventName` **and** called
  `rewriteRecentArchiveEventName(card.event, ghost)` — flipping the correct "Kape vs Horiguchi" rows
  to the ghost name on every fetch. That's what resurrected the rows after each cleanup and broke
  settle.

### The fix (committed)
Added a **ghost-event guard** right before the rewrite block in `archivePlatformPropLines`: extract
the chosen event's two surnames and require BOTH to be on the current UFCStats card
(`cardSurnames`). If not, discard the inferred name, force `card.event`, and clear the stale
`archiveEventOverride`. Fully-foreign batches are already dropped by the early-bail, so anything
reaching the guard has ≥1 on-card fighter — making `card.event` the correct label. Prevents both the
mislabel and the destructive rewrite. **Won't recur.**

## Manual cleanup performed (data only — backup taken first)
1. Backed up full storage (download), read-only diagnostic confirmed all 27 fighters under the bogus
   event were Kape-card fighters.
2. Renamed bogus event → `"UFC Fight Night: Kape vs. Horiguchi"`, clicked SETTLE FROM UFCSTATS →
   147 results updated, 125 → 2 unresolved.
3. The 2 leftovers were `Vinicius De Oliveira Prestes De Matos` (his verbose UD legal name; surname
   "Matos" ≠ UFCStats "Oliveira", so settle's raw-last-name fallback couldn't map them). Confirmed
   canonical `Vinicius Oliveira` was fully resolved (SS/FP/ctrl), so the Matos rows were redundant.
4. Cleared them with a **retry-loop delete** (see below).

## KEY LESSON — manual storage writes lose to an in-flight settle
A single console `chrome.storage.local.set` on `prop_archive_v1` gets **clobbered** by a concurrent
settle: settle's final write goes through `PropArchiveService` (locked, reads fresh, re-applies +
re-writes unresolved rows), and the unlocked console write loses the race. Symptom: "Deleted 0" even
though the records exist. The live-settle alarm fires every ~5 min and a run takes 10–30s.

**Reliable cleanup pattern** — re-delete on a short interval until a pass lands between settle writes:
```js
(async () => {
  const isGhost = r => /conor mcgregor vs max holloway/i.test(r.event||'')
    || /prestes de (oliveira|matos)|de oliveira prestes/i.test(r.fighter||'');
  for (let i=0;i<25;i++){
    const arc=(await chrome.storage.local.get('prop_archive_v1')).prop_archive_v1||[];
    const cleaned=arc.filter(r=>!isGhost(r));
    if(cleaned.length!==arc.length) await chrome.storage.local.set({prop_archive_v1:cleaned});
    await new Promise(res=>setTimeout(res,800));
    const after=(await chrome.storage.local.get('prop_archive_v1')).prop_archive_v1||[];
    const u=after.filter(r=>Number.isFinite(Number(r.line))&&Number(r.line)>0&&!Number.isFinite(Number(r.result)));
    if(!after.some(isGhost)&&u.length===0){console.log(`clean after ${i+1} passes`);return;}
  }
})();
```
Cleared in 2 passes. (Better long-term: route archive deletes through a `PropArchiveService.mutate`
path so they're inside the same lock — the DELETE_ARCHIVE_EVENT/CLEANUP handlers still write directly.)

## Also this session
- Image note: the user's screenshots are 2560×1600; the image API strips images >2000px when several
  are sent in one turn. When a screenshot "can't be seen," ask for **console output as text** (a
  `console.log(JSON.stringify(...))` one-liner) instead.

## State / housekeeping
- Both branches in sync with origin; working tree clean except local-only `.claude/settings.local.json`.
- Upcoming card is rolling to **UFC Fight Night: Fiziev vs. Torres** (seen in prediction auto-correct
  logs). Betr reset rule applies post-event for the finished card.
- Memory updated: `project_event_flip_ghost_contamination` now notes the archiver ghost-event guard.
