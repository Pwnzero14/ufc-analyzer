# Resume — GLOW-UP UI Series, Body/Leg Props (full), Betr Lines Entered

**Branch:** `feature/sleek-theme-v1` (== `master`, both pushed to origin `Pwnzero14/ufc-analyzer`). Latest code @ `c7f1254` (GLOW-UP 36; 28+ series open — see section below; includes interim best-picks placeability + body/leg-platform fixes). Prior series 19→27 closed at `7325f79`.
**Date:** 2026-06-12 (Friday, early AM — continues `RESUME_2026_06_11_PLACEABILITY_COMBO_BODYLEG.md`).
**Working tree:** clean except `.claude/settings.local.json` (modified, never staged) and untracked stray `UsersabdirAppData…Opera…/` dir (ignore).
**Card:** UFC Freedom 250 (Topuria vs Gaethje main event). Lines ~120h old in last session — re-fetch closer to the card.

---

## TL;DR

Three workstreams since the last resume, all shipped + pushed to both branches:
1. **Body/Leg Strikes props — FULLY DONE** (Underdog + PrizePicks): lines in the strip, SELF history-vs-line charts, AND opponent-scored panels. Cache now `ufcstats_v51_`. Only phase 3 (lean/projection/Best-Picks) remains.
2. **GLOW-UP UI series 19→27 (COMPLETE)** — a run of sleek-theme polish commits (mostly `analyzer.html`-only CSS/animation). GLOW-UP 27 is the final level of the series. Authored in UI co-work sessions; committed/pushed by request.
3. **Betr lines entered** for Freedom 250 (manual, 14 SS + 7 FP) via `lines_betr_manual_v1`.

---

## Commits since last resume (newest → oldest, all on master + feature)

