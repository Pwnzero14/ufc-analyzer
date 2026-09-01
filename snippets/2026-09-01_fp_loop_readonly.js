/*
 * READ-ONLY. How much has FP's broken loop actually touched?
 *
 * WHAT IS ALREADY SETTLED FROM CODE + GIT — this probe does NOT re-test it:
 *   2026-04-27  FP book prior          passed INTO predictFighter, so it runs
 *                                      INSIDE predictFantasy. A correction inside
 *                                      the estimator does NOT break the loop: the
 *                                      learner sees the number it produced.
 *   2026-08-20  v27 renormalisation    fp_global_modifier reset to 1.0 after 18
 *                                      cycles of damping ("saturating" at the floor)
 *   2026-08-21  v31 applyMarketAnchor  POST-HOC. THE LOOP BREAKS HERE.
 *   2026-08-30  v41 calibrateToBooks   POST-HOC. Second layer.
 *
 *   So the v27 saturation PREDATES the first post-hoc layer by a day and cannot
 *   have been caused by a broken loop. That hypothesis is dead on timing — the
 *   same way the SS ratchet died. Two for two; stop reaching for this shape.
 *
 * WHAT IS ACTUALLY OPEN, and what this measures:
 *   Only runs that graded a board generated on or after 2026-08-21 can have been
 *   affected. How many is that, and did the FP signal change across the boundary?
 *
 *   Note the anchor is a CLAMP, not a constant: it fires only when the model
 *   disagrees with the posted FP line by more than FP_GAP_CAP = 15, and only when
 *   a line was posted at all. Calibration (v41) moves every row. So the exposure
 *   is "some rows since 08-21, all rows since 08-30" — expect it to be small.
 *
 * Paste into the ANALYZER page console. chrome.storage.local.get only.
 */
(async () => {
  'use strict';
  const LOG = 'prop_predictor_learning_log_v1';
  const WK = 'prop_predictor_weights_v1';
  const V31 = Date.parse('2026-08-21T00:00:00Z');   // applyMarketAnchor, first post-hoc FP layer
  const V41 = Date.parse('2026-08-30T00:00:00Z');   // calibrateToBooks

  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const raw = await get([LOG, WK]);
  const log = Array.isArray(raw[LOG]) ? raw[LOG] : [];
  const w = raw[WK] || {};
  const mod = w.fp_global_modifier;
  const live = (mod && typeof mod === 'object') ? mod.default : (typeof mod === 'number' ? mod : null);

  console.log('%c[fp-loop] READ-ONLY', 'font-weight:bold');
  console.log('  runs stored          :', log.length);
  console.log('  fp_global_modifier   :', mod);
  console.log('  (v27 renormalised this to 1.0 on 2026-08-20; clamp floor is 0.75)');
  if (!log.length) { console.warn('  log empty — nothing to measure.'); return; }

  const n3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

  // Walk the fp modifier backwards from the live value, same method as the SS probe.
  const rows = [];
  let after = live;
  for (let i = log.length - 1; i >= 0; i--) {
    const r = log[i];
    const adj = (r.summary && r.summary.weightAdjustments) || {};
    const d = Number(adj['fp_global_modifier.default']);
    const delta = Number.isFinite(d) ? d : 0;
    const before = after == null ? null : after - delta;
    const preds = Array.isArray(r.predictions) ? r.predictions : [];
    const eds = preds.map((p) => Number(p && p.effectiveDelta && p.effectiveDelta.fp)).filter(Number.isFinite);
    const kinds = {};
    for (const p of preds) { const k = (p && p.targetKind && p.targetKind.fp) || 'none'; kinds[k] = (kinds[k] || 0) + 1; }
    const t = Number(r.learnedAt);
    rows.unshift({
      run: i + 1, event: r.event, date: r.date ? String(r.date).slice(0, 10) : '',
      era: t >= V41 ? 'post-v41 (anchor+cal)' : t >= V31 ? 'post-v31 (anchor)' : 'loop SOUND',
      'fpMod before': n3(before), delta: n3(delta), 'fpMod after': n3(after),
      'mean effDelta.fp': n3(mean(eds)), n: eds.length,
      'pos/neg': eds.length ? eds.filter((v) => v > 0).length + '/' + eds.filter((v) => v < 0).length : '',
      target: Object.entries(kinds).map(([k, v]) => k + ':' + v).join(' '),
    });
    after = before;
  }
  console.table(rows);

  // ── exposure ──────────────────────────────────────────────────────────────
  const sound = rows.filter((r) => r.era === 'loop SOUND');
  const broken = rows.filter((r) => r.era !== 'loop SOUND');
  console.log('%c── EXPOSURE ──', 'font-weight:bold');
  console.log('  runs with the loop SOUND (pre 2026-08-21):', sound.length);
  console.log('  runs in the BROKEN window                :', broken.length,
    broken.length ? '→ ' + broken.map((r) => r.event + ' (' + r.era + ')').join(', ') : '');
  if (!broken.length) {
    console.log('%c  NO learning run has yet graded a board carrying a post-hoc FP correction.', 'color:#4caf50');
    console.log('%c  FP\'s broken loop is real in code but has done NOTHING to the weights so far.', 'color:#4caf50');
    console.log('  Same conclusion as SS, same reason. First exposure is the Paris settle.');
  } else {
    console.log('%c  ' + broken.length + ' run(s) are in the window. Compare their mean effDelta.fp against', 'color:#ff9800');
    console.log('%c  the sound-era runs below before concluding the break caused any drift.', 'color:#ff9800');
  }

  // ── did the signal shift across the boundary? ─────────────────────────────
  const pool = (rs) => { const a = []; for (const r of rs) { const src = log[r.run - 1]; for (const p of (src.predictions || [])) { const v = Number(p && p.effectiveDelta && p.effectiveDelta.fp); if (Number.isFinite(v)) a.push(v); } } return a; };
  const sA = pool(sound), bA = pool(broken);
  console.log('%c── SIGNAL EITHER SIDE OF THE BOUNDARY ──', 'font-weight:bold');
  console.log('  loop SOUND : n =', sA.length, '| mean effDelta.fp', n3(mean(sA)));
  console.log('  BROKEN     : n =', bA.length, '| mean effDelta.fp', n3(mean(bA)));
  console.log('  A shift here is SUGGESTIVE, never conclusive — the model changed a lot in that');
  console.log('  same window (v27 regression-to-mean, v30 fair line, v31 anchor, v40 line target),');
  console.log('  so any difference has several candidate causes besides the broken loop.');

  const deltas = rows.map((r) => r.delta).filter(Number.isFinite);
  console.log('%c── fp_global_modifier TRAJECTORY ──', 'font-weight:bold');
  console.log('  steps UP', deltas.filter((d) => d > 0).length, '| DOWN', deltas.filter((d) => d < 0).length,
    '| net', n3(deltas.reduce((s, d) => s + d, 0)));
  console.log('  at the 0.75 clamp floor?', live != null && live <= 0.76 ? 'YES — saturated' : 'no (' + n3(live) + ')');

  window.__fpLoop = { rows, live, sound: sound.length, broken: broken.length, soundSignal: sA, brokenSignal: bA };
  console.log('  full result on window.__fpLoop');
})();
