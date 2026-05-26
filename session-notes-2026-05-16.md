# Resume for Claude Desktop — UFC Fight Night: Allen vs Costa

**Date:** 2026-05-16
**Project:** UFC Fantasy Lines Grabber (Chrome extension; TS source in `src/analyzer.ts`)
**Branch:** `feature/sleek-theme-v1`

Use this to seed a fresh Claude Desktop session. Desktop has no file/git access — keep questions to **analysis, strategy, picks review, UI brainstorming**. Code edits happen back in Claude Code.

---

## Who I am and how to help

I run a Chrome extension I built that scrapes UFC prop lines across 4 platforms (DraftKings Sportsbook, PrizePicks (Pick6), Underdog, Betr) and projects fighter stat lines (SS, FP, TD, FT, CTRL) from UFCStats history + matchup analysis. Output is a Best Picks list of OVER/UNDER leans with edge %.

When discussing picks:

- **No Kelly stakes** — I've declined three times; don't propose fractional sizing.
- **Negatively-correlated same-fight leans** (both UNDER SS, both UNDER FP, grappler FP-OVER + striker SS-OVER) → lean ONE side, never both.
- **Positively-correlated** (grappler TD-OVER + opponent SS-UNDER) → safe to combine.
- **Big |delta| ≠ data bug** — check the fighter's UFCStats record before suggesting attribution issues.
- **Pick-em side rules:** skip Pick6/UD/Betr underdog FP UNDERs, Betr underdog FP OVERs, Pick6 CTRL UNDERs (unless a Less button is confirmed).
- DK partial coverage is normal, not a scraper bug.

For UI work I can drive the Chrome browser via Claude in Chrome but **can't see inside the analyzer extension's own pages** (Chrome blocks one extension from inspecting another). UI feedback happens via screenshots — Windows+Shift+S, Ctrl+V into chat.

---

## Current slate state

**UFC Fight Night: Allen vs Costa** — 26/26 fighters paired, 5 placeholders for late additions.

**Top edge:** Melquizael Costa SS-UNDER **+76%** (78.5 line, ~72.5 proj SS, ~-6.0 PTD). Matchup factors from filled spine: Costa lands only 40.2 SS/fight average; Allen absorbs 48.7 SS/fight; Costa P(finish) printed 67% which felt aggressive — worth predictor sanity check next session.

**Pre-existing leans:** Best Picks list reads ~16 actionable. Cody Brundage #1 OVER (SS line 20.5, corr flag), Costa #1 UNDER (SS line 79.5, HIGH conf). Bukauskas / Edwards both UNDER on Main Card. Most of the slate's edge is on the UNDER side.

If we revisit picks, ask me to paste the current Best Picks table — it shifts a bit each pull.

---

## What I shipped this past session (UI work)

Three coupled features approved-mocked-spec'd-shipped:

- **Fight-pair layout** — opponents render side-by-side with a center spine column carrying shared fight info (rounds, weight, FT line, correlation warning, top-edge callout). Section dividers added: MAIN EVENT / CO-MAIN / MAIN CARD.
- **Sparklines in LINE MOVERS** — each row's line history (already stored in `line_history_v1`) renders as an inline 90×18 SVG between the delta arrow and the RLM badge. Different movement patterns (steady drift vs sharp jump vs late surge) are now visually distinguishable.
- **Filled spine in expanded mode** — when a fight pair is expanded to show bar history panels, the spine widens 110→220px and adds three sections: Matchup (SS/fight, opp absorb, P(finish) for both fighters), Common Opps (with a clean empty state), L5 Trends (per-fighter mirror sparklines for SS / FP / TD, cyan for fighter A / yellow for fighter B).

Spec files lived at `ui-handoff-fightpair-sparklines.md` and `ui-handoff-spine-fill.md`. Both are in the project root.

---

## Open carryover items (next session, priority ranked)

**Possible bugs to verify first:**

1. **OVER-side correlation warning** — Choi vs Santos on the co-main, both lean OVER (SS), no warning fired. SS volume in a fight is near-zero-sum so both OVER (SS) is just as negatively correlated as both UNDER (SS). Either the rule is intentionally narrower than I read or the OVER branch is missing logic. Verify.
2. **TOP EDGE label collision** — header row says `TOP EDGE +76% Melquizael Costa`. Allen-Costa spine says `TOP EDGE • 88%`. Different metrics, same name. Rename one (probably the spine one — "FIGHT CONF" or "EDGE RANK" or similar).

