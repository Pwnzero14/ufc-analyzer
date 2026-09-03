/*
 * READ-ONLY. How many duplicate rows does prop_archive_v1 carry, and why?
 *
 * THE LEAD. On the 2026-09-03 board Ion Cutelaba appeared TWICE in a
 * stale-row table with the same event and the same value (45.83). One duplicate
 * is a curiosity; a systematic duplicate is a measurement bug, because
 * [[project_hit_rate_counted_lines_not_events]] already records leaderboards
 * counting archive ROWS and inflating SS by 4.67x. Duplicates also feed the
 * recalibration engine, which rewrites displayed confidence and EV.
 *
 * THE MECHANISM THIS TESTS. Three writers, and two of them disagree about what
 * makes a row unique:
 *   addProps (heal + line archiver)  merges on recordKey =
 *        fighter | event | platform | propType | DAY
 *   settle's row-creation guard      skips when a row exists matching only
 *        fighter | event | propType     (IGNORES platform AND day)
 *   applyResult                      only ever UPDATES, never creates
 * So if the two writers disagree about the DATE of one fight — or one writes a
 * platform and the other does not — the settle guard sees a match and declines
 * to create, while addProps sees a different key and APPENDS. Same fight, two
 * rows, neither writer at fault on its own.
 *
 * PREDICTION IF THAT IS THE CAUSE: duplicate groups differ on `day` and/or
 * `platform` while agreeing on fighter, event and propType.
 * PREDICTION IF NOT: groups differ on something else (or on nothing, meaning a
 * genuine exact-duplicate append, which would point somewhere else entirely).
 * The probe reports WHAT DIFFERS rather than just a count, so it can distinguish
 * these instead of confirming whichever one I expected.
 *
 * IMPORTANT — not every group here is a bug. Two rows for one fighter+event+prop
 * on DIFFERENT PLATFORMS is correct and expected: that is how per-book lines are
 * stored. Those are counted separately and excluded from the headline. The
 * suspicious sets are same-platform-different-day, and exact duplicates.
 *
 * Paste into the ANALYZER page console. chrome.storage.local.get only.
 */
(async () => {
  'use strict';
  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const all = await get(null);
  const archive = Array.isArray(all['prop_archive_v1']) ? all['prop_archive_v1'] : [];
  console.log('%c[archive-dupes] READ-ONLY', 'font-weight:bold');
  console.log('  archive rows:', archive.length);
  if (!archive.length) { console.warn('  empty — stop.'); return; }

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const evK = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const day = (r) => String(r.date || '').slice(0, 10);
  const plat = (r) => String(r.platform || '').toLowerCase() || '(none)';

  // Group on the IDENTITY the settle guard uses: fighter + event + propType.
  const groups = new Map();
  for (const r of archive) {
    if (!r) continue;
    const k = `${norm(r.fighter)}|${evK(r.event)}|${String(r.propType || '').toLowerCase()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const multi = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  const classify = (rows) => {
    const plats = new Set(rows.map(plat));
    const days = new Set(rows.map(day));
    const results = new Set(rows.map((r) => String(r.result)));
    const lines = new Set(rows.map((r) => String(r.line ?? '-')));
    if (plats.size === rows.length && plats.size > 1) return 'per-book (EXPECTED)';
    if (plats.size > 1 && days.size === 1) return 'per-book (EXPECTED)';
    if (plats.size === 1 && days.size > 1) return 'SAME PLATFORM, DIFFERENT DAY';
    if (plats.size === 1 && days.size === 1 && lines.size === 1 && results.size === 1) return 'EXACT DUPLICATE';
    if (plats.size === 1 && days.size === 1) return 'same key, values differ';
    return 'mixed';
  };

  const tally = new Map();
  const suspect = [];
  for (const [k, rows] of multi) {
    const c = classify(rows);
    tally.set(c, (tally.get(c) || 0) + 1);
    if (c === 'SAME PLATFORM, DIFFERENT DAY' || c === 'EXACT DUPLICATE' || c === 'same key, values differ') {
      suspect.push({
        fighter: k.split('|')[0],
        event: String(rows[0].event || '').slice(0, 26),
        prop: rows[0].propType,
        rows: rows.length,
        kind: c,
        days: [...new Set(rows.map(day))].join(' , '),
        platforms: [...new Set(rows.map(plat))].join(' , '),
        results: [...new Set(rows.map((r) => String(r.result)))].join(' , '),
        lines: [...new Set(rows.map((r) => String(r.line ?? '-')))].join(' , '),
      });
    }
  }

  console.log('%c-- GROUPS WITH MORE THAN ONE ROW --', 'font-weight:bold');
  console.table([...tally.entries()].map(([kind, n]) => ({ kind, groups: n })));
  console.log('  total multi-row groups:', multi.length, 'of', groups.size, 'distinct fighter+event+prop');

  console.log('%c-- SUSPECT GROUPS (the ones that should not exist) --', 'font-weight:bold');
  suspect.sort((a, b) => b.rows - a.rows);
  console.table(suspect.slice(0, 60));
  console.log('  suspect groups:', suspect.length, '| extra rows they contribute:',
    suspect.reduce((a, s) => a + (s.rows - 1), 0));

  // Does it actually distort anything? Only SETTLED rows feed hit rates.
  const settledExtra = suspect.filter((s) => s.results.split(' , ').every((v) => v !== 'null' && v !== 'undefined' && v !== 'NaN'));
  console.log('%c-- DOES IT DISTORT THE STATS? --', 'font-weight:bold');
  console.log('  suspect groups whose rows are ALL settled:', settledExtra.length);
  console.log('  those are the ones that can double-count in any per-ROW aggregate.');
  console.log('  Anything already deduping by fighter+date is unaffected — see');
  console.log('  [[project_hit_rate_counted_lines_not_events]], which fixed exactly that.');

  const cut = suspect.filter((s) => /cutelaba/i.test(s.fighter));
  if (cut.length) { console.log('%c-- the Ion Cutelaba row that started this --', 'font-weight:bold'); console.table(cut); }
  else console.log('  NOTE: Cutelaba is NOT in the suspect set — the observed pair was per-book or is gone. Say so rather than assuming the lead held.');

  console.log('%c-- HOW TO READ --', 'font-weight:bold');
  console.log('  Mostly "per-book (EXPECTED)"     -> no bug; per-platform rows are by design.');
  console.log('  Many "SAME PLATFORM, DIFFERENT DAY" -> the writers disagree on the fight date,');
  console.log('     which is the predicted mechanism: recordKey includes day, the settle guard does not.');
  console.log('  Many "EXACT DUPLICATE"           -> something appends without going through either guard.');
  window.__dupes = { groups: groups.size, multi: multi.length, tally: [...tally], suspect };
  console.log('  full result on window.__dupes');
})();
