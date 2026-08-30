// ── PROP LINE PREDICTOR SERVICE ──────────────────────────────────────────
// Predicts SS, TD, and Fantasy lines for upcoming fights using fighter history,
// opponent data, and self-learned weights. After settlement, runs a learning
// cycle to update fighter trends and formula weights.

import { FANTASY_SCORING, MODEL_VERSION, FP_CONFIDENCE_CEILING } from '../config/index.js';

/** Books that score fantasy points with FANTASY_SCORING. PrizePicks is deliberately
 *  absent: it is a different rulebook (no control time, no non-sig strikes, a
 *  decision pays 10 against 30) and its totals are archived as `Fantasy_PP`. */
const FANTASY_SCORING_BOOKS = new Set(['pick6', 'underdog', 'betr']);
import type {
  FighterDB,
  FighterTrend,
  LearningPredictionResult,
  LearningResult,
  LearningSummary,
  PerClassModifier,
  PredictionEvent,
  PredictorWeights,
  PropArchiveRecord,
  BacktestCell,
  PredictorLineBacktest,
  PropPrediction,
  StatPrediction,
  WeightClass,
} from '../types/index.js';

// ── Storage Keys ────────────────────────────────────────────────────────
const PREDICTIONS_KEY = 'prop_predictions_v1';
const WEIGHTS_KEY = 'prop_predictor_weights_v1';
const TRENDS_KEY = 'prop_predictor_trends_v1';
const LEARNING_LOG_KEY = 'prop_predictor_learning_log_v1';

// ── Helpers ─────────────────────────────────────────────────────────────
function chromeGet<T = unknown>(keys: string[]): Promise<T> {
  return new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data as T)));
}

function chromeSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function normName(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').replace(/\./g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round1(v: number): number {
  return Math.round(v * 2) / 2; // round to nearest 0.5
}

// ── Per-class modifier helpers ──────────────────────────────────────────
function makeModifier(v = 1.0): PerClassModifier {
  return { default: v };
}

// Read the modifier for a given weight class; fall back to `default` when the
// class is unknown or has never been sampled.
function getMod(map: PerClassModifier, wc?: WeightClass | null): number {
  if (!wc) return map.default;
  const v = map[wc];
  return typeof v === 'number' ? v : map.default;
}

// Normalize a possibly-legacy (number) modifier field into a PerClassModifier.
// Old stored weights had `ss_pace_modifier: number` — migrate by moving that
// value into the `default` bucket. Idempotent for already-migrated values.
function ensureModifier(v: unknown): PerClassModifier {
  if (typeof v === 'number' && Number.isFinite(v)) return { default: v };
  if (v && typeof v === 'object' && typeof (v as PerClassModifier).default === 'number') {
    return v as PerClassModifier;
  }
  return { default: 1.0 };
}

function clampModifier(map: PerClassModifier, lo: number, hi: number): void {
  map.default = clamp(map.default, lo, hi);
  for (const k of Object.keys(map) as Array<keyof PerClassModifier>) {
    if (k === 'default') continue;
    const val = map[k];
    if (typeof val === 'number') map[k] = clamp(val, lo, hi);
  }
}

// ── Default Weights ─────────────────────────────────────────────────────
const DEFAULT_WEIGHTS: PredictorWeights = {
  ss_pace_modifier: makeModifier(1.0),
  td_attempt_modifier: makeModifier(1.0),
  fp_global_modifier: makeModifier(1.0),
  fp_ss_weight: FANTASY_SCORING.sigStrike,
  fp_td_weight: FANTASY_SCORING.takedown,
  fp_ctrl_weight: FANTASY_SCORING.controlTimePerSec,
  fp_kd_weight: FANTASY_SCORING.knockdown,
  fp_win_weight: FANTASY_SCORING.winBonus.decision,
  version: 2,
};

// Learning-cycle hyperparams
const LEARNING_RATE = 0.1;      // fraction of relative error applied per event
const MAX_STEP_PER_EVENT = 0.08; // cap per-event multiplicative change at ±8%

// MODEL v12 — SS rate bounds. Sustained UFC significant-strike output tops out
// around 8-9 per minute; anything beyond that is a parse artifact rather than a
// fighter (e.g. a single cached row reading 235 SS, which implies 15.7/min).
// Clamping the rate keeps one bad history row from blowing up a projection.
const SS_RATE_MIN = 0.5;
const SS_RATE_MAX = 9.0;
const LEAGUE_SS_RATE = 3.9;     // league-typical SS landed (and absorbed) per minute
// MODEL v15 — the MEASURED mean realised SS rate over 1,891 walk-forward fights from
// the cached population. Deliberately a separate constant from LEAGUE_SS_RATE above:
// this is the shrinkage TARGET that SS_RATE_SHRINK_K was fitted against, and using a
// different value here would re-bias every shrunk rate. (LEAGUE_SS_RATE is the
// zero-data FALLBACK and is left at 3.9 — moving it is a separate, unvalidated change
// affecting fighters with no history at all. Worth revisiting together.)
const SS_RATE_LEAGUE_MEAN = 4.55;

// ── MODEL v27 — FP regression to the mean ────────────────────────────────
// Mean Betr FP across the walk-forward population (1,307 fights / 272 fighters
// in the cached histories). Measured, and deliberately its own constant for the
// same reason SS_RATE_LEAGUE_MEAN is separate from LEAGUE_SS_RATE: the retention
// below was fitted against THIS number, so substituting another FP average would
// re-bias every shrunk projection.
const FP_LEAGUE_MEAN = 69.4;

// How much of a fighter's deviation from the league mean survives. Same
// walk-forward test SS v15 used — rebuild the baseline from PRIOR fights only,
// compare to that fight's actual Betr score:
//
//   regression slope of actual on predicted:  0.267
//   bucket residual (mean / median / trimmed), predicted FP:
//     0-40   +32.09 / +36.44 / +32.41      40-60  +13.44 / +16.96 / +14.12
//     60-80   -3.43 /  +3.79 /  -2.85      80-100 -16.60 /  -5.77 / -15.85
//     100-130 -23.85 / -12.61 / -22.97
//
// Monotonic across every bucket, and mean agrees with trimmed everywhere, so it
// is not outlier-driven — that is the check v15 insists on before trusting a
// correction. Unlike SS, BOTH tails are evidenced (the 40-60 cell alone is
// n=263 with all three statistics agreeing), so this is two-sided where SS's
// shrinkage had to be one-sided.
//
// Fitted by sweeping retention against residual spread across buckets, which is
// what decides OVER vs UNDER against a line. MAE cannot choose here — every
// candidate sits at 35.75-35.88, indistinguishable — but spread collapses from
// 46.8 (uncorrected) to ~8, and bias from -4.54 to -1.59. 0.30/0.35/0.40 all land
// within noise of each other; 0.35 sits mid-range and stays deliberately ABOVE
// the raw 0.267 fit, keeping more of the model's own signal than the pure
// regression would.
//
// Shrinkage is a monotonic linear transform, so it cannot reorder picks — the
// correlation with actual is unchanged. It moves only the LEVEL, which is
// exactly what was wrong.
const FP_SHRINK_RETENTION = 0.35;

// Retention for the no-history path, where the baseline is not a historical average
// at all but a construction from the model's own SS/TD lines. Those lines are
// themselves built from league fallbacks when the fighter is unknown — Terrance
// Chatman on the Hernandez card read `output 3.90 SS/min` against `opp absorbs 3.90`,
// both literally LEAGUE_SS_RATE — so the estimate carried no fighter-specific signal
// and still emitted 27.5 against a league mean of 69.4. With no information the honest
// projection is the mean, not 42 points under it.
//
// Cannot be measured directly: a fighter with no history cannot be walk-forward
// tested. Bounded by argument instead — zero priors cannot carry MORE signal than
// one prior, whose slope measured 0.212 (n=215), so 0.20 is an upper bound rather
// than a fitted value. What survives is the little that is real: opponent absorption
// still separates these fighters (Kuse's opponent absorbs 6.65 S/min, Chatman's 3.90).
const FP_NO_HISTORY_RETENTION = 0.20;
// Shrinkage strength in "phantom minutes at the league mean": a fighter with 36 logged
// minutes gets a 50/50 blend, a veteran with 150 keeps ~80% of their own rate. Fitted
// by MAE sweep on the same 1,891 observations (best at 36; the curve is flat from
// ~25-50, so this is not a sharp overfit).
const SS_RATE_SHRINK_K = 36;
const MIN_CLASS_SAMPLES = 2;    // need at least this many per-class samples to update a class-specific bucket

// ── Service ─────────────────────────────────────────────────────────────
export class PropLinePredictorService {

  // ── Storage Accessors ───────────────────────────────────────────────

