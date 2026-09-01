/*
 * READ-ONLY. Replaces the bad "BOOK LOOKS LOW" test from the decomposition pass.
 *
 * WHY THE OLD TEST WAS WRONG
 *   It compared the posted line against the fighter's CAREER MEAN SS scaled to
 *   expected minutes. A mean is the wrong reference for a betting line: it is
 *   dragged up by a fighter's high-volume outliers, while a line is priced near
 *   an outcome the book expects to be beaten about half the time. Hooker's 27.5
 *   scored 0.45x on that test and was flagged as possibly not real. It IS real -
 *   confirmed against the live Pick6 board, along with all 11 other SS lines.
 *
 * WHAT THIS ASKS INSTEAD
 *   Of this fighter's own logged fights, how many actually CLEARED the posted
 *   line? That is the question a soft line has to answer, and it needs no
 *   assumption about what the book was aiming at.
 *
 *   Reported three ways, because they disagree and the disagreement is the point:
 *     RAW        - sigStr > line, no adjustment. What the old hit-rate term did.
 *     NORMALISED - each past fight scaled to THIS fight's expected minutes,
 *                  bounded 0.5-1.5. The MODEL v39 method. Matters most for
 *                  Hooker: 3-round history priced into a 5-round main.
 *     MEDIAN     - the fighter's median SS beside the mean. When these separate,
 *                  the mean was the outlier-driven number and the old test was
 *                  reading it.
 *
 *   Also prints ss_under_available per book. On the 2026-09-01 Pick6 board,
 *   Hooker / Peek / Charriere / Sygula / Sola / Ruziboev are More-ONLY (no Less
 *   button). Charriere sits at 1.06 on the old ratio test and Hooker at 0.45, so
 *   More-only does NOT by itself explain a low line - do not treat it as a tell.
 *   It is here because a one-sided market is priced differently from a two-sided
 *   one, and that belongs in the record next to the hit rate.
 *
 * Paste into the ANALYZER page console. chrome.storage.local.get only.
 */
