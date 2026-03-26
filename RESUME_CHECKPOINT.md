# Resume Checkpoint

Last Saved: 2026-03-26
Branch: feature/sleek-theme-v1
HEAD: 43c6fa2

---

## What Was Built This Session

### Head-to-Head Modal
- ⚔ button on every fighter row (hover to reveal)
- Side-by-side comparison: record, style, country, all lines, FP projections, striking, grappling, leans
- Fighter images fetched from `ufc.com/athlete/{slug}`, cached in chrome.storage under `ufc_img_v1_{slug}`
- Apostrophe fix for slugs (O'Neill → oneill)
- CSS: `.h2h-modal-box`, `.h2h-fighters`, `.h2h-img-wrap`, `.h2h-table`, `.h2h-win/.h2h-lose`

### Moneyline-Adjusted FP Projection
- `calcMLAdjustedFP(history, moneyline)` — splits history into wins/losses, recency-weights each bucket, blends by implied win probability
- Shows as primary value in Avg FP cell; `+8.2` / `-5.1` ML adj badge when shift ≥3 pts
- Adds lean reason bullet when meaningful: "ML-adj projection X FP (ML, win prob%) — ..."
- Only fires when fighter has BOTH wins and losses in history

### Stat Trend Chips (Feature #2)
- `calcStatTrend(history, getter, threshold, n=3)` — last-3 avg vs career avg
- `↑ L3 +8.2` (green) / `↓ L3 -5.1` (red) chips next to Avg FP and Avg SS in stats-mini
- TD trend chip on Takedowns panel title in detail view
- Threshold: FP=5pts, SS=4 strikes, TD=0.5. Requires ≥5 fights total.

### Opening Line / Movement Tracker (Feature #3)
- `_openingLines` Map + `lines_open_v1` in chrome.storage (persists across reloads)
- `loadOpeningLines()` runs at start of loadData; `snapshotOpeningLines()` runs after mergeAndEnrich
- Resets automatically when event name changes
- `lineCell()` shows `▲0.5` (green) / `▼3.0` (red) chips on every line cell when moved ≥0.5
- Hover chip = tooltip showing opening value

### Betr Manual Line Persistence
- Save writes to both `lines_betr` and `lines_betr_manual_v1` (protected key)
- `applyBetrManualOverrides()` merges manual lines on top of scraped lines on every load
- Auto-fetch and clear-lines never touches `lines_betr_manual_v1`
- Save button detects line movements on save and reports them: "✓ Saved — Line moves: Adesanya SS ▼-2.0 (was 69.5)"

### Live Auto-Settling (from previous session, now committed)
- `LIVE_SETTLE_ALARM` fires every 5 min during event window (eventTs → eventTs+8h)
- Startup catch-up: if browser opens during live event, settles immediately + reschedules alarm
- `runSettle()` → fetchAndSettleFromUFCStats + backfill + notifies tabs

---

## Storage Keys Reference

| Key | Purpose |
|-----|---------|
| `lines_pick6` | Pick6 scraped lines |
| `lines_underdog` | Underdog scraped lines |
| `lines_betr` | Betr lines (may be overwritten) |
| `lines_betr_manual_v1` | User-adjusted Betr lines (PROTECTED) |
| `lines_prizepicks` | PrizePicks scraped lines |
| `lines_draftkings_sportsbook` | DraftKings scraped lines |
| `lines_open_v1` | Opening line snapshot `{ eventKey, lines: { "p6\|fp\|name": 84.5, ... } }` |
| `ufc_img_v1_{slug}` | Fighter image URL cache (UFC.com og:image) |
| `prop_archive_v1` | All-time prop archive with results |
| `ai_lean_snapshots_v1` | AI lean picks per event for accuracy tracking |
| `lines_open_v1` | Opening lines per fighter/platform/stat |

---

## Suggested Next Features (discussed, not started)

4. **Best 2-pick and 3-pick stack suggestions** — fighters from same fight who both project over (correlated), ranked by combined edge
5. **Fight method/time prediction** — given both fighters' finish rates + styles, predict KO/sub/dec probability → feeds SS/TD line value
6. **Push probability per line** — for lines within 5pts of avg, show % chance of landing exactly on it based on historical distribution
7. **Unit/bankroll tracker** — log actual picks per event, track P&L over time by platform and prop type
8. **Pre-event report card** — one-click export of all current leans, lines, confidence scores as shareable summary

---

## Resume Checklist
1. `npm run build` — verify clean
2. `git status` — confirm on `feature/sleek-theme-v1`
3. Load extension in Opera/Chrome (reload from extensions page)
4. Open analyzer, click BETR SCREENSHOT READER, upload lines, save — verify opening lines snapshot
5. Adjust a Betr line, save again — verify movement chip appears and status shows delta
6. Open H2H modal (⚔ button) — verify fighter images load
7. Pick next feature from the list above

## Quick Commands
```powershell
npm run build
git log --oneline -5
git status
```