  static async getWeights(): Promise<PredictorWeights> {
    const raw = await chromeGet<Record<string, unknown>>([WEIGHTS_KEY]);
    const stored = raw[WEIGHTS_KEY] as Record<string, unknown> | undefined;
    if (!stored) {
      return {
        ...DEFAULT_WEIGHTS,
        ss_pace_modifier: makeModifier(),
        td_attempt_modifier: makeModifier(),
        fp_global_modifier: makeModifier(),
      };
    }
    // Migrate legacy numeric modifiers → PerClassModifier. Keeps older learned
    // bias alive by putting the stored scalar into `default`.
    const merged: PredictorWeights = {
      ...DEFAULT_WEIGHTS,
      ...(stored as unknown as Partial<PredictorWeights>),
      ss_pace_modifier: ensureModifier(stored.ss_pace_modifier),
      td_attempt_modifier: ensureModifier(stored.td_attempt_modifier),
      fp_global_modifier: ensureModifier(stored.fp_global_modifier),
    };
    // ── MODEL v13 one-time renormalisation ────────────────────────────────────
    // Until v12 the SS formula double-counted duration and ran hot, so the learning
    // cycle spent events pushing ss_pace_modifier DOWN to compensate — far enough
    // that lightHeavyweight pinned at the 0.70 clamp floor (saturated, i.e. it
    // wanted to go lower and couldn't). Those values are an artifact of the bug,
    // not learned signal: with the formula corrected they under-predict by 3-6 SS.
    // Rescale once so `default` returns to 1.0 (DEFAULT_WEIGHTS' intent), applying
    // the SAME factor to every class so the relative per-class learning survives.
    // Gated on its OWN marker — `version` is a learning-RUN counter (incremented
    // per cycle, 14 and climbing), so gating on it would both never fire and reset
    // the user's run count.
    if (!merged.ssPaceRenormalizedV13) {
      const anchor = merged.ss_pace_modifier.default;
      if (Number.isFinite(anchor) && anchor > 0 && Math.abs(anchor - 1) > 0.02) {
        const factor = 1 / anchor;
        for (const k of Object.keys(merged.ss_pace_modifier) as Array<keyof PerClassModifier>) {
          const v = merged.ss_pace_modifier[k];
          if (typeof v === 'number' && Number.isFinite(v)) merged.ss_pace_modifier[k] = v * factor;
        }
        clampModifier(merged.ss_pace_modifier, 0.7, 1.4);
      }
      merged.ssPaceRenormalizedV13 = true;
      await this.saveWeights(merged);
    }

    // MODEL v27 — same scar, this time on FP. 18 learning cycles spent damping an
    // over-predicting baseline into fp_global_modifier: every class landed under
    // 1.0 (default 0.892, lightweight 0.810, womenFlyweight 0.771 against a 0.75
    // clamp floor — saturating, exactly as lightHeavyweight did for SS). Those
    // values are the shape of the bug, not learned signal. Now that Step 2b
    // corrects the bias at its source and level-dependently, the flat damp is
    // double-correction and has to come off.
    //
    // Rescale once so `default` returns to 1.0, applying the SAME factor to every
    // class so relative per-class learning survives. Own marker, never `version`
    // — that is a learning-RUN counter.
    if (!merged.fpModRenormalizedV27) {
      const anchor = merged.fp_global_modifier.default;
      if (Number.isFinite(anchor) && anchor > 0 && Math.abs(anchor - 1) > 0.02) {
        const factor = 1 / anchor;
        for (const k of Object.keys(merged.fp_global_modifier) as Array<keyof PerClassModifier>) {
          const v = merged.fp_global_modifier[k];
          if (typeof v === 'number' && Number.isFinite(v)) merged.fp_global_modifier[k] = v * factor;
        }
        clampModifier(merged.fp_global_modifier, 0.75, 1.30);
      }
      merged.fpModRenormalizedV27 = true;
      await this.saveWeights(merged);
    }
    return merged;
  }

  static async saveWeights(w: PredictorWeights): Promise<void> {
    await chromeSet({ [WEIGHTS_KEY]: w });
  }

  static async getTrends(): Promise<FighterTrend[]> {
    const raw = await chromeGet<Record<string, unknown>>([TRENDS_KEY]);
    return Array.isArray(raw[TRENDS_KEY]) ? raw[TRENDS_KEY] as FighterTrend[] : [];
  }

  static async saveTrends(trends: FighterTrend[]): Promise<void> {
    // Prune to 200 most recently updated
    const sorted = [...trends].sort((a, b) => b.lastUpdated - a.lastUpdated).slice(0, 200);
    await chromeSet({ [TRENDS_KEY]: sorted });
  }

  static async getPredictions(): Promise<PredictionEvent[]> {
    const raw = await chromeGet<Record<string, unknown>>([PREDICTIONS_KEY]);
    const preds = Array.isArray(raw[PREDICTIONS_KEY]) ? raw[PREDICTIONS_KEY] as PredictionEvent[] : [];
    // Fix duplicated "vs" in event names (e.g. "UFC FN: A vs. B: A vs. B" → "UFC FN: A vs. B")
    for (const p of preds) {
      const m = p.event.match(/^(.+\bvs\.?\s+\S+)\s*:\s*\S+\s+vs\.?\s+\S+$/i);
      if (m) p.event = m[1];
    }
    return preds;
  }

  static async savePredictions(preds: PredictionEvent[]): Promise<void> {
    await chromeSet({ [PREDICTIONS_KEY]: preds.slice(-10) });
  }

  static async getLearningLog(): Promise<LearningResult[]> {
    const raw = await chromeGet<Record<string, unknown>>([LEARNING_LOG_KEY]);
    return Array.isArray(raw[LEARNING_LOG_KEY]) ? raw[LEARNING_LOG_KEY] as LearningResult[] : [];
  }

  // ── Find trend for a fighter ────────────────────────────────────────

  static findTrend(trends: FighterTrend[], fighter: string): FighterTrend | null {
    const key = normName(fighter);
    return trends.find(t => normName(t.fighter) === key) ?? null;
  }

  // ── Bookmaker prior from archived Betr FP lines ──────────────────────
  //
  // Past Betr fantasy lines for the same fighter are bookmaker-aggregated
  // information — they incorporate signals (camp news, weight cut rumors,
  // Vegas action) that the model can't see. Each individual line was set
  // for a specific opponent, so the noise is high — but the median across
  // many lines is a useful central-tendency estimate that regularizes
  // wild model predictions.
  //
  // Returns `{ median, sampleCount }` if ≥ MIN_BOOK_SAMPLES recent records
  // exist, else null. Recency window is 24 months — older lines reflect a
  // different version of the fighter.
  /**
   * MODEL v30 — how far a posted FANTASY-POINTS line sits above the outcome.
   *
   * Measured over 354 settled Pick6 FP props, recomputed from raw UFCStats with
   * the current scorer (the archived `result` values predate the 2026-08-16 fix
   * and grade ~4.4 points light on average, 12% of them by more than 5). The
   * posted line beat this model on accuracy — MAE 32.7 against 36.2 — but ran a
   * bias of -10.7, where the model's own bias was ~0.
   *
   * Walk-forward, training only on prior events, 308 props:
   *
   *   raw posted line        MAE 33.44   bias -10.98
   *   line + learned shift   MAE 32.66   bias  -1.00
   *
   * And the shift is not a fluke of one card: all twelve event-clusters between
   * April and August came in negative, -4.2 to -21.8, over-rate 38-48%.
   *
   * The mechanism is that fantasy points are dominated by the win bonus (30-90),
   * so clearing a line essentially means winning the fight. Split by outcome:
   * winners clear 81.7% of the time, losers 2.9%. A pick-em book setting the
   * line near the mean is therefore setting it well above the median outcome.
   *
   * Only rows settled AFTER the scorer fix are learned from; everything earlier
   * is graded against the wrong rulebook. Until enough of those accumulate the
   * estimate is shrunk toward the offline-measured value, so this starts correct
   * and gets more specific rather than starting noisy.
   */
  static computeMarketFpShift(
    archive: PropArchiveRecord[],
  ): { shift: number; sampleCount: number } {
    const MEASURED_DEFAULT = -11;
    const SHRINK_K = 80;
    const SCORER_FIX_TS = Date.parse('2026-08-16T00:00:00Z');
    const diffs: number[] = [];
    for (const r of archive) {
      if (r.propType !== 'Fantasy') continue;
      if (!r.platform || !FANTASY_SCORING_BOOKS.has(r.platform)) continue;
      const line = Number(r.line);
      const res = Number(r.result);
      if (!Number.isFinite(line) || !Number.isFinite(res) || line <= 0) continue;
      const ts = Date.parse(r.date);
      if (!Number.isFinite(ts) || ts < SCORER_FIX_TS) continue;
      diffs.push(res - line);
    }
    const n = diffs.length;
    const empirical = n > 0 ? diffs.reduce((a, x) => a + x, 0) / n : MEASURED_DEFAULT;
    const shift = (n * empirical + SHRINK_K * MEASURED_DEFAULT) / (n + SHRINK_K);
    return { shift, sampleCount: n };
  }

