# Resume — GLOW-UP UI Series, Body/Leg Props (full), Betr Lines Entered

**Branch:** `feature/sleek-theme-v1` (== `master`, both pushed to origin `Pwnzero14/ufc-analyzer`). Latest code @ `8d29c5e` (GLOW-UP 32; 28+ series open — see section below). Prior series 19→27 closed at `7325f79`.
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

## Open / next-cadence

1. **Body/Leg phase 3** — projection + lean + Best-Picks eligibility (lines + self/opp history all wired; only the lean engine missing).
2. **UFC Freedom 250 settle after Sat Jun 14** — settle unresolved props, verify counter → 0.
3. Confirm Betr entry path (modal vs snippet) → update workflow memory.
4. Carried, non-blocking: FIX B ghost-archive ([src/background.ts](src/background.ts)), Betr auto-clear.

## Standing workflow rule

`dist/` is TRACKED + SHIPPED. After ANY `src/` change: `npm run build` → `git add dist` → commit with src → push BOTH branches. (Pure `analyzer.html` GLOW-UPs need no build.) Remote/identity + recovery: [[project_repo_git_recovery]].
