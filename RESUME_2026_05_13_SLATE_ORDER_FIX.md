# Resume — 2026-05-13, slate order fix for late-addition fighters

**Branch:** `feature/sleek-theme-v1`
**HEAD (committed, NOT pushed):** `535e02c` — feat(overrides): name-alias map + manual fighter-style override
**Prior unpushed:** `299be07` — fix(settle): widen card cache grace to 30h + grade SS_R1 from per-round table
**Working tree:** [src/analyzer.ts](src/analyzer.ts) has UNCOMMITTED changes from this session (slate-order fix) — not yet committed

---

## What shipped this session (UNCOMMITTED in src/analyzer.ts)

### Slate order fix for late-addition fighters

**Problem:** UFC Fight Night: Allen vs Costa card has 13 fights / 26 fighters, but 5 were late additions to UFCStats (Christian Edwards, Nikolay Veretennikov, Khaos Williams, Tommy Gantt, Artur Minev). Platforms hadn't posted their lines yet, so they were missing from `allFighters`. This caused `orderFightersByCard` to push only one side of half-resolved pairs, breaking the positional `i%2` fight-badge alignment in `_renderFightersImpl` and cascading wrong pairings downstream (Bukauskas+Cuamba glued together, Sopaj+Tokkos, etc.).

**Fix:** Three edits making `upcomingCardPairs` membership a rescue at each filter/prune site:

