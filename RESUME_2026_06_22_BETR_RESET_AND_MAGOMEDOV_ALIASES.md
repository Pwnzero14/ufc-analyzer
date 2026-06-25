# RESUME — 2026-06-22 — Betr reset clarified + Shara/Abus Magomedov UFCStats aliases

## TL;DR
Cleaned up the changeover from **Kape vs. Horiguchi** (settled last session) to this week's
**UFC Fight Night: Fiziev vs. Torres (2026-06-27, Baku)**, clarified how Betr lines actually reset,
and fixed two fighters whose UFCStats fight history wouldn't load. One code commit:

- **`e79afb8`** (master `2e5fe83`) — `fix: name aliases for Shara/Abus Magomedov (UFCStats short first names)`

(Prior session: ghost-event guard `93d49b6`/`2b7d423` + resume `36f23ce` — see
`RESUME_2026_06_20_GHOST_EVENT_GUARD_AND_SETTLE.md`.)

## 1. Magomedov name aliases (committed) — the only code change
Shara Magomedov (co-main vs Michel Pereira) and Abus Magomedov (main card vs Michal Oleksiejczuk)
showed "Fetching from UFCStats..." forever. Cause: UFCStats lists them by **short first names**
("Shara Magomedov" / "Abus Magomedov") but the platforms/card use the full legal first names
("Sharabutdin" / "Abusupiyan"), so the UFCStats first+last candidate search couldn't resolve them
(and bare "Magomedov" is ambiguous — TWO on this card). Added to BOTH alias maps:
- `src/config/index.ts` `NAME_ALIASES` (shared: card-match + canonicalization + settle; keeps the
  two Magomedovs distinct): `'Sharabutdin Magomedov' → 'Shara Magomedov'`,
  `'Abusupiyan Magomedov' → 'Abus Magomedov'`.
- `src/analyzer.ts` `UFCSTATS_NAME_ALIASES` (~line 1050; history fetch, belt-and-suspenders):
  lowercased keys → same values.
Verified live: both stat head-to-head panels now load full FP/SS/TD history.

**Reusable pattern (this recurs every card):** if a fighter's UFCStats history won't load, it's a
name gap. UFCStats often uses short/alt first names. Fix = add the platform/card spelling → UFCStats
spelling in `config/index.ts NAME_ALIASES` (canonical, also fixes settle) AND
`analyzer.ts UFCSTATS_NAME_ALIASES` (the fetch). Rebuild, reload extension (new canonical name =
fresh `ufcstats_v51_*` cache key, so it refetches automatically — no manual cache clear).

## 2. Card changeover cleanup (data only — no code)
- Settled Kape/Horiguchi → cleared its stale lines via popup **× CLEAR ALL LINES** (wipes the 4
  platform line stores; PRESERVES archive/history/Betr/ufcstats per
  [[project_clear_all_lines_scope]]). Also cleared the UD Conor/Max ghosts in that capture.
- Cleared the old Kape **Betr** lines manually:
  `chrome.storage.local.remove(['lines_betr','lines_betr_manual_v1'])`.

## 3. How Betr reset ACTUALLY works (corrected — memory updated)
The old [[feedback_betr_reset_rule]] note described intended behavior that the current workflow
doesn't deliver. Verified in code:
- **Startup `initializeBetrLines()`** (background.ts ~129): `BETR_EVENT_DATE` is frozen at
  `'2026-04-18'` (user never bumps it, per [[feedback_betr_entry_workflow]]). Since it's past, the
  staleness gate wipes only the legacy **seed** (`lines_betr`, `betr_seed_hash`, `betr_event_date`)
  and **preserves + re-loads `lines_betr_manual_v1`** every load → manual Betr lines persist across
  restarts. **There is no auto-reset of manual lines.**
- **RESET LINES button** (analyzer.ts ~17990): reads `betr_event_date`; future→preserve,
  past/**missing→wipe** both keys + in-memory `line_betr*`. Because `initializeBetrLines` *removes*
  `betr_event_date`, it's permanently missing → **RESET LINES always wipes Betr**, even mid-fight-week.
- **Practical rule:** after entering Betr for a card, DON'T click RESET LINES until that card is over
  (it'll erase your fresh manual entries). To clear old Betr post-event: RESET LINES or the
  `remove([...])` one-liner.

## OPEN (offered, not done) — restore Betr fight-week protection
Optional code fix: have the Betr manual-entry path (console snippet / Betr modal save ~analyzer.ts
18639) stamp `betr_event_date` = the upcoming card's date, so RESET LINES' future-date PRESERVE
branch works again without bumping `BETR_EVENT_DATE`. User hasn't decided yet.

## State / housekeeping
- Both branches in sync with origin; working tree clean except local-only `.claude/settings.local.json`.
- Current card: **Fiziev vs. Torres — Sat 2026-06-27 (Baku)**. Lines starting to drop (Partial).
  Betr not yet entered for this card. Two Magomedovs on the card now resolve correctly.
- Memory updated: [[feedback_betr_reset_rule]] (reality + the inert-protection gap).