(async () => {
  'use strict';
  const DEEP_SCAN = true;

  const PK = 'prop_predictions_v1';
  const LINE_KEYS = ['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks', 'lines_draftkings_sportsbook'];
  const BOOK = { lines_pick6: 'P6', lines_underdog: 'UD', lines_betr: 'BT', lines_prizepicks: 'PP', lines_draftkings_sportsbook: 'DK' };

  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const raw = await get([PK, ...LINE_KEYS]);
  const events = Array.isArray(raw[PK]) ? raw[PK] : [];
  if (!events.length) { console.warn('[ss-hitrate] no predictions stored.'); return; }
  const ev = events.reduce((a, b) => (Number(b && b.generatedAt || 0) > Number(a && a.generatedAt || 0) ? b : a));
  const rows = Array.isArray(ev.predictions) ? ev.predictions : [];

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const surname = (s) => { const t = norm(s).split(' ').filter(Boolean); return t.length ? t[t.length - 1] : ''; };
  const n1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) + '%' : null);

  // ── book lines + the More-only flag ────────────────────────────────────────
  const store = [];
  for (const k of LINE_KEYS) {
    const st = raw[k];
    const arr = Array.isArray(st) ? st : (st && Array.isArray(st.fighters) ? st.fighters : []);
    for (const f of arr) if (f && f.name) store.push({ book: BOOK[k], name: f.name, ss: Number(f.line_ss), under: f.ss_under_available });
  }
  const booksFor = (fighter) => {
    const n = norm(fighter), s = surname(fighter);
    let hits = store.filter((r) => norm(r.name) === n);
    if (!hits.length) {
      const byS = store.filter((r) => surname(r.name) === s && s);
      if (new Set(byS.map((r) => norm(r.name))).size > 1) return [];
      hits = byS;
    }
    return hits.filter((h) => Number.isFinite(h.ss) && h.ss > 0);
  };

  // ── UFCStats history ───────────────────────────────────────────────────────
  const keyFor = (n) => 'ufcstats_v51_' + String(n).toLowerCase().replace(/\s+/g, '_');
  const names = rows.map((p) => p.fighter);
  const sr = await get(names.map(keyFor));
  const byNorm = new Map();
  for (const n of names) { const c = sr[keyFor(n)]; if (c) byNorm.set(norm(n), c); }
  if (DEEP_SCAN && byNorm.size < names.length) {
    const all = await get(null);
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith('ufcstats_v51_') || !v || !Array.isArray(v.fightHistory)) continue;
      const nm = norm(v.name || k.slice(13).replace(/_/g, ' '));
      if (!byNorm.has(nm)) byNorm.set(nm, v);
    }
  }
  const dbFor = (f) => {
    const n = norm(f);
    if (byNorm.has(n)) return byNorm.get(n);
    const s = surname(f);
    const c = [...byNorm.entries()].filter(([k]) => surname(k) === s && s);
    return c.length === 1 ? c[0][1] : null;
  };

  const RE_EXP = /^Expected\s+([\d.]+)min/;
  const expMinOf = (sp) => {
    for (const r of (sp && sp.reasons) || []) { const m = RE_EXP.exec(String(r)); if (m) return +m[1]; }
    return null;
  };

  const out = [];
  for (const p of rows) {
    const bk = booksFor(p.fighter);
    if (!bk.length) continue;
    const vals = bk.map((b) => b.ss);
    const line = vals.every((v) => v === vals[0]) ? vals[0] : null;
    if (line == null) continue;                       // books disagree — skip, don't average

    const db = dbFor(p.fighter);
    const hist = (db && Array.isArray(db.fightHistory) ? db.fightHistory : [])
      .filter((f) => Number.isFinite(Number(f.sigStr)));
    const expMin = expMinOf(p.ss);

    if (!hist.length) { out.push({ fighter: p.fighter, line, fights: 0, note: db ? 'no SS history' : 'NO CACHE' }); continue; }

    const ss = hist.map((f) => Number(f.sigStr)).sort((a, b) => a - b);
    const mean = ss.reduce((s, v) => s + v, 0) / ss.length;
    const median = ss.length % 2 ? ss[(ss.length - 1) / 2] : (ss[ss.length / 2 - 1] + ss[ss.length / 2]) / 2;

    const rawHits = hist.filter((f) => Number(f.sigStr) > line).length;
    // MODEL v39: scale each past fight to THIS fight's expected minutes, bounded
    // 0.5-1.5 so a 60-second KO is not extrapolated to a full fight.
    let scaled = 0, normHits = 0;
    for (const f of hist) {
      const mins = Number(f.timeSecs) / 60;
      if (expMin == null || !Number.isFinite(mins) || mins <= 0) { if (Number(f.sigStr) > line) normHits++; continue; }
      scaled++;
      if (Number(f.sigStr) * Math.max(0.5, Math.min(1.5, expMin / mins)) > line) normHits++;
    }

    const sides = bk.map((b) => b.book + (b.under === false ? ' More-only' : b.under === true ? ' both' : ' ?')).join(' | ');
    out.push({
      fighter: p.fighter, R: p.scheduledRounds, line, fights: hist.length, expMin,
      'mean SS': n1(mean), 'median SS': n1(median),
      'RAW hit': rawHits + '/' + hist.length, 'raw %': pct(rawHits / hist.length),
      'v39 hit': normHits + '/' + hist.length, 'v39 %': pct(normHits / hist.length),
      scaled, sides,
    });
  }

  out.sort((a, b) => (parseFloat(b['v39 %']) || 0) - (parseFloat(a['v39 %']) || 0));
  console.log('%c[ss-hitrate] READ-ONLY — how often did this fighter actually clear the posted line?', 'font-weight:bold');
  console.log('  event', ev.event, '| rows with a single agreed book line:', out.length);
  console.table(out);
  console.log('  RAW vs v39 diverging on a row means duration is doing the work there —');
  console.log('  that is the 3R-history-into-a-5R-main case, and Hooker is the one to read.');
  console.log('  A high hit rate does NOT by itself mean value: it is the fighter\'s own past,');
  console.log('  not the opponent-adjusted forecast, and the market may be pricing something');
  console.log('  the log cannot see. It bounds the question; it does not settle it.');
  window.__ssHit = { event: ev.event, out };
  console.log('  full result on window.__ssHit');
})();
