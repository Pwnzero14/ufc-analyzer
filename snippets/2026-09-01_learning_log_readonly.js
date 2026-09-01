/*
 * READ-ONLY. Tests the RATCHET hypothesis against the actual learning log.
 *
 * THE CLAIM BEING TESTED
 *   "The negated anchorShift biases the stored line below the book, so
 *    effectiveDelta = posted - predicted runs positive, so the learner pushes
 *    ss_pace_modifier UP - and that is why default sits at 1.056."
 *
 * THREE THINGS SETTLE IT, AND THE FIRST IS DECISIVE ON ITS OWN:
 *
 *   1. TIMING. anchorShift arrived with MODEL v43 (2026-08-30). If no learning
 *      run has consumed a board generated on or after that date, the sign bug
 *      cannot have moved the modifier at all, whatever the trend looks like.
 *      A correlation found without this check would be pure coincidence.
 *
 *   2. TRAJECTORY. weightAdjustments stores the DELTA applied per event, not the
 *      absolute. Walking backwards from the live value reconstructs the path:
 *      before_i = after_i - delta_i. Monotone rise is the ratchet's signature;
 *      anything else is not.
 *
 *   3. SIGN OF THE SIGNAL. effectiveDelta.ss per fighter per run. The ratchet
 *      needs it systematically POSITIVE. targetKind says whether each row was
 *      trained against a posted LINE (v40 behaviour) or against the fighter's
 *      RESULT (the pre-v40 fallback) - a run on 'result' targets is not
 *      measuring the thing the hypothesis is about.
 *
 * Paste into the ANALYZER page console. chrome.storage.local.get only.
 */
(async () => {
  'use strict';
  const LOG = 'prop_predictor_learning_log_v1';
  const WK = 'prop_predictor_weights_v1';
  const V43_SHIPPED = Date.parse('2026-08-30T00:00:00Z');   // MODEL v43, anchorShift

  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const raw = await get([LOG, WK]);
  const log = Array.isArray(raw[LOG]) ? raw[LOG] : [];
  const w = raw[WK] || {};
  const mod = w.ss_pace_modifier;
  const liveDefault = (mod && typeof mod === 'object') ? mod.default : (typeof mod === 'number' ? mod : null);

  console.log('%c[learning-log] READ-ONLY', 'font-weight:bold');
  console.log('  runs stored           :', log.length, '(capped at 20 by savePredictions/log.slice(-20))');
  console.log('  ss_pace_modifier live :', mod);
  if (!log.length) { console.warn('  log is EMPTY - the ratchet cannot be tested and must not be asserted.'); return; }

  const n1 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

  // ── walk the trajectory backwards from the live value ─────────────────────
  const rows = [];
  let after = liveDefault;
  for (let i = log.length - 1; i >= 0; i--) {
    const r = log[i];
    const adj = (r.summary && r.summary.weightAdjustments) || {};
    const d = Number(adj['ss_pace_modifier.default']);
    const delta = Number.isFinite(d) ? d : 0;
    const before = after == null ? null : after - delta;

    const preds = Array.isArray(r.predictions) ? r.predictions : [];
    const eds = preds.map((p) => Number(p && p.effectiveDelta && p.effectiveDelta.ss)).filter(Number.isFinite);
    const kinds = {};
    for (const p of preds) { const k = (p && p.targetKind && p.targetKind.ss) || 'none'; kinds[k] = (kinds[k] || 0) + 1; }
    const lineTrained = (kinds['line-open'] || 0) + (kinds['line-close'] || 0);

    rows.unshift({
      run: i + 1, event: r.event,
      date: r.date ? String(r.date).slice(0, 10) : '',
      'v43 board?': Number(r.learnedAt) >= V43_SHIPPED ? 'MAYBE' : 'no',
      'ssMod before': n1(before), 'delta': n1(delta), 'ssMod after': n1(after),
      'mean effDelta.ss': n1(mean(eds)), 'n': eds.length,
      'pos/neg': eds.length ? eds.filter((v) => v > 0).length + '/' + eds.filter((v) => v < 0).length : '',
      target: Object.entries(kinds).map(([k, v]) => k + ':' + v).join(' '),
      'line-trained': lineTrained,
    });
    after = before;
  }
  console.table(rows);

  // ── 1. TIMING - decisive on its own ───────────────────────────────────────
  const post = log.filter((r) => Number(r.learnedAt) >= V43_SHIPPED);
  console.log('%c── 1. TIMING ──', 'font-weight:bold');
  console.log('  learning runs on/after MODEL v43 shipped (2026-08-30):', post.length);
  if (!post.length) {
    console.log('%c  RATCHET IS DEAD ON TIMING. No learning run has ever consumed a v43-anchored', 'color:#4caf50');
    console.log('%c  board, so the negated anchorShift cannot have moved ss_pace_modifier at all.', 'color:#4caf50');
    console.log('  Whatever the trajectory shows below has some OTHER cause. Do not attribute it.');
  } else {
    console.log('  ' + post.length + ' run(s) could have seen a v43 board:', post.map((r) => r.event).join(', '));
    console.log('  NOTE "MAYBE" not "yes": learnedAt is when the cycle RAN, not when the board it');
    console.log('  graded was generated. Confirm the board version before concluding anything.');
  }

  // ── 2. TRAJECTORY ─────────────────────────────────────────────────────────
  const deltas = rows.map((r) => r.delta).filter(Number.isFinite);
  const up = deltas.filter((d) => d > 0).length, dn = deltas.filter((d) => d < 0).length;
  console.log('%c── 2. TRAJECTORY ──', 'font-weight:bold');
  console.log('  ss_pace_modifier.default steps: UP', up, '| DOWN', dn, '| zero', deltas.length - up - dn);
  console.log('  net movement across the stored log:', n1(deltas.reduce((s, d) => s + d, 0)));
  console.log('  monotone rise?', up > 0 && dn === 0 ? 'YES - ratchet signature' : 'NO - it moves both ways');

  // ── 3. SIGN OF THE SIGNAL ─────────────────────────────────────────────────
  const allEd = [];
  for (const r of log) for (const p of (r.predictions || [])) {
    const v = Number(p && p.effectiveDelta && p.effectiveDelta.ss);
    if (Number.isFinite(v)) allEd.push(v);
  }
  console.log('%c── 3. SIGN OF THE SIGNAL ──', 'font-weight:bold');
  console.log('  effectiveDelta.ss across every stored run: n =', allEd.length,
    '| mean', n1(mean(allEd)),
    '| positive', allEd.filter((v) => v > 0).length, '| negative', allEd.filter((v) => v < 0).length);
  console.log('  The ratchet needs this systematically POSITIVE. It is the learner\'s view of');
  console.log('  "the line sits above what I predicted", which is what a low-biased stored line');
  console.log('  would produce - but see (1) before reading any meaning into it.');

  window.__learnLog = { rows, liveModifier: mod, postV43: post.length, effDeltaSS: allEd };
  console.log('  full result on window.__learnLog');
})();
