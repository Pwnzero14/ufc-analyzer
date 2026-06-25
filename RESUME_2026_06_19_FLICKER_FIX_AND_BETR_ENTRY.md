# RESUME — 2026-06-19 — Analyzer flicker fix + Betr line entry (Kape vs Horiguchi)

## TL;DR
Two things this session:
1. **Fixed the analyzer page "keeps refreshing" flicker** — code change, committed + pushed both branches.
2. **Entered Betr SS/FP lines** for UFC Fight Night: Kape vs. Horiguchi (2026-06-20) via the
   standard manual console-snippet workflow — data only, no code.

Commits:
- **`c3d7002`** (master `802bf03`) — `fix: stop analyzer page flicker — coalesce re-renders, idle-skip heartbeat`
- (earlier today, prior session doc) 5R/3R headliner fix `edced19`/`5c99189`; gitignore `63030c0`/`3a52fd2`

## 1. Flicker fix (src/analyzer.ts) — committed
**Symptom:** analyzer.html visibly flickered / looked like a full page reload, frequently.
**Root cause:** NOT a real `location.reload` (both are manual: backup-restore + debug
cache-clear). It was `loadData()` (full destructive UI rebuild) fired far too eagerly:
- Each `autoScrapeAllPlatforms` cycle broadcasts ~5 separate messages (LINES_UPDATED per
  platform + ODDS_UPDATED + BET_HANDLE_UPDATED) seconds apart; the old in-flight guard only
  collapsed OVERLAPPING calls, so each message = its own full rebuild (~5/scrape; worse on
  fight week with watcher + alarm both polling ~5 min).
- A 60s periodic timer rebuilt the whole page every minute even when nothing changed.

**Fixes (all analyzer.ts):**
- `requestDataReload()` is now a **leading-edge debounce** (`DATA_RELOAD_MIN_GAP_MS = 1200`):
  renders instantly when idle, coalesces a burst into one trailing render.
- The 60s periodic timer is now a **smart heartbeat**: reads a cheap change-signature
  (`lineDataSigFromResult` = per-platform capturedAt + counts) and SKIPS the rebuild when
  unchanged. Real updates still render instantly via the background messages.
- Signature computed from RAW storage (before the betr manual-override mutation in loadData) so
  the heartbeat's raw-storage read compares apples-to-apples. `lastLoadedLinesSig` set after a
  successful render.

No infinite loop / no storage.onChanged bounce / no re-entrancy — purely over-eager rendering.
Verified live: idle page sits still; auto-fetch refreshes once/twice instead of a rapid sequence.

## 2. Betr line entry — DATA ONLY (no commit)
Entered Betr lines for the Kape/Horiguchi card via the established workflow
(`feedback_betr_entry_workflow.md`): backup → read-only diagnostic → write to
`lines_betr_manual_v1` ONLY (never the seed / `BETR_EVENT_DATE`).

- Diagnostic showed a **fresh** state: manual 0, seed 0, `BETR_EVENT_DATE` undefined — nothing to
  merge/preserve. Backup downloaded first.
- Wrote **23 fighters** (`{ name, opponent, line_fp, line_ss, line_td:null }`, `capturedAt`).
  Confirmed via post-write table.
- 3 boosted 🚀 FP lines (Andre Fili 50.5, Leon Shahbazyan 50.5, Gaston Bolaños 50.5) entered
  normally as OVER-only — downstream skip logic handles them (`feedback_boost_icon_is_over_only`).
- Kevin Borjas omitted (no line shown on Betr).
- Lines entered (SS / FP): Kape 62.5/–, Horiguchi 66.5/–, Cutelaba 25.5/–, Stirling 42.5/89.5,
  Amil 42.5/–, C.Rodriguez 45.5/–, Baghdasaryan 26.5/–, Magomedov 36.5/87.5, V.Oliveira –/82.5,
  Fili –/50.5🚀, A.Lima –/96.5, Mesquita 30.5/99.5, Mullins 12.5/–, Nascimento 32.5/–,
  Raposo 24.5/–, Bolaños 55.5/50.5🚀, Aswell 70.5/91.5, Shahbazyan 15.5/50.5🚀,
  Chokheli 20.5/98.5, Rosa 55.5/–, Santos 50.5/–, Collins 52.5/–, Tanzilovi 48.5/–.

**Betr entry mechanics confirmed this session** (useful next time):
- `applyBetrManualOverrides` (analyzer.ts ~842): manual entries merge onto `lines_betr` base by
  lowercased name; if base is empty they're pushed as new → manual-only write displays fine.
- The **BETR LINES modal** save (analyzer.ts ~18618) writes BOTH `lines_betr` AND
  `lines_betr_manual_v1`; the `remove('lines_betr_manual_v1')` at ~18632 ONLY fires on a save
  with zero rows (manual clear) — never auto on load, so a console write won't vanish.

## State / housekeeping
- Working tree clean except local-only `.claude/settings.local.json` (never staged).
- Both branches in sync with origin (`feature/sleek-theme-v1`, `master`).
- Card: UFC Fight Night: Kape vs. Horiguchi — **Sat 2026-06-20**. After event day, Betr reset
  rule applies (`feedback_betr_reset_rule.md`): preserve pre-fight-week, clear on/after event day.
- Reminder: the dist-ship convention — rebuild + commit dist with every src change, push BOTH
  branches.
