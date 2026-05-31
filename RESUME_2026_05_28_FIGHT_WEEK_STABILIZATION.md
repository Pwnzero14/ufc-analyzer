# Resume — Fight Week Stabilization (Song vs Figueiredo)

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-05-28 (Thursday, fight week for Song vs Figueiredo Friday 2026-05-30)
**Working tree:** Clean except `.claude/settings.local.json` and the two pre-existing untracked dirs (Opera storage backup + empty nested copy). All session work shipped in two commits on top of prior session's `e4d230d`.

---

## TL;DR

Three fight-week bugs surfaced on the Song vs Figueiredo card and were fixed:

1. **Matchup pairing cascade-broke from Jake Matthews onward** — Carlston Harris was parsed as "Harris Carlston" (last-first) and Aoriqileng as "Aori Aoriqileng" (first-name duplicates the single-name) by Underdog. Both missed `upcomingCardPairs` lookup, falling into the i%2 positional pairing trap from commit 756b695.
2. **Pick6 CTRL auto-fetch silently dropped all CTRL data** — three compounding root causes (URL drift, tab nesting, inactive-tab throttling).
3. **Su Mudaerji's unplaceable Pick6 FP UNDER surfaced in Best Picks** — his moneyline lookup failed because BestFightOdds duplicates single-word fighter names in its markup ("Sumudaerji Sumudaerji"), so `isMoneylineUnderdog` returned false and the pick-em UNDER filter didn't fire.

All verified working in the live analyzer. Two commits, ready to push.

---

## What shipped this session

### Commit 1 — `10ed4ac fix(aliases): name normalization for live card + odds lookup`

Two name-format fixes bundled because both are "platform spelling ≠ canonical UFCStats form":

