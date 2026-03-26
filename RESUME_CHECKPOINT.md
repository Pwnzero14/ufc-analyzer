# Resume Checkpoint

Last Saved: 2026-03-26
Branch: feature/sleek-theme-v1
HEAD: 4bfb6da

---

## RESUME CODE (paste this at the start of a new session)

```
Resuming UFC Fantasy Lines Grabber project.

Repo: C:\Users\abdir\Downloads\ufc_project_v2
Branch: feature/sleek-theme-v1 (HEAD: 4bfb6da)
Stack: Chrome/Opera Extension — Manifest V3, TypeScript → compiled analyzer.js + dist/

WHAT'S BUILT (all committed, build is clean):
1. Head-to-Head modal — ⚔ button on each fighter row, side-by-side comparison with UFC.com fighter images (og:image, cached in ufc_img_v1_{slug})
2. Moneyline-adjusted FP projection — calcMLAdjustedFP() splits win/loss FP history, blends by implied win prob from moneyline; shows ML adj badge (+8.2 / -5.1) when shift ≥3pts
3. Stat trend chips — ↑ L3 +8.2 (green) / ↓ L3 -5.1 (red) on Avg FP, Avg SS, TD panel; calcStatTrend() compares last-3 to career avg
4. Opening line movement tracker — _openingLines Map + lines_open_v1 in chrome.storage; ▲/▼ chips on line cells when moved ≥0.5; persists across reloads, resets on new event
5. Betr manual line persistence — lines_betr_manual_v1 (PROTECTED key, never cleared); save writes to both keys; detects and reports line moves on save
6. Live auto-settling — LIVE_SETTLE_ALARM every 5 min during event window; startup catch-up if browser opens mid-event

KEY FILES:
- src/analyzer.ts — main logic (~7700+ lines)
- analyzer.html — UI + all CSS
- manifest.json — MV3 config (host_permissions includes ufc.com for fighter images)
- src/background.ts — alarms, settling, storage

STORAGE KEYS:
lines_pick6 / lines_underdog / lines_betr / lines_betr_manual_v1 (PROTECTED) / lines_prizepicks / lines_draftkings_sportsbook / lines_open_v1 / ufc_img_v1_{slug} / prop_archive_v1 / ai_lean_snapshots_v1

SUGGESTED NEXT FEATURES (not started):
4. Best 2/3-pick stack suggestions — same-fight fighters both projecting over, ranked by combined edge
5. Fight method/time prediction — KO/sub/dec probability from finish rates + styles, feeds SS/TD line value
6. Push probability per line — % chance of landing exactly on line based on historical distribution
7. Unit/bankroll tracker — log picks per event, track P&L by platform and prop type
8. Pre-event report card — one-click export of all leans/lines/confidence as shareable summary

TO RESUME: run `npm run build`, reload extension in Opera, pick a feature above.
```

---

## What Was Built This Session

### Head-to-Head Modal
- ⚔ button on every fighter row (hover to reveal)
- Side-by-side comparison: record, style, country, all lines, FP projections, striking, grappling, leans
- Fighter images fetched from `ufc.com/athlete/{slug}`, cached in chrome.storage under `ufc_img_v1_{slug}`
- Apostrophe fix for slugs (O'Neill → oneill)

### Moneyline-Adjusted FP Projection
- `calcMLAdjustedFP(history, moneyline)` — splits history into wins/losses, recency-weights each bucket, blends by implied win probability
- Shows as primary value in Avg FP cell; `+8.2` / `-5.1` ML adj badge when shift ≥3 pts
- Only fires when fighter has BOTH wins and losses in history

### Stat Trend Chips
- `calcStatTrend(history, getter, threshold, n=3)` — last-3 avg vs career avg
- `↑ L3 +8.2` (green) / `↓ L3 -5.1` (red) chips next to Avg FP and Avg SS in stats-mini
- TD trend chip on Takedowns panel title in detail view
- Threshold: FP=5pts, SS=4 strikes, TD=0.5. Requires ≥5 fights total.

### Opening Line / Movement Tracker
- `_openingLines` Map + `lines_open_v1` in chrome.storage (persists across reloads)
- `loadOpeningLines()` runs at start of loadData; `snapshotOpeningLines()` runs after mergeAndEnrich
- Resets automatically when event name changes
- `lineCell()` shows `▲0.5` (green) / `▼3.0` (red) chips on every line cell when moved ≥0.5

### Betr Manual Line Persistence
- Save writes to both `lines_betr` and `lines_betr_manual_v1` (protected key)
- `applyBetrManualOverrides()` merges manual lines on top of scraped lines on every load
- Auto-fetch and clear-lines never touches `lines_betr_manual_v1`
- Save button detects line movements on save and reports them

---

## Suggested Next Features

4. **Best 2-pick and 3-pick stack suggestions** — fighters from same fight who both project over, ranked by combined edge
5. **Fight method/time prediction** — KO/sub/dec probability from finish rates + styles → feeds SS/TD line value
6. **Push probability per line** — for lines within 5pts of avg, show % chance of landing exactly on it
7. **Unit/bankroll tracker** — log actual picks per event, track P&L over time by platform and prop type
8. **Pre-event report card** — one-click export of all current leans, lines, confidence scores as shareable summary

---

## Quick Commands
```powershell
npm run build
git log --oneline -5
git status
```
