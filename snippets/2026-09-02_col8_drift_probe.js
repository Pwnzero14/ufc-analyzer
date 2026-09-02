/*
 * READ-ONLY. Why does column 8 (Rev) drift while column 9 (Ctrl) does not?
 *
 * WHAT IS ALREADY ESTABLISHED (probe v2, 2026-09-02):
 *   27 Fantasy rows are off by exactly 5 x cache rev. SS and TD agree on ALL of
 *   them, so the entry was not rewritten. 17 have CTRL agreeing too, so col 8 can
 *   move while col 9 stays put. Column map in parseFightDetailStats:
 *     kd=1  sigStr=2  totStr=4  td=5  SUB=7  REV=8  CTRL=9
 *
 * THE TWO CANDIDATE MECHANISMS, AND HOW THIS SEPARATES THEM:
 *
 *  (A) THE FALLBACK READ THE OPPONENT'S CELL.
 *      val(col) = tds[col]?.[fIdx] || tds[col]?.[0] || ''
 *      When the wanted fighter's <p> in that cell is EMPTY, this silently returns
 *      FIGHTER 1's value instead. firstNum('') is null and calcFP turns null into
 *      0 via (rev || 0), so the loss is invisible.
 *      PREDICTION: the value the stored FP implies (rev = 0) should match the
 *      OPPONENT's rev for that same fight. Testable from the cache alone, because
 *      both fighters are usually cached and each carries their own entry.
 *      NOTE fIdx itself cannot simply be wrong - that would drag sigStr and td
 *      along, and those never drift. Only a per-CELL empty triggers the fallback.
 *
 *  (B) THE TRAILING COLUMNS WERE ABSENT.
 *      If the row came back with fewer <td>s, cols 8 and 9 would both vanish.
 *      PREDICTION: ctrl should fail whenever rev does. It does NOT on 17 of 27,
 *      which already argues against this - but col 7 (sub) is the tiebreaker.
 *      sub scores 0 on pick6 and 4 on PRIZEPICKS, so a Fantasy_PP row off by
 *      exactly 4 x sub proves col 7 drifted too and the loss is a RANGE, not one
 *      cell. If PP reconciles exactly, col 7 is stable and the damage is specific
 *      to col 8.
 *
 * Both mirrors below are fuzz-verified against dist/ before use — see the
 * companion node harness. v1 of the earlier probe invented its constants and
 * produced 2270 phantom findings; do not hand-transcribe a scoring table.
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
    if (k.startsWith('ufcstats_v51_') && v && Array.isArray(v.fightHistory)) caches.push(v);
  }
  console.log('%c[col8-drift] READ-ONLY', 'font-weight:bold');
  if (!archive.length || !caches.length) { console.warn('missing data'); return; }

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const evKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const r2 = (v) => Math.round(v * 100) / 100;

  // fighterNorm|eventKey -> fight entry
  const now = new Map();
  for (const c of caches) for (const h of c.fightHistory) {
    if (h && h.event) now.set(norm(c.name) + '|' + evKey(h.event), h);
  }
  const rows = new Map();
  for (const r of archive) {
    if (!r || r.result == null) continue;
    const k = norm(r.fighter) + '|' + evKey(r.event);
    if (!rows.has(k)) rows.set(k, {});
    rows.get(k)[String(r.propType)] = Number(r.result);
  }

  // ── scoring mirrors (config/index.ts) ─────────────────────────────────────
  const F = { sig: 0.4, nonSig: 0.2, ctrl: 0.03, td: 5, rev: 5, kd: 10, quick: 25,
    wb: { r1: 90, r2: 70, r3: 45, r4: 40, dec: 30 } };
  const P = { sig: 0.5, nonSig: 0, ctrl: 0, td: 5, rev: 0, kd: 10, sub: 4,
    wb: { r1: 50, r2: 40, r3: 30, r4: 20, dec: 10 } };
  const isFinish = (m) => /KO|TKO|SUB/i.test(m || '');
  const bonus = (t, won, method, round) => {
    if (!won) return 0;
    if (/DEC/i.test(method || '')) return t.wb.dec;
    const r = round || 3;
    return r === 1 ? t.wb.r1 : r === 2 ? t.wb.r2 : r === 3 ? t.wb.r3 : t.wb.r4;
  };
  const fpFantasy = (h) => {
    if (h.sigStr == null) return null;
    const won = String(h.result).toLowerCase() === 'win';
    const nonSig = Math.max(0, Number(h.totStr || 0) - Number(h.sigStr || 0));
    let v = Number(h.sigStr || 0) * F.sig + nonSig * F.nonSig + Number(h.ctrlSecs || 0) * F.ctrl
      + Number(h.kd || 0) * F.kd + Number(h.td || 0) * F.td + Number(h.rev || 0) * F.rev
      + bonus(F, won, h.method, h.round);
    if (won && isFinish(h.method) && (h.round || 0) === 1 && (h.timeSecs == null ? 9999 : Number(h.timeSecs)) <= 60) v += F.quick;
    return r2(v);
  };
  const fpPP = (h) => {
    if (h.sigStr == null) return null;
    const won = String(h.result).toLowerCase() === 'win';
    let v = Number(h.sigStr || 0) * P.sig + Number(h.kd || 0) * P.kd + Number(h.td || 0) * P.td
      + Number(h.sub || 0) * P.sub + bonus(P, won, h.method, h.round);
    return r2(v);
  };

  // ── find the rev-explained rows, then interrogate each ────────────────────
  const out = [];
  for (const [k, props] of rows) {
    const stored = props['Fantasy'];
    if (!Number.isFinite(stored)) continue;
    const h = now.get(k);
    if (!h || h.sigStr == null) continue;
    const want = fpFantasy(h);
    if (want == null) continue;
    const d = r2(stored - want);
    const revN = Number(h.rev || 0);
    if (!(revN > 0 && Math.abs(d + 5 * revN) < 0.02)) continue;   // rev-explained only

    const [fnorm, ek] = k.split('|');
    // (A) what does the OPPONENT's own cache entry say for this same fight?
    const oppKey = norm(h.opponent) + '|' + ek;
    const oh = now.get(oppKey);
    const oppRev = oh ? (oh.rev == null ? null : Number(oh.rev)) : undefined;

    // (B) does the Fantasy_PP row reconcile? if it is off by 4 x sub, col 7 drifted too
    const ppStored = props['Fantasy_PP'];
    const ppWant = fpPP(h);
    const ppD = (Number.isFinite(ppStored) && ppWant != null) ? r2(ppStored - ppWant) : null;
    const subN = Number(h.sub || 0);
    const ppSubExplained = ppD != null && subN > 0 && Math.abs(ppD + 4 * subN) < 0.02;

    out.push({
      fighter: fnorm, event: (h.event || '').slice(0, 26),
      'cache rev': revN, 'stored implies': 0, delta: d,
      opponent: norm(h.opponent).slice(0, 18),
      'opp cached?': oh ? 'yes' : 'NO',
      'opp rev': oppRev === undefined ? '-' : oppRev === null ? 'null' : oppRev,
      'A: opp rev = 0?': oh ? (oppRev === 0 ? 'MATCH' : 'no (' + oppRev + ')') : '-',
      sub: subN,
      'PP delta': ppD == null ? '-' : ppD,
      'B: PP off by 4xsub?': ppD == null ? '-' : ppSubExplained ? 'YES col7 drifted' : (Math.abs(ppD) < 0.02 ? 'PP exact' : 'PP off ' + ppD),
    });
  }

  console.table(out);

  const withOpp = out.filter((r) => r['opp cached?'] === 'yes');
  const aMatch = withOpp.filter((r) => r['A: opp rev = 0?'] === 'MATCH').length;
  const ppExact = out.filter((r) => r['B: PP off by 4xsub?'] === 'PP exact').length;
  const ppCol7 = out.filter((r) => r['B: PP off by 4xsub?'] === 'YES col7 drifted').length;
  const withSub = out.filter((r) => r.sub > 0).length;

  console.log('%c── VERDICT ──', 'font-weight:bold');
  console.log('  rev-explained rows                :', out.length, '| opponent also cached:', withOpp.length);
  console.log('%c  (A) OPPONENT-CELL FALLBACK', 'font-weight:bold');
  console.log('      opponent rev = 0 (what stored implies):', aMatch, '/', withOpp.length);
  console.log('      A predicts a HIGH match rate. But note the base rate: most fights have');
  console.log('      rev 0 on both sides, so a high number here is WEAK on its own. It only');
  console.log('      becomes evidence where the opponent rev is NON-zero and still matches.');
  console.log('%c  (B) TRAILING-RANGE LOSS  (col 7 tiebreaker)', 'font-weight:bold');
  console.log('      rows with sub > 0 in the cache     :', withSub);
  console.log('      Fantasy_PP reconciles EXACTLY      :', ppExact);
  console.log('      Fantasy_PP off by exactly 4 x sub  :', ppCol7);
  if (withSub === 0) {
    console.log('      No rows carry a submission attempt, so col 7 cannot be tested here.');
    console.log('      B is NOT ruled out by this run - say so rather than claiming it is.');
  } else if (ppCol7 === 0 && ppExact > 0) {
    console.log('%c      col 7 is STABLE while col 8 drifted -> the loss is ONE CELL, not a range.', 'color:#e0b000');
    console.log('%c      That kills (B) and leaves (A), or something else specific to col 8.', 'color:#e0b000');
  } else if (ppCol7 > 0) {
    console.log('%c      col 7 ALSO drifted -> a contiguous trailing RANGE was lost. (B) lives.', 'color:#ff9800');
  }
  window.__col8 = { out, aMatch, withOpp: withOpp.length, ppExact, ppCol7, withSub };
  console.log('  full result on window.__col8');
})();