**[src/analyzer.ts:14184-14185](src/analyzer.ts#L14184-L14185)** — two new NAME_ALIASES entries:
```
'Aori Aoriqileng':  'Aoriqileng',
'Harris Carlston':  'Carlston Harris',
```
Restores matchup pairing for fights 5–13 (Jake Matthews vs Carlston Harris, Alex Perez vs Sumudaerji, YiSak Lee vs Luis Felipe Dias, etc.). Both fighters now also resolve UFCStats data via the alias lookup in `fetchFromUFCStats`.

**[src/background.ts:48-53](src/background.ts#L48-L53)** — `parseBestFightOddsMoneylines` now de-dupes two-token name repeats:
```ts
const parts = n.split(' ');
if (parts.length === 2 && parts[0] === parts[1] && parts[0].length >= 4) {
  n = parts[0];
}
```
BestFightOdds renders single-word fighters (Sumudaerji, Aoriqileng, others) as "Name Name" in their row markup. Without dedupe, the moneyline ends up keyed under the duplicated form. Analyzer's lookup uses the alias-resolved canonical name ("Su Mudaerji") and misses. After dedupe, storage holds `{Sumudaerji: 117}` → analyzer's `normalizeName` applies the `'Sumudaerji': 'Su Mudaerji'` alias on load → `fightOddsMoneylineByName["Su Mudaerji"] = 117` → `isMoneylineUnderdog` returns true → pick-em UNDER filter at [src/analyzer.ts:6689](src/analyzer.ts#L6689) suppresses Su Mudaerji's Pick6 FP UNDER from Best Picks.

### Commit 2 — `dda8d67 fix(pick6): restore CTRL auto-fetch — URL + Time-parent click + active tab`

Pick6 CTRL hadn't been auto-fetched in weeks. Three compounding causes, all addressed:

**[src/config/index.ts:14](src/config/index.ts#L14)** — Pick6 URL changed back from `?sport=UFC` (bare) to `/category/46?sport=UFC`. Bare URL loads but is missing the Time parent tab until DK's SPA finishes redirecting to `/category/N` — and the redirect happens too slowly for the auto-fetch crawl. The existing pickGroup injection in [background.ts:2305-2324](src/background.ts#L2305-L2324) appends the cached `&pickGroup=148389`, landing the tab on the per-event view immediately.

**[src/content.ts:321-328](src/content.ts#L321-L328)** — Time parent click added before Control Time sub-tab click. DK re-nested Control Time as a sub-tab under a parent "Time" tab; the DOM doesn't contain the Control Time button until "Time" is clicked. Wait times bumped (Time: 1000ms, Control Time: 1200ms, post-scroll: 1200ms) as belt-and-suspenders for any residual rAF throttling.

**[src/background.ts:2118-2124](src/background.ts#L2118-L2124)** — Pick6 tab opens with `active: true` (was `active: false`). Chrome throttles `requestAnimationFrame` to ~1Hz in background tabs; React batches view updates through rAF; stat-tab clicks happened but cards never re-rendered before the scrape ran. Opening active means user gets briefly switched to Pick6 for ~13s, then the tab auto-closes in the `finally` block at [background.ts:2200](src/background.ts#L2200), returning focus to the previous tab.

### Memory updated

[project_pick6_pickgroup_polling_pending.md](.claude/projects/c--Users-abdir-Downloads-ufc-project-v2/memory/project_pick6_pickgroup_polling_pending.md) — rewritten. The old hypothesis (pickGroup polling broken in auto-fetch tabs) was wrong. Real root cause is the three-part fix above. Renamed to `pick6-ctrl-fetch-pattern` slug. Includes a diagnostic recipe: open a fresh tab to the auto-fetch URL with DevTools BEFORE navigating, watch for `[UFC Ext] pick6:` lines.

[MEMORY.md](.claude/projects/c--Users-abdir-Downloads-ufc-project-v2/memory/MEMORY.md) — index entry updated to reflect resolution.

---

## Sticky context for next session

- **Next UFC card:** Song vs Figueiredo Friday 2026-05-30 (Macau, China).
- **Branch:** `feature/sleek-theme-v1` — clean. Two commits ahead of origin. Push when ready.
- **Build clean** as of last `npm run build`.
- **Live analyzer state verified:** matchups correct end-to-end, Pick6 CTRL chips populated after auto-fetch, Su Mudaerji no longer in Best Unders.

---

## Don't-forgets (unchanged)

- Don't propose Kelly stakes
- Don't recommend storage-mutating snippets without read-only diagnosis first
- Reset Lines preserves Betr pre-fight-week, clears on/after event day
- Same-fight cross-stat OVERs/UNDERs are negatively correlated — lean ONE side
- Big |Δ| ≠ data bug; check fighter UFCStats history before flagging delta anomalies
- Verify uncommitted state with `git status` before assuming work is unshipped
- UFCStats name aliases must use the post-`normalizeName` (title-cased) form, not the raw UFCStats string
- Pick6 URL flips between `?sport=UFC`, `/category/46`, and `/category/129` across events — treat URL drift as the default Pick6 failure mode
- **NEW:** Pick-em underdog FP UNDER filter relies on `isMoneylineUnderdog`, which relies on moneyline data being keyed under the canonical (alias-resolved) name. If a future single-name fighter appears in Best Unders incorrectly, check whether their BestFightOdds key got duplicated past the new dedupe guard.
- **NEW:** Pick6 auto-fetch now opens the tab active — user gets briefly switched to Pick6 mid-auto-fetch. UX trade for reliable CTRL/TD/SS capture.

---

## Next session priorities

### Option A — Push the two commits (1 min)

`git push origin feature/sleek-theme-v1`. Both are stable fight-week fixes verified live. Worth shipping to origin before Friday's card.

### Option B — Watch Friday's card live (2026-05-30)

First post-fix event. Auto-fetch behavior to confirm:
- Matchup pairings stay correct after fresh fetches
- Pick6 CTRL chips populate on auto-fetch (briefly switches user to Pick6 tab, then returns)
- Best Picks doesn't suggest unplaceable Pick6 FP UNDERs for any underdog
- Settle path correctly grades Su Mudaerji / Aoriqileng / Carlston Harris archive rows (verify alias resolution works at settle time too)

### Option C — Ghost-fighter archive-write fix (still pending from 5/17)

[background.ts:1108](src/background.ts#L1108) should filter archive writes against `card.pairs` not the platform roster union. Prevents the UD cross-promotion ghost-line problem at source. Natural follow-up.

### Option D — Predictor UI decouple

Per [RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md](RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md). Allow GENERATE PREDICTIONS to work on the card before platform lines drop. ~30-45 min.

---

## Next session opener

> Continuing `feature/sleek-theme-v1`. Last session (2026-05-28): shipped three fight-week fixes for the Song vs Figueiredo card across two commits — name normalization (Carlston Harris / Aori Aoriqileng pairing + BestFightOdds duplicate-name parser for Su Mudaerji underdog detection) at `10ed4ac`, and Pick6 CTRL auto-fetch restoration (URL + Time-parent click + active tab) at `dda8d67`. All verified live in the analyzer. Two commits ahead of origin, ready to push. Next likely target: push commits, then ghost-fighter archive-write fix at [background.ts:1108](src/background.ts#L1108). See [RESUME_2026_05_28_FIGHT_WEEK_STABILIZATION.md](RESUME_2026_05_28_FIGHT_WEEK_STABILIZATION.md).
