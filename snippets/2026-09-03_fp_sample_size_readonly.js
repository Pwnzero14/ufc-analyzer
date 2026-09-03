/*
 * READ-ONLY. Should the FP engine emit a lean at n=1?
 *
 * THE QUESTION, made decidable. Every other lean engine refuses below three
 * fights (calcSSLean / calcSSR1Lean / calcTDLean / calcCTRLLean all
 * `return null`), and calcFTLean falls back to an explicitly-labelled
 * MARKET-ONLY lean. FP alone emits an ordinary pick off one fight. Its
 * confidence is damped — calcMultivariateConfidence's sampleSizeFactor is
 * (n-3)/10, so n=1 multiplies by 0.64 — but never refused and, before
 * GLOW-UP 306C, never marked.
 *
 * Arguing this is cheap and worthless. The FP lean's core personal input is the
 * fighter's own FP average, so the thing to measure is whether that average
 * PREDICTS at low n:
 *
 *   For every fight in every cached fighter's history, take the average of the
 *   fights BEFORE it (n of them) and see how far it lands from what actually
 *   happened. Bucket by n.
 *
 * THE CONTROL IS WHAT MAKES IT DECISIVE. A personal average will always carry
 * some error, and "n=1 is worse than n=8" proves nothing on its own — of course
 * it is. The real question is whether a 1-fight average beats knowing NOTHING
 * about the fighter. So each bucket is scored against the LEAGUE MEAN over the
 * same fights:
 *
 *   personal MAE  <  league MAE   -> the personal baseline is adding signal
 *   personal MAE  >= league MAE   -> at that n it is adding NOISE, and the
 *                                    engine would do better ignoring the
 *                                    fighter's own record entirely, which is
 *                                    exactly what a market-only fallback does
 *
 * That flips the decision from taste to a number, and it can come back either
 * way. If n=1 beats the league mean, FP is RIGHT to emit and the honest outcome
 * is to keep 306C's label and change nothing else. Report whichever it says.
 *
 * FANTASY_SCORING is copied from config/index.ts and has been fuzz-verified
 * against calcFPForPlatform earlier in this series. Do not hand-transcribe a
 * scoring table — probe v1 of the archive-FP series invented one and produced
 * 2270 phantom findings.
 *
 * LIMITS, stated so the output is not over-read:
 *  - This measures the PERSONAL BASELINE, not the whole FP lean, which also
 *    carries market anchoring and an opponent adjustment. A bad baseline is
 *    strong evidence but not proof the final lean is bad.
 *  - Cached history is UFC fights only, so "n" is UFC experience, not career.
 *  - Fights with no parsed stats are skipped, which can make n smaller than the
 *    fighter's true record at that date.
 *
 * Paste into the ANALYZER page console. chrome.storage.local.get only.
 */
