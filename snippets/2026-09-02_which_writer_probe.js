/*
 * READ-ONLY. WHICH PARSER wrote the rev=0 rows — settle or backfill?
 *
 * WHERE THIS SITS
 *   27 Fantasy rows are off by exactly 5 x cache rev. Two hypotheses are now DEAD,
 *   both killed by data rather than argument:
 *     (B) trailing-range loss — col 7 (`sub`) is STABLE. 14 affected rows carry
 *         sub > 0, Fantasy_PP reconciles exactly on 25/27, and ZERO are off by
 *         4 x sub. The loss is one cell, not a range.
 *     (A) opponent-cell fallback — on the ONLY 5 rows where it was testable (the
 *         opponent's rev is non-zero) the stored value is 0, not the opponent's
 *         2/2/1/2/2. The 22/27 "match" was base rate: most fights have rev 0 on
 *         both sides, where "read the opponent" and "read nothing" are identical.
 *   So the value was ABSENT and defaulted to 0 — not misread. Exactly two code
 *   paths can produce that default:
 *
 *     SETTLE   background.ts:727
 *              parseInt(cellVal(cells[8] ?? '', i)) || 0
 *              cellVal FILTERS empty parts and THEN indexes, so one blank cell
 *              shifts every later index: one fighter gets the other's value and
 *              the other gets nothing. `|| 0` then hides it.
 *     BACKFILL analyzer/parsers.ts:160
 *              firstNum(val(8)) -> null, which calcFP turns into 0 via (rev || 0).
 *              val() preserves <p> POSITION, so no index shift is possible.
 *
 * THE DISCRIMINATOR — no fetch, no guessing
 *   The two writers leave different propType sets on a fight:
 *     settle-only  : SS_R1, ss_body, ss_leg, KD, and control spelled `ctrl`
 *     backfill-only: control spelled `Control`
 *   (The dual ctrl/Control spelling is already documented in
 *    [[project_ctrl_archive_dual_proptype]].) So the propTypes present on each
 *   affected fight say which parser produced its FP.
 *
 *   PREDICTION IF THE background.ts FILTER IS THE CAUSE: the 27 should be
 *   dominated by settle-fingerprinted fights.
 *   IF THEY ARE BACKFILL: the filter is a red herring and parsers.ts is at fault.
 *   IF MIXED: both parsers drop col 8 and the cause is upstream of both.
 *
 *   BASE RATE IS PRINTED TOO. A finding of "mostly settle" means nothing if most
 *   of the archive is settle. The probe reports the settle/backfill split across
 *   ALL fights so the affected set can be compared against it.
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
  if (!archive.length || !caches.length) { console.warn('missing data'); return; }

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const evKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const r2 = (v) => Math.round(v * 100) / 100;

  const now = new Map();
  for (const c of caches) for (const h of c.fightHistory) {
    if (h && h.event) now.set(norm(c.name) + '|' + evKey(h.event), h);
  }
  const rows = new Map();
  for (const r of archive) {
    if (!r || r.result == null) continue;
    const k = norm(r.fighter) + '|' + evKey(r.event);
    if (!rows.has(k)) rows.set(k, new Set());
    rows.get(k).add(String(r.propType));
  }
  const fpRows = new Map();
  for (const r of archive) {
    if (!r || r.result == null || String(r.propType) !== 'Fantasy') continue;
    fpRows.set(norm(r.fighter) + '|' + evKey(r.event), Number(r.result));
  }

  // FANTASY_SCORING mirror — fuzz-verified against dist elsewhere in this series.
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

  const SETTLE_ONLY = ['SS_R1', 'ss_body', 'ss_leg', 'KD', 'ctrl'];
  const writerOf = (set) => {
    const s = SETTLE_ONLY.some((p) => set.has(p));
    const b = set.has('Control');
    return s && b ? 'BOTH' : s ? 'settle' : b ? 'backfill' : 'unknown';
  };

  // ── base rate across every fight that has a Fantasy row ───────────────────
  const base = { settle: 0, backfill: 0, BOTH: 0, unknown: 0 };
  for (const [k] of fpRows) { const set = rows.get(k); if (set) base[writerOf(set)]++; }

  // ── the affected set ──────────────────────────────────────────────────────
  const out = [];
  for (const [k, stored] of fpRows) {
    const h = now.get(k);
    if (!h || h.sigStr == null) continue;
    const want = fpF(h);
    if (want == null) continue;
    const d = r2(stored - want);
    const revN = Number(h.rev || 0);
    if (!(revN > 0 && Math.abs(d + 5 * revN) < 0.02)) continue;
    const set = rows.get(k) || new Set();
    out.push({
      fighter: k.split('|')[0], event: (h.event || '').slice(0, 24),
      rev: revN, delta: d, writer: writerOf(set),
      'settle marks': SETTLE_ONLY.filter((p) => set.has(p)).join(',') || '-',
      Control: set.has('Control') ? 'yes' : 'no',
      props: [...set].sort().join(' ').slice(0, 60),
    });
  }
  console.log('%c[which-writer] READ-ONLY', 'font-weight:bold');
  console.table(out);

  const tally = { settle: 0, backfill: 0, BOTH: 0, unknown: 0 };
  for (const r of out) tally[r.writer]++;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '-');
  const nBase = base.settle + base.backfill + base.BOTH + base.unknown;

  console.log('%c── VERDICT ──', 'font-weight:bold');
  console.log('  affected rows:', out.length);
  console.log('     settle', tally.settle, '| backfill', tally.backfill, '| BOTH', tally.BOTH, '| unknown', tally.unknown);
  console.log('  BASE RATE over all', nBase, 'fights with a Fantasy row:');
  console.log('     settle', base.settle, '(' + pct(base.settle, nBase) + ')',
    '| backfill', base.backfill, '(' + pct(base.backfill, nBase) + ')',
    '| BOTH', base.BOTH, '| unknown', base.unknown);
  console.log('  COMPARE THE TWO. "mostly settle" is only a finding if settle is NOT');
  console.log('  already most of the archive. If affected % ~= base %, the writer is');
  console.log('  not the discriminator and the cause sits upstream of both parsers.');
  window.__whichWriter = { out, tally, base };
  console.log('  full result on window.__whichWriter');
})();
