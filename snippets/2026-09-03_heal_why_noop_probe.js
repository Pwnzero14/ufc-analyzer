/*
 * READ-ONLY. The heal RUNS for Charriere and still does not correct him. Why?
 *
 * WHAT THE PREVIOUS PROBE SETTLED (2026-09-04 heal_path_probe, run 09-03)
 *   G3 SILENT FALSE: 0 | would hit: 29.  updateResult FINDS the row for every
 *   affected fighter. THE NORMALIZER-SPLIT HYPOTHESIS IS DEAD - do not re-open
 *   it. Charriere's history rows are all stored PLAIN ("Morgan Charriere"); the
 *   only accented row is a Betr LINE row for the current card.
 *   Also settled: rows 0-35 are Fantasy/Fantasy_PP/SS/TD/Control/FightTime with
 *   platform '(none)', which is precisely the record set
 *   archivePerformanceForRosterFighter emits (the settle path writes SS_R1 /
 *   ss_body / KD / ctrl WITH a platform). So the heal has run for him and
 *   authored those rows. Gate 1 passes in reality.
 *
 * WHAT WAS WRONG WITH THAT PROBE, so its G1 column is not re-used by mistake
 *   The roster reconstruction read `v.lines` or a bare array. The stores are
 *   shaped { fighters: [...] } (see STORAGE_LINE_KEYS, analyzer.ts:1122, and
 *   background.ts:145). rosterSet came back EMPTY, so every row reported
 *   "G1 NO" and that column carried no information at all. Fixed below.
 *
 * WHAT IS NOT AN ANOMALY, and must not be counted as one
 *   The heal only touches fighters on the CURRENT roster. Most of the 29 stale
 *   rows belong to fighters who are not on this card; they CANNOT heal and will
 *   correct themselves the next time those fighters appear. The anomaly is a
 *   population of ONE: a fighter who IS on the card, whose rows the heal wrote,
 *   and whose Fantasy row is still 5 x rev light. This probe separates the two
 *   groups so the background is never mistaken for the bug.
 *
 * THE SURVIVING HYPOTHESES, and the datum that separates them
 *   (H1) SILENT WRITE FAILURE - the known one.
 *        [[project_storage_quota_silent_writes]]: storageSet resolves even when
 *        the write is REJECTED, so a full disk looks like a no-op. Every
 *        updateResult rewrites the ENTIRE archive (~38.7k rows), and the heal
 *        fires ~12 of those per fight, unawaited. At the 10MB ceiling the heal
 *        runs, logs nothing, and changes nothing.
 *        PREDICTS: bytes in use at/near the quota, and a large prop_archive_v1.
 *   (H2) TRUNCATED CHAIN - archivePerformanceForRosterFighter is fire-and-forget
 *        (analyzer.ts:1639, .catch() with no await). Its writes are serialized
 *        through one static _writeChain shared by every fighter. If the page is
 *        closed or reloaded before the chain drains, later writes never land.
 *        PREDICTS: headroom is fine; the row heals after one QUIET board load.
 *   (H3) STALE CACHE - the heal ran when the cache said rev=0 and has not run
 *        since the cache re-parsed to rev=1.
 *        PREDICTS: cache fetchedAt is RECENT (TTL is 24h + hash%8h, so 24-32h)
 *        and yet the row is stale, which would make H3 self-contradictory,
 *        because a refresh and a heal are the same code path.
 *   NOTE: SS/TD/Control/FightTime agreeing with the cache dates NOTHING. Those
 *   values are identical whether rev is 0 or 1. They are not evidence of a
 *   recent run - do not cite them as such.
 *
 * Paste into the ANALYZER page console. get + getBytesInUse only, no writes.
 */
