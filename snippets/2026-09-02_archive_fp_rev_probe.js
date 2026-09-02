/*
 * READ-ONLY. Archive FP investigation — the discriminating test.
 *
 * *** v2. THE FIRST VERSION OF THIS PROBE WAS WRONG AND ITS OUTPUT IS VOID. ***
 * It INVENTED the pick6 scoring constants instead of reading them, using
 * sigStrike 0.5 (real: 0.4), controlTimePerSec 0.0083 (real: 0.03), a flat 30
 * win bonus (real: 90/70/45/40 by round, 30 only on a decision) and omitting the
 * 25-point quick-win bonus entirely. Result: all 2270 Fantasy rows "disagreed",
 * every low-value row by a ratio of exactly 0.8 = 0.4/0.5, and the reversal
 * signal was completely swamped. The comment that excused it — "the exact bonus
 * table matters less than the DIFFERENCE between the two" — was false: a wrong
 * multiplier moves every row and drowns the term being measured.
 * Constants below are copied from config/index.ts FANTASY_SCORING and the
 * arithmetic mirrors calcFPForPlatform('pick6', ...) line for line.
 *
 * WHAT THE CHECKPOINT'S LEAD SAID, AND WHY IT IS DEAD (settled in code, 09-02):
 *   "fightHistory is parsed from the FIGHTER page, the settle path from the FIGHT
 *    DETAIL page — the two may disagree on reversals."
 *   parseFightHistoryLinks (analyzer/parsers.ts:42) pushes ONLY {result, opponent,
 *   event, method, round, date, fightUrl}. No rev, no stats at all. The fighter
 *   page never supplies a reversal. Both sides read the SAME detail page at the
 *   SAME column 8. Do not spend a live fetch on that.
 *
 * WHAT REPLACES IT:
 *   archivePerformanceForRosterFighter (analyzer.ts ~26325) computes the stored FP
 *   from ufcData.fightHistory — the SAME object this recomputes from. So a
 *   disagreement means the CACHE CHANGED between the row being written and now.
 *   ufcstats_v51_* expires every ~24-32h and re-parses every fight detail.
 *
 * THE TEST: for every Fantasy row that disagrees, do the SS / TD / Control rows
 * for the SAME fight still agree with the cache?
 *   only Fantasy off, by exactly 5 x rev -> `rev` is SPECIFICALLY unstable
 *   everything off                       -> the whole entry was rewritten
 *
 * SANITY GATE FIRST. If the recompute is right, the overwhelming majority of rows
 * must AGREE. The probe reports the agree rate and REFUSES to interpret anything
 * below 90% — that is the check whose absence made v1 worthless.
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
  console.log('%c[archive-fp v2] READ-ONLY', 'font-weight:bold');
  console.log('  archive rows:', archive.length, '| ufcstats caches:', caches.length);
  if (!archive.length || !caches.length) { console.warn('  missing data — stop.'); return; }

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const evKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const n1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

  const now = new Map();
  for (const c of caches) {
    const f = norm(c.name);
    for (const h of c.fightHistory) {
      if (!h || !h.event) continue;
      now.set(f + '|' + evKey(h.event), h);
    }
  }
  const rows = new Map();
  for (const r of archive) {
    if (!r || r.result == null) continue;
    const k = norm(r.fighter) + '|' + evKey(r.event);
    if (!rows.has(k)) rows.set(k, {});
    rows.get(k)[String(r.propType)] = Number(r.result);
  }

  // ── EXACT copy of FANTASY_SCORING (config/index.ts:125) ───────────────────
  const SC = { sigStrike: 0.4, nonSigStrike: 0.2, controlTimePerSec: 0.03,
    takedown: 5, reversal: 5, knockdown: 10, quickWinBonus: 25,
    winBonus: { round1: 90, round2: 70, round3: 45, round4Plus: 40, decision: 30 } };
  const isFinish = (m) => /KO|TKO|SUB/i.test(m || '');
  const winBonus = (won, method, round) => {
    if (!won) return 0;
    if (/DEC/i.test(method || '')) return SC.winBonus.decision;
    const r = round || 3;
    return r === 1 ? SC.winBonus.round1 : r === 2 ? SC.winBonus.round2
         : r === 3 ? SC.winBonus.round3 : SC.winBonus.round4Plus;
  };
  // Mirrors calcFPForPlatform('pick6', ...) exactly. `sub` is NOT scored on pick6.
  const fp = (h, useRev) => {
    if (h.sigStr == null) return null;
    const won = String(h.result).toLowerCase() === 'win';
    const nonSig = Math.max(0, Number(h.totStr || 0) - Number(h.sigStr || 0));
    let v = Number(h.sigStr || 0) * SC.sigStrike
      + nonSig * SC.nonSigStrike
      + Number(h.ctrlSecs || 0) * SC.controlTimePerSec
      + Number(h.kd || 0) * SC.knockdown
      + Number(h.td || 0) * SC.takedown
      + (useRev ? Number(h.rev || 0) * SC.reversal : 0)
      + winBonus(won, h.method, h.round);
    if (won && isFinish(h.method) && (h.round || 0) === 1 && (h.timeSecs == null ? 9999 : Number(h.timeSecs)) <= 60) {
      v += SC.quickWinBonus;
    }
    return Math.round(v * 100) / 100;
  };

  let compared = 0, agreed = 0;
  const out = [];
  for (const [k, props] of rows) {
    const stored = props['Fantasy'];
    if (!Number.isFinite(stored)) continue;
    const h = now.get(k);
    if (!h || h.sigStr == null) continue;
    const withRev = fp(h, true);
    if (withRev == null) continue;
    compared++;
    const dFP = Math.round((stored - withRev) * 100) / 100;
    if (Math.abs(dFP) < 0.02) { agreed++; continue; }

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
    const revN = Number(h.rev || 0);
    const revExplains = revN > 0 && Math.abs(dFP + 5 * revN) < 0.02;

    out.push({
      fighter: k.split('|')[0], event: (h.event || '').slice(0, 30),
      stored, recomputed: withRev, delta: n1(dFP),
      rev: h.rev == null ? 'null' : revN,
      'rev explains?': revExplains ? 'YES' : '',
      SS: ssOk === null ? '-' : ssOk ? 'ok' : 'DIFF',
      TD: tdOk === null ? '-' : tdOk ? 'ok' : 'DIFF',
      CTRL: ctrlOk === null ? '-' : ctrlOk ? 'ok' : 'DIFF',
      'others agree': othersAgree === null ? '-' : othersAgree ? 'ALL OK' : 'SOME DIFF',
    });
  }

  // ── SANITY GATE — the check whose absence made v1 worthless ───────────────
  const rate = compared ? agreed / compared : 0;
  console.log('%c── SANITY GATE ──', 'font-weight:bold');
  console.log('  Fantasy rows compared:', compared, '| AGREE:', agreed, '(' + Math.round(rate * 100) + '%)', '| disagree:', out.length);
  if (rate < 0.90) {
    console.error('%c  AGREE RATE BELOW 90% — THE RECOMPUTE IS STILL WRONG. STOP.', 'color:#f44336;font-weight:bold');
    console.error('  Do not read the table below. Fix the scoring mirror against');
    console.error('  calcFPForPlatform / FANTASY_SCORING before drawing any conclusion.');
    console.table(out.slice(0, 20));
    window.__archFp = { compared, agreed, rate, out };
    return;
  }
  console.log('%c  Gate passed — the recompute reproduces the archive. Disagreements are real.', 'color:#4caf50');

  out.sort((a, b) => a.delta - b.delta);
  console.table(out);

  const revRows = out.filter((r) => r['rev explains?'] === 'YES');
  const clean = revRows.filter((r) => r['others agree'] === 'ALL OK');
  const dirty = revRows.filter((r) => r['others agree'] === 'SOME DIFF');
  console.log('%c── VERDICT ──', 'font-weight:bold');
  console.log('  disagreeing Fantasy rows                    :', out.length);
  console.log('  explained exactly by 5 x cache rev          :', revRows.length);
  console.log('     ...with SS/TD/CTRL still AGREEING        :', clean.length, '<- rev SPECIFICALLY unstable');
  console.log('     ...with SS/TD/CTRL ALSO differing        :', dirty.length, '<- whole entry rewritten');
  if (clean.length && !dirty.length) {
    console.log('%c  rev is the ONLY field that moved — suspect parseFightDetailStats fIdx', 'color:#e0b000');
    console.log('%c  and its `|| tds[col][0]` fallback to the OPPONENT cell.', 'color:#e0b000');
  } else if (dirty.length && !clean.length) {
    console.log('%c  Whole entries changed; rev is a passenger. Look upstream of the parse.', 'color:#ff9800');
  } else if (clean.length && dirty.length) {
    console.log('%c  MIXED — two mechanisms. Split them before chasing either.', 'color:#ff9800');
  } else {
    console.log('  No reversal-explained rows. Whatever the residual is, it is not reversals.');
  }
  window.__archFp = { compared, agreed, rate, out, revRows, clean, dirty };
  console.log('  full result on window.__archFp');
})();