  /**
   * MODEL v31 — the model may disagree with the fair line, but only so far.
   *
   * v30 fixed WHERE the gap is measured from. This fixes HOW BIG the gap is
   * allowed to be, which turned out to be the larger error.
   *
   * Measured on 133 strict same-event joins of a stored prediction to a settled
   * outcome (8 cards, model versions 7-22), bucketed by the gap between the
   * model and the fair line:
   *
   *   gap        n    over%   MAE model   MAE fair line
   *   below 0    63    43%      36.7          32.1
   *   0..+15     36    33%      28.4          27.3
   *   +15..+30   15    47%      39.3          37.5
   *   +30 up     19    37%      48.8          32.7
   *
   * Two things to read there. The model is beaten by the bare line in every
   * bucket, and it is beaten WORST exactly where it disagrees most — a 48.8 MAE
   * against the line's 32.7 on the rows the board was presenting as its biggest
   * edges. And the over-rate never clears 50% in any bucket: across the 70 rows
   * where the model called OVER, the prop went over 26 times, 37%.
   *
   * So the distance between the model and the line is not signal. Capping it
   * improves accuracy monotonically (MAE 36.5 uncapped -> 33.0 at +/-15 -> 31.5
   * at zero), but a zero cap makes the board mute, so this keeps a +/-15 voice:
   * wide enough to be a real fantasy edge (a takedown is 5 points), narrow
   * enough that the +47s stop being manufactured.
   *
   * Symmetric on purpose. The model loses to the line on the under side too
   * (36.7 against 32.1), so there is no case for a one-sided cap.
   *
   * Caveat, stated because it is load-bearing: every stored prediction with a
   * settled result comes from MODEL v7-v22, the only versions old enough to have
   * been graded. The MAE ordering is consistent and large, but it has not been
   * confirmed on a v31 board, and cannot be until one settles.
   */
  static readonly FP_GAP_CAP = 15;

  static applyMarketAnchor(
    fantasy: StatPrediction,
    postedLine: number | null,
    shift: number,
  ): StatPrediction {
    if (postedLine == null || !Number.isFinite(postedLine) || !Number.isFinite(shift)) return fantasy;
    const fair = postedLine + shift;
    const cap = this.FP_GAP_CAP;
    const gap = fantasy.line - fair;
    if (Math.abs(gap) <= cap) return fantasy;
    const anchored = round1(clamp(fair + Math.sign(gap) * cap, 5, 250));
    return {
      ...fantasy,
      line: anchored,
      anchoredFrom: fantasy.line,
      reasons: [
        ...fantasy.reasons,
        `Anchored to market: model said ${fantasy.line.toFixed(1)}, ${Math.abs(gap).toFixed(1)} from the fair line ${fair.toFixed(1)} — capped at ${cap}`,
      ],
    };
  }

  static computeBookPriorFP(
    archive: PropArchiveRecord[],
    fighter: string,
  ): { median: number; sampleCount: number } | null {
    const MIN_BOOK_SAMPLES = 5;
    const RECENCY_DAYS = 730;
    const cutoff = Date.now() - RECENCY_DAYS * 86400 * 1000;
    const key = normName(fighter);

    const lines: number[] = [];
    for (const r of archive) {
      if (normName(r.fighter) !== key) continue;
      // MODEL v30: was `!== 'betr'`. The archive holds 29 Betr FP rows against 553
      // from Pick6, and measured against the ≥5-per-fighter threshold the Betr-only
      // filter qualified EXACTLY ZERO fighters — the feature has never once fired in
      // production. Pick6, Underdog and Betr all score fantasy points with the same
      // rulebook (see FANTASY_SCORING), so all three are the same quantity; only
      // PrizePicks, which is a different rulebook, has to stay out.
      if (!r.platform || !FANTASY_SCORING_BOOKS.has(r.platform)) continue;
      if (r.propType !== 'Fantasy' && r.propType !== 'FP') continue;
      const lineVal = Number(r.line);
      if (!Number.isFinite(lineVal) || lineVal <= 0) continue;
      const recordTs = Date.parse(r.date);
      if (Number.isFinite(recordTs) && recordTs < cutoff) continue;
      lines.push(lineVal);
    }
    if (lines.length < MIN_BOOK_SAMPLES) return null;

    lines.sort((a, b) => a - b);
    const median = lines.length % 2 === 0
      ? (lines[lines.length / 2 - 1] + lines[lines.length / 2]) / 2
      : lines[(lines.length - 1) / 2];
    return { median, sampleCount: lines.length };
  }

  // ── Expected fight duration model ────────────────────────────────────
  //
  // Returns the expected actual length of this fight in minutes, alongside
  // the fighter's own historical average for ratio scaling. Counting-stat
  // predictions (SS, TD, FP base) should scale by `expectedMin / avgHistMin`
  // — this is what fixes early-finish blowups like Davey Grant where the
  // career average is built from 15-min fights but the matchup is highly
  // finishable.
  //
  // P(finish) blends fighter's own finish rate with opponent's finish-loss
  // rate; either side can end the fight early. E[finishMinute] is the mean
  // total-fight-duration across the fighter's past finish wins (falls back
  // to ~7.5 min when sample is too thin).
  static estimateExpectedMinutes(
    fighterDB: FighterDB,
    opponentDB: FighterDB | null,
    scheduledRounds: number,
  ): { expectedMin: number; pFinish: number; avgHistMin: number; avgFinishMin: number } {
    const fighterFinishRate = fighterDB.finishRate ?? 0.45;

    let oppFinishLossRate = 0.45;
    if (opponentDB) {
      const oppLosses = opponentDB.history.filter(f => f.result === 'loss');
      const oppFinishLosses = oppLosses.filter(f => /KO|TKO|SUB/i.test(f.method || ''));
      oppFinishLossRate = oppLosses.length >= 2 ? oppFinishLosses.length / oppLosses.length : 0.45;
    }
    // Both fighters can end the fight; symmetric blend.
    const pFinish = clamp((fighterFinishRate + oppFinishLossRate) / 2, 0.10, 0.85);

    // E[finishMinute] from fighter's own finish wins (timeSecs is total fight duration).
    const finishWins = fighterDB.history.filter(f =>
      f.result === 'win' && /KO|TKO|SUB/i.test(f.method || '')
      && Number.isFinite(Number(f.timeSecs)) && Number(f.timeSecs) > 0,
    );
    const avgFinishMin = finishWins.length >= 2
      ? finishWins.reduce((s, f) => s + (Number(f.timeSecs) / 60), 0) / finishWins.length
      : 7.5;

    const fullLengthMin = scheduledRounds * 5;
    const expectedMin = pFinish * avgFinishMin + (1 - pFinish) * fullLengthMin;

    // Fighter's own historical avg fight duration — the denominator for ratio scaling.
    let avgHistMin = fighterDB.avgTimeMins ?? NaN;
    if (!Number.isFinite(avgHistMin) || avgHistMin < 1) {
      const valid = fighterDB.history.filter(f =>
        Number.isFinite(Number(f.timeSecs)) && Number(f.timeSecs) > 0,
      );
      avgHistMin = valid.length > 0
        ? valid.reduce((s, f) => s + Number(f.timeSecs) / 60, 0) / valid.length
        : (scheduledRounds === 5 ? 15 : 9); // league-typical fallback
    }

    return { expectedMin, pFinish, avgHistMin, avgFinishMin };
  }

  // ── SS Prediction ───────────────────────────────────────────────────