(async () => {
  'use strict';
  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const bytes = (k) => new Promise((r) => chrome.storage.local.getBytesInUse(k, r));
  const all = await get(null);
  const archive = Array.isArray(all['prop_archive_v1']) ? all['prop_archive_v1'] : [];
  console.log('%c[heal-noop] READ-ONLY', 'font-weight:bold');

  const loose = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const evLoose = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const r2 = (v) => Math.round(v * 100) / 100;

  // ── (H1) QUOTA ────────────────────────────────────────────────────────────
  const QUOTA = 10 * 1024 * 1024;
  let total = null, archBytes = null;
  try { total = await bytes(null); } catch (e) { console.warn('getBytesInUse(null) failed', e); }
  try { archBytes = await bytes('prop_archive_v1'); } catch (e) {}
  const jsonBytes = new Blob([JSON.stringify(archive)]).size;
  console.log('%c-- H1: QUOTA --', 'font-weight:bold');
  console.log('  archive rows        :', archive.length);
  console.log('  prop_archive_v1     :', archBytes, 'bytes (JSON.stringify =', jsonBytes + ')');
  console.log('  TOTAL bytes in use  :', total, 'of', QUOTA,
    total == null ? '' : '(' + Math.round((total / QUOTA) * 100) + '% used, ' + (QUOTA - total) + ' free)');
  if (total != null && QUOTA - total < jsonBytes) {
    console.log('%c  HEADROOM < ONE ARCHIVE REWRITE. A full-archive setAllRecords cannot', 'color:#f44336;font-weight:bold');
    console.log('%c  fit. This is H1 and it explains a heal that runs and changes nothing.', 'color:#f44336;font-weight:bold');
  } else if (total != null) {
    console.log('%c  Headroom exceeds one full archive rewrite -> H1 does NOT explain it.', 'color:#4caf50');
    console.log('  Say H1 is ruled out; do not keep it alive as a maybe.');
  }
  const big = Object.entries(all)
    .map(([k, v]) => [k, new Blob([JSON.stringify(v)]).size])
    .sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('  12 largest keys:');
  console.table(big.map(([k, b]) => ({ key: k, bytes: b, MB: (b / 1048576).toFixed(2) })));

  // ── the roster, read from the RIGHT field this time ───────────────────────
  const rosterRaw = new Set();
  const LINE_KEYS = ['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks',
    'lines_draftkings_sportsbook', 'lines_betr_manual_v1'];
  for (const k of LINE_KEYS) {
    const v = all[k];
    const arr = v && Array.isArray(v.fighters) ? v.fighters : null;
    if (!arr) continue;
    for (const f of arr) { const n = f && (f.name || f.fighter); if (n) rosterRaw.add(String(n)); }
  }
  const rosterLoose = new Set([...rosterRaw].map(loose));
  console.log('%c-- ROSTER (fixed reconstruction) --', 'font-weight:bold');
  console.log('  raw names:', rosterRaw.size, '| loose:', rosterLoose.size);
  if (!rosterRaw.size) console.warn('  STILL EMPTY - the line stores are shaped differently again; ignore roster columns.');
  console.log('  charriere present?', [...rosterLoose].filter((n) => n.includes('charriere')));

  // ── caches ────────────────────────────────────────────────────────────────
  const caches = [];
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('ufcstats_v51_') && v && Array.isArray(v.fightHistory)) caches.push({ key: k, data: v });
  }
  const cacheByLoose = new Map();
  for (const c of caches) for (const h of (c.data.fightHistory || [])) {
    if (h && h.event) cacheByLoose.set(loose(c.data.name) + '|' + evLoose(h.event), { h, c });
  }

  const F = { sig: 0.4, nonSig: 0.2, ctrl: 0.03, td: 5, rev: 5, kd: 10, quick: 25,
    wb: { r1: 90, r2: 70, r3: 45, r4: 40, dec: 30 } };
  const isFinish = (m) => /KO|TKO|SUB/i.test(m || '');
  const fpF = (h) => {
    if (h.sigStr == null) return null;
    const won = String(h.result).toLowerCase() === 'win';
    const nonSig = Math.max(0, Number(h.totStr || 0) - Number(h.sigStr || 0));
    const b = !won ? 0 : /DEC/i.test(h.method || '') ? F.wb.dec
      : ((h.round || 3) === 1 ? F.wb.r1 : (h.round || 3) === 2 ? F.wb.r2 : (h.round || 3) === 3 ? F.wb.r3 : F.wb.r4);
    let v = Number(h.sigStr || 0) * F.sig + nonSig * F.nonSig + Number(h.ctrlSecs || 0) * F.ctrl
      + Number(h.kd || 0) * F.kd + Number(h.td || 0) * F.td + Number(h.rev || 0) * F.rev + b;
    if (won && isFinish(h.method) && (h.round || 0) === 1 && (h.timeSecs == null ? 9999 : Number(h.timeSecs)) <= 60) v += F.quick;
    return r2(v);
  };

  // ── the 29, split into CAN-heal (on roster) vs CANNOT (not on card) ───────
  const rows = [];
  for (const row of archive) {
    if (!row || row.result == null) continue;
    if (String(row.propType) !== 'Fantasy') continue;
    const hit = cacheByLoose.get(loose(row.fighter) + '|' + evLoose(row.event));
    if (!hit || hit.h.sigStr == null) continue;
    const want = fpF(hit.h);
    if (want == null) continue;
    const d = r2(Number(row.result) - want);
    const revN = Number(hit.h.rev || 0);
    if (!(revN > 0 && Math.abs(d + 5 * revN) < 0.02)) continue;
    const onRoster = rosterLoose.has(loose(row.fighter));
    const ageH = ((Date.now() - Number(hit.c.data.fetchedAt)) / 3600000);
    const ttlH = (() => { let h2 = 0; const n = hit.c.data.name || '';
      for (let i = 0; i < n.length; i++) h2 = (h2 * 31 + n.charCodeAt(i)) >>> 0;
      return 24 + (h2 % (8 * 3600000)) / 3600000; })();
    rows.push({
      fighter: row.fighter, event: String(row.event).slice(0, 28),
      stored: row.result, 'heal would write': want, rev: revN, delta: d,
      'ON ROSTER (can heal)': onRoster ? 'YES' : 'no - expected background',
      'cache age h': ageH.toFixed(1), 'cache TTL h': ttlH.toFixed(1),
      'cache expired?': ageH > ttlH ? 'EXPIRED' : 'fresh',
    });
  }
  rows.sort((a, b) => (a['ON ROSTER (can heal)'] < b['ON ROSTER (can heal)'] ? 1 : -1));
  console.log('%c-- THE 29, SPLIT --', 'font-weight:bold');
  console.table(rows);
  const canHeal = rows.filter((r) => r['ON ROSTER (can heal)'] === 'YES');
  console.log('  ON ROSTER (the real anomaly):', canHeal.length,
    '| not on card (expected background):', rows.length - canHeal.length);
  if (!canHeal.length) {
    console.log('%c  NOBODY AFFECTED IS ON THE CARD. Then there is no live bug here at all -', 'color:#e0b000');
    console.log('%c  every stale row is simply awaiting its fighter\'s next appearance, and', 'color:#e0b000');
    console.log('%c  the Charriere question dissolves. Check this BEFORE proposing any fix.', 'color:#e0b000');
  }

  console.log('%c-- NEXT STEP (decides H2) --', 'font-weight:bold');
  console.log('  If H1 is ruled out and Charriere IS on the roster above, reload the');
  console.log('  analyzer board, let it FULLY settle (no navigation), then re-run this');
  console.log('  probe. Healed => H2, the fire-and-forget chain was being truncated.');
  console.log('  Still stale => neither; instrument updateResult\'s return value.');
  window.__healNoop = { rows, canHeal, total, archBytes, jsonBytes, rosterRaw: [...rosterRaw], big };
  console.log('  full result on window.__healNoop');
})();
