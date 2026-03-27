# Resume Checkpoint

Last Saved: 2026-03-27 (Session 2)
Branch: feature/sleek-theme-v1
HEAD: 91f3b50 (+ session 2 changes uncommitted)
Snapshot: backups/full_project_snapshot_20260327_session2/

---

## RESUME CODE (paste this at the start of a new session)

```
Resuming UFC Fantasy Lines Grabber project.

Repo: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1
Stack: Chrome/Opera Extension — Manifest V3, TypeScript → compiled dist/
Event context: UFC Fight Night: Israel Adesanya vs Joe Pyfer (March 28, 2026, Seattle)

WHAT'S BUILT (all working, build is clean):
1. Head-to-Head modal — ⚔ button on each fighter row, side-by-side comparison with UFC.com fighter images
2. Moneyline-adjusted FP projection — calcMLAdjustedFP() blends win/loss history by implied win prob
3. Stat trend chips — ↑/↓ L3 chips on Avg FP, Avg SS, TD panel
4. Opening line movement tracker — lines_open_v1 in chrome.storage; ▲/▼ chips on line cells
5. Betr manual line persistence — lines_betr_manual_v1 (PROTECTED, never cleared)
6. Live auto-settling — LIVE_SETTLE_ALARM every 5 min during event window
7. Pre-event Report Card modal — fight pairs ordered by UFCStats card order (main → prelims)
8. Line Shopping Diff modal (🛒 Shop button) — all platforms side-by-side, lean-aware coloring
   - OVER lean: lowest line = green/best (easiest to clear)
   - UNDER lean: highest line = green/best (most room to go under)
   - Platform labels on every cell (P6/UD/BT/PP/DK), lean chip per fighter
9. Style Matchup panel (in expanded row detail)
   - Matchup chip: STRIKER vs GRAPPLER etc. with color coding
   - styleMatchupEdge() reasons for all 9 style pair combinations (incl. balanced cases)
   - SS over rate by opponent style (when cached opponent data available)
   - deriveStyle() fixed: slpm > 3.5 AND tdAvg < 1.5 → striker (catches kickboxers like Izzy)
10. Injury/Weight Cut News Flag (⚠ NEWS badge)
    - Fetches Google News RSS per fighter after data loads (30-min cache)
    - Keywords: injur, withdraw, pull, weight cut, hospitali, surgery, fracture, etc.
    - Pulsing badge on fighter row → click opens news modal with headlines + links
11. KO/SUB/DEC Finish Split (in Career Data panel)
    - Win methods: KO/TKO (red) · SUB (purple) · DEC (blue) mini bars
    - Loss methods: KO/TKO losses highlighted with ⚠ count (chin exposure)
12. Fight Time Breakdown panel (in expanded row detail)
    - Win + loss method bars for both fighters
    - Combined early-finish risk: 1 - (1-myFinish) × (1-oppFinish) → HIGH/MOD/LOW
    - Direct FT signal: ↓ LEAN UNDER FT or ↑ LEAN OVER FT
13. calcFTLean enhanced
    - KO/TKO loss vulnerability: -0.7 when ≥50% losses by stoppage
    - Opponent KO threat: -0.5 when opponent wins ≥40% by KO/TKO
    - FT lean panel title now shows direction inline: FT Lean ▼ UNDER 72%
14. Opponent Activity Context panel (in expanded row detail)
    - Splits FP/SS over rates by opponent activity (oppStats.sigStr as proxy)
    - vs active opp (>25 SS landed): X% over rate
    - vs passive opp (<12 SS landed): X% over rate
    - Quality flag when 25%+ drop vs active opponents

KEY FILES:
- src/analyzer.ts — main logic (~8600+ lines)
- analyzer.html — UI + all CSS
- manifest.json — MV3 config (host_permissions includes news.google.com)
- src/background.ts — alarms, settling, storage, FIND_CARD_FOR_FIGHTERS handler
- src/services/StorageService.ts — all chrome.storage wrappers

STORAGE KEYS:
lines_pick6 / lines_underdog / lines_betr / lines_betr_manual_v1 (PROTECTED) / lines_prizepicks /
lines_draftkings_sportsbook / lines_open_v1 / upcoming_ufc_card / last_completed_ufc_card /
ufc_img_v1_{slug} / prop_archive_v1 / ai_lean_snapshots_v1

NEW FUNCTIONS ADDED THIS SESSION:
- fetchFighterNews(name) / fetchAllFighterNews() — Google News RSS, 30-min cache
- generateLineShopModal() — lean-aware line shopping diff table
- buildStyleMatchupPanel(db, oppDB, ssLine, tdLine) — matchup chip + edge reasons + SS hit rates
- buildFightTimeSummaryPanel(db, oppDB, ftLine) — finish split bars + combined finish risk
- buildOpponentQualityPanel(db, fpLine, ssLine) — active vs passive opponent over rate splits
- styleMatchupEdge() — expanded to handle all 9 style pair combinations

MODULE STATE:
- _newsCache: Map<string, {items, fetchedAt}> — fighter news cache
- _newsAlertFighters: Set<string> — fighters with injury/news alerts
- NEWS_INJURY_KEYWORDS / NEWS_CACHE_TTL — news filtering constants

SUGGESTED NEXT FEATURES:
- Stack builder — which 2-3-pick combos from same fight have highest combined EV
- Quick pick export — one-click copy of locked picks in platform-ready format
- Side bet dedicated view — SS/TD/FT-only table with their own lean chips
- Lock picks mode — mark picks as locked, float to top, dim rest
- Confidence filter slider — show only fighters above X% confidence
```

---

## What Was Built This Session (2026-03-27, Session 2)

### Line Shopping Diff (🛒 Shop button)
- New modal comparing all platforms side-by-side per fighter
- Platform labels on every cell (P6/UD/BT/PP/DK above each value)
- Lean-aware coloring: OVER lean → lowest line = green/best; UNDER lean → highest = green/best
- Lean chip per fighter row showing direction + confidence
- Sorted by biggest spread descending

### Style Matchup Panel
- Added to expanded row detail
- Matchup chip with color per pair (STRIKER vs GRAPPLER etc.)
- Fixed deriveStyle(): lowered striker threshold to slpm > 3.5 AND tdAvg < 1.5
- Added all 9 balanced matchup cases to styleMatchupEdge()
- Removed empty "not enough cached data" message — panel only renders if content exists

### Injury/Weight Cut News Flag
- Google News RSS fetch per fighter (https://news.google.com/*)
- 30-min in-memory cache, runs after data loads
- ⚠ NEWS badge on fighter row, click → news modal with alert headlines + links

### KO/SUB/DEC Finish Split + Fight Time Suite
- Win/loss method breakdown bars in Career Data panel
- Fight Time Breakdown panel: both fighters' finish profiles + combined risk score + FT signal
- calcFTLean enhanced with KO-loss vulnerability and opponent KO threat scoring
- Opponent Activity Context panel: active vs passive opponent over rate splits

---

## Quick Commands
```powershell
npm run build
git log --oneline -5
git status
```