  static predictSS(
    fighterDB: FighterDB,
    opponentDB: FighterDB | null,
    scheduledRounds: number,
    weights: PredictorWeights,
    trend: FighterTrend | null,
    weightClass?: WeightClass | null,
    marketFtMin?: number | null,
    marketExpectedMin?: number | null,
  ): StatPrediction {
    const reasons: string[] = [];

    // ── MODEL v12: rate-based projection ──────────────────────────────────────
    // The old formula blended `avgSigStr` (a per-FIGHT total, deflated by the
    // fighter's own early finishes) with `sapm * 15` (already a per-15-MINUTE
    // rate), then multiplied the blend by `expectedMin / avgHistMin`. That applied
    // a duration multiplier to a term that was already duration-normalised, so a
    // finisher with a short average fight length got scaled 2-2.6x — Uros Medic
    // (22.3 avg SS, 3:59 avg fight, career max 69) projected 101.5 against a 29.5
    // opener, and the error correlated -0.50 with average fight length across the
    // slate. Everything is now a per-minute RATE and duration is applied ONCE.
    const { expectedMin: rawModelMin, pFinish, avgHistMin } = this.estimateExpectedMinutes(fighterDB, opponentDB, scheduledRounds);
    // MODEL v14: the career-based estimate systematically over-reads duration — it
    // weights the non-finish branch against `rounds × 5` with pFinish capped at 0.85,
    // so a fight the market prices as a near-certain early finish still carries a big
    // full-length component. Measured against the DK round-market read on the Ankalaev
    // slate: mean 11.16min career vs 9.66min market, i.e. the career figure runs ~15%
    // long. Correct it at source so every downstream branch is on the same scale —
    // without this, projections silently drop ~13% the moment DK opens its round
    // markets mid-fight-week, which is a data-availability artifact, not a real signal.
    const CAREER_MIN_DAMPING = 0.87;
    const modelMin = rawModelMin * CAREER_MIN_DAMPING;
    // Duration source, best first (MODEL v13):
    //  1. Market-DERIVED E[minutes] from DK's round ladder + Go-the-Distance. The
    //     career-rate estimate can't see that a fight is priced 64% to end inside
    //     7:30. Weighted 0.75 rather than 1.0 so a misparsed/stale market can't fully
    //     drive the projection — measured on the Ankalaev slate, 0.75 and 1.0 were
    //     within noise (MAE 7.9 vs 8.0) and 0.75 kept bias nearer zero.
    //  2. The pick-em fight-time line (a median, cruder but usually present earlier).
    //  3. Career-based estimate alone.
    const MARKET_MIN_WEIGHT = 0.75;
    const expectedMin = (marketExpectedMin != null && Number.isFinite(marketExpectedMin) && marketExpectedMin > 0)
      ? MARKET_MIN_WEIGHT * marketExpectedMin + (1 - MARKET_MIN_WEIGHT) * modelMin
      : (marketFtMin != null && Number.isFinite(marketFtMin) && marketFtMin > 0)
        ? 0.5 * modelMin + 0.5 * marketFtMin
        : modelMin;

    // Fighter's own output rate. NOTE the `> 0` guards: `??` does NOT fall through
    // on 0, and an unfetched fighter has slpm/avgSigStr of exactly 0 — which used
    // to yield fighterAvgSS = 0 and make the projection purely the opponent's
    // absorbed number (Rzepecki/Vagaev/Tuchalov were the slate's three biggest
    // under-predictions for exactly this reason).
    const histRate = (fighterDB.avgSigStr != null && fighterDB.avgSigStr > 0 && avgHistMin > 0)
      ? fighterDB.avgSigStr / avgHistMin
      : null;
    const rawRate = clamp(
      histRate ?? ((fighterDB.slpm ?? 0) > 0 ? (fighterDB.slpm as number) : LEAGUE_SS_RATE),
      SS_RATE_MIN, SS_RATE_MAX,
    );
    // ── MODEL v15: shrink the observed rate toward the league mean ─────────────
    // An observed SS/min is a NOISY estimate of a fighter's true rate, and extreme
    // observations carry the most noise — so they regress. Measured walk-forward over
    // 1,891 fights from 325 cached fighters (rate from prior fights only, projected
    // across the fight's ACTUAL duration so this isolates the rate, not the duration):
    //   prior rate   mean error (predicted - actual)
    //     0-3 SS/min      -6.83   <- LOW rates were UNDER-predicted
    //     3-4             -2.03
    //     4-5             +2.51
    //     5-6             +5.29
    //     6+             +17.45   <- HIGH rates badly OVER-predicted, 72% of the time
    // Regressing actual rate on prior rate gives slope 0.49 — about half of any
    // deviation from the league mean evaporates — and the slope rises with sample
    // size (0.28 at 3-5 prior fights, 0.70 at 8+), exactly as regression to the mean
    // predicts. Empirical-Bayes form is used rather than that raw linear fit, which
    // over-corrects the extreme low end (it wanted +134% on a 1.32 SS/min fighter
    // where the bucket evidence supports ~+11%). K is in "phantom minutes at league
    // average", fitted on the same set: it shrinks proportionally, cannot overshoot,
    // and handles sample size natively — a fighter with few logged minutes is pulled
    // harder than a veteran. Effect on bias: 6+ bucket +17.45 -> +4.96, 0-3 bucket
    // -6.83 -> +0.74. MAE gains only 3.6%, but the systematic tilt is what mattered:
    // the model was over-projecting precisely the fighters an OVER would be bet on.
    // ONE-SIDED on purpose. Splitting mean vs median vs trimmed mean per bucket shows
    // the two tails are not equally supported:
    //     6+ SS/min : mean +17.45, median +16.20, trimmed +18.08  <- robust, not outliers
    //     5-6       : mean  +5.29, median  +4.28, trimmed  +6.05  <- solid
    //     3-4       : mean  -2.03, median  +0.32, trimmed  -0.51  <- ~zero
    //     0-3       : mean  -6.83, median  -3.88, trimmed  -5.30  <- half the mean is skew
    // The over-prediction at high rates is consistent however it's measured. The
    // low-end under-prediction is materially weaker AND is contradicted by the live
    // market: shrinking Robert Valentin UP (1.30 -> 3.21 SS/min) moved a projection
    // that matched his posted line almost exactly (22.8 vs 21.5) out to 30.4. Claiming
    // the book is that wrong about a low-output fighter needs better evidence than an
    // outlier-skewed bucket mean, so only rates ABOVE the league mean are shrunk.
    const priorMinutes = (avgHistMin > 0 && histRate != null)
      ? avgHistMin * (fighterDB.history?.length ?? 0)
      : 0;
    const fighterRate = (priorMinutes > 0 && rawRate > SS_RATE_LEAGUE_MEAN)
      ? clamp(
          (rawRate * priorMinutes + SS_RATE_SHRINK_K * SS_RATE_LEAGUE_MEAN) / (priorMinutes + SS_RATE_SHRINK_K),
          SS_RATE_MIN, SS_RATE_MAX,
        )
      : rawRate;
    // Opponent's absorbed rate (SAPM is already per-minute — no ×15).
    const oppRate = clamp(
      (opponentDB && (opponentDB.sapm ?? 0) > 0) ? (opponentDB.sapm as number) : LEAGUE_SS_RATE,
      SS_RATE_MIN, SS_RATE_MAX,
    );
    // Show the shrink when it actually moved the number, so a projection that
    // disagrees with the raw career rate explains itself.
    reasons.push(Math.abs(fighterRate - rawRate) >= 0.15
      ? `Output ${fighterRate.toFixed(2)} SS/min (${rawRate.toFixed(2)} raw, regressed on ${priorMinutes.toFixed(0)}min)`
      : `Output ${fighterRate.toFixed(2)} SS/min`);
    if (opponentDB) reasons.push(`Opp absorbs ${oppRate.toFixed(2)} SS/min`);
    reasons.push(
      `Expected ${expectedMin.toFixed(1)}min (`
      + (marketExpectedMin != null && marketExpectedMin > 0
        ? `DK round market ${marketExpectedMin.toFixed(1)}min`
        : marketFtMin != null && marketFtMin > 0
          ? `market FT ${marketFtMin}, career P(fin) ${(pFinish * 100).toFixed(0)}%`
          : `career P(fin) ${(pFinish * 100).toFixed(0)}%`)
      + ')',
    );

    // Core formula — pace modifier is per-weight-class so flyweight error doesn't drift heavyweight calibration
    const ssMod = getMod(weights.ss_pace_modifier, weightClass);
    let predicted = ((fighterRate + oppRate) / 2) * expectedMin * ssMod;

    // Style adjustments
    if (fighterDB.style === 'striker') {
      predicted *= 1.08;
      reasons.push('Striker style (+8%)');
    }
    if (opponentDB?.style === 'grappler') {
      predicted *= 0.88;
      reasons.push('vs Grappler (-12%)');
    }

    // Apply learned trend
    if (trend && Math.abs(trend.ss_trend) > 0.5) {
      predicted += trend.ss_trend;
      reasons.push(`Trend adj: ${trend.ss_trend > 0 ? '+' : ''}${trend.ss_trend.toFixed(1)}`);
    }

    // Confidence
    const sampleSize = fighterDB.history.filter(f => f.sigStr != null).length;
    const confidence = clamp(
      40 + sampleSize * 3 + (fighterDB.fpConsistency ?? 50) * 0.15 + (opponentDB ? 10 : 0),
      25, 90,
    );

    const line = round1(clamp(predicted, 0.5, 200));
    // "over"/"under" here means: is this matchup projected ABOVE the fighter's own
    // historical per-fight norm? Derive the norm from the rate so a fighter with no
    // usable avgSigStr still gets a sane comparison instead of a divide-by-zero.
    const ownNorm = (fighterDB.avgSigStr != null && fighterDB.avgSigStr > 0)
      ? fighterDB.avgSigStr
      : fighterRate * (avgHistMin > 0 ? avgHistMin : expectedMin);
    const lean = predicted > ownNorm ? 'over' : 'under';

    return { line, lean, confidence: Math.round(confidence), reasons };
  }

  // ── TD Prediction ───────────────────────────────────────────────────

  static predictTD(
    fighterDB: FighterDB,
    opponentDB: FighterDB | null,
    scheduledRounds: number,
    weights: PredictorWeights,
    trend: FighterTrend | null,
    weightClass?: WeightClass | null,
  ): StatPrediction {
    const reasons: string[] = [];

    // Fighter's TD per fight from history
    const tdPerFight = fighterDB.avgTDperFight ?? 0;
    reasons.push(`Avg TD/fight: ${tdPerFight.toFixed(1)}`);

    // Opponent TD defense rate (0-1)
    const oppTdDef = opponentDB ? (opponentDB.tdDef ?? 50) / 100 : 0.5;
    if (opponentDB) reasons.push(`Opp TD Def: ${(oppTdDef * 100).toFixed(0)}%`);

    // Expected-duration scaling — same logic as predictSS. TDs are time-distributed,
    // so a finish-prone matchup truncates the TD count.
    const { expectedMin, avgHistMin } = this.estimateExpectedMinutes(fighterDB, opponentDB, scheduledRounds);
    const durationModifier = avgHistMin > 0 ? expectedMin / avgHistMin : (scheduledRounds / 3);
    if (scheduledRounds === 5) reasons.push('5-round fight');

    // Core formula: attempts * success rate adjusted for opponent — per-class TD modifier
    const tdMod = getMod(weights.td_attempt_modifier, weightClass);
    let predicted = tdPerFight * (1 - oppTdDef * 0.5) * durationModifier * tdMod;

    // Style adjustments
    if (fighterDB.style === 'grappler') {
      predicted *= 1.15;
      reasons.push('Grappler style (+15%)');
    }
    if (opponentDB?.style === 'striker') {
      predicted *= 1.05;
      reasons.push('vs Striker (+5% TD opp)');
    }

    // Apply learned trend
    if (trend && Math.abs(trend.td_trend) > 0.1) {
      predicted += trend.td_trend;
      reasons.push(`Trend adj: ${trend.td_trend > 0 ? '+' : ''}${trend.td_trend.toFixed(1)}`);
    }

    // Confidence — TD is harder to predict, lower base
    const sampleSize = fighterDB.history.filter(f => f.td != null).length;
    const confidence = clamp(
      30 + sampleSize * 3 + (opponentDB ? 10 : 0) + (tdPerFight > 1 ? 10 : 0),
      20, 85,
    );

    const line = round1(clamp(predicted, 0.5, 20));
    const lean = predicted > tdPerFight ? 'over' : 'under';

    return { line, lean, confidence: Math.round(confidence), reasons };
  }

