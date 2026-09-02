/*
 * READ-ONLY. Archive FP investigation — the discriminating test.
 *
 * WHAT THE CHECKPOINT'S LEAD SAID, AND WHY IT IS DEAD (settled in code, 09-02):
 *   "fightHistory is parsed from the FIGHTER page, the settle path from the FIGHT
 *    DETAIL page — the two may disagree on reversals."
 *   parseFightHistoryLinks (the fighter-page parser, analyzer/parsers.ts:42) pushes
 *   ONLY {result, opponent, event, method, round, date, fightUrl}. No rev, no stats
 *   at all. The fighter page never supplies a reversal, so there is no
 *   fighter-vs-detail disagreement to find. Both sides read the SAME detail page at
 *   the SAME column 8. Do not spend a live fetch on that.
 *
 * WHAT REPLACES IT:
 *   archivePerformanceForRosterFighter (analyzer.ts ~26325) computes the stored FP
 *   from ufcData.fightHistory — the SAME object the audit recomputes from. So a
 *   disagreement means the CACHE CHANGED between the row being written and now.
 *   And it does change: ufcstats_v51_* expires every ~24-32h (ufcstatsCacheTtlMs)
 *   and re-parses every fight detail on refetch.
 *
 * THE TEST THIS RUNS:
 *   For every Fantasy row that disagrees, check whether the SS / TD / Control rows
 *   for the SAME fight still agree with the current cache.
 *     - SS/TD/CTRL agree, only Fantasy disagrees  -> `rev` is SPECIFICALLY unstable.
 *       Suspect parseFightDetailStats fIdx resolution: `tds[col]?.[fIdx] ||
 *       tds[col]?.[0]` silently falls back to the OPPONENT's cell.
 *     - Everything disagrees                       -> the whole entry was rewritten;
 *       rev is a passenger and the cause is upstream of the parse.
 *   That split is the finding either way, and it costs no fetch.
 *
 * Paste into the ANALYZER page console. chrome.storage.local.get only.
 */
