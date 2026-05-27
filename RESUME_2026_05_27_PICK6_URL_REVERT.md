# Resume — Pick6 URL Revert (DK flipped back to `?sport=UFC`)

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-05-27 (Wednesday early AM — fight week for Song vs Figueiredo 2026-05-30)
**Working tree:** One uncommitted edit to [src/config/index.ts](src/config/index.ts) (Pick6 URL revert). Everything else from the prior session is at `07f624d` on origin. Same two untracked dirs we deliberately left alone (Opera storage backup + empty nested copy).

---

## TL;DR

This week's Pick6 slate stopped fetching because DK reverted the 5/15 MMA-category URL consolidation. The bare `pick6.draftkings.com/?sport=UFC` is rendering UFC fighters directly with stat tabs again — exactly like pre-5/15. **One-line config flip** restores Pick6 fetching. Verified live: 14 lines captured on the Song vs Figueiredo card, 26 fighters loaded.

---

## What shipped this session

### Pick6 URL revert — [src/config/index.ts:14](src/config/index.ts#L14)

```diff
- url: 'https://pick6.draftkings.com/category/129?sport=MMA',
+ url: 'https://pick6.draftkings.com/?sport=UFC',
```

Comment updated to flag this as a known back-and-forth: DK has flipped twice now, so the comment names both forms and notes which to revert to if it flips again. The supporting code paths are all already form-agnostic:

- [background.ts:2312-2316](src/background.ts#L2312-L2316) pickGroup injection only triggers on `/category/...` URLs → harmless no-op for the bare URL.
- [content.ts:288](src/content.ts#L288) UFC sub-tab click is idempotent — no-op when the sub-tab doesn't exist.
- [content.ts:892-895](src/content.ts#L892-L895) pickGroup capture already accepts both `sport=UFC` and `sport=MMA` (was fixed prophylactically on 5/15).

No other changes required. Build clean.

### Live verification

Auto-fetch on Song vs Figueiredo card after reload:
- Pick6: 14 lines (status pill: `Pick6 14 now`)
- Underdog: 18 lines (was already working)
- 26 fighters loaded with stats
- Slate check: P6 missing 12 (normal partial coverage — props still rolling out, per `project_dk_partial_coverage` memory)

---

## Memory updated

[project_dk_pick6_mma_consolidation.md](.claude/projects/c--Users-abdir-Downloads-ufc-project-v2/memory/project_dk_pick6_mma_consolidation.md) — rewritten to document the flip-flop pattern rather than the one-time 5/15 change. Future session encountering Pick6 fetch failure should:

1. Check what URL the auto-fetch tab actually lands on.
2. Compare against `CONFIG.platforms.pick6.url`.
3. Flip the config string.

That's it — surrounding code is form-agnostic.

---

## Sticky context for next session

- **Next UFC card:** Song vs Figueiredo Friday 2026-05-30 (Macau, China).
- **Branch:** `feature/sleek-theme-v1` — clean except for this one uncommitted Pick6 URL edit. Probably commit before next thing.
- **Build clean as of last `npm run build`.**
- **UFCStats PoW wrapper (shipped 5/26)** working — UFCStats data + matchups all correct end-to-end.

---

## Don't-forgets (unchanged)

- Don't propose Kelly stakes
- Don't recommend storage-mutating snippets without read-only diagnosis first
- Reset Lines preserves Betr pre-fight-week, clears on/after event day
- Same-fight cross-stat OVERs/UNDERs are negatively correlated — lean ONE side
- Big |Δ| ≠ data bug; check fighter UFCStats history before flagging delta anomalies
- Verify uncommitted state with `git status` before assuming work is unshipped
- UFCStats name aliases must use the post-`normalizeName` (title-cased) form, not the raw UFCStats string
- **NEW:** Pick6 URL flips between `?sport=UFC` and `/category/129?sport=MMA` across events — treat URL drift as the default Pick6 failure mode, not selector/DOM breakage

---

## Next session priorities (still mostly from 5/26)

### Option A — Commit the Pick6 URL flip (5 min, recommended first)

One-line change, clean small commit. Title something like `fix(pick6): revert URL to ?sport=UFC after DK flipped back`.

### Option B — Ship the ghost-fighter archive-write fix

Still pending from 5/17. [background.ts:1108](src/background.ts#L1108) should filter archive writes against `card.pairs` not the platform roster union. Prevents the UD cross-promotion ghost-line problem at source. Natural follow-up.

### Option C — Predictor UI decouple

Per [RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md](RESUME_2026_05_10_PRE_LINE_PREDICTIONS.md). Allow GENERATE PREDICTIONS to work on the card before platform lines drop. ~30-45 min.

### Option D — Watch Friday's card live

Song vs Figueiredo runs 2026-05-30. First post-PoW-fix event AND first event where Pick6's URL flip-flop is documented. Worth being around to catch any settle-path or fetch regressions live.

---

## Next session opener

> Continuing `feature/sleek-theme-v1`. Last session (2026-05-27): DK reverted Pick6's 5/15 MMA-category consolidation, so flipped `CONFIG.platforms.pick6.url` back to `https://pick6.draftkings.com/?sport=UFC` ([src/config/index.ts:14](src/config/index.ts#L14)). Verified live — 14 Pick6 lines + 18 UD lines on Song vs Figueiredo card. Memory updated to treat Pick6 URL drift as recurring. One-line uncommitted edit ready to ship. Next likely target: commit the URL flip, then ghost-fighter archive-write fix at [background.ts:1108](src/background.ts#L1108). See [RESUME_2026_05_27_PICK6_URL_REVERT.md](RESUME_2026_05_27_PICK6_URL_REVERT.md).