  // ── Calculate Betr FP for a single historical fight ──────────────────

  private static calcBetrFP(f: { sigStr?: number|null; totStr?: number|null; ctrlSecs?: number|null; kd?: number|null; td?: number|null; rev?: number|null; result?: string|null; method?: string|null; round?: number|null; timeSecs?: number|null }): number | null {
    if (f.sigStr == null && f.totStr == null && f.kd == null && f.td == null && f.ctrlSecs == null) return null;
    const nonSig = Math.max(0, (f.totStr || 0) - (f.sigStr || 0));
    const won = f.result === 'win';
    let fp = (f.sigStr || 0) * FANTASY_SCORING.sigStrike
           + nonSig            * FANTASY_SCORING.nonSigStrike
           + (f.ctrlSecs || 0) * FANTASY_SCORING.controlTimePerSec
           + (f.kd  || 0)      * FANTASY_SCORING.knockdown
           + (f.td  || 0)      * FANTASY_SCORING.takedown
           + (f.rev || 0)      * FANTASY_SCORING.reversal;
    // Win bonus
    if (won) {
      const isDec = /DEC/i.test(f.method || '');
      if (isDec) { fp += FANTASY_SCORING.winBonus.decision; }
      else {
        const r = f.round || 3;
        if (r === 1) fp += FANTASY_SCORING.winBonus.round1;
        else if (r === 2) fp += FANTASY_SCORING.winBonus.round2;
        else if (r === 3) fp += FANTASY_SCORING.winBonus.round3;
        else fp += FANTASY_SCORING.winBonus.round4Plus;
        // Quick win bonus: R1 finish ≤60s
        if (r === 1 && (f.timeSecs || 9999) <= 60) fp += FANTASY_SCORING.quickWinBonus;
      }
    }
    return fp;
  }

  // ── Fantasy Prediction (Betr Scoring) ───────────────────────────────
  //
  // Strategy: Calculate what each historical fight scored under Betr rules,
  // use recency-weighted average as baseline, then adjust for opponent
  // matchup (defensive stats, finish susceptibility) and scheduled rounds.

