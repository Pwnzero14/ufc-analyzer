**Last session:** 2026-04-24. Branch: `feature/sleek-theme-v1`. Build: clean.

## ✅ BOTH UNRESOLVED FIXES RESOLVED 2026-04-24

### Fix A — Pick6 CTRL auto-fetch — RESOLVED

Root cause: `hasEnoughPick6StatCoverage` only required fp/ss/td, so the background wait loop broke at ~5s elapsed (as soon as fp/ss/td looked good) and closed the tabs BEFORE the content script finished its Time → Control Time click sequence (that's the last step of `scrapePick6AllStats` and runs ~6-8s into each tab's crawl). The ctrlGraceMet gate already existed on the early-exit and quiet-exit paths but the coverage-complete path had no such gate.

Fix in [src/background.ts:2062-2075](src/background.ts#L2062-L2075):
- Moved `ctrlGraceMet` above the coverage-complete check
- Gated the break on `ctrlGraceMet` so it waits for CTRL or grace expiry
- Bumped grace from 7000ms → 9000ms (log showed fp/ss/td done at ~5s elapsed; content script needs roughly 3-5 more seconds to finish the Time → Ctrl click sequence — 7000ms was still too tight)
- Added `ctrl=N` to the coverage-complete log

Verified by user: `pick6 concurrent coverage complete at T+12667ms: fighters=26, fp=26, ss=24, td=8, ctrl=15` — CTRL captured via auto-fetch, no manual visit required.

### Fix B — disappearing fighters — RESOLVED

Norma Dumont, Victor Valenzuela, Talita Alencar all now appear. Fixes in [src/analyzer.ts](src/analyzer.ts):
- Extended `strictCardNameMatch` with subsequence + single-word branches
- Added `canonicalizeCardOpponent` helper
- Added a post-merge sweep that rewrites every `entry.opponent` to the matching map key

Root cause: platforms sometimes scrape the opponent in a different form than that opponent's own entry key — e.g. Joselyne's opp came through as "Norma Dumont Viana" while Norma's entry key was "Norma Dumont" — which broke the reciprocal-opponent prune.

---

### Earlier Pick6 CTRL work (from prior session, kept for context)

Pick6 CTRL pipeline end-to-end when user **manually visits** Pick6 at the deep URL `category/46?sport=UFC&pickGroup=146377`:
- [src/content.ts](src/content.ts) `scrapePick6AllStats` — clicks Time tab → Control Time sub-tab in sequence (was missing the two-step nav)
- [src/content.ts](src/content.ts) `sendInterim` — fires when CTRL count changes, not just fighter count change (was withholding CTRL until final send)
- [src/background.ts](src/background.ts) `mergeFighters` — added `line_ctrl`, `ctrl_under_available`, `ctrl_over_odds`, `ctrl_under_odds` to the merge field allowlist (was silently dropping them)
- [src/background.ts](src/background.ts) `scrapePick6UrlsConcurrently` — added `ctrlCount` to coverage and gated early-exit on CTRL grace

---

**What was tried this session (didn't fix it):**
[src/analyzer.ts:13499-13548](src/analyzer.ts#L13499-L13548) side-cluster prune — added "rescue any cluster member that's on the upcoming card" via `isUpcomingCardFighter`. User reports this didn't work.

**Why it likely didn't work:**
The rescue depends on `isUpcomingCardFighter(name)` returning true for these three. That check goes through `strictCardNameMatch` ([src/analyzer.ts:350-364](src/analyzer.ts#L350-L364)) which requires:
- Same last name AND
- Same first-letter of first name AND
- At least one of the first names is ≥3 chars

For these three:
- **Norma Dumont** (platform) vs **Norma Dumont Viana** (UFCStats card) — last names "dumont" vs "viana" → DON'T MATCH ❌
- **Talita Alencar** (platform) vs **Ana Talita De Oliviera Alencar** (UFCStats card) — last names match ("alencar") but first names "talita" vs "ana" — first letters T vs A → DON'T MATCH ❌
- **Victor Valenzuela** — never investigated last session, may have similar mismatch

So `isUpcomingCardFighter` returns FALSE for these names → rescue doesn't trigger → side-cluster prune still kills them.

**Diagnostic snippet to confirm (paste in analyzer console):**
```js
// Check if isUpcomingCardFighter sees these three. They're not exposed directly,
// but we can check upcomingCardPairs:
console.log('Card pairs:', window.__upcomingCardPairs || 'not exposed');
// Or look at what passed through to allFighters AFTER reload:
console.log('All fighters:', allFighters?.map(f => f.name));
console.log('Looking for: Norma Dumont, Victor Valenzuela, Talita Alencar');
```

**Real fix paths (pick one next session):**
1. **Loosen `strictCardNameMatch`** to also try: last-N-words match, where N=1,2,3. So "Talita Alencar" matches "Ana Talita De Oliviera Alencar" because ["Talita Alencar"] is a suffix of ["Ana", "Talita", "De", "Oliviera", "Alencar"]. Risk: might over-match.
2. **Bidirectional substring check** — already partially exists in `namesMatch` ([src/analyzer.ts:13201-13212](src/analyzer.ts#L13201-L13212)) but `strictCardNameMatch` is more conservative. Either teach `isUpcomingCardFighter` to also use `namesMatch`, or add explicit suffix/prefix matching.
3. **Skip side-cluster prune entirely when slate is small (≤24 fighters)** — most slates that bleed into wrong components are due to platform name mismatch, not slate switches. Less surgical but might just work.
4. **Most surgical:** in the side-cluster prune, before deciding what to drop, run a second name-resolution pass that tries `namesMatch` (more permissive than `strictCardNameMatch`) to MERGE the islands first, so Norma+opponent end up in same component.

Recommended start: option 1 (loosen strictCardNameMatch with suffix-match) since it also helps `findOpponentFromUpcomingCard` resolve opponents correctly across platforms.

## Other context preserved from prior session

[Same as before — Sterling/Zalal card live, Betr lines entered, etc. All other features working.]

## Snapshot tags for revert

- `ufcstats-matching-v3` (2026-04-20)
- HEAD as of 2026-04-23 mid-session — has Fix 1a (CTRL when manual visit) but not Fix A or B working

## Don'ts (persistent)

- **LINE DATA IS IRREPLACEABLE.** Backup BEFORE any storage-mutating snippet.
- **NEVER bump `BETR_EVENT_DATE` or edit the hardcoded seed** to enter Betr lines.
- User is in **Chrome**. ↻ reload flushes cache.
- Betr entry: screenshot → Claude writes console snippet targeting `lines_betr_manual_v1`.
- **DK partial coverage is normal.**
- **Skip Pick6 CTRL UNDER unless `ctrl_under_available === true`.**

## Resume prompt

> Reading `RESUME_NEXT_SESSION.md`. Branch `feature/sleek-theme-v1`. **Two unresolved fixes — Pick6 CTRL auto-fetch (Fix A) and 3 disappearing fighters (Fix B).** Read both sections before doing anything. Do NOT re-attempt the same fixes that already shipped this session — they're listed under "What's already in code (didn't work)". Start with Fix B option 1 (loosen strictCardNameMatch) since it's surgical and may also help opponent resolution. Then for Fix A, investigate auto-fetch tab SPA navigation (likely option 1: force-navigate via chrome.tabs.update after waitForTabLoad).
