/*
 * READ-ONLY. Confirms (or kills) the v43 anchorShift sign claim with numbers.
 *
 * Paste into the console of the ANALYZER page
 * (chrome-extension://<id>/analyzer.html), not the popup and not a book tab.
 *
 * It only calls chrome.storage.local.get. Nothing is written, nothing is
 * removed, no line store is touched. Safe to run on a live fight-week board.
 *
 * WHAT IT IS TESTING
 *   analyzer.ts ~14564:  const anchorShift = (stat) => -(bookCal.global[stat]);
 *   applyMarketAnchorFor:  fair = postedLine + shift
 *   calibrateToBooks:      line = line - bookCal.global[stat]   (runs AFTER)
 *
 *   bookCal.global[stat] is (predicted - posted) and is POSITIVE for SS, so
 *   with S = that offset and P = the posted line:
 *     shift = +S  ->  final band = [P - cap, P + cap]      (symmetric)
 *     shift = -S  ->  final band = [P - 2S - cap, P - 2S + cap]  (never above P)
 *
 * THE PREDICTION THIS SCRIPT CHECKS
 *   Every ANCHORED SS/TD/R1 SS row should land at or below its posted line,
 *   and its delta should sit inside [-2S - cap, -2S + cap]. If anchored rows
 *   straddle the book, or the deltas do not match that band, the sign claim is
 *   WRONG and should be dropped rather than argued.
 *
 * Both numbers come from the stored reason strings, not from re-deriving
 * anything: the anchor reason carries `fair` and `cap`, the calibration reason
 * carries the measured offset S. P is then recovered as fair + S.
 * The raw line stores are read ONLY as an independent cross-check on that
 * recovered P, and are reported separately for exactly that reason.
 */