  static predictFantasy(
    fighterDB: FighterDB,
    opponentDB: FighterDB | null,
    scheduledRounds: number,
    weights: PredictorWeights,
    trend: FighterTrend | null,
    ssLine: number,
    tdLine: number,
    weightClass?: WeightClass | null,
    bookPriorFP?: { median: number; sampleCount: number } | null,
  ): StatPrediction {
    const reasons: string[] = [];

    // ── Step 1: Compute per-fight Betr scores from raw history ──────
    const fightScores: { fp: number; isRecent: boolean; rounds: number; won: boolean; isFinish: boolean; round: number }[] = [];
    const history = fighterDB.history;
    for (let i = 0; i < history.length; i++) {
      const f = history[i];
      const betrFP = this.calcBetrFP(f);
      if (betrFP == null) continue;
      fightScores.push({
        fp: betrFP,
        isRecent: i < 3, // first 3 in history = most recent fights
        rounds: f.round || 3,
        won: f.result === 'win',
        isFinish: /KO|TKO|SUB/i.test(f.method || ''),
        round: f.round || 3,
      });
    }

    // ── Step 2: Recency-weighted average ────────────────────────────
    // Weights: most recent fight = 1.0, then 0.85, 0.72, 0.61, 0.52, etc.
    let baseline: number;
    let usedComponentEstimate = false;
    if (fightScores.length > 0) {
      let weightSum = 0;
      let fpSum = 0;
      for (let i = 0; i < fightScores.length; i++) {
        const w = Math.pow(0.85, i); // exponential decay
        fpSum += fightScores[i].fp * w;
        weightSum += w;
      }
      baseline = fpSum / weightSum;
      const plainAvg = fightScores.reduce((s, f) => s + f.fp, 0) / fightScores.length;
      reasons.push(`Betr avg: ${plainAvg.toFixed(1)} (${fightScores.length} fights)`);
      if (Math.abs(baseline - plainAvg) > 1) {
        reasons.push(`Recency-weighted: ${baseline.toFixed(1)}`);
      }
    } else if (fighterDB.avgFP_betr != null && fighterDB.avgFP_betr > 0) {
      baseline = fighterDB.avgFP_betr;
      reasons.push(`Betr platform avg: ${baseline.toFixed(1)}`);
    } else if (fighterDB.avgFP != null && fighterDB.avgFP > 0) {
      baseline = fighterDB.avgFP;
      reasons.push(`Career avg fallback: ${baseline.toFixed(1)}`);
    } else {
      // No history at all — build from predicted components as last resort
      baseline = ssLine * FANTASY_SCORING.sigStrike
               + ssLine * 0.3 * FANTASY_SCORING.nonSigStrike
               + tdLine * FANTASY_SCORING.takedown
               + FANTASY_SCORING.winBonus.decision * 0.5;
      usedComponentEstimate = true;
      reasons.push('No history — component estimate');
    }

    // ── Step 2b: Shrink toward the league mean (MODEL v27) ───────────
    // A recency-weighted average of past Betr scores badly over-states how much
    // of a fighter's level repeats. FP is dominated by win bonuses, which are
    // lumpy and largely non-repeatable: three straight R1 finishes build a ~130
    // baseline out of points that mostly will not recur. The walk-forward test
    // measures the surviving signal at 0.267 of the deviation from league mean.
    //
    // Paired with the fp_global_modifier renormalisation in getWeights(). They
    // ship together and must stay together: that modifier had been absorbing this
    // same bias as a flat per-class damp (every class under 1.0 after 18 cycles,
    // womenFlyweight pinned near the 0.75 floor). A flat multiplier is the wrong
    // instrument for a level-dependent bias — it drags the low end further down
    // when the data says it should come UP — and applying shrinkage on top of the
    // damp, without the renorm, would double-correct.
    // v28: applies to EVERY baseline, not just the fightScores branch. The
    // avgFP_betr / avgFP fallbacks are career averages too and regress the same way;
    // they were skipping the correction purely because of how the branch was written.
    // The component-estimate branch retains less, per FP_NO_HISTORY_RETENTION.
    {
      const retention = usedComponentEstimate ? FP_NO_HISTORY_RETENTION : FP_SHRINK_RETENTION;
      const shrunk = FP_LEAGUE_MEAN + retention * (baseline - FP_LEAGUE_MEAN);
      if (Math.abs(shrunk - baseline) > 1) {
        reasons.push(`Regression to mean: ${baseline.toFixed(1)}→${shrunk.toFixed(1)} (keeps ${(retention * 100).toFixed(0)}% of the gap to league ${FP_LEAGUE_MEAN}${usedComponentEstimate ? ', no history' : ''})`);
      }
      baseline = shrunk;
    }

    // ── Step 3: duration — REMOVED in MODEL v29 ──────────────────────
    // This scaled the counting-stat portion by expectedMin/avgHistMin, holding the
    // win-bonus portion flat. Walk-forward over 1,329 fights says the ratio carries
    // no usable information about FP, and that applying it actively hurts:
    //
    //   model                  MAE     bias
    //   no duration           35.77   -1.87   <- best of seven
    //   sqrt(ratio)           36.60   -1.13
    //   damped 0.5            36.68   -2.94
    //   capped 1.5            37.45   -0.82
    //   FULL RATIO (was live) 38.83   -4.01   <- worst of seven
    //
    //   ratio      n   meanActual  bias_none  bias_full
    //   0-0.8    468      68.8       -1.5      +17.8
    //   0.8-1.2  249      69.9       -1.0       -2.6
    //   1.2-1.6  318      66.8       -3.5      -15.7
    //   1.6-2.2  180      70.8       -1.8      -24.6
    //   2.2+     114      72.9       -0.9      -31.6
    //
    // bias_none is flat across every bucket, and meanActual barely moves with the
    // ratio (68.8 / 69.9 / 66.8 / 70.8 / 72.9) — duration simply does not predict
    // the LEVEL of a fantasy score. bias_full is wrong at both ends, so the step was
    // not mis-tuned, it was injecting noise. Tuning variants were measured and all
    // lost to removal; none is kept.
    //
    // The mechanism is one this project already knew: FP is FINISH-weighted. A longer
    // fight means more strikes but a less likely finish bonus; a shorter fight means
    // fewer strikes but a likelier one, and the two offset. Applying SS-style
    // duration coupling to FP is exactly what the finish-weighted note warns against.
    //
    // estimateExpectedMinutes is still called — predictSS and predictTD both use it,
    // and pFinish is reported below because it is genuinely informative about SHAPE
    // even though it does not move the level.
    const { pFinish, avgFinishMin } =
      this.estimateExpectedMinutes(fighterDB, opponentDB, scheduledRounds);
        if (pFinish > 0.6) {
      reasons.push(`High P(finish) ${(pFinish * 100).toFixed(0)}% (E[finish] ${avgFinishMin.toFixed(1)}min)`);
    }

    // ── Step 4: Opponent matchup adjustments ────────────────────────
    let oppMultiplier = 1.0;
    const oppReasons: string[] = [];

    if (opponentDB) {
      // 4a. Striking absorption — opponent's SAPM vs league average (~3.5)
      //     High SAPM = opponent gets hit a lot = more striking FP for our fighter
      const oppSAPM = opponentDB.sapm ?? 3.5;
      const sapmDelta = (oppSAPM - 3.5) / 3.5; // e.g. SAPM=5 → +43%, SAPM=2 → -43%
      const strikingAdj = 1 + sapmDelta * 0.15; // dampen: ±6% per unit
      if (Math.abs(sapmDelta) > 0.1) {
        oppReasons.push(`Opp absorbs ${oppSAPM.toFixed(1)} S/min (${sapmDelta > 0 ? '+' : ''}${(sapmDelta * 15).toFixed(0)}%)`);
      }

      // 4b. Opponent striking defense — high strDef = harder to land
      const oppStrDef = opponentDB.strDef ?? 55;
      const strDefDelta = (55 - oppStrDef) / 100; // Below 55% = easier target
      const strDefAdj = 1 + strDefDelta * 0.20;
      if (Math.abs(strDefDelta) > 0.05) {
        oppReasons.push(`Opp str def ${oppStrDef}%`);
      }

      // 4c. Opponent TD defense — affects grappling scoring
      const oppTdDef = opponentDB.tdDef ?? 55;
      const tdDefDelta = (55 - oppTdDef) / 100;
      // Only applies to the grappling portion — estimate ~20% of FP from grappling
      const tdAdj = 1 + tdDefDelta * 0.08;
      if (Math.abs(tdDefDelta) > 0.05) {
        oppReasons.push(`Opp TD def ${oppTdDef}%`);
      }

      // 4d. Opponent finish susceptibility — affects win bonus expectation
      //     Look at opponent's loss history for KO/TKO/SUB losses
      const oppLosses = opponentDB.history.filter(f => f.result === 'loss');
      const oppFinishLosses = oppLosses.filter(f => /KO|TKO|SUB/i.test(f.method || ''));
      const oppFinishLossRate = oppLosses.length >= 2 ? oppFinishLosses.length / oppLosses.length : 0.45;
      // Compare to fighter's own finish rate
      const fighterFinishRate = fighterDB.finishRate ?? 0.45;
      // If fighter finishes often AND opponent gets finished often → boost win bonus
      const finishSynergyDelta = ((fighterFinishRate - 0.45) + (oppFinishLossRate - 0.45)) / 2;
      const finishAdj = 1 + finishSynergyDelta * 0.12;
      if (Math.abs(finishSynergyDelta) > 0.05) {
        oppReasons.push(`Finish synergy: ${fighterFinishRate > 0.5 ? 'finisher' : 'grinder'} vs ${oppFinishLossRate > 0.5 ? 'vulnerable' : 'durable'}`);
      }

      oppMultiplier = strikingAdj * strDefAdj * tdAdj * finishAdj;
      oppMultiplier = clamp(oppMultiplier, 0.78, 1.25); // cap total adjustment ±22%
    }

    let predicted = baseline * oppMultiplier;
    if (opponentDB && Math.abs(oppMultiplier - 1) > 0.01) {
      reasons.push(`Opp adj: ×${oppMultiplier.toFixed(2)} (${oppReasons.join('; ')})`);
    }

    // ── Step 5: Style matchup modifiers ─────────────────────────────
    if (fighterDB.style === 'grappler' && opponentDB?.style === 'grappler') {
      // Grappler vs grappler often neutralizes grappling → less ctrl time
      predicted *= 0.94;
      reasons.push('Grappler vs grappler (-6%)');
    }
    if (fighterDB.style === 'striker' && opponentDB?.style === 'striker') {
      // Striker vs striker = more action, more KD potential
      predicted *= 1.04;
      reasons.push('Striker vs striker (+4%)');
    }

    // ── Step 6: Apply learned trend ─────────────────────────────────
    if (trend && Math.abs(trend.fp_trend) > 1) {
      predicted += trend.fp_trend;
      reasons.push(`Trend: ${trend.fp_trend > 0 ? '+' : ''}${trend.fp_trend.toFixed(1)}`);
    }

    // ── Step 6b: Apply learned FP calibration modifier (per weight class) ───
    // This is the knob `runLearningCycle` turns to correct FP bias — per class so
    // heavyweight over-prediction doesn't drag flyweight calibration down.
    const fpMod = getMod(weights.fp_global_modifier, weightClass);
    if (Math.abs(fpMod - 1) > 0.005) {
      predicted *= fpMod;
      reasons.push(`FP cal (${weightClass ?? 'default'}): ×${fpMod.toFixed(3)}`);
    }

    // ── Step 6c: Blend bookmaker prior (median past Betr FP lines) ───
    // Bookmakers see signals the model doesn't (camp news, weight-cut chatter,
    // late action). When we have ≥5 recent (≤24mo) Betr FP lines for this
    // fighter, blend the median in as a 30% regularizer. This dampens wild
    // model predictions and brings projections closer to market consensus
    // when the fighter has a reasonable bookmaker history.
    if (bookPriorFP && bookPriorFP.sampleCount >= 5) {
      // Blend weight scales with sample size (5 → 0.20, 10 → 0.30, 20+ → 0.35).
      const blendW = clamp(0.10 + bookPriorFP.sampleCount * 0.02, 0.20, 0.35);
      const oldPredicted = predicted;
      predicted = (1 - blendW) * predicted + blendW * bookPriorFP.median;
      if (Math.abs(oldPredicted - predicted) > 1) {
        reasons.push(`Book prior: ${bookPriorFP.median.toFixed(1)} (n=${bookPriorFP.sampleCount}, w=${blendW.toFixed(2)}) → ${oldPredicted.toFixed(1)}→${predicted.toFixed(1)}`);
      }
    }

    // ── Step 7: Floor/ceiling sanity from history ────────────────────
    if (fighterDB.fpFloor != null && fighterDB.fpCeiling != null && fightScores.length >= 3) {
      // Don't predict outside reasonable range unless opponent adjustments push it
      const historicFloor = fighterDB.fpFloor * 0.85;
      const historicCeiling = fighterDB.fpCeiling * 1.1;
      if (predicted < historicFloor || predicted > historicCeiling) {
        const clamped = clamp(predicted, historicFloor, historicCeiling);
        reasons.push(`Clamped to historic range: ${historicFloor.toFixed(0)}-${historicCeiling.toFixed(0)}`);
        predicted = clamped;
      }
    }

    // ── Confidence ──────────────────────────────────────────────────
    const sampleSize = fightScores.length;
    const consistencyBonus = (fighterDB.fpConsistency ?? 50) * 0.25;
    const oppBonus = opponentDB ? 10 : 0;
    const recentBonus = sampleSize >= 3 ? 5 : 0;
    const confidence = clamp(
      30 + sampleSize * 4 + consistencyBonus + oppBonus + recentBonus,
      20, FP_CONFIDENCE_CEILING,
    );

    const historicalAvg = fighterDB.avgFP_betr ?? fighterDB.avgFP ?? predicted;
    const line = round1(clamp(predicted, 5, 250));
    const lean = predicted > historicalAvg ? 'over' : 'under';

    return { line, lean, confidence: Math.round(confidence), reasons, sampleSize: fightScores.length };
  }

  // ── Predict All Stats for a Fighter ─────────────────────────────────

  static predictFighter(
    fighter: string,
    opponent: string,
    fighterDB: FighterDB,
    opponentDB: FighterDB | null,
    scheduledRounds: number,
    weights: PredictorWeights,
    trend: FighterTrend | null,
    weightClass?: WeightClass | null,
    bookPriorFP?: { median: number; sampleCount: number } | null,
    marketFtMin?: number | null,
    marketExpectedMin?: number | null,
  ): PropPrediction {
    const ss = this.predictSS(fighterDB, opponentDB, scheduledRounds, weights, trend, weightClass, marketFtMin, marketExpectedMin);
    const td = this.predictTD(fighterDB, opponentDB, scheduledRounds, weights, trend, weightClass);
    const fantasy = this.predictFantasy(fighterDB, opponentDB, scheduledRounds, weights, trend, ss.line, td.line, weightClass, bookPriorFP);

    return { fighter, opponent, scheduledRounds, modelVersion: MODEL_VERSION, weightClass: weightClass ?? undefined, ss, td, fantasy };
  }

  // ── Learning Cycle ──────────────────────────────────────────────────

  /**
   * Median OPENING line across books for one fighter+prop, with the closing line as
   * fallback. This is the quantity the predictor is actually trying to forecast: the
   * number a book will POST, not the number the fighter will produce.
   *
   * Opening rather than closing on purpose — the predictor runs before books post, so
   * the opener is the like-for-like target. The close is a different (later, sharper)
   * question and only stands in when no opener was archived.
   */
  static marketLineFor(
    archiveRecords: PropArchiveRecord[],
    fighter: string,
    propTypes: string[],
  ): { line: number; kind: 'open' | 'close'; books: number } | null {
    const fkey = normName(fighter);
    const rows = archiveRecords.filter(r => normName(r.fighter) === fkey && propTypes.includes(String(r.propType)));
    if (!rows.length) return null;
    const med = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    const opens = rows.map(r => Number(r.openLine)).filter(v => Number.isFinite(v) && v > 0);
    if (opens.length) return { line: med(opens), kind: 'open', books: opens.length };
    const closes = rows.map(r => Number(r.line)).filter(v => Number.isFinite(v) && v > 0);
    if (closes.length) return { line: med(closes), kind: 'close', books: closes.length };
    return null;
  }