1. **Inject placeholder entries** at [src/analyzer.ts:13916-13927](src/analyzer.ts#L13916-L13927) — create empty `MergedLineEntry` for any upcomingCardPairs fighter not already present in the map after platform-line loops. Opponent field pre-populated so canonicalization sweep handles them naturally.

2. **Spare from hasRealLines prune** at [src/analyzer.ts:14050](src/analyzer.ts#L14050) — added `|| isUpcomingCardFighter(f.name)` to the filter that drops UFCStats-unresolved fighters with no lines.

3. **Spare from source visibility filter** at [src/analyzer.ts:598](src/analyzer.ts#L598) — added `|| isUpcomingCardFighter(f.name)` so placeholder fighters survive the per-platform visibility check (otherwise filtered out for having no Pick6/UD/PP/Betr/DK data).

**Order-safe:** when platforms later post lines for these fighters, the platform-line loops at [13884-13914](src/analyzer.ts#L13884-L13914) hit `findOrCreateEntry` first and populate the entry with real line data. The injection block runs AFTER and sees `map[name]` already exists, so it no-ops. Placeholders get overwritten naturally — no manual reset needed.

**Verified:** ALL FIGHTERS shows 26 / 26. Bukauskas+Edwards box, Veretennikov+Williams box, Gantt+Minev box all render correctly with placeholder rows (no line chips, "No visible source lines" label, but correct opponent + fight-section badge).

---

## Christian Edwards "Pain" research (in conversation, not coded)

UFC debutee replacing Rodolfo Bellato at Catch Weight vs Bukauskas.

- **8-4 pro record**, age 27, 6'3" / 78.5" reach
- Trains **Jackson Wink** (Jon Jones's camp) but is a **long-frame striker**, not a wrestler
- **High-variance fighter:** 5 KO/TKO wins, 1 sub, 2 dec. Lost as -1000 favorite to Ben Parrish (38-sec KO, Bellator 266). Most recent loss: CFFC LHW title fight vs Luke Fernandez (May 2025, ~12 months stale)
- **Macro thesis:** finish-or-be-finished. Pairs well with Bukauskas's profile (3 finishes in last 4 W's, KO loss to Krylov)

**Pick implication when Bukauskas's SS line drops:**
- FT UNDER (whatever it posts at) is **macro-thesis play** — both fighters have R1-finish profiles, holds regardless of SS specifics
- If SS OVER appears: drop it. Edwards's R1-finish risk slashes SS volume upside
- Edwards's own lines (if any appear): fade any TD OVER (he's a striker), watch for FT UNDER on his side too

---

## Current slate context — UFC Fight Night: Allen vs Costa (26 fighters now)

**Session-end status:**
- Pick6: 20 lines · Underdog: 20 lines · PrizePicks: 10 lines · Betr: — · DK: no data
- 5 slate issues: lines 23min stale, P6/UD missing 6 of 26, PP missing 16 of 26, DK no data
- 19 actionable leans, top edge **+76% Melquizael Costa SS-UNDER**
- 5 placeholder fighters showing "No visible source lines" (Edwards, Veretennikov, Williams, Gantt, Minev) — will populate as platforms catch up

### Picks unchanged from 2026-05-12 resume (BUT see "what to re-check" below)

8 BEST OVERS / 8 BEST UNDERS — see [RESUME_2026_05_12_OVERRIDES_AND_ALLEN_VS_COSTA.md](RESUME_2026_05_12_OVERRIDES_AND_ALLEN_VS_COSTA.md). Same-fight conflict resolution noted there still applies.

### Cross-stat watches (confirmed via correct pairing now visible)

- **Bannon (SS OVER 39.5) vs Caliari (SS UNDER 48.5)** — SAME FIGHT, opposite SS picks. Lean ONE.
- **Vieira (SS UNDER 39.5) vs Cavalcanti (SS OVER 64.5)** — SAME FIGHT, opposite SS picks. Lean ONE.
- **Brundage (TD UNDER 0.5) + Petroski (FT OVER 7.5)** — SAME FIGHT, POSITIVELY correlated (both bet on Petroski control). Safe to stack.

---

## NEXT SESSION FOCUS

### High priority
1. **Commit the slate-order fix** if it survives a few REFRESH cycles without regressing. Suggested message:
   ```
   fix(analyzer): inject placeholder entries for late-addition card fighters

   Three filter sites (merge pipeline prune, hasRealLines, source visibility)
   were dropping upcomingCardPairs members who had no platform lines yet,
   causing orderFightersByCard's positional i%2 fight-badge grouping to
   cascade wrong pairings when half a pair was missing (e.g. Bukauskas vs
   debutee Edwards). All three now exempt isUpcomingCardFighter members.
   ```
   Then push `299be07` + `535e02c` + this new commit.

2. **Re-evaluate Bukauskas picks** once SS line drops (was unreliable in 2026-05-12 picks because computed vs wrong opponent). Edwards research above is the macro framing.

3. **AUTO-FETCH every few hours** — Pick6/UD should fill in Edwards/Veretennikov/Williams/Gantt/Minev as fight week progresses. Placeholders auto-replace on each cycle.

### Carryover (unchanged)

- **Long-form vs canonical event-name re-injection bug** — past events flapping. See [project_merge_fighters_field_list](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_merge_fighters_field_list.md).
- **Pick6 pickGroup polling misses CTRL** — [project_pick6_pickgroup_polling_pending](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md)
- **Settle fires too early on event day** — apply 30h grace at [src/background.ts:3066+](src/background.ts#L3066)
- **REFRESH doesn't force-refresh card snapshot** — would prevent this whole issue. Discussed but parked. Lives at [src/analyzer.ts:14350](src/analyzer.ts#L14350).
- **AUTO-FETCH state-aware styling** — button stays bright green with fresh pills
- **Analyzer phase-2 split** — [project_analyzer_split_progress](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md)

---

## Don't-forgets (unchanged + 1 new)

- Don't propose Kelly stakes
- Don't recommend storage-mutating snippets without read-only diagnosis first
- Reset Lines preserves Betr pre-fight-week, clears on/after event day
- Same-fight cross-stat OVERs/UNDERs that imply contradictory fight scripts (e.g. SS OVER + FT UNDER) are negatively correlated — lean ONE side
- Same-fight cross-stat that reinforces one fight script (e.g. TD OVER + SS UNDER for a grappler) is positively correlated — safe to combine
- Big |delta| ≠ data bug; check fighter UFCStats history before flagging delta anomalies
- Resume document at start of session can be stale on uncommitted state — verify with `git status`
- When user reports misclassified/missing fighters, the three manual overrides handle most cases — check [project_manual_overrides](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_manual_overrides.md) before proposing classifier rewrites
- **NEW:** When fighters appear in `upcomingCardPairs` but not in `allFighters`, there's a filter/prune in the merge pipeline dropping them. Three sites have `isUpcomingCardFighter` rescues now; if a 4th filter is added in `loadData` and the cascade returns, that's where to look.

---

## Quick state snapshot at session end

- 14155 total settled records, 59 unresolved
- Allen vs Costa: 26 fighters paired correctly (was 21 cascading)
- 5 placeholder cards rendering empty-line state with correct opponent labels
- 19 actionable leans, top edge Costa SS-UNDER +76%
- Working tree: src/analyzer.ts has uncommitted slate-order fix
- 2 prior unpushed commits + uncommitted change = 3 things to commit/push when ready