- `01ba982` — **GLOW-UP 28** (opens 28+ series): Models & Career suite — fused panel pairs, per-panel identity accents — `analyzer.html` + `src/analyzer.ts` + dist
- `7325f79` — GLOW-UP 27 (FINAL of 19→27): finishing touches (scroll progress bar, hit-rate hero, gold caret, smooth jumps) — `analyzer.html`
- `4ac11d5` — GLOW-UP 26: Line Movers polish (steam flicker, RLM glow, hover rails, section accents) — `analyzer.html`
- `6d3fd85` — GLOW-UP 25: app chrome polish (glass header, tab glow, auto-fetch breath, logo jab) — `analyzer.html`
- `149c37b` — GLOW-UP 24: Best Picks podium (medal ranks, hero #1 row, entrance stagger) — `analyzer.html`
- `93a996b` — GLOW-UP 23: global motion pass (card cascade, drilldown choreography, press feedback, reduced-motion) — `analyzer.html`
- `ced4129` — GLOW-UP 22: fighter card header strip (lean avatar rings, gradient hero numbers, hovers) — `analyzer.html`
- `e8393be` — GLOW-UP 21: fused head-to-head panel pairs (shared shell, center divider, mirrored accents) — `analyzer.html`
- `df45052` — GLOW-UP 20: center spine evolution (matchup advantage bars, trend readouts, VS pulse) — `analyzer.html` + `src/analyzer.ts` + dist
- `3a060a7` — GLOW-UP 19: drilldown chart evolution (hover tooltips, hit-rate meta strip, W/L dots) — `analyzer.html` + `src/analyzer.ts` + dist
- `896e85c` — **feat(props): opponent body/leg history panels** (cache v50→v51) — see prior resume for the 5-step detail.
- (earlier body/leg phases `0fcbfab`/`25bff68`/`efb5fc7`, combo fix `2b84244`, placeability `11fdf8f`, prune snippet `2eb605f` — covered in `RESUME_2026_06_11_PLACEABILITY_COMBO_BODYLEG.md`.)

**GLOW-UP commit pattern (for next time):** user does the UI edit in co-work, then asks me to `rm -f .git/index.lock` → stage ONLY the named file(s) (usually just `analyzer.html`; 19/20/28 also had `src/analyzer.ts` + `dist/analyzer.js`+`.map`) → commit the given message → push BOTH branches. NEVER stage `.claude/settings.local.json` or the stray Opera dir.

---

## GLOW-UP 28+ series (NEW — open)

Series 19→27 is closed (final = `7325f79`). The 28+ run starts here; log each level newest-first as it ships.

- `c7f1254` — **GLOW-UP 36** — H2H win probability (DK trueOdds, vig-free) + common-opponents panel + DK country codes for avatar badges. Files: `analyzer.html` + `src/analyzer.ts` + `src/background.ts` + dist (analyzer + background). Pushed to both branches.
- `0232a67` — **fix(drilldown):** body/leg SS line now follows the active platform pill (PP line when PrizePicks selected, UD-first otherwise) via `platformBodyLegLine`; self + opp panels. Files: `src/analyzer.ts` + dist.
- `6cb270a` — **fix(best-picks): suppress unplaceable pick-em unders + correct archive book.** (a) Pick6 FP dog UNDER detected via Pick6/Underdog shared-scoring divergence (`pick6FpInflatedVsUnderdog`) — works even when the moneyline map is missing the bout (fixed Pereira's Pick6 93.5 leak over his real UD 64.99); (b) TD-under per-book filter in `bestSideLineForPick` (`tdUnderBookOffered`); (c) PrizePicks removed from `PICKEM_UNDER_FORBIDDEN_PLATFORMS` (it DOES offer dog FP-under); (d) Best-Picks archive note keys on the displayed/placeable book, not the active platform. Files: `src/analyzer.ts` + dist. See [[project_pickem_platform_rules]].
- `4a8171b` — **GLOW-UP 35** — avatar opens head-to-head: removes the flaky ⚔ button, adds hover swords overlay + capture-before-expand. Files: `analyzer.html` + `src/analyzer.ts` + `dist/analyzer.js`+`.map`. Pushed to both branches.
- `8967cbd` — **GLOW-UP 33-34 + DK moneyline pipeline** (combined, not pure CSS):
  - **GLOW-UP 33** — head-to-head overhaul with advantage bars.
  - **GLOW-UP 34** — center-spine H2H trigger + real fighter countries (via `src/analyzer/fighter-image.ts`).
  - **DK moneyline pipeline** — DK `sportscontent` API moneylines, refreshed every auto-fetch, junk-filtered, with BFO fallback (`src/background.ts` + `src/analyzer.ts`).
  - Files: `analyzer.html` + `src/analyzer.ts` + `src/background.ts` + `src/analyzer/fighter-image.ts` + all modified `dist/` (analyzer, background, fighter-image js/map/d.ts). Pushed to both branches. (Untracked `snippets/2026-06-12_ml_diagnostic.js` left unstaged.)
- `8d29c5e` — **GLOW-UP 32** — modals & platform pills: modal spring-in, keycap polish, LED dots, active pill rings. Files: `analyzer.html` only. Pushed to both branches.
- `3a77b01` — **GLOW-UP 31** — Slate Check command center: tri-color heroes, live dot, scanline, faded dividers. Files: `analyzer.html` only. Pushed to both branches.
- `3f1ac9b` — **GLOW-UP 30** — Learning Drilldown banner: staged wash, spark icon, gradient headline, details stagger. Files: `analyzer.html` only. Pushed to both branches.
- `1e0ec37` — **GLOW-UP 29** — Parlay Lab evolution: selection rails, health hero, crowned #1 suggestion, slip animations. Files: `analyzer.html` only. Pushed to both branches.
- `01ba982` — **GLOW-UP 28** — Models & Career suite: fused panel pairs (shared-shell treatment extended to the Models + Career panels) with per-panel identity accents. Files: `analyzer.html` + `src/analyzer.ts` + `dist/analyzer.js` (`.map` unchanged this time). Pushed to both branches.

(Same commit pattern as 19→27 above. Restore point still tag `known-good-2026-06-12-glowup27` @ `e50ef05` — cut a fresh tag/zip once the 28+ run settles.)

---

## Body/Leg Strikes — COMPLETE (display + history, self + opponent)

Underdog + PrizePicks only. **Not yet** projection/lean/Best-Picks (that's phase 3 — the lone remaining body/leg item).
- Lines: `line_ss_body`/`line_ss_leg` scraped (UD page-context + UD/PP API parsers), plumbed through types/merge/analyzer; shown as `UD/PP Body`/`Leg` cells in the LINES strip.
- History: `parseFightDetailStats` (+ `…Opponent`) read the UFCStats Head/Body/Leg table (Body=col4, Leg=col5); `sigStrBody`/`sigStrLeg` on `FightResult`/`OppFightResult`/`FightStats`/`OppStats`/`UFCFightHistory`/`HistoryRow`.
- Drilldown: `Body Sig Strikes History vs Line` + `⚔️ Opp Body SS Scored` (and Leg), paired self|opp like SS/R1 SS. Verified live on Freedom 250.
- **Cache `ufcstats_v51_`** — bump on any history/opp-shape change; re-fetch repopulates. Pre-v51 keys orphaned (prune snippet `CURRENT_UFCSTATS_VERSION` → 51 to reclaim).

---

## Betr lines — entered for Freedom 250 (manual workflow)

Written to **`lines_betr_manual_v1` ONLY** (14 fighters: 14 SS, 7 FP), captured 2026-06-12 00:40. Seed / `BETR_EVENT_DATE` / line-movement untouched. Verified `✅ 14 SS / 7 FP`. See [[feedback_betr_entry_workflow]].
- **NEW:** there is a built-in **`BETR SCREENSHOT READER`** modal (drop screenshots → AI reads → review → `SAVE TO BETR`) that produced identical values. **Unconfirmed which path the user actually used** (modal vs my console snippet) — ask next time; if the modal is reliable, prefer it over the console-snippet path and update [[feedback_betr_entry_workflow]].
- Going forward: edit individual Betr lines via the BETR LINES modal row-edit (preserves openers); it clears on/after event day.

---

## Emergency restore points (created this session)

**Current (use these):**
- **Git tag `known-good-2026-06-12-glowup27`** @ `e50ef05` (GLOW-UP series complete + body/leg + Betr), pushed to origin.
- **Zip:** `OneDrive\Desktop\ufc_analyzer_snapshot_2026-06-12_glowup27_e50ef05.zip` (1.3 MB, 207 files, `git archive` of HEAD — standalone restorable, syncs to cloud).
- Restore: `git reset --hard known-good-2026-06-12-glowup27` OR extract the zip (dist included → loadable as-is).

**Older (superseded):** tag `known-good-2026-06-11-glowup19` @ `3a060a7` + zip `…2026-06-11_glowup19_3a060a7.zip`.

## NEXT SESSION (start here) — DK bet handle ("% of bets placed") in H2H

**Goal:** add DK's "% of bets placed" split (e.g. *Topuria 69% · 31% Gaethje*) to the **Head-to-Head** panel, as a bar under the existing `WIN PROBABILITY · DK implied` bar.

**Investigation is DONE (2026-06-12) — don't re-derive. Findings:**
- DK SS/TD props are **DOM-scraped** from the rendered page (`scrapeDKSportsbookProps()` in [content.ts:683-786](src/content.ts#L683)), NOT an API. DK **moneyline / trueOdds / countryCode** come from the REST sportscontent API (`refreshDKMoneylinesFromApi`, [background.ts:2318](src/background.ts#L2318), endpoint `…/sportscontent/dkusoh/v1/leagues/9034`).
- The bet-handle is **NOT** in that REST leagues API (probed every key — only `markets[].marketType.betOfferTypeId` matched, unrelated).
- It IS pushed over a **binary msgpack WebSocket** (`websocket?format=msgpack&locale=en`, initiator `dkDataLayer.js`). **Do NOT go down the WebSocket route** — binary frames + undocumented subscription protocol + MV3 service-worker lifecycle = too brittle for one stat.
- **The win:** the percentages are in the **rendered DOM** on each fight's **event page** (`/event/<slug>/<id>`, e.g. `/event/ilia-topuria-vs-justin-gaethje/33525834`), inside the "Fight Lines" card → "% of bets placed" widget. So scrape the DOM, exactly like SS/TD.

**The one nuance:** SS/TD render on the props/category page the auto-fetch already loads; "% of bets placed" only renders on the **per-fight event page**, whose pathname does **not** include `ufc` — so the current DK content-script trigger (`host.includes('sportsbook.draftkings.com') && pathname.includes('ufc')`, [content.ts:1014](src/content.ts#L1014)) skips it.

**Plan (3 steps):**
1. **Scrape** — extend [content.ts](src/content.ts) DK detection to also fire on `/event/…` pages; add a scraper for the "% of bets placed" widget → `{fighterNorm: pct}`. Locate by the "% of bets placed" text node, walk to its container, read the two percentages + the two fighter names (left/right). FIRST STEP next session: grab the widget `outerHTML` via the snippet below to target DK's obfuscated React classes precisely.
2. **Store** — persist as `fight_bethandle_dk_v1` (mirror `fight_trueprob_dk_v1`, set near [background.ts:2360](src/background.ts#L2360)).
3. **Display** — H2H panel renders a "bets placed" bar under the win-prob bar (H2H lives in the GLOW-UP 36 work, `analyzer.html` + analyzer.ts; win-prob bar text is `WIN PROBABILITY · DK implied, vig removed`).

**Populate strategy:** start **opportunistic** (scrape whenever the user is on a DK event page — zero extra fetch load). Optional later: auto-fetch opens each event page (~14 loads/card) for full-card coverage.

**Snippet to run first next session** (DK event tab console — grabs the widget HTML):
```js
const lab = [...document.querySelectorAll('*')].find(n => (n.textContent||'').trim().toLowerCase() === '% of bets placed');
let box = lab; for (let i=0;i<4 && box?.parentElement;i++) box = box.parentElement;
console.log(box ? box.outerHTML.slice(0, 3000) : 'NOT FOUND — scroll the bar into view first');
```
Diagnostic snippets from this session (untracked, in `snippets/`): `2026-06-12_dk_bet_handle_probe.js` (leagues-API key probe), `2026-06-12_dk_bet_handle_endpoint_sniff.js` (fetch/XHR sniffer).

---

## Open / next-cadence

1. **DK bet handle in H2H** — see "NEXT SESSION" section above (investigation complete, ready to build).
2. **Body/Leg phase 3** — projection + lean + Best-Picks eligibility (lines + self/opp history all wired; only the lean engine missing).
2. **UFC Freedom 250 settle after Sat Jun 14** — settle unresolved props, verify counter → 0.
3. Confirm Betr entry path (modal vs snippet) → update workflow memory.
4. Carried, non-blocking: FIX B ghost-archive ([src/background.ts](src/background.ts)), Betr auto-clear.

## Standing workflow rule

`dist/` is TRACKED + SHIPPED. After ANY `src/` change: `npm run build` → `git add dist` → commit with src → push BOTH branches. (Pure `analyzer.html` GLOW-UPs need no build.) Remote/identity + recovery: [[project_repo_git_recovery]].
