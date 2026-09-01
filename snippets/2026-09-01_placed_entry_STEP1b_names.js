/*
 * STEP 1b. READ-ONLY. Writes nothing. Fixes a bug in STEP 1.
 *
 * STEP 1 section 4 came back empty and section 6 read "(unresolved)". That was
 * MY bug, not a data problem: upcoming_ufc_card.fighters is UFCFight[] shaped
 * { f1, f2, scheduledRounds, weightClass } - there is no `name` or `opponent`
 * field on it, so the filter matched nothing. src/types/index.ts:292.
 *
 * This re-reads the pairing correctly and pulls the FULL, untruncated name and
 * opponent from every line store, because those are the strings that must be
 * cloned verbatim into the placed record. Console tables truncate; the values
 * printed here are the whole string.
 */
(async () => {
  'use strict';
  const CARD = 'upcoming_ufc_card';
  const LINE_KEYS = ['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks', 'lines_draftkings_sportsbook'];
  const BOOK = { lines_pick6: 'pick6', lines_underdog: 'underdog', lines_betr: 'betr', lines_prizepicks: 'prizepicks', lines_draftkings_sportsbook: 'draftkings_sportsbook' };
  const TARGETS = ['ruziboev', 'page'];

  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const raw = await get([CARD, ...LINE_KEYS]);

  console.log('%c[placed-entry STEP 1b] READ-ONLY', 'font-weight:bold');

  // ── the card, read with the RIGHT field names ─────────────────────────────
  const card = raw[CARD];
  const fights = (card && Array.isArray(card.fighters)) ? card.fighters : [];
  console.log('%c── CARD PAIRINGS (f1 / f2) ──', 'font-weight:bold');
  console.log('  event on card:', card && card.event, '| fights:', fights.length);
  const hit = fights.filter((f) => TARGETS.some((t) =>
    String(f && f.f1 || '').toLowerCase().includes(t) || String(f && f.f2 || '').toLowerCase().includes(t)));
  if (hit.length) {
    for (const f of hit) console.log('  MATCH  f1=' + JSON.stringify(f.f1) + '  f2=' + JSON.stringify(f.f2) + '  rounds=' + f.scheduledRounds);
  } else {
    console.warn('  still no match - printing every pairing so the spelling can be read directly:');
    for (const f of fights) console.log('   ', JSON.stringify(f.f1), 'vs', JSON.stringify(f.f2));
  }
  // Guard the two-Johnson trap explicitly, on the corrected fields.
  for (const t of TARGETS) {
    const n = fights.filter((f) => String(f.f1 || '').toLowerCase().includes(t) || String(f.f2 || '').toLowerCase().includes(t)).length;
    if (n > 1) console.warn('  *** ' + n + ' fights involve "' + t + '" — resolve before writing. ***');
  }

  // ── full strings from the line stores ─────────────────────────────────────
  console.log('%c── LINE-STORE RECORDS (full strings, JSON-quoted) ──', 'font-weight:bold');
  for (const k of LINE_KEYS) {
    const st = raw[k];
    const arr = Array.isArray(st) ? st : (st && Array.isArray(st.fighters) ? st.fighters : []);
    for (const f of arr) {
      const nm = String(f && f.name || '').toLowerCase();
      if (!TARGETS.some((t) => nm.includes(t))) continue;
      console.log('  ' + BOOK[k].padEnd(22),
        'name=' + JSON.stringify(f.name).padEnd(24),
        'opponent=' + JSON.stringify(f.opponent ?? null).padEnd(24),
        'line_ss=' + f.line_ss,
        'ss_under_available=' + f.ss_under_available);
    }
  }
  console.log('  The UNDERDOG rows are the ones to clone - that is the book the slip was on.');
  console.log('  prettyName() only rewrites O\'-surnames, Mc-names and roman numerals, so for');
  console.log('  these two `pretty` is identical to `name`. No transform needed.');
})();
