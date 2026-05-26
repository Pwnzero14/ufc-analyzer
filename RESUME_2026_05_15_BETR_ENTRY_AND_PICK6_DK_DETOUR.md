# Resume — Betr lines entered + Pick6 URL detour reverted

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-05-15
**Card:** Allen vs Costa (Sat, main event) + Choi vs Santos (co-main)
**Status:** Working. No commit yet.

## What landed this session

### 1. Betr lines entered for the Allen/Costa card (20 fighters)
Used the standard `lines_betr_manual_v1` console snippet path (per `feedback_betr_entry_workflow.md`). User backed up first, ran read-only diagnostic (`upcomingCardPairs` was empty, existing manual store had stale Tuco Tokkos / Modestas Bukauskas / etc. entries from prior week), then wrote new array.

Lines counter went **52 → 98**. Name reconciliation handled "Dooho Choi" → "Doo Ho Choi" via existing `namesMatch` logic. All 20 fighters confirmed visible with BT badges in the analyzer.

Entered fighters (FP / SS):
- Cavalcanti / K. Vieira (–/60.5, –/39.5)
- Erslan / Tokkos (–/27.5, –/25.5)
- Ardelean / Viana (75.5/72.5, –/30.5)
- Petroski / Brundage (74.5/25.5, –/20.5)
- Edwards / Bukauskas (50.5/28.5, –/34.5) — Edwards FP is boosted (+money OVER-only)
- Wellmaker / Diaz (88.5/54.5, –/45.5)
- Caliari / Bannon (80.5/–, 50.5/–) — Bannon FP is boosted (+money OVER-only)
- Williams / Veretennikov (–/37.5, –/35.5)
- Santos / Choi (–/50.5, –/45.5)
- Costa / Allen (–/79.5, –/73.5)

### 2. Pick6 URL detour (REVERTED — file state restored)
DraftKings flipped Pick6 from `?sport=UFC` to `?sport=MMA` this weekend (probably because there are 2 MMA cards). I edited 3 files to switch the URLs, but Pick6 still didn't fetch, and user said the rename is likely temporary. **All three files reverted** to `?sport=UFC` state:
- [src/config/index.ts:10](src/config/index.ts#L10)
- [src/background.ts:1636-1638](src/background.ts#L1636-L1638)
- [src/content.ts:893](src/content.ts#L893)

If Pick6 is still broken next weekend after the dual-card situation passes → it's permanent and we redo the change (and probably need new category IDs too — the working URL we observed used `category/129?sport=MMA&pickGroup=147785`, not `category/46/47`).

### 3. Memory saved
- `feedback_boost_icon_is_over_only.md` — Rocket icon on Betr/UD FP lines = OVER-only at +money. Don't exclude, enter normally. Existing `shouldSkipFpSideForFighter` at [src/analyzer.ts:1986-1994](src/analyzer.ts#L1986-L1994) already filters appropriately for ML underdogs.

## Current diff (uncommitted)

Carryover from prior session (still uncommitted):
- `analyzer.html` — fight-pair layout + spine + sparkline CSS
- `src/analyzer.ts` — FIGHT-PAIR LAYOUT block + pair-wrap + sparklines (~370 lines)
- ~25 `RESUME_*.md` files

This session added/modified:
- `RESUME_2026_05_15_BETR_ENTRY_AND_PICK6_DK_DETOUR.md` (this file)
- (Pick6 URL files were edited then reverted — should show as no-op in `git diff`)

Build: clean (`npm run build` passes).

## Quick verification on resume

```powershell
# Pick6 URLs back to ?sport=UFC
grep -n "sport=UFC" src/config/index.ts src/background.ts src/content.ts

# Betr manual store has 20 entries
# (open analyzer DevTools)
chrome.storage.local.get('lines_betr_manual_v1', r => console.log(r.lines_betr_manual_v1.fighters.length))
```

## What's NOT done

- **No commit yet.** Layout/sparklines from previous session still uncommitted. When user is ready: single feat commit for layout+sparklines, drop or .gitignore the RESUME_*.md pile.
- **Pick6 fetching** — still broken if DraftKings keeps `?sport=MMA` past this weekend. Wait one more event before re-investigating.
- **Lean badge overlap squishing** — deferred (user said "looking good" earlier).

## Context for future Claude

- The `lines_betr_manual_v1` workflow is non-negotiable: user backups first, diagnostic snippet first, write snippet last. Don't shortcut.
- "Boost rocket icon" on Betr/UD ≠ exclude — enter normally, downstream skip logic handles.
- If user sends Pick6 screenshots showing `?sport=MMA` URLs working AND `?sport=UFC` failing, that's the permanent rename signal — re-apply this session's reverted edits, but this time also probe whether `category/46` and `category/47` are still valid or need to be replaced with the new MMA-section category IDs.
- User gets frustrated when I branch into options. Pick the safe path, walk it step-by-step, one ask per turn.
