/*
 * READ-ONLY. Decomposes every SS prediction into the exact chain that produced it,
 * then asks two questions the anchor audit could not:
 *
 *   Q1  WHERE does the gap to the posted line enter?  Attribute it to the raw
 *       formula's own terms (rate / expected minutes / pace modifier / style),
 *       not to the correction layers stacked on top.
 *   Q2  ARE THE POSTED LINES SANE?  A model that reads +12 above a junk line is
 *       not a model problem. Checked against the fighter's own UFCStats history.
 *
 * Paste into the console of the ANALYZER page. It calls chrome.storage.local.get
 * only. Nothing is written or removed.
 *
 * HOW THE CHAIN IS RECOVERED
 *   Every stage writes its own before/after into the reason strings, so the whole
 *   pipeline is reconstructible from storage with no re-derivation:
 *     predictSS      "Output X SS/min" / "Opp absorbs Y SS/min" / "Expected Zmin"
 *                    / "Striker style (+8%)" / "vs Grappler (-12%)" / "Trend adj: T"
 *     applyBookPrior "Book prior: ... -> before->after"
 *     applyMarketAnchorFor / applyMarketAnchor  "Anchored to market: ... fair ... cap"
 *     applyDebutMoneylineSplit                  "Debut split +H: ... -> before->after"
 *     calibrateToBooks                          "Book calibration: before -> after"
 *
 *   Each stage's `after` must equal the next stage's `before`. That makes the
 *   reconstruction SELF-CHECKING: a break in the chain means a transform this
 *   script does not know about is moving the number, and THAT is the finding.
 *   The `chain` column reports it rather than papering over it.
 *
 * The raw formula is then recomputed independently:
 *     raw = ((ownRate + oppRate)/2) * expMin * ssMod * styleMult + trend
 *   and compared against the raw recovered from the chain. If those two disagree,
 *   trust neither number and fix the parse before reading anything below.
 */
