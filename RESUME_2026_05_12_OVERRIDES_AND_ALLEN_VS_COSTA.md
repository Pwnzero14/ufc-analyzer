# Resume — 2026-05-12, post-overrides + Allen vs Costa pre-fight-week

**Branch:** `feature/sleek-theme-v1`
**HEAD (committed, NOT pushed):** `535e02c` — feat(overrides): name-alias map + manual fighter-style override
**Prior unpushed:** `299be07` — fix(settle): widen card cache grace to 30h + grade SS_R1 from per-round table
**Working tree:** clean for source files (resume markdown files untracked)

---

## What shipped this session (commit `535e02c`)

### 1. UFCSTATS_NAME_ALIASES map — [src/analyzer.ts:855-869](src/analyzer.ts#L855-L869)
Two known mismatches between platform names and UFCStats names baked in:
- `'timothy angel cuamba'` → `'Timmy Cuamba'` (platform alt-first-name issue)
- `'bernardo sopaj'` → `'Benardo Sopaj'` (typo on UFCStats's side, no first 'r')

Applied at the top of `fetchFromUFCStats` BEFORE cache lookup, so the UFCStats cache is keyed under the real name (future platform-spelling variants correctly share one cache entry). UI still displays the platform name — only the UFCStats search is affected.

To add new aliases later: edit the map and rebuild.

### 2. Manual fighter-style override system
Console functions exposed in analyzer DevTools:
```js
setFighterStyle('Melquizael Costa', 'striker')   // 'striker' | 'grappler' | 'balanced'
clearFighterStyle('Melquizael Costa')
listFighterStyles()
```
Persists in `chrome.storage.local` under `fighter_style_override_v1`. Loaded at `initAnalyzerCore` into a module-scoped Map `_fighterStyleOverrides`. Applied inside `buildFighterDB` so the override is respected for both fresh and cached DBs (existing cache entries get mutated in place by `applyFighterStyleOverrides`).

After overriding, user must re-run Generate Predictions to recompute SS/TD/FP with the new style — predictions are cached at the prediction-event level.

Why this exists: `deriveStyle` at [src/analyzer/fantasy-scoring.ts:112-122](src/analyzer/fantasy-scoring.ts#L112-L122) is a crude threshold classifier:
- Grappler if `tdAvg > 2.0` OR `subAvg > 0.5`
- Striker if `slpm > 3.5` AND `tdAvg < 1.5`
- Otherwise balanced

Misfires on fighters with stat-padded sub finishes vs lower competition (flagged grappler but actually strikers), or striker-grappler hybrids that need 'balanced'.

---

## Memory entry added

[project_manual_overrides.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_manual_overrides.md) covers all three override mechanisms in one place: UFCSTATS_NAME_ALIASES, markMissedWeight, setFighterStyle. Future first-resort for misclassification edge cases.

---

## Pre-line prediction decoupling — VALIDATED ✓

The next-session focus from yesterday's resume is **DONE without code changes**. User generated predictions BEFORE running AUTO-FETCH on the UFC Fight Night: Allen vs Costa card. Predictions persisted, then AUTO-FETCH pulled platform lines, and edges lit up against the already-saved `_cachedPredictions`. The model's roster pull (`upcomingCardPairs` from `syncUpcomingCardContext`) and prediction flow are already decoupled from platform lines — the UI gating turned out to be cosmetic only.

Workflow now confirmed:
1. Generate Predictions BEFORE lines drop (using only UFCStats card data)
2. Lines drop → AUTO-FETCH
3. Edges light up automatically against the locked-in forecast

---

## Current slate context — UFC Fight Night: Allen vs Costa

**Status as of session end:** early fight week
- Pick6: 20 lines · Underdog: 22 lines · PrizePicks: 1 line · Betr: — · DK: no data
- 4 slate issues: lines 22min stale, P6 missing 2, PP missing 21, DK no data
- 20 actionable leans, top edge **+76% Melquizael Costa SS-UNDER**

### Picks visible (curated, AI BEST PICKS tab)

**BEST OVERS (8):**
| # | Fighter | Stat | Line | Source | Conf |
|---|---------|------|------|--------|------|
| 1 | Daniel Santos | TD | 1.5 | Pick6 | MED |
| 2 | Andre Petroski | FT | 7.5 | UD | MED |
| 3 | Alice Ardelean | FT | 12.5 | UD | LOW |
| 4 | Shauna Bannon | SS | 39.5 | Pick6 | LOW |
| 5 | Tuco Tokkos | TD | 2.5 | Pick6 | LOW |
| 6 | Jacqueline Cavalcanti | SS | 64.5 | Pick6 | LOW |
| 7 | Luis Gurule | SS | 54.5 | Pick6 | LOW |
| 8 | Modestas Bukauskas | SS | 38.5 | Pick6 | LOW |

**BEST UNDERS (8):**
| # | Fighter | Stat | Line | Source | Conf |
|---|---------|------|------|--------|------|
| 1 | Melquizael Costa | SS | 79.5 | Pick6 | HIGH |
| 2 | Modestas Bukauskas | FT | 12.5 | UD | HIGH |
| 3 | Timothy Angel Cuamba | SS | 43.5 | UD | MED |
| 4 | Daniel Santos | SS | 54.5 | Pick6 | MED |
| 5 | Malcolm Wellmaker | SS | 54.5 | Pick6 | LOW |
| 6 | Nicolle Caliari | SS | 48.5 | Pick6 | LOW |
| 7 | Ketlen Vieira | SS | 39.5 | Pick6 | LOW |
| 8 | Cody Brundage | TD | 0.5 | Pick6 | LOW + `corr` flag |

### Cross-stat watch flags

- **Modestas Bukauskas** appears as OVER SS 38.5 AND UNDER FT 12.5. Negatively correlated — shorter fight means fewer strikes. Possible (R1 finish flurry) but per memory, lean ONE side. Probably take FT UNDER 12.5 (HIGH conf) and skip the SS OVER.
- **Daniel Santos** appears as OVER TD 1.5 AND UNDER SS 54.5. POSITIVELY correlated (grappler thesis: more TDs → less striking). Safe to take both if committing to Santos as the grappler in his fight.
- **Cody Brundage TD UNDER 0.5** has system-flagged `corr` warning already.

### Model trust caveats discussed

**Allen prediction 39 SS vs book line 73.5** — huge 34 SS gap. Root cause traced:
- Model formula at [src/services/PropLinePredictorService.ts:307](src/services/PropLinePredictorService.ts#L307) averages fighter offense with opponent absorption, then scales by duration ratio.
- This anchors Allen to (47.6 + 44.6) / 2 = 46.1 base.
- Then ×0.88 grappler penalty (Costa flagged grappler) → ~40
- Book extrapolates per-minute volume across 5R fight time → ~73
- **Predictor v2 #2 (book prior blending)** is dead in production until archive grows past ~6 events — so wild model outliers aren't damped by historical calibration yet.

**User's MMA take (NOT applied as overrides this session, per user choice):**
- Allen = striker (not balanced as classifier says, not grappler)
- Costa = striker-grappler hybrid (not pure grappler) — would map to 'balanced' in our 3-state enum
- If anyone has a grappling edge in this fight it's Allen, NOT Costa — but Allen is still fundamentally a striker

User explicitly said "the leans are fine as-is" for this card — overrides are parked for future use. If you want to apply them later:
```js
setFighterStyle('Melquizael Costa', 'balanced')
setFighterStyle('Arnold Allen', 'striker')
```
Then re-run Generate Predictions. The -12% "vs Grappler" penalty disappears from Allen and the model output rises toward ~50 (still below 73.5 because of the structural averaging issue).

---

## NEXT SESSION FOCUS — Slate finalization once lines stabilize

The picks above are based on partial fight-week-1 lines. Watch for:

1. **AUTO-FETCH again** — see if Pick6/UD lines move and PrizePicks fills in (currently 1/22 fighters)
2. **DK Sportsbook** posts props progressively (per memory, partial coverage is normal) — eventually appears
3. **Re-check the HIGH-conf picks** after line movement:
   - Costa SS UNDER 79.5 — still top edge or shifted?
   - Bukauskas FT UNDER 12.5 — still HIGH?
4. **Decide on Bukauskas same-fighter cross-stat** — pick FT UNDER (likely) or SS OVER, not both
5. **Consider committing Santos grappler-thesis combo** if his lines hold (TD OVER 1.5 + SS UNDER 54.5)

---

## Open carryover (unchanged from yesterday's resume)

### High priority
- **Long-form vs canonical event-name re-injection bug** — past events keep flapping unresolved (UFC 328 etc) because some path re-creates archive records with long-form event names that don't match canonical UFCStats names. 256 records flapped 8↔203↔256 last session. Likely culprit: `mergeFighters` allowlist or a content-script/auto-fetch path. See [project_merge_fighters_field_list.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_merge_fighters_field_list.md).
- **Push the commits** — `299be07` and `535e02c` are local-only on `feature/sleek-theme-v1`; push when ready.

### Medium priority
- **Pick6 pickGroup polling still misses CTRL** — see [project_pick6_pickgroup_polling_pending.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_pick6_pickgroup_polling_pending.md)

### Low priority
- **Settle fires too early on event day** — uses same midnight-based heuristic that caused the cache bug. Apply same 30h grace to whatever is gating Settle in [src/background.ts:3066+](src/background.ts#L3066)
- **Tab count race condition** — `LEAN OVER 0 / LEAN UNDER 0 / AI BEST PICKS 8` on hard reload, observed once, didn't reproduce
- **AUTO-FETCH state-aware styling** — button stays bright green even with fresh `5m` pills (CSS specificity)
- **Analyzer phase-2 split** — Betr IIFE + UI panels per [project_analyzer_split_progress.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_analyzer_split_progress.md)

---

## Don't-forgets (unchanged + 1 new)

- Don't propose Kelly stakes
- Don't recommend storage-mutating snippets without read-only diagnosis first
- Reset Lines preserves Betr pre-fight-week, clears on/after event day
- Same-fight cross-stat OVERs/UNDERs are negatively correlated when they imply contradictory fight scripts (e.g. SS OVER + FT UNDER) — lean ONE side
- Same-fight cross-stat that REINFORCES one fight script (e.g. TD OVER + SS UNDER for a grappler) is positively correlated — safe to combine
- Big |delta| ≠ data bug; check fighter UFCStats history before flagging delta anomalies
- Resume document at start of session can be stale on uncommitted state — verify with `git status` before assuming work is unshipped
- **NEW:** When user reports misclassified/missing fighters, the three manual overrides handle most cases — check [project_manual_overrides.md](C:\Users\abdir\.claude\projects\c--Users-abdir-Downloads-ufc-project-v2\memory\project_manual_overrides.md) before proposing classifier rewrites

---

## Quick state snapshot at session end

- 13354 total settled records, all resolved
- UFC 328 fully absorbed, weights updated via Learning Cycle (prior session)
- UFC Fight Night: Allen vs Costa predictions generated and saved
- 20 actionable leans, 2 HIGH-conf picks, top edge Costa SS-UNDER +76%
- Override map clean (no entries set for this card)
- AUTO-FETCH ran ~22min before session end; lines aging