(async () => {
  'use strict';

  const PK = 'prop_predictions_v1';
  const LINE_KEYS = ['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks', 'lines_draftkings_sportsbook'];
  const BOOK = { lines_pick6: 'P6', lines_underdog: 'UD', lines_betr: 'BT', lines_prizepicks: 'PP', lines_draftkings_sportsbook: 'DK' };

  const get = (keys) => new Promise((res) => chrome.storage.local.get(keys, res));
  const raw = await get([PK, ...LINE_KEYS]);

  const events = Array.isArray(raw[PK]) ? raw[PK] : [];
  if (!events.length) { console.warn('[anchor-audit] prop_predictions_v1 is empty — generate predictions first.'); return; }

  const ev = events.reduce((a, b) => (Number(b && b.generatedAt || 0) > Number(a && a.generatedAt || 0) ? b : a));
  const rows = Array.isArray(ev.predictions) ? ev.predictions : [];
  console.log('%c[anchor-audit] READ-ONLY', 'font-weight:bold');
  console.log('  event     ', ev.event);
  console.log('  generated ', new Date(Number(ev.generatedAt) || 0).toLocaleString());
  console.log('  rows      ', rows.length, '| model v' + (rows[0] && rows[0].modelVersion));

  // ── reason parsers ─────────────────────────────────────────────────────────
  // Strings are emitted verbatim by PropLinePredictorService; the dash class
  // covers em/en/hyphen so a font or a later edit cannot silently zero the parse.
  const D = '\\s*[\\u2014\\u2013-]\\s*';
  const RE_CAL = new RegExp('Book calibration:\\s*(-?[\\d.]+)\\s*\\u2192\\s*(-?[\\d.]+)\\s*\\(measured\\s+(SS|TD|FP|R1 SS)\\s+offset\\s+([+-][\\d.]+)\\s+over\\s+(\\d+)\\s+events');
  const RE_ANC = new RegExp('Anchored to market: model said\\s+(-?[\\d.]+)\\s+for\\s+(SS|TD|R1 SS),\\s+([\\d.]+)\\s+from the fair line\\s+(-?[\\d.]+)' + D + 'capped at\\s+([\\d.]+)');
  const RE_ANC_FP = new RegExp('Anchored to market: model said\\s+(-?[\\d.]+),\\s+([\\d.]+)\\s+from the fair line\\s+(-?[\\d.]+)' + D + 'capped at\\s+([\\d.]+)');
  // AMENDED AFTER THE FIRST RUN (2026-09-01). applyDebutMoneylineSplit runs AFTER the
  // anchor and moves sp.line by +/- DEBUT_ML_GAP/2 while leaving anchoredFrom stale, so
  // a debut row's final line is NOT the anchored value and its delta says nothing about
  // the anchor. The first run's lone "above the book" row was exactly this (Parnasse:
  // anchored 36.2 -> debut +6.7 -> calibration -3.3 -> 39.5). Excluded from the verdict
  // and reported separately rather than silently dropped.
  const RE_DEBUT = /Debut split [+-][\d.]+:/;

  const firstMatch = (reasons, re) => {
    for (const r of (reasons || [])) { const m = re.exec(String(r)); if (m) return m; }
    return null;
  };

  // ── raw line stores, for the independent cross-check only ──────────────────
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const surname = (s) => { const t = norm(s).split(' ').filter(Boolean); return t.length ? t[t.length - 1] : ''; };

  const storeRows = [];
  for (const k of LINE_KEYS) {
    const st = raw[k];
    const arr = Array.isArray(st) ? st : (st && Array.isArray(st.fighters) ? st.fighters : []);
    for (const f of arr) if (f && f.name) storeRows.push({ book: BOOK[k], name: f.name, ss: Number(f.line_ss), ss_r1: Number(f.line_ss_r1), td: Number(f.line_td) });
  }

  // Exact normalised name first; surname only as a fallback, and a surname hit
  // that is not unique is reported as ambiguous rather than picked. (The two
  // Johnsons on one card is a real trap in this repo — never silently resolve it.)
  const lookupBooks = (fighter, field) => {
    const n = norm(fighter), s = surname(fighter);
    let hits = storeRows.filter((r) => norm(r.name) === n);
    let how = 'exact';
    if (!hits.length) {
      const byS = storeRows.filter((r) => surname(r.name) === s && s);
      const distinct = new Set(byS.map((r) => norm(r.name)));
      if (distinct.size > 1) return { how: 'AMBIGUOUS', lines: {} };
      hits = byS; how = byS.length ? 'surname' : 'none';
    }
    const lines = {};
    for (const h of hits) { const v = Number(h[field]); if (Number.isFinite(v) && v > 0) lines[h.book] = v; }
    return { how, lines };
  };

  // ── walk every stat on every row ───────────────────────────────────────────
  const STATS = [['ss', 'SS'], ['td', 'TD'], ['ss_r1', 'R1 SS'], ['fantasy', 'FP']];
  const FIELD = { SS: 'ss', 'R1 SS': 'ss_r1', TD: 'td' };
  const offsets = {};   // stat -> Set of S values seen
  const out = [];

  for (const p of rows) {
    for (const [key, label] of STATS) {
      const sp = p[key];
      if (!sp || !Number.isFinite(Number(sp.line))) continue;

      const cal = firstMatch(sp.reasons, RE_CAL);
      const S = cal ? parseFloat(cal[4]) : null;
      if (S != null) (offsets[label] = offsets[label] || new Set()).add(S);

      const anc = label === 'FP' ? firstMatch(sp.reasons, RE_ANC_FP) : firstMatch(sp.reasons, RE_ANC);
      const anchored = sp.anchoredFrom != null || !!anc;
      if (!anchored && !cal) continue;   // nothing recoverable and nothing moved

      const fair = anc ? parseFloat(label === 'FP' ? anc[3] : anc[4]) : null;
      const cap = anc ? parseFloat(label === 'FP' ? anc[4] : anc[5]) : null;
      const modelSaid = sp.anchoredFrom != null ? Number(sp.anchoredFrom)
        : (anc ? parseFloat(anc[1]) : null);

      out.push({
        fighter: p.fighter, stat: label, anchored,
        debut: (sp.reasons || []).some((r) => RE_DEBUT.test(String(r))),
        modelSaid, fair, cap, S,
        final: Number(sp.line),
        _field: FIELD[label] || null,
      });
    }
  }

  // Resolve S per stat globally — calibrateToBooks omits its reason when the
  // snap is a no-op, so a row can be missing the offset the rest of the board has.
  const globalS = {};
  for (const [stat, set] of Object.entries(offsets)) {
    const vals = [...set];
    globalS[stat] = vals[0];
    if (vals.length > 1) console.warn('[anchor-audit] stat ' + stat + ' reports MORE THAN ONE offset:', vals, '- the parse or the run is mixed; stop here.');
  }
  console.log('  measured offsets S (predicted - posted):', globalS);

  // ── the test ───────────────────────────────────────────────────────────────
  // AMENDED AFTER THE FIRST RUN. The original headline test was the delta band, and
  // it was the wrong instrument twice over: it is nearly degenerate at its upper edge
  // (the wrong-sign band tops out at ~0, so "in band" and "at or below the book" are
  // almost the same question), and its "posted(implied)" input is fair + S, which is
  // circular - it cannot disagree with the sign it is testing.
  //
  // THE DIRECT TEST is `shift`, recovered without any assumption:
  //     applyMarketAnchorFor computes  fair = postedLine + shift
  //     so                             shift = fair - (the line the book actually posts)
  // `fair` is quoted verbatim in the stored reason; the posted line comes from the RAW
  // line store, which no part of the anchor path touches. shift ~ -S means the negation
  // is live; shift ~ +S means it is not. No band, no inference, no circularity.
  const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

  const table = out.map((r) => {
    const S = r.S != null ? r.S : globalS[r.stat];
    const xb = r._field ? lookupBooks(r.fighter, r._field) : { how: 'n/a', lines: {} };
    const bookVals = Object.values(xb.lines);
    // Only decide when every book agrees, so a two-book disagreement cannot be read
    // as a shift. getSourceActiveLine picks ONE book and this script does not know which.
    const bookRaw = bookVals.length && bookVals.every((v) => v === bookVals[0]) ? bookVals[0] : null;
    const shift = (r.fair != null && bookRaw != null) ? Math.round((r.fair - bookRaw) * 10) / 10 : null;
    return {
      fighter: r.fighter, stat: r.stat, anchored: r.anchored, debut: r.debut,
      model: r.modelSaid, fair: r.fair, cap: r.cap, S,
      final: r.final,
      'book(raw)': bookRaw != null ? bookRaw : (Object.entries(xb.lines).map(([b, v]) => b + ' ' + v).join(' ') || '-'),
      'shift=fair-book': shift,
      verdict: shift == null ? '' : (near(shift, -S, 0.15) ? 'NEGATED (-S)' : near(shift, S, 0.15) ? 'correct (+S)' : 'neither'),
      'delta vs book': (bookRaw != null) ? Math.round((r.final - bookRaw) * 10) / 10 : null,
      match: xb.how,
    };
  });

  const decidable = table.filter((r) => r.anchored && r['shift=fair-book'] != null && r.S);
  console.table(table);

  console.log('%c── VERDICT ──', 'font-weight:bold');
  console.log('  stat rows examined            :', table.length);
  console.log('  anchored                      :', table.filter((r) => r.anchored).length);
  console.log('  anchored AND decidable        :', decidable.length, '(needs a raw book line all books agree on)');
  if (!decidable.length) {
    console.log('  UNPROVEN either way. The anchor either never fired, or fired only where this');
    console.log('  script cannot see a raw book line. Re-run once more books post.');
  } else {
    const neg = decidable.filter((r) => r.verdict === 'NEGATED (-S)').length;
    const pos = decidable.filter((r) => r.verdict === 'correct (+S)').length;
    const other = decidable.length - neg - pos;
    console.log('  shift = -S (sign is negated)  :', neg);
    console.log('  shift = +S (sign is correct)  :', pos);
    console.log('  neither                       :', other);
    if (neg === decidable.length) {
      console.log('%c  CONFIRMED: fair sits BELOW the posted line by exactly the measured offset on every', 'color:#e0b000');
      console.log('%c  decidable row. anchorShift is negated. calibrateToBooks then subtracts S again.', 'color:#e0b000');
    } else if (pos === decidable.length) {
      console.log('%c  NOT A BUG. fair sits above the posted line by +S, which is the intended reference.', 'color:#4caf50');
    } else {
      console.log('%c  MIXED - ' + other + ' row(s) match neither. The anchor is probably reading a different', 'color:#ff9800');
      console.log('%c  book than this script found. Resolve THAT before touching the sign.', 'color:#ff9800');
    }
  }

  // Debut rows are reported, never counted: applyDebutMoneylineSplit moves the line
  // after the anchor and leaves anchoredFrom stale, so their delta is not the anchor's.
  const debutRows = table.filter((r) => r.debut && r.anchored);
  if (debutRows.length) {
    console.log('  EXCLUDED (debut split moved the line after anchoring):',
      debutRows.map((r) => r.fighter + ' ' + r.stat).join(', '));
  }

  window.__anchorAudit = { event: ev.event, globalS, table, decidable, debutRows };
  console.log('  full result also on window.__anchorAudit');
})();
