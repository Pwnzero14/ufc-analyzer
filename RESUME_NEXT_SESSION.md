**Last session:** 2026-04-24. Branch: `feature/sleek-theme-v1`. Build: clean. Snapshot tag: `clv-rlm-v1`.

## What shipped this session

Two features from the "make the analyzer better" brainstorm — the post-event CLV audit loop and the reverse-line-movement signal.

### Feature 1 — Post-event CLV audit loop

Closes the feedback loop between AI picks and actual closing-line reality. Two parts:

**Per-source measured Bayesian prior** — replaces the hardcoded `historicalAccuracy = 0.55` in [src/analyzer.ts:1801](src/analyzer.ts#L1801) (formerly line 1814 before insertions).
- New storage: `bayesian_priors_v1` (per-source `fp`/`ss`/`td`/`ft` hit rate) at [src/analyzer.ts:606](src/analyzer.ts#L606).
- Module state `_bayesianPriors` + `loadBayesianPriors()` + `getHistoricalPriorForSource()` just above `calcBayesianLean`.
- Priors computed inside `initRecalibrationMap` at [src/analyzer.ts:13878-13894](src/analyzer.ts#L13878-L13894) from the same `typeB` buckets it already iterates. Beta(5.5, 4.5) smoothing → low-N stays near 0.55, measured accuracy takes over as N grows. Clamped to [0.30, 0.80].
- `calcBayesianLean` signature now accepts optional `source?: LeanSource` param. Three call sites updated to pass `'fp'` (all three are FP-only flows): [src/analyzer.ts:2066](src/analyzer.ts#L2066), [src/analyzer.ts:2952](src/analyzer.ts#L2952), [src/analyzer.ts:3107](src/analyzer.ts#L3107).
- `loadBayesianPriors()` kicked off alongside `initRecalibrationMap` in `mergeAndEnrich` at [src/analyzer.ts:13774](src/analyzer.ts#L13774).

**"Your CLV (entry → close)" panel section** — new section in the Archive panel, right below "AI Pick Accuracy by Stat Type".
- Per-pick CLV: `(lean === 'over' ? 1 : -1) * (closeLine - entryLine)`. Positive = you beat the close.
- Data join: `ai_lean_snapshots_v1.picks[].activeLine` (entry) × `prop_archive_v1.line` (close). Counts picks even without settled results — closing line alone is enough for CLV.
- Per-source badges show: avg CLV · % of picks that beat close · % hit-rate (when resolved). Low-N (<5) greys out.
- Sanity-bound: |CLV| > 20 rejected as likely name/platform mismatch.
- Aggregation loop at [src/analyzer.ts:8720-8775](src/analyzer.ts#L8720-L8775), badge renderer at [src/analyzer.ts:8899-8919](src/analyzer.ts#L8899-L8919), section mount at [src/analyzer.ts:9525](src/analyzer.ts#L9525).

### Feature 3 — Reverse-line-movement signal

Proxy RLM without ticket% data. On pick-em platforms the public default on fantasy-style props is OVER — so a line RISING against opening is a sharp-UNDER signal.

**Type extension** — `LineMovementEvent` in [src/types/index.ts:188-191](src/types/index.ts#L188-L191) gained `rlm?: 'under' | 'over'` and `rlmReason?: string`.

**Classifier** — `LineDropService.classifyRLM()` at [src/analyzer.ts:14939-14963](src/analyzer.ts#L14939-L14963):
- Pick-em only (p6/ud/pp/betr); DK skipped because juice changes the public-default model.
- RLM UNDER: current ≥1.0 above open (strong), or absDelta ≥1.5 within-session rise (weak).
- RLM OVER: current ≤-2.0 below open AND absDelta ≥1.5 this poll.
- Wired in at the event-construction site [src/analyzer.ts:14926](src/analyzer.ts#L14926).

**Rendering** — same RLM classification ported to the opening-anchored summary roll-up:
- Live feed (`renderLineMoveFeed`) at [src/analyzer.ts:14644](src/analyzer.ts#L14644) — adds an RLM chip next to the value-spike chip.
- Movement summary (`renderLineMovementSummary`) at [src/analyzer.ts:14571-14602](src/analyzer.ts#L14571-L14602) — inline pick-em rise/drop counters, same UNDER/OVER rules, chip alongside STEAM.
- Styles `.rlm-tag.rlm-under` (purple) + `.rlm-tag.rlm-over` (blue) in [analyzer.html:1345-1355](analyzer.html#L1345-L1355).

### To verify in the browser

1. Reload the extension in `chrome://extensions` (↻ reload flushes cache).
2. Open the analyzer. Archive panel should show a new "Your CLV (entry → close)" section with badges — values accumulate as `ai_lean_snapshots_v1` × `prop_archive_v1` match up. On an empty archive, badges show `—`.
3. Line Movement Summary + Line Move Feed should show `RLM UNDER` / `RLM OVER` chips on rows where the RLM heuristic fires. Rise of ≥1.0 against opening on any pick-em platform triggers UNDER; deep drop ≤-2.0 triggers OVER.
4. No storage migration. Opening lines / line history / Betr seed untouched.

---

## What's on deck (nothing urgent)

All four remaining brainstorm items from the "make the analyzer better" list are unstarted. In rough order of leverage:

1. **Fractional-Kelly stake sizing on each fighter row** — EV is already computed per-book ([src/analyzer.ts:5929](src/analyzer.ts#L5929)) and recalibrated confidence at [src/analyzer.ts:9798](src/analyzer.ts#L9798). ~10 lines to add a `~X% BR` chip.
2. **Weight-cut / weigh-in flag** — parallel to `fetchAllFighterNews` at [src/analyzer.ts:10810](src/analyzer.ts#L10810). Scrape weigh-in results day-of; "missed weight" / "looked depleted" → flag for R1 props and FP UNDER.
3. **"Why this lean" — top 3 feature contributors** — `buildDFSFeatureVector` at [src/analyzer.ts:4193](src/analyzer.ts#L4193) already has the features; surfacing the top 3 by contribution is mostly UI.
4. **Split `analyzer.ts`** — 16k+ lines in one file. A `src/analyzer/` folder split would make all future features cheaper. Not glamorous; enables everything else.

---

## Snapshot tags for revert

- `clv-rlm-v1` (2026-04-24) — **latest.** Post-event CLV audit + RLM signal shipped. Build clean.
- `ctrl-autofetch-v1` (2026-04-24) — Pick6 CTRL auto-fetch + disappearing fighters fixed + similar-opp panel.
- `ufcstats-matching-v3` (2026-04-20)

## Don'ts (persistent)

- **LINE DATA IS IRREPLACEABLE.** Backup BEFORE any storage-mutating snippet.
- **NEVER bump `BETR_EVENT_DATE` or edit the hardcoded seed** to enter Betr lines.
- User is in **Chrome**. ↻ reload flushes cache.
- Betr entry: screenshot → Claude writes console snippet targeting `lines_betr_manual_v1`.
- **DK partial coverage is normal.**
- **Skip Pick6 CTRL UNDER unless `ctrl_under_available === true`.**

## Resume prompt

> Reading `RESUME_NEXT_SESSION.md`. Branch `feature/sleek-theme-v1`. Snapshot tag `clv-rlm-v1` (2026-04-24) is the current known-good state — this session added the post-event CLV audit loop (per-source measured Bayesian prior replacing the 0.55 default, plus a "Your CLV (entry → close)" section in the Archive panel) and the reverse-line-movement signal (RLM UNDER/OVER chips on pick-em movements in the feed and summary). Both features built clean, nothing to verify blocking. Four follow-ups queued (Kelly sizing, weigh-in flag, feature explanations, analyzer.ts split) — none urgent. Ask what's on deck before assuming work.