**UI polish queue (ranked by impact):**

3. **Best Picks podium + collapse archive text** — top 3 in each column should get progressive size/glow hierarchy. The repeated "Archive check: SS unders on active book are 100% over 3 settled samples,..." sentence is screen noise — collapse to a tiny `ⓘ 100% (3/3)` chip with hover-expand.
4. **Legend / icon glossary** — snowflake, water droplet, `VOL ACC`, `CHAOS`, `FP -6 UD`, `consensus ⚡`, `Stat split`, `Rival models dissent`, `NEW models dissent` — all meaningful but unexplained anywhere in the UI. A `?` icon in the header opens a one-screen modal mapping every glyph and tag to a one-line definition.
5. **Cancel-fight confirm step** — the `× Cancel fight` button on each card is currently one-click destructive. Per the irreplaceable-state rule, add a confirm.
6. **Density toggle** (Compact / Default / Expanded) — 20+ fighters visible in compact mode, current view as default, current + bar history as expanded. Should be a header-level toggle.
7. **Line-strip platform layout** — replace the 3-4 platform bubble boxes on each fighter card with a small grid: 5 stats (SS / FP / FT / TD / CTRL) × N platforms (UD / PP / DK / Betr), missing cells render `—`. Was in the original fight-pair spec but didn't get implemented yet.
8. **Parlay Lab synergy-first reorder** — SYNERGY PAIRS is your most sophisticated signal but sits below the AI Suggested Parlays. Flip the order.
9. **Label the line value** on bar history charts — the yellow vertical tick has no label; add a small floating value above the tick.
10. **AUTO-FETCH live state indicator** — the green pill doesn't differentiate "running" vs "idle". Pulsing dot or "● live" when fetching.
11. **Drifters section header visibility** — section name not visible / not sticky in current LINE MOVERS view.
12. **Top Edge headline more presence** — the slate's top-edge callout is currently mid-row text. Could be a small card-treatment with the fighter's name pulled forward and a "open in Parlay Lab" CTA.

**Carried over from the previous resume (still open):**

- Long-form vs canonical event-name re-injection bug — past events flap.
- Pick6 pickGroup polling shipped but auto-fetch still misses CTRL props.
- REFRESH button doesn't force-refresh card snapshot.
- AUTO-FETCH state-aware styling (overlaps with #10 above).
- Analyzer phase-2 split (Betr IIFE + UI panels — post-fight territory).
- `listFighterStyles` not exposed on `window` — trivial fix when convenient.

---

## Guardrails to keep across all sessions

- READ-ONLY on `lines_open_v1` and `line_history_v1` in chrome.storage — line movement data is irreplaceable, I've lost it before.
- Don't touch predictor v2 logic (duration model, book prior, RLM calibration, adaptive trend rate) when doing presentation-layer work.
- Don't break AI BEST PICKS, Parlay Lab, or DATA tab predictions — they iterate fighter-by-fighter, not by fight.
- Preserve `window.markMissedWeight`, `setFighterStyle`, `resetFighterBaseline` exactly as-is.
- Use `UFCSTATS_NAME_ALIASES` for any name-resolution code, including the new common-opps intersection in the filled spine.

---

## Useful things to ask Claude Desktop next session

- Walk through current Best Picks output (I'll paste) and stress-test the top leans against UFCStats history.
- Discuss correlation structure across a multi-pick parlay.
- Sanity-check a counterintuitive lean (especially anywhere the predictor v2 P(finish) feels aggressive given the matchup).
- Review a screenshot of a new UI change after it ships.
- Brainstorm the next UI surface to push on (Best Picks podium and the icon legend are the most natural next picks).

## Don't ask me to

- Run console snippets (I won't be at the rig).
- Edit code (no file access on this side).
- Propose Kelly sizing.
- Recommend storage-mutating browser-side snippets without verifying state first.

---

## Today's quick-cite anchors

- **Top edge:** Costa SS-UNDER +76%, line 78.5, proj 72.5.
- **Three UI features shipped this session:** fight-pair layout, sparklines in LINE MOVERS, filled spine in expanded mode.
- **Top two things to verify next session:** OVER-side correlation warning logic, TOP EDGE label collision.
- **Highest-impact UI polish remaining:** Best Picks podium + collapse archive text; icon legend modal.
