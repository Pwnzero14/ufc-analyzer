# Resume — UFCStats PoW Bot Challenge + Song vs Figueiredo Name Aliases

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-05-26 (Monday early AM — fight week for Song vs Figueiredo 2026-05-30)
**Working tree:** Clean of session work. Everything captured in checkpoint commit `07f624d` and pushed to origin. Only items still uncommitted: `.claude/settings.local.json` (machine-specific, intentional skip) + two untracked dirs we deliberately left alone (`UsersabdirAppDataRoaming…Opera GX.../` looks like an irreplaceable Opera storage backup; `ufc_project_v2/` looks like an empty nested copy).

---

## TL;DR

Fight week for Song vs. Figueiredo opened with a fully broken slate. Three independent bugs stacked:

1. **UFCStats deployed a SHA-256 proof-of-work bot challenge** — every page now returns a 2998-byte "Checking your browser…" stub until solved. Solved via a new wrapper module.
2. **Render skip mis-classified all fighters as "placeholders"** when UFCStats whiffed every fetch, hiding the entire card even though UD had 18 lines.
3. **Chinese fighter name reversals + UFCStats's internal-capitalization of `YiSak Lee`** broke unification between platform scrapes and the UFCStats schedule, cascading into shifted card-pair grouping.

All three fixed. UFCStats data loading, matchups correct end-to-end. **Backlog from prior ~3 weeks of work plus this session shipped in checkpoint commit [`07f624d`](../../commit/07f624d) and pushed to origin** — 40 files, +4893/-194.

---

## What shipped this session

### 1. PoW solver wrapper — [src/services/ufcstats-fetch.ts](src/services/ufcstats-fetch.ts) (NEW)

UFCStats now serves a SHA-256 proof-of-work challenge on every page:
- `nonce="xxxxxxxx"` + `target=new Array(N+1).join('0')` (typically N=2, so 8 bits of leading zeros = ~256 SHA-256 iterations)
- Solve, POST to `/__c` with `credentials:'include'` → server sets session cookie
- Subsequent fetches carry the cookie automatically

Public API: `ufcstatsFetchText(url, init?) → Promise<string | null>` — drop-in replacement for `fetch(url).then(r => r.text())`. Handles the challenge transparently with one retry.

**Wired into 12 fetch sites:**
- [src/analyzer.ts](src/analyzer.ts): alpha index (`getAlphaPage`), fighter detail page, per-fight detail batches, event list, event detail (5 sites)
- [src/background.ts](src/background.ts): settle completed-events list, settle event page, refresh-event-fighter event page, upcoming/completed/last/next-event fetches (7 sites)

Cookie is browser-managed and shared across both contexts via the existing `http://www.ufcstats.com/*` host permission. One PoW solve per session unblocks everything.

### 2. Render placeholder fix — [src/analyzer.ts:11317](src/analyzer.ts#L11317)

`isPlaceholderFighter(f)` returns `f.db?.loaded === false` — purely about UFCStats data presence. When UFCStats fetch failed for *every* fighter (PoW wall, name mismatches, etc.), every fighter on the slate counted as placeholder, and the fight-pair render loop skipped **every** pair → empty card.

Fix: the skip now also requires both fighters to have no lines from any platform. Fighters with UD/Pick6 lines render with `⟳` placeholders in the stats columns until UFCStats catches up.

### 3. Name aliases — [src/analyzer.ts:14135](src/analyzer.ts#L14135) (`NAME_ALIASES`) and [src/analyzer.ts:871](src/analyzer.ts#L871) (`UFCSTATS_NAME_ALIASES`)

Added Chinese fighter aliases for the Song vs Figueiredo card. Platforms use Western order (given-family), UFCStats uses Chinese order (family-given). Unified to UFCStats canonical form:

```
'Yadong Song':    'Song Yadong'
'Yi Sak Lee':     'Yisak Lee'  ← see "YiSak gotcha" below
'Qileng Aori':    'Aoriqileng'
'Aori Qileng':    'Aoriqileng'
'Xiong Jing Nan': 'Xiong Jingnan'
'Kangjie Zhu':    'Zhu Kangjie'
'Meng Ding':      'Ding Meng'
'Mingyang Zhang': 'Zhang Mingyang'
'Jingnan Xiong':  'Xiong Jingnan'
```

Plus `UFCSTATS_NAME_ALIASES['su mudaerji'] → 'Sumudaerji'` so the alpha-index lookup uses the UFCStats single-word form (analyzer canonical is "Su Mudaerji" to preserve historical archive keys).

### 4. Single-word fighter support — [src/analyzer.ts:901](src/analyzer.ts#L901) + [analyzer.ts:973](src/analyzer.ts#L973)