(async () => {
  'use strict';
  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const all = await get(null);
  const caches = [];
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('ufcstats_v51_') && v && Array.isArray(v.fightHistory)) caches.push(v);
  }
  console.log('%c[fp-sample-size] READ-ONLY', 'font-weight:bold');
  console.log('  cached fighters:', caches.length);
  if (!caches.length) { console.warn('  no caches — stop.'); return; }

  // ── FANTASY_SCORING (config/index.ts), fuzz-verified in this series ───────
  const F = { sig: 0.4, nonSig: 0.2, ctrl: 0.03, td: 5, rev: 5, kd: 10, quick: 25,
    wb: { r1: 90, r2: 70, r3: 45, r4: 40, dec: 30 } };
  const isFinish = (m) => /KO|TKO|SUB/i.test(m || '');
  const fp = (h) => {
    if (h.sigStr == null) return null;
    const won = String(h.result).toLowerCase() === 'win';
    const nonSig = Math.max(0, Number(h.totStr || 0) - Number(h.sigStr || 0));
    const b = !won ? 0 : /DEC/i.test(h.method || '') ? F.wb.dec
      : ((h.round || 3) === 1 ? F.wb.r1 : (h.round || 3) === 2 ? F.wb.r2 : (h.round || 3) === 3 ? F.wb.r3 : F.wb.r4);
    let v = Number(h.sigStr || 0) * F.sig + nonSig * F.nonSig + Number(h.ctrlSecs || 0) * F.ctrl
      + Number(h.kd || 0) * F.kd + Number(h.td || 0) * F.td + Number(h.rev || 0) * F.rev + b;
    if (won && isFinish(h.method) && (h.round || 0) === 1 && (h.timeSecs == null ? 9999 : Number(h.timeSecs)) <= 60) v += F.quick;
    return Math.round(v * 100) / 100;
  };

  // ── build (n, priorAvg, actual) triples, chronological per fighter ────────
  const rows = [];
  const allFp = [];
  for (const c of caches) {
    const hist = (c.fightHistory || [])
      .map((h) => ({ h, t: Date.parse(h.date), v: fp(h) }))
      .filter((x) => Number.isFinite(x.t) && x.v != null)
      .sort((a, b) => a.t - b.t);
    for (const x of hist) allFp.push(x.v);
    let sum = 0;
    for (let i = 0; i < hist.length; i++) {
      if (i > 0) rows.push({ n: i, prior: sum / i, actual: hist[i].v, who: c.name });
      sum += hist[i].v;
    }
  }
  if (!rows.length) { console.warn('  no usable fight pairs — stop.'); return; }

  // League mean over the SAME population the buckets are scored on, so the two
  // baselines are compared on identical fights rather than different samples.
  const leagueMean = allFp.reduce((a, b) => a + b, 0) / allFp.length;

  const BUCKETS = [[1, 1], [2, 2], [3, 5], [6, 9], [10, 99]];
  const label = (lo, hi) => (lo === hi ? `n=${lo}` : hi === 99 ? `n>=${lo}` : `n=${lo}-${hi}`);
  const out = [];
  for (const [lo, hi] of BUCKETS) {
    const b = rows.filter((r) => r.n >= lo && r.n <= hi);
    if (!b.length) continue;
    const mae = b.reduce((a, r) => a + Math.abs(r.actual - r.prior), 0) / b.length;
    const leagueMae = b.reduce((a, r) => a + Math.abs(r.actual - leagueMean), 0) / b.length;
    out.push({
      bucket: label(lo, hi), fights: b.length,
      'personal MAE': +mae.toFixed(1),
      'league-mean MAE': +leagueMae.toFixed(1),
      'personal better by': +(leagueMae - mae).toFixed(1),
      verdict: mae < leagueMae ? 'ADDS SIGNAL' : 'ADDS NOISE',
    });
  }
  console.table(out);
  console.log('  league mean FP:', leagueMean.toFixed(1), '| fight pairs scored:', rows.length);

  const n1 = out.find((o) => o.bucket === 'n=1');
  console.log('%c-- VERDICT --', 'font-weight:bold');
  if (!n1) {
    console.log('  No n=1 cases in the cache, so this run CANNOT answer the question.');
    console.log('  Say that rather than reading the other buckets as an answer.');
  } else if (n1.verdict === 'ADDS NOISE') {
    console.log('%c  At n=1 the personal average is WORSE than knowing nothing about the', 'color:#f44336;font-weight:bold');
    console.log('%c  fighter. The FP engine should not build a lean on it — a market-only', 'color:#f44336;font-weight:bold');
    console.log('%c  fallback (what calcFTLean already does) is the evidence-backed answer.', 'color:#f44336;font-weight:bold');
  } else {
    console.log('%c  At n=1 the personal average still BEATS the league mean. FP is right to', 'color:#4caf50;font-weight:bold');
    console.log('%c  emit; keep the GLOW-UP 306C label and change nothing else. Do not', 'color:#4caf50;font-weight:bold');
    console.log('%c  a thing the data says is working.', 'color:#4caf50;font-weight:bold');
  }
  console.log('  Read the whole table: where the crossover sits matters as much as n=1,');
  console.log('  because it says where a personal baseline STARTS being worth having.');
  window.__fpSample = { out, rows, leagueMean };
  console.log('  full result on window.__fpSample');
})();
