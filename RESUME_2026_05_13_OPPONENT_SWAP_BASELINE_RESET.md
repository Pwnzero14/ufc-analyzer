# Resume — 2026-05-13 (PM), opponent-swap baseline reset

**Branch:** `feature/sleek-theme-v1`
**HEAD (pushed):** `70ac3ca` — feat(overrides): resetFighterBaseline console fn
**Stack pushed this session (origin synced):**

```
70ac3ca feat(overrides): resetFighterBaseline console fn for mid-event opponent swaps
756b695 fix(analyzer): inject placeholder entries for late-addition card fighters
535e02c feat(overrides): name-alias map + manual fighter-style override
299be07 fix(settle): widen card cache grace to 30h + grade SS_R1 from per-round table
```

Working tree: clean (analyzer-wise). `.claude/settings.local.json` + `RESUME_CHECKPOINT.md` still locally modified; many untracked RESUME_*.md files. None of that affects code.

---

## What shipped this session

### 1. `756b695` — slate-order placeholder injection (pulled from prior session's uncommitted state)

Three filter sites exempted via `isUpcomingCardFighter(f.name)` so late-addition fighters survive the merge pipeline even before platforms post their lines:

- [src/analyzer.ts:598](src/analyzer.ts#L598) — `applySourceVisibilityFilter`
- [src/analyzer.ts:13959-13972](src/analyzer.ts#L13959-L13972) — placeholder injection in `mergeAndEnrich`
- [src/analyzer.ts:14110](src/analyzer.ts#L14110) — `pruned` filter (hasRealLines)

Verified earlier this session: 26/26 fighters paired correctly on Allen vs Costa card. Placeholder fighters (Edwards, Veretennikov, Williams, Gantt, Minev) render with `— No visible source lines` until books post props; auto-replace on next refresh.

### 2. `70ac3ca` — `window.resetFighterBaseline(name)` console override

New fourth manual override. Reason this exists: `_openingLines` / `_prevRefreshLines` / `_lineHistory` are keyed by fighter name alone (no opponent in the key). When a fighter's opponent changes mid-event, the new opener gets diffed against the old line vs the dropped opponent, producing a false drift + RLM badge. Existing wipes only fire on event changes (Betr-date mismatch, <20% fighter overlap) — opponent swaps within the same event don't trigger.

**Usage:**
```javascript
window.resetFighterBaseline('Modestas Bukauskas')
```

Wipes all platform/stat opening + prev-refresh + history entries for that one fighter, persists `lines_open_v1` + `line_history_v1`, re-renders. Next refresh re-snapshots current lines as the new opener.

**Triggered today by:** Bellato (vs Bukauskas) withdrew, Edwards replaced him. Pre-fix: Bukauskas UD-SS showed `38.5 (vs Bellato) → 34.5 (vs Edwards)` as a -4 drift + RLM OVER badge. Post-fix (after running the console one-shot snippet — see prior turn): drift chip gone, DRIFTERS section clean, `max Δ` back to 0.0, 34.5 stands as new opener.

Memory: `project_manual_overrides.md` updated to list four overrides instead of three; added "drift/RLM badge against withdrawn opponent → resetFighterBaseline" to the dispatch table.

---

## Why we picked manual-override over auto-detect (decision recorded)

Considered auto-detecting opponent changes by persisting a `fighter → last-known-opponent` map and wiping baselines on diff. Rejected because:

1. Partial-load opponent-resolution flicker (a real issue per [project_merge_fighters_field_list](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_merge_fighters_field_list.md)) could trigger spurious wipes during a refresh where some platforms arrive without opponents resolved
2. Lost line movement is irreplaceable per [feedback_opera_remove_wipes_storage](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\feedback_opera_remove_wipes_storage.md)
3. Opponent swaps are rare (a few per year) — manual is fine
4. Matches the established override pattern (markMissedWeight, setFighterStyle, UFCSTATS_NAME_ALIASES)

If swaps become painful (3+/event), revisit with a conservative auto-detect (only wipe when same opponent has been stable for N refreshes and then changes).

---

## Current slate context — UFC Fight Night: Allen vs Costa

Unchanged from prior resume except Bukauskas is now correctly anchored vs Edwards:

- 26 fighters paired correctly (5 placeholders for late additions: Edwards, Veretennikov, Williams, Gantt, Minev)
- 19 actionable leans, top edge **+76% Melquizael Costa SS-UNDER** (was top edge at session start, still top edge)
- 5 slate issues: 27.4h-old lines, P6/UD missing 6 of 26, PP missing 16 of 26, DK no data
- Bukauskas SS line: 34.5 UD (vs Edwards) is now the opener
- Christian Edwards: UD SS 29.5 only — see prior resume for fight-context macro thesis (FT UNDER plays the R1-finish profile of both fighters)

### Picks unchanged from 2026-05-12 resume
See [RESUME_2026_05_12_OVERRIDES_AND_ALLEN_VS_COSTA.md](RESUME_2026_05_12_OVERRIDES_AND_ALLEN_VS_COSTA.md) for 8 BEST OVERS / 8 BEST UNDERS and same-fight conflict resolution. Cross-stat watches (Bannon SS-OVER vs Caliari SS-UNDER same fight, Vieira/Cavalcanti SS opposite, Brundage TD-UNDER + Petroski FT-OVER positively correlated) still apply.

### Bukauskas-specific re-evaluate

Now that his baseline is anchored to the 34.5 vs Edwards, the original 2026-05-12 Bukauskas picks (which were computed vs the wrong opponent Bellato) can be re-checked. Edwards macro framing (R1-finish profile, 5 KO/TKO wins, KO'd as -1000 fav by Parrish in 38 sec): FT UNDER on either side plays the macro thesis; treat any SS OVER on Bukauskas's side with skepticism since Edwards's finish-risk slashes SS volume upside.

---

## NEXT SESSION FOCUS

### High priority
1. **Re-run Best Picks** with the now-correct Bukauskas vs Edwards pairing and the fresh 34.5 baseline. The original list was computed before placeholder fix → wrong opponent for Bukauskas → likely off.
2. **AUTO-FETCH cycle** — Pick6/UD should fill in Edwards/Veretennikov/Williams/Gantt/Minev as fight week progresses. Placeholders auto-replace on each cycle (the placeholder injection runs BEFORE the platform-line loops would re-populate the entry, so they get cleanly overwritten).
3. **Watch for additional opponent swaps** — fight week tends to produce 1-2. Run `window.resetFighterBaseline('Fighter Name')` if you see drift chips against opponents who are no longer on the card.

### Carryover (unchanged from prior resume)

- **Long-form vs canonical event-name re-injection bug** — past events flapping. See [project_merge_fighters_field_list](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_merge_fighters_field_list.md).
- **Pick6 pickGroup polling misses CTRL** — [project_pick6_pickgroup_polling_pending](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md)
- **REFRESH doesn't force-refresh card snapshot** — parked. Lives at [src/analyzer.ts:14350](src/analyzer.ts#L14350).
- **AUTO-FETCH state-aware styling** — button stays bright green with fresh pills
- **Analyzer phase-2 split** — [project_analyzer_split_progress](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md)
- **`listFighterStyles` not exposed on window** — documented in code comment at [src/analyzer.ts:11051](src/analyzer.ts#L11051) as a console API but the registration line is missing. Trivial 1-line fix when convenient.

---

## Manual overrides — full quick reference (post this session)

| Override | Where | Key |
| --- | --- | --- |
| `UFCSTATS_NAME_ALIASES` | code (analyzer.ts top of fetchFromUFCStats) | platform name → UFCStats name |
| `window.markMissedWeight('name', lbsOver)` | console | `weight_miss_manual_v1` |
| `window.setFighterStyle('name', 'striker'\|'grappler'\|'balanced')` | console | `fighter_style_override_v1` |
| **`window.resetFighterBaseline('name')`** *(NEW)* | console | wipes `lines_open_v1` + `line_history_v1` entries for one fighter |

Each has `clear*` / `list*` companions (note: `listFighterStyles` is defined but not exposed — see carryover above).

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
- When fighters appear in `upcomingCardPairs` but not in `allFighters`, three filter sites in mergeAndEnrich have `isUpcomingCardFighter` rescues — if a 4th filter is added in `loadData` and the cascade returns, that's where to look
- **NEW:** Baselines are keyed by fighter name alone; opponent swaps don't auto-invalidate. Drift chip against a withdrawn opponent → `resetFighterBaseline`.

---

## Quick state snapshot at session end

- Branch pushed, working tree clean (analyzer-wise)
- 4 commits ahead → 0 commits ahead (all pushed)
- Bukauskas baseline anchored to 34.5 UD (vs Edwards), drift chip gone
- 26/26 fighters paired, 5 placeholders awaiting platform lines
- 19 actionable leans, top edge Costa SS-UNDER +76%
- 14155 total settled records, 59 unresolved
