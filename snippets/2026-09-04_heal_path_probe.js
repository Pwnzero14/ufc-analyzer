/*
 * READ-ONLY. WHY DIDN'T CHARRIERE HEAL?
 *
 * THIS IS A QUESTION ABOUT THE HEAL PATH, NOT THE PARSE. The parse is settled:
 * the live UFCStats page reads Rev correctly, the cache is right, the archive is
 * stale. Four parse hypotheses are dead (fighter-page-vs-detail, trailing-range
 * loss, opponent-cell fallback, settle-vs-backfill writer) - do not re-open them.
 *
 * THE HEAL THAT SHOULD HAVE FIRED
 *   fetchFighterStats -> archivePerformanceForRosterFighter(name, ufcData)
 *   runs on EVERY board load for a roster fighter, INCLUDING a cache hit
 *   (fetchFromUFCStats returns the cached object and the archive call is made off
 *   the resolved promise regardless). It then does BOTH:
 *     PropArchiveService.updateResult(...)  - overwrites row.result unconditionally
 *     PropArchiveService.addProps(records)  - upserts by recordKey
 *   Either one alone should have rewritten a stale Fantasy row. Neither did.
 *
 * THE FOUR GATES, IN THE ORDER THEY CAN KILL IT (cheapest to rule out first):
 *   1. ROSTER   `if (!roster.has(fighterNorm.toLowerCase())) return;`
 *               roster = normalizeName() over allFighters, which is built from the
 *               MERGED PLATFORM LINE ENTRIES, not from upcoming_ufc_card.
 *   2. CACHE    the loop only writes rows for events present in fightHistory, and
 *               only when at least one stats field is non-null.
 *   3. MATCH    updateResult filters fighter + propType FIRST (any event) and
 *               returns false SILENTLY when !candidates.length. Only then does it
 *               narrow by normalizeEvent, then nearest date, then opponent.
 *   4. KEY      addProps merges by recordKey = fighter|event|platform|prop|day.
 *               A miss here APPENDS a second row instead of healing the first.
 *
 * THE LEAD THIS PROBE EXISTS TO TEST
 *   There are TWO normalizeName implementations and they DISAGREE ON DIACRITICS:
 *     analyzer.ts:24584        NFD + strip U+0300-U+036F, then Title Case
 *                              -> "Morgan Charriere"
 *     PropArchiveService.ts:6  NO diacritic strip, just lowercase
 *                              -> "morgan charriere" vs "morgan charri<e-grave>re"
 *   archivePerformanceForRosterFighter passes the ALREADY-STRIPPED name into
 *   updateResult, which re-normalizes it with the OTHER function and compares to
 *   normalizeName(row.fighter) of the STORED row. If the stored row carries the
 *   accented platform spelling the two never compare equal: gate 3 returns false
 *   with no log line, and gate 4 writes a duplicate under a different key.
 *   PREDICTION IF TRUE : the archive holds an accented spelling for the affected
 *     fighter, updateResult finds 0 candidates, recordKey does not collide.
 *   PREDICTION IF FALSE: candidates ARE found and the row is a real target - in
 *     which case the heal does rewrite it and the question becomes why it never
 *     runs (gate 1 or 2), which this probe reports too. Do not claim the
 *     normalizer split if gate 3 passed.
 *
 * The four normalizers below are COPIED VERBATIM from source. Do not
 * hand-transcribe them differently - v1 of the archive-FP probe invented its
 * scoring constants and produced 2270 phantom findings.
 *
 * TWO HONEST LIMITS OF THIS PROBE, stated up front so its output is not
 * over-read:
 *   (a) allFighters cannot be read from storage. The roster set here is
 *       RECONSTRUCTED from the lines_* stores. A gate-1 "NO" is therefore a
 *       LEAD, not a verdict - confirm it against the live rosterNameSet().
 *   (b) anaName omits NAME_ALIASES. A fighter whose alias rewrites their name
 *       will look mismatched here when production would match.
 *
 * Paste into the ANALYZER page console. chrome.storage.local.get only.
 */
