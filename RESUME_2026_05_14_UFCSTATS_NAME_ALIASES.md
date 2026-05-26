# Resume — 2026-05-14, UFCStats name aliases (Tokkos / Choi / Gantt)

**Branch:** `feature/sleek-theme-v1`
**HEAD (pushed):** `70ac3ca` — feat(overrides): resetFighterBaseline console fn
**Working tree:** `src/analyzer.ts` modified (uncommitted), confirmed working by user. Same usual locally-modified `.claude/settings.local.json` + `RESUME_CHECKPOINT.md` + untracked RESUME_*.md files.

---

## What shipped this session

### Three UFCStats name aliases added at [src/analyzer.ts:870-875](src/analyzer.ts#L870-L875)

User reported "Fetching from UFCStats..." spinners hanging on three fighters on the Allen vs Costa card. Cause: platform display name ≠ UFCStats display name, and the candidate-by-first+last search couldn't disambiguate.

| Platform name | UFCStats name |
| --- | --- |
| George Tuco Tokkos | Tuco Tokkos |
| Doo Ho Choi | Dooho Choi |
| Thomas Gantt | Tommy Gantt |

```typescript
const UFCSTATS_NAME_ALIASES: Record<string, string> = {
  'timothy angel cuamba': 'Timmy Cuamba',
  'bernardo sopaj': 'Benardo Sopaj',
  'george tuco tokkos': 'Tuco Tokkos',
  'doo ho choi': 'Dooho Choi',
  'thomas gantt': 'Tommy Gantt',
};
```

In-code fix per [feedback_in_code_fixes_skip_verify](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_in_code_fixes_skip_verify.md) — no console verify needed, just rebuild + reload. User confirmed fixed.

**NOT YET COMMITTED.** Stage when you sit down next session:
```bash
git add src/analyzer.ts
git commit -m "fix(aliases): UFCStats name mismatches on Allen vs Costa card"
```

Suggested message body: lists the three aliases and notes pattern is "UFCStats uses real/given name, platform uses nickname or vice versa."

---

## Current slate context — UFC Fight Night: Allen vs Costa (unchanged)

Same as [RESUME_2026_05_13_OPPONENT_SWAP_BASELINE_RESET.md](RESUME_2026_05_13_OPPONENT_SWAP_BASELINE_RESET.md):

- 26/26 fighters paired; 5 placeholders awaiting full line coverage
- Top edge **+76% Melquizael Costa SS-UNDER** (Costa now has full data per screenshot — 79.5 line, 66.8 proj SS, -12.7 PTD)
- 8 BEST OVERS / 8 BEST UNDERS list from 2026-05-12 resume still applies (with the Bukauskas vs Edwards re-evaluate caveat from 2026-05-13)
- Bukauskas baseline anchored to 34.5 UD vs Edwards (drift chip gone)
- Now with Tokkos / Choi / Gantt UFCStats fetching, their three rows go from "Fetching from UFCStats..." → real history-based projections, which may shift their leans

### Re-run recommended next session

After the alias commit lands and pages reload, **the SS/CTRL matchup analyzers and FP/SS/TD/FT history blocks** for those three fighters will populate. Currently they all show "No bet (insufficient data)" — leans for those three are not in the current Best Picks output.

Affected fights:
- **Tuco Tokkos vs Ivan Erslan** (LHW) — Tokkos was Unavailable for SS history; Erslan had 28.3 historical avg SS, 2/3 over → OVER 24.5 was the system's read for Erslan only
- **Doo Ho Choi vs Daniel Gustavo Santos** (FW) — both showed Unavailable
- **Thomas Gantt vs Artur Minev** (LW) — both showed Unavailable; Minev had no historical samples (likely UFC debut or near-debut)

Best Picks list should be re-pulled after the fetch cycle completes.

---

## NEXT SESSION FOCUS

### High priority
1. **Commit the alias fix** — one-liner described above
2. **Trigger UFCStats fetch for the three fighters** — should auto-happen on next refresh now that the alias map matches. Verify the three rows leave "Fetching..." state.
3. **Re-run Best Picks** with the three newly-resolved fighters and any updated Bukauskas vs Edwards projections.

### Carryover (unchanged from 2026-05-13)
- Long-form vs canonical event-name re-injection bug — past events flapping ([project_merge_fighters_field_list](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_merge_fighters_field_list.md))
- Pick6 pickGroup polling misses CTRL ([project_pick6_pickgroup_polling_pending](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md))
- REFRESH doesn't force-refresh card snapshot — parked at [src/analyzer.ts:14350](src/analyzer.ts#L14350)
- AUTO-FETCH state-aware styling
- Analyzer phase-2 split ([project_analyzer_split_progress](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md))
- `listFighterStyles` not exposed on window — comment at [src/analyzer.ts:11051](src/analyzer.ts#L11051), one-line fix when convenient
- Watch for additional opponent swaps — use `window.resetFighterBaseline('name')` if drift chips appear against withdrawn opponents

---

## Manual overrides — full quick reference (unchanged)

| Override | Where | Key |
| --- | --- | --- |
| `UFCSTATS_NAME_ALIASES` | code ([src/analyzer.ts:870](src/analyzer.ts#L870)) | platform name → UFCStats name |
| `window.markMissedWeight('name', lbsOver)` | console | `weight_miss_manual_v1` |
| `window.setFighterStyle('name', 'striker'\|'grappler'\|'balanced')` | console | `fighter_style_override_v1` |
| `window.resetFighterBaseline('name')` | console | wipes `lines_open_v1` + `line_history_v1` entries for one fighter |

When a UFCStats history block hangs in "Fetching..." state, first check if it's a name-mismatch alias case (UFCStats event page has the source-of-truth display name).

---

## Don't-forgets

- Don't propose Kelly stakes
- Don't recommend storage-mutating snippets without read-only diagnosis first AND backup — line data is irreplaceable
- Reset Lines preserves Betr pre-fight-week, clears on/after event day
- Same-fight cross-stat OVERs/UNDERs that imply contradictory fight scripts (SS OVER + FT UNDER) are negatively correlated — lean ONE side
- Same-fight cross-stat reinforcing one script (TD OVER + SS UNDER for a grappler) is positively correlated — safe to combine
- Big |delta| ≠ data bug; check fighter UFCStats history before flagging delta anomalies
- Resume document at start of session can be stale on uncommitted state — verify with `git status`
- When user reports misclassified/missing fighters or stale drift, check the four manual overrides before proposing classifier rewrites
- When fighters appear in `upcomingCardPairs` but not in `allFighters`, three filter sites in mergeAndEnrich have `isUpcomingCardFighter` rescues
- Baselines are keyed by fighter name alone; opponent swaps don't auto-invalidate — `resetFighterBaseline` is the fix
- **NEW:** "Fetching from UFCStats..." that never resolves = name-alias case. Check UFCStats event page for the canonical name, add lowercased platform name → UFCStats name to `UFCSTATS_NAME_ALIASES`.

---

## Quick state snapshot at session end

- Branch on `feature/sleek-theme-v1`, HEAD at `70ac3ca` (pushed)
- `src/analyzer.ts` has 3 new alias entries — **uncommitted**, user confirmed working
- 26/26 fighters paired, 5 placeholders for late additions
- Tokkos / Choi / Gantt UFCStats fetches working post-rebuild
- 19 actionable leans pre-fix; refreshed Best Picks needed next session
- Top edge Costa SS-UNDER +76% still applies