(async () => {
  'use strict';

  // Set false to skip the full-storage sweep for UFCStats caches that are not
  // found under their direct key (aliased names). Read-only either way, but the
  // sweep pulls the whole local store into memory, which is slow on this profile.
  const DEEP_SCAN = true;

  const PK = 'prop_predictions_v1';
  const WK = 'prop_predictor_weights_v1';
  const LINE_KEYS = ['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks', 'lines_draftkings_sportsbook'];
  const BOOK = { lines_pick6: 'P6', lines_underdog: 'UD', lines_betr: 'BT', lines_prizepicks: 'PP', lines_draftkings_sportsbook: 'DK' };

  const get = (keys) => new Promise((res) => chrome.storage.local.get(keys, res));
  const raw = await get([PK, WK, ...LINE_KEYS]);

  const events = Array.isArray(raw[PK]) ? raw[PK] : [];
  if (!events.length) { console.warn('[ss-decomp] prop_predictions_v1 is empty.'); return; }
  const ev = events.reduce((a, b) => (Number(b && b.generatedAt || 0) > Number(a && a.generatedAt || 0) ? b : a));
  const rows = Array.isArray(ev.predictions) ? ev.predictions : [];

  const weights = raw[WK] || {};
  const ssModMap = weights.ss_pace_modifier;
  const modFor = (wc) => {
    if (typeof ssModMap === 'number') return ssModMap;
    if (!ssModMap || typeof ssModMap !== 'object') return 1.0;
    const v = wc ? ssModMap[wc] : undefined;
    return typeof v === 'number' ? v : (typeof ssModMap.default === 'number' ? ssModMap.default : 1.0);
  };

  console.log('%c[ss-decomp] READ-ONLY', 'font-weight:bold');
  console.log('  event    ', ev.event, '| generated', new Date(Number(ev.generatedAt) || 0).toLocaleString());
  console.log('  ss_pace_modifier', ssModMap, '  (clamp is [0.70, 1.40] — at a bound means saturated)');

  // ── parsers ────────────────────────────────────────────────────────────────
  const D = '\\s*[\\u2014\\u2013-]\\s*';
  const A = '\\u2192';                                   // the -> in before->after
  const RE_RATE = /^Output\s+([\d.]+)\s+SS\/min(?:\s+\(([\d.]+)\s+raw,\s+regressed on\s+([\d.]+)min\))?/;
  const RE_OPP = /^Opp absorbs\s+([\d.]+)\s+SS\/min/;
  const RE_EXP = /^Expected\s+([\d.]+)min/;
  const RE_TREND = /^Trend adj:\s*([+-]?[\d.]+)/;
  const RE_PRIOR = new RegExp('Book prior: .*?' + A + '\\s*(-?[\\d.]+)' + A + '(-?[\\d.]+)');
  const RE_ANC = new RegExp('Anchored to market: model said\\s+(-?[\\d.]+)\\s+for\\s+(SS|TD|R1 SS),\\s+([\\d.]+)\\s+from the fair line\\s+(-?[\\d.]+)' + D + 'capped at\\s+([\\d.]+)');
  const RE_DEBUT = new RegExp('Debut split\\s+([+-][\\d.]+):.*?' + A + '\\s*(-?[\\d.]+)' + A + '(-?[\\d.]+)');
  const RE_CAL = new RegExp('Book calibration:\\s*(-?[\\d.]+)\\s*' + A + '\\s*(-?[\\d.]+)\\s*\\(measured\\s+(SS|TD|FP|R1 SS)\\s+offset\\s+([+-][\\d.]+)');
  const find = (rs, re) => { for (const r of (rs || [])) { const m = re.exec(String(r)); if (m) return m; } return null; };
  const has = (rs, s) => (rs || []).some((r) => String(r).includes(s));
  const n1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);   // DISPLAY only
  const n2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null); // DISPLAY only
  // The pipeline's own rounding. NOT one decimal place, despite the name:
  // PropLinePredictorService:59 is `Math.round(v * 2) / 2` — nearest 0.5. Every
  // stage output passes through it, so reconstructing with 1dp puts the rebuilt
  // value up to 0.25 off and reports a CHAIN BREAK on any row whose arithmetic
  // did not already land on the grid. That is exactly what the first run did, on
  // 9 of 28 rows. Use this for reconstruction and n1/n2 only for printing.
  const round1 = (v) => Math.round(v * 2) / 2;

  // ── raw book lines ─────────────────────────────────────────────────────────
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const surname = (s) => { const t = norm(s).split(' ').filter(Boolean); return t.length ? t[t.length - 1] : ''; };
  const storeRows = [];
  for (const k of LINE_KEYS) {
    const st = raw[k];
    const arr = Array.isArray(st) ? st : (st && Array.isArray(st.fighters) ? st.fighters : []);
    for (const f of arr) if (f && f.name) storeRows.push({ book: BOOK[k], name: f.name, ss: Number(f.line_ss) });
  }
  const booksFor = (fighter) => {
    const n = norm(fighter), s = surname(fighter);
    let hits = storeRows.filter((r) => norm(r.name) === n);
    if (!hits.length) {
      const byS = storeRows.filter((r) => surname(r.name) === s && s);
      if (new Set(byS.map((r) => norm(r.name))).size > 1) return { lines: {}, how: 'AMBIGUOUS' };
      hits = byS;
    }
    const lines = {};
    for (const h of hits) if (Number.isFinite(h.ss) && h.ss > 0) lines[h.book] = h.ss;
    return { lines, how: hits.length ? 'ok' : 'none' };
  };

  // ── UFCStats caches, for the line sanity check ─────────────────────────────
  const keyFor = (name) => 'ufcstats_v51_' + String(name).toLowerCase().replace(/\s+/g, '_');
  const wanted = rows.map((p) => p.fighter);
  const statsRaw = await get(wanted.map(keyFor));
  const statsByNorm = new Map();
  for (const name of wanted) { const c = statsRaw[keyFor(name)]; if (c) statsByNorm.set(norm(name), c); }
  let scanned = 0;
  if (DEEP_SCAN && statsByNorm.size < wanted.length) {
    const all = await get(null);
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith('ufcstats_v51_') || !v || !Array.isArray(v.fightHistory)) continue;
      scanned++;
      const nm = norm(v.name || k.slice('ufcstats_v51_'.length).replace(/_/g, ' '));
      if (!statsByNorm.has(nm)) statsByNorm.set(nm, v);
    }
  }
  const statsFor = (fighter) => {
    const n = norm(fighter);
    if (statsByNorm.has(n)) return statsByNorm.get(n);
    const s = surname(fighter);
    const cands = [...statsByNorm.entries()].filter(([k]) => surname(k) === s && s);
    return cands.length === 1 ? cands[0][1] : null;   // never guess between two
  };

  // ── walk every SS row ──────────────────────────────────────────────────────
  const chainTbl = [], formTbl = [], sanityTbl = [];
  for (const p of rows) {
    const sp = p.ss;
    if (!sp || !Number.isFinite(Number(sp.line))) continue;
    const rs = sp.reasons || [];
    const final = Number(sp.line);

    const mPrior = find(rs, RE_PRIOR), mAnc = find(rs, RE_ANC), mDeb = find(rs, RE_DEBUT), mCal = find(rs, RE_CAL);
    const prior = mPrior ? { before: +mPrior[1], after: +mPrior[2] } : null;
    const anch = mAnc ? { said: +mAnc[1], fair: +mAnc[4], cap: +mAnc[5] } : null;
    const debut = mDeb ? { half: +mDeb[1], before: +mDeb[2], after: +mDeb[3] } : null;
    const cal = mCal ? { before: +mCal[1], after: +mCal[2], off: +mCal[4] } : null;

    // stage values, forward
    const vRaw = prior ? prior.before : (anch ? anch.said : (debut ? debut.before : (cal ? cal.before : final)));
    const vPrior = prior ? prior.after : vRaw;
    // Mirrors applyMarketAnchorFor exactly: round1(fair + sign(gap) * cap), no clamp.
    const vAnch = anch ? round1(anch.fair + Math.sign(anch.said - anch.fair) * anch.cap) : vPrior;
    const vDeb = debut ? debut.after : vAnch;
    const vCal = cal ? cal.after : vDeb;

    // self-check every join we can see
    const brk = [];
    const eq = (a, b) => a == null || b == null || Math.abs(a - b) <= 0.06;
    if (prior && anch && !eq(prior.after, anch.said)) brk.push('prior->anchor');
    if (anch && debut && !eq(vAnch, debut.before)) brk.push('anchor->debut');
    if (debut && cal && !eq(debut.after, cal.before)) brk.push('debut->cal');
    if (!debut && anch && cal && !eq(vAnch, cal.before)) brk.push('anchor->cal');
    if (!anch && prior && cal && !eq(prior.after, cal.before)) brk.push('prior->cal');
    if (!eq(vCal, final)) brk.push('cal->final');

    const bk = booksFor(p.fighter);
    const bv = Object.values(bk.lines);
    const book = bv.length && bv.every((x) => x === bv[0]) ? bv[0] : null;

    chainTbl.push({
      fighter: p.fighter, R: p.scheduledRounds,
      raw: n1(vRaw), '→prior': prior ? n1(vPrior) : '', '→anchor': anch ? n1(vAnch) : '',
      '→debut': debut ? n1(vDeb) : '', '→cal': cal ? n1(vCal) : '', final,
      book: book != null ? book : (Object.entries(bk.lines).map(([b, v]) => b + ' ' + v).join(' ') || '-'),
      'raw-book': book != null ? n1(vRaw - book) : null,
      'final-book': book != null ? n1(final - book) : null,
      chain: brk.length ? 'BREAK: ' + brk.join(',') : 'ok',
    });

    // ── the raw formula, recomputed ─────────────────────────────────────────
    const mR = find(rs, RE_RATE), mO = find(rs, RE_OPP), mE = find(rs, RE_EXP), mT = find(rs, RE_TREND);
    const ownRate = mR ? +mR[1] : null, rawRate = mR && mR[2] ? +mR[2] : null;
    const oppRate = mO ? +mO[1] : null, expMin = mE ? +mE[1] : null;
    const trend = mT ? +mT[1] : 0;
    const striker = has(rs, 'Striker style (+8%)'), vsGrap = has(rs, 'vs Grappler (-12%)');
    const styleMult = (striker ? 1.08 : 1) * (vsGrap ? 0.88 : 1);
    const ssMod = modFor(p.weightClass);
    // Recompute as an INTERVAL, not a point. Every input here is read back from a
    // reason string at the precision it was printed (rates 2dp, minutes and trend
    // 1dp), so the true value lies in a band — and that band then passes through
    // round1's 0.5 grid. Comparing a point estimate against a grid-snapped stored
    // value is what produced the earlier false MISMATCHes.
    const fml = (own, opp, mins, tr) => ((own + opp) / 2) * mins * ssMod * styleMult + tr;
    const haveF = ownRate != null && oppRate != null && expMin != null;
    const lo = haveF ? fml(ownRate - 0.005, oppRate - 0.005, expMin - 0.05, trend - 0.05) : null;
    const hi = haveF ? fml(ownRate + 0.005, oppRate + 0.005, expMin + 0.05, trend + 0.05) : null;
    const recomputed = haveF ? round1(fml(ownRate, oppRate, expMin, trend)) : null;

    // what the formula would need in order to land ON the book line
    const denom = expMin != null ? expMin * ssMod * styleMult : null;
    const needRate = (book != null && denom) ? n2((book - trend) / denom) : null;
    const needMin = (book != null && ownRate != null && oppRate != null)
      ? n1((book - trend) / (((ownRate + oppRate) / 2) * ssMod * styleMult)) : null;

    formTbl.push({
      fighter: p.fighter, R: p.scheduledRounds, wc: p.weightClass || 'default',
      ownRate, 'ownRate(pre-shrink)': rawRate, oppRate,
      meanRate: n2(ownRate != null && oppRate != null ? (ownRate + oppRate) / 2 : NaN),
      expMin, ssMod: n2(ssMod), style: styleMult === 1 ? '' : n2(styleMult), trend: trend || '',
      recomputed, 'raw(chain)': n1(vRaw),
      band: haveF ? round1(lo) + '..' + round1(hi) : '',
      formula: !haveF ? '' : (vRaw >= round1(lo) - 1e-9 && vRaw <= round1(hi) + 1e-9) ? 'ok' : 'MISMATCH',
      book: book != null ? book : null,
      'rate needed for book': needRate, 'min needed for book': needMin,
    });

    // ── is the posted line sane? ────────────────────────────────────────────
    const db = statsFor(p.fighter);
    const hist = db && Array.isArray(db.fightHistory) ? db.fightHistory : [];
    const withSS = hist.filter((f) => Number.isFinite(Number(f.sigStr)) && Number(f.timeSecs) > 0);
    if (book != null) {
      if (!withSS.length) {
        sanityTbl.push({ fighter: p.fighter, book, fights: 0, 'career avg SS': null, 'career SS/min': null, 'expected at expMin': null, ratio: null, flag: db ? 'no usable history' : 'NO CACHE' });
      } else {
        const avgSS = withSS.reduce((s, f) => s + Number(f.sigStr), 0) / withSS.length;
        const mins = withSS.reduce((s, f) => s + Number(f.timeSecs) / 60, 0);
        const cRate = withSS.reduce((s, f) => s + Number(f.sigStr), 0) / mins;
        const expAt = expMin != null ? cRate * expMin : null;
        const ratio = expAt ? book / expAt : null;
        sanityTbl.push({
          fighter: p.fighter, book, fights: withSS.length,
          'career avg SS': n1(avgSS), 'career SS/min': n2(cRate),
          'expected at expMin': n1(expAt), ratio: n2(ratio),
          flag: ratio == null ? '' : ratio < 0.6 ? 'BOOK LOOKS LOW' : ratio > 1.6 ? 'BOOK LOOKS HIGH' : '',
        });
      }
    }
  }

  const med = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? n1(v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };

  console.log('%c── 1. THE CHAIN ──', 'font-weight:bold');
  console.table(chainTbl);
  const breaks = chainTbl.filter((r) => r.chain !== 'ok');
  if (breaks.length) console.warn('  ' + breaks.length + ' row(s) have a CHAIN BREAK — an unmodelled transform is moving the line. Read nothing below until that is explained:', breaks.map((r) => r.fighter + ' (' + r.chain + ')'));
  else console.log('  chain intact on every row — the five known stages account for the whole move.');
  // Medians over TRUSTED rows only. A broken chain means the raw value is not
  // established, and averaging it in would launder the uncertainty away.
  const ok = chainTbl.filter((r) => r.chain === 'ok');
  console.log('  trusted rows     :', ok.length, 'of', chainTbl.length);
  console.log('  median raw-book  :', med(ok.map((r) => r['raw-book'])), ' <- the estimator\'s own error');
  console.log('  median final-book:', med(ok.map((r) => r['final-book'])), ' <- what the learner sees');
  console.log('  The gap between those two numbers IS the blind spot: the correction layers');
  console.log('  close it before runLearningCycle reads the stored line.');

  console.log('%c── 2. THE RAW FORMULA ──', 'font-weight:bold');
  console.table(formTbl);
  const mism = formTbl.filter((r) => r.formula === 'MISMATCH' && r.recomputed != null);
  if (mism.length) console.warn('  ' + mism.length + ' row(s) do not recompute. The parse or the formula is wrong; do not attribute anything:', mism.map((r) => r.fighter));

  console.log('%c── 3. ARE THE POSTED LINES SANE? ──', 'font-weight:bold');
  console.table(sanityTbl);
  const low = sanityTbl.filter((r) => r.flag === 'BOOK LOOKS LOW');
  console.log('  books below 0.6x the fighter\'s own career-rate expectation:', low.length, low.map((r) => r.fighter + ' ' + r.book).join(', '));
  console.log('  Any fighter in that list makes the model\'s gap against THAT line meaningless.');
  console.log('  Rule it out before treating the gap as predictor error.');

  window.__ssDecomp = { event: ev.event, ssMod: ssModMap, chainTbl, formTbl, sanityTbl, cachesScanned: scanned };
  console.log('  full result on window.__ssDecomp');
})();