`nameCandidates` returned `[]` for any 1-word name, so Aoriqileng / Sumudaerji couldn't fetch at all. Added:
- Candidates with empty `first` (or empty `last`) for 1-word names
- `findDetailUrl` treats empty `firstLower`/`lastLower` as "the corresponding cell must be empty" — matches UFCStats rows where the single name lives in just one cell

### 5. Reverse alpha-page candidate — [src/analyzer.ts:951](src/analyzer.ts#L951)

For 2-word names where `first[0] !== last[0]`, also try `?char=first[0]` with the same first/last. Covers UFCStats indexing Chinese fighters by family-name initial (Song Yadong indexed on `s` page even though our default search is `y`).

---

## The YiSak gotcha (worth remembering)

UFCStats spells it **`YiSak Lee`** (internal capital S). `normalizeName` title-cases each word, so `"YiSak Lee"` → `"Yisak Lee"` (lowercase rest).

If you alias `'Yi Sak Lee' → 'YiSak Lee'`, the UFCStats-side path produces `"Yisak Lee"` and the UD-side produces `"YiSak Lee"` — two separate entries, reciprocal-opponent prune drops one, fighter goes missing, card shifts by +1 from that fight onward, last fighter orphaned.

**Rule:** alias keys/values must match the **post-title-case** form, not the raw UFCStats string. Final canonical was `'Yisak Lee'`. Lost ~20 minutes on this — only spotted it by tracing the shift offset back to fight 7 in the screenshots.

---

## Sticky context for next session

- **Next UFC card:** Song vs Figueiredo Friday 2026-05-30 (Macau, China). Detail page: ufcstats.com/event-details/1e75e6c9de99fa76.
- **Branch is clean and pushed.** `feature/sleek-theme-v1` is at `07f624d` on origin. No more multi-week backlog risk — going forward, commit per feature.
- **Build clean as of last `npm run build`.**
- **Ghost-fighter archive-write fix at [background.ts:1108](src/background.ts#L1108)** still pending from 5/17 resume — that's the cleanest next thing to ship.

---

## Memory written

- [project_ufcstats_bot_challenge.md](.claude/projects/c--Users-abdir-Downloads-ufc-project-v2/memory/project_ufcstats_bot_challenge.md) — Documents the PoW wrapper. Future sessions don't need to rediscover the challenge.

---

## Don't-forgets (unchanged)

- Don't propose Kelly stakes
- Don't recommend storage-mutating snippets without read-only diagnosis first
- Reset Lines preserves Betr pre-fight-week, clears on/after event day
- Same-fight cross-stat OVERs/UNDERs are negatively correlated — lean ONE side
- Big |Δ| ≠ data bug; check fighter UFCStats history before flagging delta anomalies
- Verify uncommitted state with `git status` before assuming work is unshipped
- **NEW:** UFCStats name aliases must use the post-`normalizeName` (title-cased) form, not the raw UFCStats string

---

## Next session priorities

### Option A — Ship the ghost-fighter archive-write fix (recommended)

Still pending from 5/17. [background.ts:1108](src/background.ts#L1108) should filter archive writes against `card.pairs` not the platform roster union. Prevents the UD cross-promotion ghost-line problem at source. Natural follow-up to the PoW work, doable as a clean small commit.

### Option B — Predictor UI decouple

Per [RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md](RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md). Allow GENERATE PREDICTIONS to work on the card before platform lines drop. ~30-45 min.

### Option C — Watch Friday's card live

Song vs Figueiredo runs 2026-05-30. First post-PoW-fix event. Worth being around to catch any settle-path regressions live since the settle path also routes through `ufcstatsFetchText` now.

---

## Next session opener

> Continuing `feature/sleek-theme-v1` (clean, pushed, at `07f624d`). Last session (2026-05-26): solved UFCStats's new SHA-256 PoW bot challenge via a wrapper at [src/services/ufcstats-fetch.ts](src/services/ufcstats-fetch.ts), fixed an analyzer render bug where placeholder-fighter skip nuked the whole card when UFCStats whiffed, added name aliases for Song vs Figueiredo's Chinese fighters (incl. a `YiSak Lee` post-title-case gotcha), and committed ~3 weeks of backlog. UFCStats data + matchups all correct end-to-end. Next likely target: ghost-fighter archive-write fix at [background.ts:1108](src/background.ts#L1108). See [RESUME_2026_05_26_UFCSTATS_POW_AND_NAME_ALIASES.md](RESUME_2026_05_26_UFCSTATS_POW_AND_NAME_ALIASES.md).
