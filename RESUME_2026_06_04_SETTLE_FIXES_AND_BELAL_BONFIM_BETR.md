# Resume — Settle Follow-ups Shipped + Belal vs Bonfim Betr Entry

**Branch:** `feature/sleek-theme-v1`
**Date:** 2026-06-04 (Thursday, fight week — Belal vs Bonfim card Saturday 6/6)
**Card in analyzer:** Belal Muhammad vs Gabriel Bonfim (Live · 95 lines)
**Working tree:** clean re: code. `.claude/settings.local.json` modified (pre-existing) + the two long-standing untracked dirs still showing. Last commit `457c356` pushed to `origin`.

---

## TL;DR

Shipped the two non-blocking settle follow-ups that were queued from the 2026-05-30 Song vs Figueiredo session (commit `457c356`, pushed). Then did routine Betr base-line entry for the Belal vs Bonfim card — 24 SS lines + 9 FP lines into `lines_betr_manual_v1`, verified attached (Betr chip → 24, Live 71→95).

---

## What happened this session

### 1. Code fixes — commit `457c356` (pushed to origin/feature/sleek-theme-v1)

`fix(settle): share NAME_ALIASES with settle path + drop debug HTML leak` — 3 files, +62/−54.

**Fix A — removed the `debug_fight_html_*` storage leak.** Deleted the write-only block (and its `firstFightHtmlStored` flag) in the UFCStats fetch loop in [src/analyzer.ts](src/analyzer.ts). Nothing read those keys; they accumulated ~4 MB/card and silently broke SETTLE NOW once `chrome.storage.local` hit the 10 MB cap. (Was follow-up A from the 05-30 resume.)

**Fix B — settle path is now alias-aware.** Moved `NAME_ALIASES` out of analyzer.ts into the shared [src/config/index.ts](src/config/index.ts). Both [src/analyzer.ts](src/analyzer.ts) (`normalizeName`) and the settle path in [src/background.ts:694-703](src/background.ts#L694) now import the *same* map — analyzer no longer holds a private copy, so the two normalizers can't drift. `background.ts`'s `_normName` resolves through a re-normalized `_aliasLC` map, so platform-spelling archive rows (e.g. "Yadong Song") match their canonical UFCStats siblings ("Song Yadong") at settle time. This kills the per-event ~27-row manual sibling-backfill ritual. (Was follow-up B from the 05-30 resume.)

> **Deviation from the 05-30 plan:** the plan said "inline the map into background.ts." I instead extracted to the shared config module both files already import — same net line count, no duplicate-map drift. Verified 4 alias cases resolve (Yadong Song, Meng Ding, Loopy Godinez, Carlston Harris) via a node check. `tsc` clean.
>
> **Caveat:** only affects *future* settles. Already-orphaned rows from past events were hand-resolved at the time. And the bridge only covers names already in `NAME_ALIASES` — a brand-new spelling mismatch still needs an alias added to config/index.ts + rebuild.

Note: `UFCSTATS_NAME_ALIASES` (analyzer.ts ~871, canonical→UFCStats-search form, used pre-fetch) is a **separate** map — intentionally untouched.

### 2. Betr base-line entry — Belal vs Bonfim

Did the standard `lines_betr_manual_v1` workflow (per [[feedback_betr_entry_workflow]]): user clicked BACKUP, ran read-only diagnostic (confirmed empty: `BETR_EVENT_DATE undefined`, 0 base fighters, no manual capturedAt → clean write safe), then the bulk write snippet, then F5.

Result: **24 SS + 9 FP written**, `capturedAt 2026-06-04T22:02:48Z`. After F5, Betr chip flipped `— → 24 now`, Live count 71→95, `bt=` values now populate the SS/TD comparison logs. All 24 reconciled via `namesMatch` (no orphans, no new aliases needed — including the six not in the pre-existing Pick6/UD roster: Yannis, Luna, Mitchell, Nolan, Shahbazyan, Allen).

The 9 FP lines: Carnelossi 50.5🚀, Chaves 88.5, Duben 50.5🚀, McGhee 91.5, Costa 107.5, Baraniewski 101.5, Tafa 50.5🚀, Ziam 89.5, Nolan 50.5🚀. The four 🚀 are Betr flat-50.5 boost promos (OVER-only, +money) — entered normally per [[feedback_boost_icon_is_over_only]]; skip logic handles the side. FP coverage being partial (9 of 24) is expected.

One spelling note acted on: Betr shows "É. Cháirez" with accents; wrote ASCII `E. Chairez` to match canonical UFCStats spelling and avoid a `namesMatch` last-name break. Confirmed correct — analyzer roster has "Edgar Chairez".

---

## State of the project right now

- **Branch:** `feature/sleek-theme-v1` — in sync with `origin`, no uncommitted code.
- **Last code commit:** `457c356 fix(settle): share NAME_ALIASES …` (this session, pushed).
- **dist/** rebuilt locally (`npm run build`, clean). dist is gitignored — only the 3 src files were committed. Extension was reloaded/refreshed to pick it up.
- **Betr lines:** Belal vs Bonfim base lines loaded in `lines_betr_manual_v1` (24 SS + 9 FP). As the week moves, edit individual lines via the BETR LINES modal row-edit (preserves openLine/movement) — do NOT re-run the bulk snippet unless intentionally resetting openers.
- **Archive:** unchanged this session. Song vs Figueiredo fully settled last session; storage ~5.5 MB.

---

## Memory updates this session

- **Updated** [[project_settle_path_no_alias_resolution]] — marked RESOLVED in code (457c356); kept historical bug context + "if orphans still appear, add alias to config + rebuild" guidance.
- **Updated** [[project_debug_fight_html_storage_bloat]] — marked RESOLVED; noted legacy keys may still sit in old storage (delete snippet still applies); silent-settle-0 diagnostic preserved as reusable for other bloat sources.
- **MEMORY.md** index lines for both updated to lead with FIXED status.

---

## Open / next-cadence (nothing blocking)

- **Pre-fight prediction work for Belal vs Bonfim** — normal fight-week cadence (Tue–Fri). Lines now fully loaded across all 5 platforms.
- **Watch the next settle** (post-Belal/Bonfim, ~Sat night/Sun) — first real test of the Fix B alias-aware settle path in production. If it resolves with **0 manual sibling-backfill**, that confirms the fix; if orphans remain, they're either (a) a spelling not in `NAME_ALIASES` → add to config/index.ts, or (b) irreducible Pick6-only `ctrl` / platform-specific `FightTime` stragglers with no sibling to copy from.
- **`feature/sleek-theme-v1`** is still a long-lived feature branch, not merged to `master`. No merge requested.

---

## Quick-reference: Betr entry workflow (reuse next card)

1. User clicks **BACKUP** in analyzer header (mandatory).
2. Read-only diagnostic on analyzer-tab console: check `BETR_EVENT_DATE`, `lines_betr` base count, `lines_betr_manual_v1` capturedAt. Clean if all empty/none.
3. Bulk write snippet → `lines_betr_manual_v1` ONLY, shape `{ fighters: [{name, opponent, line_ss, line_fp, line_td, line_ft}], capturedAt }`. `line_td/line_ft: null` unless shown.
4. **F5 the analyzer tab** (not the extension). Betr chip should flip to `N now`; Live count rises by N.
5. NEVER bump `BETR_EVENT_DATE` or edit the background.ts seed — that wipes line movement (the whole reason the manual key exists).
6. Names: initial-form ("B. Muhammad") reconciles fine via `namesMatch` (last name + first initial). Strip accents to ASCII to avoid last-name mismatches.
