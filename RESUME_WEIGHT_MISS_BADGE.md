**Last session:** 2026-05-01 (UFC Perth weigh-in morning, fight Sat May 2). Branch: `feature/sleek-theme-v1`. Build: clean. **State:** ⚖ MISS badge bug — Gerald Meerschaert missed weight by 4 lb (confirmed via MMA Orbit tweet), but his row in the analyzer shows no badge. Spent the session iterating on the attribution logic. Three code changes made, all **uncommitted** in working tree.

---

## What's wrong

Gerald missed weight at UFC Perth weigh-ins (190 vs 186 MW limit, fight goes ahead with 30% purse forfeit). The `_weightMissSignals` pipeline isn't firing for him, despite Google News carrying the story. Original cause: every weight-miss headline returned by his Google News search uses generic descriptors like **"Longtime veteran"**, **"UFC Perth fighter"**, **"UFC Perth star"** — never his name. Strict name-in-title gate at `parseWeightMissFromTitle` rejected them all.

---

## Files modified (uncommitted)

```
src/analyzer.ts             | 65 +++++++++++++++++++++++++++++++++++++--------
src/analyzer/news.ts        | 14 +++++++++-
src/analyzer/weight-miss.ts | 12 ++++-----
```

### `src/analyzer/weight-miss.ts`
- Dropped the strict name-in-title gate (was `if (!lower.includes(fLower) && !lower.includes(lastName)) return null;`)
- Added new pattern `/weight\s+miss(?:ed|es|ing)?\b/i` to catch "four-pound weight miss" phrasing
- Param renamed `fighterName` → `_fighterName` (now unused; comment notes caller is responsible for context)

### `src/analyzer/news.ts`
- Added `description: string` field to `NewsItem` interface
- Parser now extracts `<description>` from Google News RSS, strips HTML tags + decodes common entities → plaintext for name matching

### `src/analyzer.ts` (`fetchAllFighterNews`, ~line 10556)
- Refactored into two passes:
  - **Pass 1**: Per-fighter parallel fetch, collect weight-miss candidates keyed by `articleKey = item.link || item.title`
  - **Pass 2**: For each article URL, attribute to a single fighter (title-named wins; else lowest item-index wins)
- `namesSelf` / `namesOther` checks now use **title + description** as haystack
- Strict gate: `if (!namesSelf) return; if (namesOther) return;` (no signal unless this fighter is named AND no other fighter is named)

---

## Current behavior

After the changes:
- ✅ JDM false-positive **fixed** — he no longer gets `⚖ MISS 4 LB` from card-recap articles
- ❌ Gerald **still no badge** — descriptions are too thin to contain his name

---

## Why it's still broken — diagnostic confirmed

Ran in console:
```js
fetch('https://news.google.com/rss/search?q=' + encodeURIComponent('"Gerald Meerschaert" UFC') + '&hl=en-US&gl=US&ceid=US:en')
  .then(r => r.text())
  .then(xml => {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const items = Array.from(doc.querySelectorAll('item'));
    items.slice(0, 8).forEach((item, i) => {
      console.log(`#${i}: ${item.querySelector('title')?.textContent}`);
      console.log(`  desc: ${(item.querySelector('description')?.textContent || '').slice(0, 300)}`);
    });
  });
```

**Result:** Google News descriptions have format `<a href="…">TITLE</a>&nbsp;&nbsp;<font>SOURCE</font>` — i.e., they just repeat the title text plus the source name. **No article body, no fighter-name snippets.** So our title+description haystack still doesn't contain "Gerald" or "Meerschaert" for the weight-miss articles.

The articles that DO mention Gerald in title/description (#5 UFC Records profile, #7 Khamzat Chimaev confrontation) don't match weight-miss patterns, so they're not candidates.

---

## What to try next session

### Approach A — Per-fighter article count (recommended)
Within a fight pair, the fighter who actually missed weight has multiple articles matching weight-miss patterns in their search results; the opponent has zero or one (tangential card-recap mentions). Compare counts per fight pair:

```ts
// Pseudocode — apply at end of fetchAllFighterNews
for each unique fight pair (f, opp):
  fScore = count of weight-miss-pattern articles in f's results (post cross-fighter-name guard)
  oScore = count of weight-miss-pattern articles in opp's results
  if fScore >= 2 && fScore > oScore * 2: apply f's best signal
  if oScore >= 2 && oScore > fScore * 2: apply opp's best signal
  // tiebreak: skip (ambiguous)
```

For UFC Perth: Gerald has 3+ matching articles (`#2 talkSPORT`, `#3 Bloody Elbow`, `#? MMA Fighting`); Malkoun has 0 → fires for Gerald. JDM has maybe 1 (recap mention); Prates has 0-1 → ambiguous, no badge. Goal achieved.

This drops the "both names guard" since we're using a per-pair count instead. Keep the cross-fighter title-name reject as a sanity check but don't require namesSelf.

### Approach B — Article-URL slug
The Google News redirect URL (`https://news.google.com/rss/articles/CBMi…`) is base64-encoded; the encoded payload contains the original article URL, often with a slug like `gerald-meerschaert-misses-weight`. Decode and check for fighter name. Risk: Google may change encoding format; brittle.

### Approach C — Don't fix code; wait for direct headlines
As more outlets publish (MMA Junkie, ESPN, MMA News), some will use direct headlines like "Gerald Meerschaert misses weight at UFC Perth". The current strict gate would then fire correctly. Lowest-effort path but doesn't solve the underlying generic-title problem for future cards.

**Recommendation:** Approach A. It's clean, doesn't depend on Google's URL encoding, and matches the reality that the misser is the subject of multiple articles.

---

## Verification gate (still pending)

Original gate from previous session's resume: "verify ⚖ MISS badges fired correctly" before predictor v2 lift verification. **Still not satisfied** — pick this up first thing next session.

After fix:
1. Reload extension at `chrome://extensions` (↻)
2. Gerald row → ⚖ MISS 4 LB
3. JDM, Prates, Malkoun, all other Perth fighters → no badge
4. Click Gerald's badge → confirm source headline references his miss
5. Expand Gerald's row → Top 3 Drivers + SS/TD/FT panels reflect weight-miss penalty (existing logic in `applyWeightMissToFighter`)

---

## Other context (unchanged)

- DM vs Prates settle gate still pending — Sat May 2 ~11 AM EST
- Project snapshot from previous session: `backups/full_project_snapshot_20260430_135140/`
- Analyzer snapshot: `backups/analyzer_snapshot_20260430_220052/`
- Branch is 38+ ahead of origin (was 38 before this session; current uncommitted changes haven't added a commit)
- Predictor v2 lift verification + Learning Summary visual check still gated on the DM/Prates settle
- Don't propose Kelly stakes (memory: `feedback_no_kelly_stakes`)

---

## Quick reference — key code locations

- Weight-miss parser: [src/analyzer/weight-miss.ts:19](src/analyzer/weight-miss.ts#L19)
- News fetcher + RSS parser: [src/analyzer/news.ts:17](src/analyzer/news.ts#L17)
- `fetchAllFighterNews` orchestrator: [src/analyzer.ts:10556](src/analyzer.ts#L10556)
- Badge render in row: [src/analyzer.ts:12702](src/analyzer.ts#L12702)
- News modal click handler: [src/analyzer.ts:15611](src/analyzer.ts#L15611)
- `applyWeightMissToFighter` (lean engine): [src/analyzer.ts:5363](src/analyzer.ts#L5363)
