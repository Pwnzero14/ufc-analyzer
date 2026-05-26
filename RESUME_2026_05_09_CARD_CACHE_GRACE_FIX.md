# Resume — 2026-05-09, fight day morning

**Branch:** `feature/sleek-theme-v1`
**HEAD (pushed):** `8017448` — feat(weight-miss): manual override via console
**Uncommitted:** `src/analyzer.ts`, `src/background.ts` — card cache grace fix (build clean, verified working in browser, NOT YET COMMITTED)
**Card:** UFC 328, fights tonight Sat May 9 → **by next session this card is in the past, results need to be absorbed**

---

## What broke this session

After the morning auto-fetch, the analyzer rendered fighters in scrambled order — Joshua Van/King Green at top as "MAIN EVENT", Chimaev mid-card, Strickland in the prelims. Pairings unrelated to actual matchups.

### Root cause

`isUsableUpcomingCard` (analyzer) and `isCardDateUsable` (background) both used a `-6h` grace window from `parseEventDateMs(card.date)`. That date parses to **midnight of event day**. So at 6:00 AM on event day, both functions started returning `false` — even though fights don't start until ~10 PM.

The analyzer's `syncUpcomingCardContext` reacts to a "not usable" cached card by **deleting the storage key entirely**:

```ts
// src/analyzer.ts (pre-fix)
if (!card) {
  applyUpcomingCardContext(null);
  await storageRemove(['upcoming_ufc_card']);  // ← wipe!
  return null;
}
```

So sometime around 6 AM today, `upcoming_ufc_card` got nuked. With `upcomingCardPairs` empty, `orderFightersByCard` returns fighters as-is (raw scrape order from line data), and the rendering pipeline assigns MAIN EVENT/CO-MAIN by array index — producing the scrambled UI.

### The fix (uncommitted)

Both functions now use a **30h grace** instead of 6h. Math: midnight event-day + 30h = 6 AM next morning. Covers fights (~10 PM event day) + result absorption window (~1-2 AM next day) + buffer.

```diff
// src/analyzer.ts:494-499
- // Only accept cards for events that haven't fully passed yet (6h grace for same-night use).
- return ts >= Date.now() - 6 * 60 * 60 * 1000;
+ // parseEventDateMs returns midnight of event day; UFC fights start ~10 PM event day
+ // and end ~1-2 AM the next morning. 30h grace keeps the card usable through fight
+ // night and into the morning after, when result absorption typically runs.
+ return ts >= Date.now() - 30 * 60 * 60 * 1000;
```

```diff
// src/background.ts:2797-2804  (same change to isCardDateUsable)
- return ts >= now - 6 * 60 * 60 * 1000;
+ return ts >= now - 30 * 60 * 60 * 1000;
```

Build clean (`npm run build` passes), reloaded extension, analyzer rendered correctly: Chimaev/Strickland MAIN EVENT, Joshua Van/Tatsuro Taira CO-MAIN, Volkov/Cortes Acosta heavyweight, etc.

---

## Things to do at start of next session

### 1. Commit + push the cache fix

```
git add src/analyzer.ts src/background.ts
git commit -m "fix(card-cache): widen event-day grace to 30h to prevent fight-day cache wipe"
git push
```

Two files, one logical change. Suggested message body: explain that midnight-based date parsing + 6h grace meant the card self-deleted at 6 AM event day, leaving `upcomingCardPairs` empty and fighters rendered in scramble order.

### 2. Settle UFC 328 results

By next session the card is over. Background `Settle` may have already absorbed it (the alarm is set for 2026-05-10T08:00:00Z per logs). Verify:

- Check `chrome.storage.local.get('upcoming_ufc_card')` — should now point at the NEXT event, not 328
- Or check `lastCompletedCard` for UFC 328 entry
- If Settle didn't fire / failed, run **Run Learning Cycle** button — but ONLY after next slate's Pick6/UD/Betr lines are loaded (see [project_learning_cycle_workflow.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_learning_cycle_workflow.md))