  /**
   * SUGGESTION 6 — score stored predictions against the number books ACTUALLY POSTED.
   *
   * The learning panel has always reported error against the fighter's realised stat,
   * which is a different and much noisier question: measured over 149 settled SS props,
   * the posted line sat 0.29 from the eventual result on average but with a mean
   * absolute error of 25.90. Predicting the outcome therefore carries ~26 points of
   * irreducible noise that books are not even attempting to price. This scores the
   * thing the predictor is for.
   *
   * Read-only and archive-driven: it needs no live card and no posted lines for the
   * upcoming event — every past event with archived open lines is a labelled row.
   * `vsResult` is reported alongside so the two targets can be compared directly.
   */
  static backtestVsPostedLines(
    predictionEvents: PredictionEvent[],
    archiveRecords: PropArchiveRecord[],
  ): PredictorLineBacktest {
    const PROPS: Array<{ stat: 'ss' | 'td' | 'fp'; label: string; types: string[] }> = [
      { stat: 'ss', label: 'SS', types: ['SS'] },
      { stat: 'td', label: 'TD', types: ['TD'] },
      { stat: 'fp', label: 'FP', types: ['Fantasy', 'FP', 'Fantasy_PP'] },
    ];
    const mkCell = (): BacktestCell => ({ n: 0, absSum: 0, sgnSum: 0, mae: 0, bias: 0 });
    const seal = (c: BacktestCell): BacktestCell => {
      c.mae = c.n ? c.absSum / c.n : NaN;
      c.bias = c.n ? c.sgnSum / c.n : NaN;
      return c;
    };
    const byStat: Record<string, BacktestCell> = {};
    const vsResult: Record<string, BacktestCell> = {};
    const byBook: Record<string, Record<string, BacktestCell>> = {};
    for (const p of PROPS) { byStat[p.label] = mkCell(); vsResult[p.label] = mkCell(); }

    let events = 0;
    for (const ev of predictionEvents) {
      // Only events whose props have actually been archived can be scored.
      const evRows = archiveRecords.filter(r => normName(String(r.event || '')).includes(normName(ev.event).slice(0, 20)));
      if (!evRows.length) continue;
      events++;
      for (const pred of ev.predictions) {
        for (const p of PROPS) {
          const predicted = p.stat === 'ss' ? pred.ss.line : p.stat === 'td' ? pred.td.line : pred.fantasy.line;
          if (!Number.isFinite(predicted)) continue;
          const fkey = normName(pred.fighter);
          const rows = evRows.filter(r => normName(r.fighter) === fkey && p.types.includes(String(r.propType)));
          if (!rows.length) continue;

          const mkt = this.marketLineFor(rows, pred.fighter, p.types);
          if (mkt) {
            const d = predicted - mkt.line;
            const c = byStat[p.label];
            c.n++; c.absSum += Math.abs(d); c.sgnSum += d;
            // Per BOOK: books disagree systematically, so one blended number cannot
            // match all four and the per-book split is what says which it is closest to.
            for (const r of rows) {
              const book = String(r.platform || '').toLowerCase();
              const bl = Number.isFinite(Number(r.openLine)) ? Number(r.openLine) : Number(r.line);
              if (!book || !Number.isFinite(bl) || bl <= 0) continue;
              byBook[book] = byBook[book] || {};
              byBook[book][p.label] = byBook[book][p.label] || mkCell();
              const bc = byBook[book][p.label];
              const bd = predicted - bl;
              bc.n++; bc.absSum += Math.abs(bd); bc.sgnSum += bd;
            }
          }
          // Contrast: the metric the panel reports today.
          const res = rows.map(r => Number(r.result)).find(v => Number.isFinite(v));
          if (res != null && Number.isFinite(res)) {
            const d = predicted - res;
            const c = vsResult[p.label];
            c.n++; c.absSum += Math.abs(d); c.sgnSum += d;
          }
        }
      }
    }
    for (const k of Object.keys(byStat)) { seal(byStat[k]); seal(vsResult[k]); }
    for (const b of Object.keys(byBook)) for (const k of Object.keys(byBook[b])) seal(byBook[b][k]);
    return { events, byStat, byBook, vsResult };
  }