(async () => {
  'use strict';
  const ARCH = 'prop_archive_v1';
  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const all = await get(null);
  const archive = Array.isArray(all[ARCH]) ? all[ARCH] : [];
  const caches = [];
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('ufcstats_v51_') && v && Array.isArray(v.fightHistory)) caches.push({ key: k, data: v });
  }
  console.log('%c[heal-path] READ-ONLY', 'font-weight:bold');
  console.log('  archive rows:', archive.length, '| ufcstats caches:', caches.length);
  if (!archive.length || !caches.length) { console.warn('  missing data - stop.'); return; }

  // ── VERBATIM from PropArchiveService.ts (lines 6, 17, 22, 71) ─────────────
  const svcName = (name) => {
    if (typeof name !== 'string') return '';
    return name
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
      .replace(/\./g, '')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };
  const svcEvent = (e) => (typeof e !== 'string' ? '' : e.replace(/\s+/g, ' ').trim().toLowerCase());
  const svcProp = (p) => {
    const v = String(p || '').trim();
    if (!v) return 'Fantasy';
    if (/^ss$/i.test(v)) return 'SS';
    if (/^td$/i.test(v)) return 'TD';
    if (/^fantasy_pp$/i.test(v) || /^fp_pp$/i.test(v)) return 'Fantasy_PP';
    if (/^fantasy$/i.test(v) || /^fp$/i.test(v)) return 'Fantasy';
    if (/^control$/i.test(v)) return 'Control';
    if (/^ft$/i.test(v) || /^fight\s*time$/i.test(v) || /^fighttime$/i.test(v)) return 'FightTime';
    return v;
  };
  const svcKey = (r) => [
    svcName(r.fighter), svcEvent(r.event), (r.platform || '').toLowerCase(),
    String(svcProp(r.propType)).toLowerCase(), String(r.date || '').slice(0, 10),
  ].join('|');

  // ── VERBATIM from analyzer.ts:24584, minus NAME_ALIASES (see limit (b)) ───
  const anaName = (name) => {
    if (!name || name === 'null' || name === 'undefined') return null;
    let n = String(name).replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').trim();
    n = n.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
    n = n.replace(/\([^)]*\)/g, ' ');
    n = n.replace(/\./g, '').replace(/-/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
    n = n.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return n;
  };

  // accent-blind key, used only to FIND rows across the split
  const loose = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const evLoose = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const r2 = (v) => Math.round(v * 100) / 100;
  const hasAccent = (s) => String(s || '') !== String(s || '').normalize('NFD').replace(/\p{M}/gu, '');

  // ── FANTASY_SCORING mirror (config/index.ts) - fuzz-verified in this series ─
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

  // ── RECONSTRUCTED roster (limit (a) - a lead, not a verdict) ──────────────
  const rosterRaw = new Set();
  for (const k of Object.keys(all)) {
    if (!/^lines_/.test(k)) continue;
    const v = all[k];
    const arr = Array.isArray(v) ? v : (v && Array.isArray(v.lines) ? v.lines : null);
    if (!arr) continue;
    for (const row of arr) { const n = row && (row.name || row.fighter || row.player); if (n) rosterRaw.add(String(n)); }
  }
  const cardNames = new Set();
  const card = all['upcoming_ufc_card'];
  if (card && Array.isArray(card.fighters)) {
    for (const f of card.fighters) { if (f && f.f1) cardNames.add(String(f.f1)); if (f && f.f2) cardNames.add(String(f.f2)); }
  }
  const rosterSet = new Set();
  for (const n of rosterRaw) { const a = anaName(n); if (a) rosterSet.add(a.toLowerCase()); }
  const cardSet = new Set();
  for (const n of cardNames) { const a = anaName(n); if (a) cardSet.add(a.toLowerCase()); }
  console.log('  line-store raw names:', rosterRaw.size, '-> reconstructed roster', rosterSet.size,
    '| card names:', cardNames.size, '-> card set', cardSet.size);
  if (!rosterSet.size) console.warn('  RECONSTRUCTION EMPTY - gate 1 below is untestable, ignore its column.');

  // ── cache index, accent-blind ─────────────────────────────────────────────
  const cacheByLoose = new Map();
  for (const c of caches) for (const h of (c.data.fightHistory || [])) {
    if (h && h.event) cacheByLoose.set(loose(c.data.name) + '|' + evLoose(h.event), { h, cacheName: c.data.name, cacheKey: c.key });
  }
  // loose raw-name lookup so we can use the PLATFORM spelling the heal is really called with
  const rosterByLoose = new Map();
  for (const n of rosterRaw) rosterByLoose.set(loose(n), n);

  // ── every stale Fantasy row explained by 5 x rev ──────────────────────────
  const affected = [];
  for (const row of archive) {
    if (!row || row.result == null) continue;
    if (String(svcProp(row.propType)).toLowerCase() !== 'fantasy') continue;
    const hit = cacheByLoose.get(loose(row.fighter) + '|' + evLoose(row.event));
    if (!hit || hit.h.sigStr == null) continue;
    const want = fpF(hit.h);
    if (want == null) continue;
    const d = r2(Number(row.result) - want);
    const revN = Number(hit.h.rev || 0);
    if (!(revN > 0 && Math.abs(d + 5 * revN) < 0.02)) continue;
    affected.push({ row, ...hit, want, delta: d, rev: revN });
  }
  console.log('%c  stale-by-5xrev Fantasy rows found:', 'font-weight:bold', affected.length);

  // ── simulate the gates ────────────────────────────────────────────────────
  const table = [];
  for (const a of affected) {
    // the heal receives the PLATFORM name (pre-alias), not the cache name
    const platformRaw = rosterByLoose.get(loose(a.cacheName)) || a.cacheName;
    const fighterNorm = anaName(platformRaw);
    const g1 = fighterNorm ? rosterSet.has(fighterNorm.toLowerCase()) : false;

    const nf = svcName(fighterNorm);
    const ne = svcEvent(a.h.event);
    const candidates = archive.filter((r) =>
      svcName(r.fighter) === nf && String(svcProp(r.propType)).toLowerCase() === 'fantasy');
    const exactEvent = candidates.filter((r) => svcEvent(r.event) === ne);

    const ts = Date.parse(a.h.date);
    const dateIso = Number.isFinite(ts) ? new Date(ts).toISOString() : null;
    const wouldKey = dateIso
      ? svcKey({ fighter: fighterNorm, event: String(a.h.event).trim(), platform: '', propType: 'Fantasy', date: dateIso })
      : '(no parseable cache date)';
    const staleKey = svcKey(a.row);

    table.push({
      'platform name': platformRaw,
      'archive fighter': a.row.fighter,
      'accent differs?': svcName(platformRaw) !== svcName(a.row.fighter) ? 'YES' : '',
      event: String(a.row.event).slice(0, 26),
      rev: a.rev, delta: a.delta,
      'G1 roster?': g1 ? 'yes' : 'NO',
      'G3 cands': candidates.length,
      'G3 exact': exactEvent.length,
      'G3 verdict': !candidates.length ? 'SILENT FALSE' : exactEvent.length ? 'would hit' : 'date-fallback',
      'G4 key': wouldKey === staleKey ? 'merge' : 'APPENDS NEW',
      'arch platform': a.row.platform || '(none)',
      'arch day': String(a.row.date || '').slice(0, 10),
      'cache day': dateIso ? dateIso.slice(0, 10) : '-',
    });
  }
  console.table(table);

  const nSilent = table.filter((r) => r['G3 verdict'] === 'SILENT FALSE').length;
  const nHit = table.filter((r) => r['G3 verdict'] === 'would hit').length;
  const nDate = table.filter((r) => r['G3 verdict'] === 'date-fallback').length;
  const nNoRoster = table.filter((r) => r['G1 roster?'] === 'NO').length;
  const nAppend = table.filter((r) => r['G4 key'] === 'APPENDS NEW').length;

  // ── Charriere specifically, since he is the named case ────────────────────
  const chRows = archive.filter((r) => loose(r.fighter).includes('charriere'));
  const chCaches = caches.filter((c) => loose(c.data.name).includes('charriere'));
  console.log('%c-- CHARRIERE --', 'font-weight:bold');
  console.log('  archive rows:', chRows.length, '| caches:', chCaches.length);
  console.log('  distinct archive spellings:', [...new Set(chRows.map((r) => r.fighter))]);
  console.log('  distinct cache spellings  :', chCaches.map((c) => c.data.name));
  console.log('  any accented archive spelling?', chRows.some((r) => hasAccent(r.fighter)));
  console.log('  in reconstructed roster?', [...rosterSet].filter((n) => n.includes('charriere')));
  for (const c of chCaches) {
    const age = ((Date.now() - Number(c.data.fetchedAt)) / 3600000).toFixed(1);
    console.log('   cache', c.key, '| fetched', age + 'h ago', '| fights', (c.data.fightHistory || []).length);
  }
  console.table(chRows.map((r) => ({
    fighter: r.fighter, event: String(r.event).slice(0, 30), prop: r.propType,
    result: r.result, line: r.line == null ? '-' : r.line,
    platform: r.platform || '(none)', day: String(r.date || '').slice(0, 10),
  })));

  // ── the diacritic split, measured archive-wide ────────────────────────────
  const accentRows = archive.filter((r) => hasAccent(r.fighter));
  const accentNames = [...new Set(accentRows.map((r) => r.fighter))];
  console.log('%c-- DIACRITIC SPLIT (archive-wide) --', 'font-weight:bold');
  console.log('  rows whose fighter carries a diacritic:', accentRows.length, 'across', accentNames.length, 'names');
  console.log('  IF the split is the mechanism, every one of these is unreachable by');
  console.log('  updateResult from the heal path. Sample:', accentNames.slice(0, 15));
  const shadow = [];
  for (const n of accentNames) {
    const stripped = svcName(loose(n));
    const twin = archive.find((r) => svcName(r.fighter) === stripped);
    if (twin) shadow.push({ accented: n, 'plain twin': twin.fighter });
  }
  console.log('  names present in BOTH spellings (duplicate shadow rows):', shadow.length);
  if (shadow.length) console.table(shadow);

  console.log('%c-- VERDICT --', 'font-weight:bold');
  console.log('  affected rows:', table.length,
    '| G1 not-in-roster:', nNoRoster,
    '| G3 SILENT FALSE:', nSilent, '| would hit:', nHit, '| date-fallback:', nDate,
    '| G4 appends:', nAppend);
  console.log('%c-- HOW TO READ THIS --', 'font-weight:bold');
  console.log('  G1 NO           -> heal never runs; roster spelling is the bug (confirm live).');
  console.log('  G3 SILENT FALSE -> heal runs and finds nothing; the normalizer split is the bug.');
  console.log('  G3 would hit    -> the heal DOES rewrite the row and staleness is a');
  console.log('                     timing/ordering question. Say so; do NOT claim the');
  console.log('                     normalizer split when the gate passed.');
  console.log('  G4 APPENDS NEW  -> addProps cannot heal either, and the archive gains a');
  console.log('                     duplicate on every board load.');
  window.__heal = { affected, table, chRows, chCaches, accentNames, shadow,
    rosterSet: [...rosterSet], cardSet: [...cardSet],
    counts: { nNoRoster, nSilent, nHit, nDate, nAppend } };
  console.log('  full result on window.__heal');
})();
