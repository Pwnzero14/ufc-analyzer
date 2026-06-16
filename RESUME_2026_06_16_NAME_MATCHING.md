# RESUME — 2026-06-16 — Name-matching fixes (verbose/tagged/accented platform names)

## TL;DR
While loading lines for **UFC Fight Night: Kape vs. Horiguchi (2026-06-20)**, some fighters'
Underdog lines wouldn't attach and one fighter's UFCStats stats wouldn't fetch — all
platform↔UFCStats name-spelling gaps. Fixed and verified live. One commit:

- **`54078de`** — `fix: name-matching — verbose/tagged UD names + accents now attach lines`
  (follows yesterday's settle work: `737920a` + `d0a38c6`)

## What was wrong & the fix (src/analyzer.ts, src/config/index.ts)
Three fighters surfaced the gap as their lines went live:
1. **Vinicius Oliveira** — Underdog name `"Vinicius De Oliveira Prestes De Matos"` (his full
   legal name, 6 words).
2. **Andre Lima** — Underdog name `"Andre (Bra) Lima"` (country tag).
3. **Bia Mesquita** — platforms use `"Beatriz Mesquita"`; UFCStats fighter page is `"Bia Mesquita"`.

ROOT CAUSE (the non-obvious one): `isValidFighterName()` inside `mergeAndEnrich` (analyzer.ts
~15110) validated the **raw** scraped name and **dropped fighters before normalize/alias ran**:
- 6-word name failed `words.length > 5`
- `(Bra)` failed the `includes('(')` check
So the alias never got a chance. Fixes:
- `isValidFighterName` now validates the **normalized** name (parens/accents stripped, alias
  applied). Still rejects `:` event/prop labels.
- `normalizeName` now strips **diacritics** (NFD + combining-marks removal) and **parenthetical
  country tags** `\([^)]*\)`.
- `NAME_ALIASES` (config/index.ts, shared with settle): added
  `'Vinicius De Oliveira Prestes De Matos' → 'Vinicius Oliveira'` (+ `'Vinicius De Oliveira'`),
  and `'Beatriz Mesquita' → 'Bia Mesquita'`.

Result: Vinicius (UD SS 55.5) and Andre Lima (UD SS 58.5) attach; Bia fetches her UFCStats
history. Tagged names like `(Bra)`/`(Mex)` now flow automatically; truly verbose legal names
still need an alias to collapse, but won't crash the merge.

## Pattern for next time (this WILL recur as lines drop)
If a fighter's line won't attach or stats won't load this week, it's almost always a name gap:
1. In the **analyzer page console**, dump the raw platform name:
   ```js
   (async () => {
     const s = await chrome.storage.local.get(null);
     const k = Object.keys(s).find(x => /underdog/i.test(x) && Array.isArray(s[x]?.fighters || s[x]));
     const arr = Array.isArray(s[k]) ? s[k] : (s[k]?.fighters || []);
     console.log(k, JSON.stringify(arr.map(f => f.name)));   // add .filter(...) to narrow
   })();
   ```
   (storage key is `lines_underdog`; analogous for pick6/prizepicks/betr)
2. Compare to the UFCStats card spelling. Add `'<platform spelling>': '<UFCStats spelling>'` to
   `NAME_ALIASES` in `src/config/index.ts` (RHS = UFCStats canonical). Rebuild (`npm run build`).
3. Diacritics and `(Tag)` are now handled automatically — only true reorder/nickname/verbose
   gaps need an alias.

## State / housekeeping
- Yesterday's settle/archive work is done & healthy; see `RESUME_2026_06_15_SETTLE_GHOST_FIXES.md`.
- Archive: only this week's Kape/Horiguchi pending lines unresolved (legit); zero ghosts.
- Memory: `project_settle_rearchive_oscillation_and_fixes.md` (settle); name-matching pattern is
  standard project knowledge (`project_manual_overrides.md`, `UFCSTATS_NAME_ALIASES`).
- All commits pushed to `feature/sleek-theme-v1` AND `master` (dist included).