(async () => {
  'use strict';
  const ARCH = 'prop_archive_v1';
  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));

  // Pull the archive, then every ufcstats cache in one sweep.
  const all = await get(null);
  const archive = Array.isArray(all[ARCH]) ? all[ARCH] : [];
  const caches = [];
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('ufcstats_v51_') && v && Array.isArray(v.fightHistory)) caches.push(v);
  }
  console.log('%c[archive-fp] READ-ONLY', 'font-weight:bold');
  console.log('  archive rows:', archive.length, '| ufcstats caches:', caches.length);
  if (!archive.length || !caches.length) { console.warn('  missing data — stop.'); return; }

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const evKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const n1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

  // Index the cache: fighter+event -> the fight entry as it stands NOW.
  const now = new Map();
  for (const c of caches) {
    const f = norm(c.name);
    for (const h of c.fightHistory) {
      if (!h || !h.event) continue;
      now.set(f + '|' + evKey(h.event), h);
    }
  }

  // Index archive rows by fighter+event -> {propType: result}
  const rows = new Map();
  for (const r of archive) {
    if (!r || r.result == null) continue;
    const k = norm(r.fighter) + '|' + evKey(r.event);
    if (!rows.has(k)) rows.set(k, {});
    rows.get(k)[String(r.propType)] = Number(r.result);
  }

  // calcFP for pick6 ("Fantasy"). Mirrors analyzer/fantasy-scoring.ts pick6 scoring.
  // Only used to recompute WITH and WITHOUT rev, so the exact bonus table matters
  // less than the DIFFERENCE between the two — which is 5 x rev either way.
  const S = { sig: 0.5, tot: 0.2, td: 5, kd: 10, rev: 5, sub: 5, ctrlPerMin: 0.5, decWin: 30, finWin: 30 };
  const fp = (h, useRev) => {
    if (h.sigStr == null) return null;
    const won = String(h.result).toLowerCase() === 'win';
    const nonSig = Math.max(0, Number(h.totStr || 0) - Number(h.sigStr || 0));
    let v = Number(h.sigStr || 0) * S.sig + nonSig * S.tot
      + Number(h.td || 0) * S.td + Number(h.kd || 0) * S.kd
      + (useRev ? Number(h.rev || 0) * S.rev : 0) + Number(h.sub || 0) * S.sub
      + (Number(h.ctrlSecs || 0) / 60) * S.ctrlPerMin;
    if (won) v += S.decWin;
    return Math.round(v * 10) / 10;
  };

  const out = [];
  for (const [k, props] of rows) {
    const stored = props['Fantasy'];
    if (!Number.isFinite(stored)) continue;
    const h = now.get(k);
    if (!h || h.sigStr == null) continue;

    const withRev = fp(h, true);
    if (withRev == null) continue;
    const dFP = n1(stored - withRev);
    if (dFP === 0) continue;                       // agrees — not our problem

    // Do the OTHER props for this same fight still agree with the cache?
    const cmp = (label, cacheVal, tol) => {
      const a = props[label];
      if (!Number.isFinite(a) || cacheVal == null) return null;
      return Math.abs(a - Number(cacheVal)) <= tol;
    };
    const ssOk = cmp('SS', h.sigStr, 0.01);
    const tdOk = cmp('TD', h.td, 0.01);
    const ctrlOk = cmp('Control', h.ctrlSecs == null ? null : Math.round((h.ctrlSecs / 60) * 100) / 100, 0.02);
    const others = [ssOk, tdOk, ctrlOk].filter((x) => x !== null);
    const othersAgree = others.length ? others.every(Boolean) : null;

    const revExplains = Number(h.rev || 0) > 0 && Math.abs(dFP + 5 * Number(h.rev)) < 0.05;
    out.push({
      fighter: k.split('|')[0], event: (h.event || '').slice(0, 34),
      stored, 'recomputed(+rev)': withRev, delta: dFP,
      'cache rev': h.rev == null ? 'null' : h.rev,
      'rev explains?': revExplains ? 'YES' : '',
      SS: ssOk === null ? '-' : ssOk ? 'ok' : 'DIFF',
      TD: tdOk === null ? '-' : tdOk ? 'ok' : 'DIFF',
      CTRL: ctrlOk === null ? '-' : ctrlOk ? 'ok' : 'DIFF',
      'others agree': othersAgree === null ? '-' : othersAgree ? 'ALL OK' : 'SOME DIFF',
      'PP delta': Number.isFinite(props['Fantasy_PP']) ? 'has PP row' : 'no PP row',
    });
  }

  out.sort((a, b) => a.delta - b.delta);
  console.table(out);

  const revRows = out.filter((r) => r['rev explains?'] === 'YES');
  const clean = revRows.filter((r) => r['others agree'] === 'ALL OK');
  const dirty = revRows.filter((r) => r['others agree'] === 'SOME DIFF');
  console.log('%c── VERDICT ──', 'font-weight:bold');
  console.log('  Fantasy rows disagreeing with the current cache :', out.length);
  console.log('  of those, explained exactly by 5 x cache rev    :', revRows.length);
  console.log('     ...with SS/TD/CTRL still AGREEING            :', clean.length, '<- rev is SPECIFICALLY unstable');
  console.log('     ...with SS/TD/CTRL ALSO differing            :', dirty.length, '<- whole entry was rewritten');
  if (clean.length && !dirty.length) {
    console.log('%c  rev is the ONLY field that moved. The parse of column 8 is the suspect —', 'color:#e0b000');
    console.log('%c  specifically parseFightDetailStats fIdx and its `|| tds[col][0]` fallback.', 'color:#e0b000');
  } else if (dirty.length && !clean.length) {
    console.log('%c  The whole entry changed. rev is a passenger; look upstream of the parse', 'color:#ff9800');
    console.log('%c  (which fetch wrote the row, and whether the fighter was on the roster then).', 'color:#ff9800');
  } else if (clean.length && dirty.length) {
    console.log('%c  MIXED — two different mechanisms. Split them before chasing either.', 'color:#ff9800');
  } else {
    console.log('  No reversal-explained rows against the CURRENT cache. The 28 from the');
    console.log('  earlier audit may have been re-archived since. That is itself the answer:');
    console.log('  the rows self-heal on refetch, which points at cache churn, not a parse bug.');
  }
  window.__archFp = { out, revRows, clean, dirty };
  console.log('  full result on window.__archFp');
})();