### 3. Clear Jeremy Stephens manual weight-miss flag

Per yesterday's session, `markMissedWeight('Jeremy Stephens', 4)` was active for UFC 328. After fight is settled:

```js
clearMissedWeight('Jeremy Stephens')
listMissedWeights()  // verify cleanup
```

### 4. UFC 328 lift verification

Re-run lift comparison post-card to see how the predictor v2 changes (duration model, RLM calibration, adaptive trend rate) performed. Predictor v2 #2 (book prior) still dead in production until archive grows beyond ~6 events.

---

## Side issue noted, not addressed this session

**Settle fires too early on event day.** Console showed during diagnostic:

```
[UFC Settle] Event "UFC 328: Chimaev vs. Strickland" already past, attempting settle now
[UFC Settle] 0 fights found for UFC 328: Chimaev vs. Strickland
[UFC Settle] Parsed 0 fighter results from 0 fights
```

Settle process used the same midnight-based date heuristic that caused the cache bug. It tried to settle UFC 328 at 10:27 AM on event day. Settled = 0 because UFCStats hasn't posted results yet (fights tonight). Harmless this run (`errors=0`, no bad data written) but wasteful and could mask real settle failures.

Possible follow-up: same `30h` (or even `next_day_midnight + 6h`) grace applied to whatever is gating Settle. Find via `[UFC Settle]` log strings:

- [src/background.ts:731](src/background.ts#L731) — `290 unresolved records across 2 event(s)`
- [src/background.ts:792](src/background.ts#L792) — `Matched ... → ...`
- [src/background.ts:802](src/background.ts#L802) — `0 fights found`
- [src/background.ts:3066](src/background.ts#L3066) — `already past, attempting settle now`

Defer until next session — non-blocking, just chatty.

---

## Carryover from yesterday's resume (still pending, unchanged)

- **Tab count race condition** — `LEAN OVER 0 / LEAN UNDER 0 / AI BEST PICKS 8` on hard reload, observed once, didn't reproduce
- **AUTO-FETCH state-aware styling** — button stays bright green even with fresh `5m` pills (CSS specificity)
- **Pick6 pickGroup polling misses CTRL** — needs live Pick6 CTRL props to repro, see [project_pick6_pickgroup_polling_pending.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md)
- **SS_R1 grader** — defer until next slate has SS_R1 props
- **Analyzer phase-2 split** — Betr IIFE + UI panels per [project_analyzer_split_progress.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md)
- **FP Betr lines for UFC 328** — moot, card over

---

## Files touched this session

```
src/analyzer.ts      | isUsableUpcomingCard: 6h → 30h grace + clarifying comment
src/background.ts    | isCardDateUsable: 6h → 30h grace + clarifying comment
```

Two-line behavioral change, ~6 lines diff including comment rewrite.

---

## Key code locations (cache pipeline)

- Analyzer-side date check: [src/analyzer.ts:494-501](src/analyzer.ts#L494-L501)
- Analyzer-side cache delete on reject: [src/analyzer.ts:565-567](src/analyzer.ts#L565-L567)
- Background-side date check: [src/background.ts:2797-2804](src/background.ts#L2797-L2804)
- Background-side fetch entry: [src/background.ts:2806 `fetchUpcomingUFCCard`](src/background.ts#L2806)
- Card pair → fighter order: [src/analyzer.ts:5662 `orderFightersByCard`](src/analyzer.ts#L5662)
- Render uses array index → main event / co-main / etc.: [src/analyzer.ts:10869-10875](src/analyzer.ts#L10869-L10875)

---

## Don't-forgets (unchanged)

- Don't propose Kelly stakes
- Don't recommend storage-mutating snippets without read-only diagnosis first
- Reset Lines preserves Betr pre-fight-week, clears on/after event day
- Same-fight cross-stat OVERs/UNDERs are negatively correlated — lean ONE side, never both
- Big |delta| ≠ data bug; check fighter UFCStats history before flagging delta anomalies
- Resume document at start of session can be stale on uncommitted state — verify with `git status` before assuming work is unshipped
