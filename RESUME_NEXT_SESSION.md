**Last session:** 2026-04-20. Branch: `feature/sleek-theme-v1`. Build: clean. UFCStats name-match fixes landed for Sterling/Zalal card.

## This session — UFCStats matching bugs fixed

Sterling vs. Zalal predictions surfaced three distinct name-match bugs in `src/analyzer.ts`. All fixed in one go; user bypassed the "read-only diagnosis first" rule ("just do it like you would have") since these are in-code fixes behind a cache-bump flush (safely reversible).

### Bug fixes (all in [src/analyzer.ts](src/analyzer.ts))

1. **Mayra Bueno Silva — wrong opponent history (old heavyweight men).** Two compounding bugs: (a) 3-word name only generated `last=silva` on 's' page; (b) dangerous fallback matched any row with any cell equal to "silva".
   - Added compound-last candidate: `{char:'b', first:'mayra', last:'bueno silva'}`
   - Rewrote `findDetailUrl` to require strict cell-level match (cells[0]=first, cells[1]=last), removed loose fallback.

2. **Marcus Buchecha — only 1 fight shown (missing DRAW vs Nzechukwu).** `parseFightHistoryLinks` regex filtered draw/nc. Extended `/>\s*(win|loss)\s*</i` → `/>\s*(win|loss|draw|nc)\s*</i`. Downstream consumers use `=== 'win'` / `=== 'loss'` so draws don't inflate streaks.

3. **Norma Dumont Viana — not loading.** UFCStats drops trailing Portuguese surname, lists her as just "Norma Dumont". Added middle-word-as-last candidate: `{char:'d', first:'norma', last:'dumont'}`.

4. **Ana Talita De Oliviera Alencar — not loading.** UFCStats lists her as just "Talita Alencar". Added 4+-word candidate using second word as first name: `{char:'a', first:'talita', last:'alencar'}`.

Cache key bumped `v42 → v46` across the four fix cycles (flushes stale mismatched entries).

## Snapshot tags for revert

- `ui-snapshot-pre-visual-v1` (commit `4a80feb`) — QA panel done, no visual polish yet
- `ui-snapshot-visual-v2` (commit `e4d8390`) — density + severity applied
- `ufcstats-matching-v3` (this session) — **CURRENT** — all four name-match fixes landed

## Event state

**UFC Fight Night: Sterling vs. Zalal** — predictions generated 2026-04-20, refreshed this session with corrected UFCStats fight histories. No Betr base lines yet. Screenshots → console snippet workflow when fight week opens.

**UFC Fight Night: Burns vs. Malott** (2026-04-18) — fully settled. AI pick accuracy 17/20 (85%). Learning cycle digested 344 records.

## Visual enhancement menu — 5 options still on the table

User implemented options 1 & 2 from the original list. Still open:

3. **Sticky mini-header with slate summary** — pinned bar w/ event + countdown + QA pill.
4. **Fighter row redesign** — two-line card, platform icons instead of text.
5. **Dark-mode refinement** — contrast audit, 2-tone neutral ramp, soft glows.
6. **Badge system unification** — consistent pill language across badge types.
7. **Animated transitions** — fade-in panels, tab slide, line-movement pulse.

## Don'ts (persistent)

- **LINE DATA IS IRREPLACEABLE.** Never recommend storage-mutating snippet without read-only diagnostic + backup first. See `memory/feedback_no_destructive_snippets_without_verify.md`.
- **Disambiguate badges** before debugging "missing badge" reports. `.line-movement` vs `.best-shop-badge`. See `memory/feedback_badge_disambiguation.md`.
- User is in **Chrome** (migrated from Opera GX 2026-04-17). ↻ reload flushes cache.
- Betr entry: screenshot → Claude writes console snippet. Never ask user to type rows.
- **DK partial coverage is normal** — don't flag "X of Y fighters missing DK" as bug.
- **Cross-book disagreement is normal** — that's why best-shop exists.
- **Post-event settle flow:** Force Backfill first. If stragglers, Dismiss (auto-clears Betr). Don't manually RESET LINES after Dismiss.
- **UFCStats name-match fixes bypass "verify first" rule** — in-code, cache-bumped, reversible. User confirmed pattern this session.

## Resume prompt (paste to next session)

> Reading `RESUME_NEXT_SESSION.md`. Branch `feature/sleek-theme-v1`, code at tag `ufcstats-matching-v3`. Last session fixed four UFCStats name-match bugs (Mayra Bueno Silva, Marcus Buchecha draws, Norma Dumont Viana, Ana Talita De Oliviera Alencar) — cache at v46. Sterling/Zalal predictions now populate correctly. Next work: either enter Betr base lines for Sterling/Zalal when I send screenshots, or pick one of the 5 remaining visual enhancements (sticky mini-header, fighter row redesign, dark-mode refinement, badge unification, animated transitions).