  static async runLearningCycle(
    eventName: string,
    archiveRecords: PropArchiveRecord[],
  ): Promise<LearningResult | null> {
    const predictions = await this.getPredictions();
    // Match ALL unsettled entries for this event — duplicates can occur when
    // predictions were re-generated under slightly different event-name strings
    // or auto-corrected after the fact. Learn from the first, mark all settled
    // so the duplicates don't double-update weights on subsequent clicks.
    const eventMatches = predictions.filter(p =>
      !p.settled && normName(p.event).includes(normName(eventName).slice(0, 20))
    );
    const eventPred = eventMatches[0];
    if (!eventPred) return null;

    const weights = await this.getWeights();
    const trends = await this.getTrends();
    const results: LearningPredictionResult[] = [];

    // RLM-as-calibration: when the closing line moved meaningfully from open
    // on a prop, sharp action says the model was off by the RLM amount. Blend
    // the closing line into the truth target as a partial signal:
    //   effectiveActual = 0.7 × actual + 0.3 × closingLine  (only if |rlm| > threshold)
    // Trend EWMA + per-class weight updates use the resulting effectiveDelta.
    const RLM_FP = 5, RLM_SS = 3, RLM_TD = 0.5;
    const getMarketSignal = (fighter: string, propType: string): { closingLine: number; rlm: number } | null => {
      const fkey = normName(fighter);
      const matching = archiveRecords.filter(r =>
        normName(r.fighter) === fkey &&
        r.propType === propType &&
        Number.isFinite(Number(r.openLine)) &&
        Number.isFinite(Number(r.line))
      );
      if (matching.length === 0) return null;
      const closes = matching.map(r => Number(r.line)).sort((a, b) => a - b);
      const drifts = matching.map(r => Number(r.line) - Number(r.openLine)).sort((a, b) => a - b);
      return {
        closingLine: closes[Math.floor(closes.length / 2)],
        rlm: drifts[Math.floor(drifts.length / 2)],
      };
    };
    const blendActual = (raw: number, market: { closingLine: number; rlm: number } | null, threshold: number): number => {
      if (!Number.isFinite(raw) || !market || Math.abs(market.rlm) <= threshold) return raw;
      return 0.7 * raw + 0.3 * market.closingLine;
    };

    for (const pred of eventPred.predictions) {
      const key = normName(pred.fighter);

      // Find matching settled archive records
      const ssActual = archiveRecords.find(r =>
        normName(r.fighter) === key && r.propType === 'SS' && Number.isFinite(Number(r.result))
      );
      const tdActual = archiveRecords.find(r =>
        normName(r.fighter) === key && r.propType === 'TD' && Number.isFinite(Number(r.result))
      );
      const fpActual = archiveRecords.find(r =>
        normName(r.fighter) === key && (r.propType === 'Fantasy' || r.propType === 'FP') && Number.isFinite(Number(r.result))
      );

      const actual = {
        ss: ssActual ? Number(ssActual.result) : NaN,
        td: tdActual ? Number(tdActual.result) : NaN,
        fp: fpActual ? Number(fpActual.result) : NaN,
      };
      const predicted = { ss: pred.ss.line, td: pred.td.line, fp: pred.fantasy.line };
      const delta = {
        ss: actual.ss - predicted.ss,
        td: actual.td - predicted.td,
        fp: actual.fp - predicted.fp,
      };

      const ssMarket = getMarketSignal(pred.fighter, 'SS');
      const tdMarket = getMarketSignal(pred.fighter, 'TD');
      const fpMarket = getMarketSignal(pred.fighter, 'Fantasy');

      // ── MODEL v40: learn against the POSTED LINE, not the realised stat ────────
      // This predictor forecasts a LINE. It was being trained on `result` — the number
      // the fighter went on to produce — which is a different and far noisier target:
      // over 149 settled SS props the posted line sat 0.29 from the eventual result on
      // average, with a mean absolute error of 25.90. Training on the outcome spends the
      // whole gradient chasing ~26 points of variance no book is trying to price.
      //
      // The tuning notes above already give this away — v13 cites MAE 7.9, which is only
      // reachable against a LINE, never against a result that scatters by 26. The model
      // was tuned on one target and learned on the other; this reconciles them.
      //
      // Fallback chain per stat: median opening line -> median closing line (both from
      // marketLineFor) -> the old RLM-blended result -> the raw result. So a prop with no
      // archived line behaves exactly as it did before rather than dropping out.
      const targetFor = (
        stat: 'ss' | 'td' | 'fp',
        types: string[],
        rawActual: number,
        mkt: { closingLine: number; rlm: number } | null,
        rlmThreshold: number,
      ): { target: number; kind: string } => {
        const posted = this.marketLineFor(archiveRecords, pred.fighter, types);
        if (posted) return { target: posted.line, kind: posted.kind === 'open' ? 'line-open' : 'line-close' };
        const blended = blendActual(rawActual, mkt, rlmThreshold);
        return { target: blended, kind: blended === rawActual ? 'result' : 'result-rlm' };
      };
      const tSS = targetFor('ss', ['SS'], actual.ss, ssMarket, RLM_SS);
      const tTD = targetFor('td', ['TD'], actual.td, tdMarket, RLM_TD);
      const tFP = targetFor('fp', ['Fantasy', 'FP', 'Fantasy_PP'], actual.fp, fpMarket, RLM_FP);

      const marketTarget = { ss: tSS.target, td: tTD.target, fp: tFP.target };
      const targetKind = { ss: tSS.kind, td: tTD.kind, fp: tFP.kind };
      const effectiveDelta = {
        ss: tSS.target - predicted.ss,
        td: tTD.target - predicted.td,
        fp: tFP.target - predicted.fp,
      };

      results.push({ fighter: pred.fighter, weightClass: pred.weightClass, predicted, actual, delta, effectiveDelta, marketTarget, targetKind });

      // Update fighter trend with sample-count-adaptive learning rate.
      // α = clamp(1 / (n+2), 0.10, 0.50) where n is pre-update sampleCount.
      // First sample → α=0.50 (absorb half), n=3 → 0.20, n=8+ → 0.10 (stabilize).
      let fighterTrend = this.findTrend(trends, pred.fighter);
      if (!fighterTrend) {
        fighterTrend = { fighter: pred.fighter, ss_trend: 0, td_trend: 0, fp_trend: 0, sampleCount: 0, lastUpdated: 0 };
        trends.push(fighterTrend);
      }
      const alpha = clamp(1 / (fighterTrend.sampleCount + 2), 0.10, 0.50);
      if (Number.isFinite(effectiveDelta.ss)) fighterTrend.ss_trend = fighterTrend.ss_trend * (1 - alpha) + effectiveDelta.ss * alpha;
      if (Number.isFinite(effectiveDelta.td)) fighterTrend.td_trend = fighterTrend.td_trend * (1 - alpha) + effectiveDelta.td * alpha;
      if (Number.isFinite(effectiveDelta.fp)) fighterTrend.fp_trend = fighterTrend.fp_trend * (1 - alpha) + effectiveDelta.fp * alpha;
      fighterTrend.sampleCount++;
      fighterTrend.lastUpdated = Date.now();
    }

    // ── Per-class proportional weight updates ──────────────────────────
    // Each modifier (ss, td, fp) is now a PerClassModifier. We always update the
    // `default` bucket using all samples (so events with no class data still learn)
    // AND update each class-specific bucket that has ≥ MIN_CLASS_SAMPLES samples
    // this event. This means flyweight bias no longer leaks into heavyweight calibration.
    const weightAdj: Record<string, number> = {};

    const proportionalStep = (
      samples: LearningPredictionResult[],
      pickActual: (r: LearningPredictionResult) => number,
      pickDelta: (r: LearningPredictionResult) => number,
      minActual: number,
    ): number | null => {
      if (samples.length === 0) return null;
      const valid = samples.filter(r => Number.isFinite(pickDelta(r)));
      if (valid.length === 0) return null;
      const avgActual = valid.reduce((s, r) => s + pickActual(r), 0) / valid.length;
      if (avgActual < minActual) return null;
      const avgDelta = valid.reduce((s, r) => s + pickDelta(r), 0) / valid.length;
      const relErr = avgDelta / avgActual;
      return clamp(relErr * LEARNING_RATE, -MAX_STEP_PER_EVENT, MAX_STEP_PER_EVENT);
    };

    // Group results by weight class (undefined/unknown → 'default' bucket)
    const resultsByClass = new Map<WeightClass | 'default', LearningPredictionResult[]>();
    for (const r of results) {
      const key = (r.weightClass ?? 'default') as WeightClass | 'default';
      const bucket = resultsByClass.get(key) ?? [];
      bucket.push(r);
      resultsByClass.set(key, bucket);
    }

    type ModKey = 'ss_pace_modifier' | 'td_attempt_modifier' | 'fp_global_modifier';
    const statConfigs: Array<{
      mod: ModKey;
      label: string;
      pickActual: (r: LearningPredictionResult) => number;
      pickDelta: (r: LearningPredictionResult) => number;
      minActual: number;
    }> = [
      // MODEL v40: the denominator follows the numerator onto the LINE scale. relErr is
      // avgDelta/avgActual, so leaving `actual` here while effectiveDelta became a
      // line-delta would divide a line-scale error by a result-scale magnitude and
      // silently mis-size every weight step — most visibly on TD, where a result of 0
      // and a line of 0.5 are routine.
      { mod: 'ss_pace_modifier',   label: 'ss', pickActual: r => r.marketTarget?.ss ?? r.actual.ss, pickDelta: r => r.effectiveDelta?.ss ?? r.delta.ss, minActual: 1   },
      { mod: 'td_attempt_modifier',label: 'td', pickActual: r => r.marketTarget?.td ?? r.actual.td, pickDelta: r => r.effectiveDelta?.td ?? r.delta.td, minActual: 0.3 },
      { mod: 'fp_global_modifier', label: 'fp', pickActual: r => r.marketTarget?.fp ?? r.actual.fp, pickDelta: r => r.effectiveDelta?.fp ?? r.delta.fp, minActual: 5   },
    ];

    for (const cfg of statConfigs) {
      const map = weights[cfg.mod];

      // 1) Always update the `default` bucket using ALL samples — this is the fallback
      //    applied to classes we've never seen, and the most stable signal each event.
      const allStep = proportionalStep(results, cfg.pickActual, cfg.pickDelta, cfg.minActual);
      if (allStep != null) {
        const old = map.default;
        map.default = old * (1 + allStep);
        weightAdj[`${cfg.mod}.default`] = map.default - old;
      }

      // 2) Update each weight class that has enough samples to be trustworthy.
      //    Class-specific bucket is seeded from `default` (post-update) the first time
      //    we see that class, so it inherits accumulated bias rather than starting at 1.0.
      for (const [wc, bucket] of resultsByClass) {
        if (wc === 'default') continue;
        const valid = bucket.filter(r => Number.isFinite(cfg.pickDelta(r)));
        if (valid.length < MIN_CLASS_SAMPLES) continue;
        const step = proportionalStep(valid, cfg.pickActual, cfg.pickDelta, cfg.minActual);
        if (step == null) continue;
        const old = typeof map[wc] === 'number' ? (map[wc] as number) : map.default;
        const next = old * (1 + step);
        map[wc] = next;
        weightAdj[`${cfg.mod}.${wc}`] = next - old;
      }
    }

    // Clamp every bucket to sane ranges
    clampModifier(weights.ss_pace_modifier, 0.7, 1.4);
    clampModifier(weights.td_attempt_modifier, 0.5, 1.6);
    clampModifier(weights.fp_global_modifier, 0.75, 1.30);
    weights.version++;

    // Persist
    await this.saveWeights(weights);
    await this.saveTrends(trends);

    // Build summary
    const allDeltas = results.filter(r => Number.isFinite(r.delta.ss) || Number.isFinite(r.delta.fp));
    const bestIdx = allDeltas.reduce((best, r, i) => {
      const score = Math.abs(r.delta.ss || 0) + Math.abs(r.delta.td || 0) + Math.abs(r.delta.fp || 0);
      const bestScore = Math.abs(allDeltas[best].delta.ss || 0) + Math.abs(allDeltas[best].delta.td || 0) + Math.abs(allDeltas[best].delta.fp || 0);
      return score < bestScore ? i : best;
    }, 0);
    const worstIdx = allDeltas.reduce((worst, r, i) => {
      const score = Math.abs(r.delta.ss || 0) + Math.abs(r.delta.td || 0) + Math.abs(r.delta.fp || 0);
      const worstScore = Math.abs(allDeltas[worst].delta.ss || 0) + Math.abs(allDeltas[worst].delta.td || 0) + Math.abs(allDeltas[worst].delta.fp || 0);
      return score > worstScore ? i : worst;
    }, 0);

    const meanAbs = (arr: LearningPredictionResult[], pick: (r: LearningPredictionResult) => number): number => {
      const valid = arr.filter(r => Number.isFinite(pick(r)));
      if (!valid.length) return 0;
      return valid.reduce((s, r) => s + Math.abs(pick(r)), 0) / valid.length;
    };
    const summary: LearningSummary = {
      avgAbsDeltaSS: meanAbs(results, r => r.delta.ss),
      avgAbsDeltaTD: meanAbs(results, r => r.delta.td),
      avgAbsDeltaFP: meanAbs(results, r => r.delta.fp),
      bestPrediction: allDeltas[bestIdx]?.fighter ?? '—',
      worstPrediction: allDeltas[worstIdx]?.fighter ?? '—',
      weightAdjustments: weightAdj,
      trendUpdates: results.filter(r => Number.isFinite(r.delta.ss) || Number.isFinite(r.delta.td) || Number.isFinite(r.delta.fp)).length,
    };

    const learningResult: LearningResult = {
      event: eventName,
      date: new Date().toISOString(),
      learnedAt: Date.now(),
      predictions: results,
      summary,
    };

    // Append to log
    const log = await this.getLearningLog();
    log.push(learningResult);
    await chromeSet({ [LEARNING_LOG_KEY]: log.slice(-20) });

    // Mark settled — all duplicate entries, not just the one we learned from
    for (const p of eventMatches) p.settled = true;
    await this.savePredictions(predictions);

    return learningResult;
  }
}
