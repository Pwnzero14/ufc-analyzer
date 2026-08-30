import type { FighterDB, FighterTrend, LearningResult, PredictionEvent, PredictorWeights, PropArchiveRecord, PredictorLineBacktest, BookCalibration, PropPrediction, StatPrediction, WeightClass } from '../types/index.js';
export declare class PropLinePredictorService {
    static getWeights(): Promise<PredictorWeights>;
    static saveWeights(w: PredictorWeights): Promise<void>;
    static getTrends(): Promise<FighterTrend[]>;
    static saveTrends(trends: FighterTrend[]): Promise<void>;
    static getPredictions(): Promise<PredictionEvent[]>;
    static savePredictions(preds: PredictionEvent[]): Promise<void>;
    static getLearningLog(): Promise<LearningResult[]>;
    static findTrend(trends: FighterTrend[], fighter: string): FighterTrend | null;
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
    static computeMarketFpShift(archive: PropArchiveRecord[]): {
        shift: number;
        sampleCount: number;
    };
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
    static applyMarketAnchor(fantasy: StatPrediction, postedLine: number | null, shift: number): StatPrediction;
    static computeBookPriorFP(archive: PropArchiveRecord[], fighter: string): {
        median: number;
        sampleCount: number;
    } | null;
    static estimateExpectedMinutes(fighterDB: FighterDB, opponentDB: FighterDB | null, scheduledRounds: number): {
        expectedMin: number;
        pFinish: number;
        avgHistMin: number;
        avgFinishMin: number;
    };
    static predictSS(fighterDB: FighterDB, opponentDB: FighterDB | null, scheduledRounds: number, weights: PredictorWeights, trend: FighterTrend | null, weightClass?: WeightClass | null, marketFtMin?: number | null, marketExpectedMin?: number | null): StatPrediction;
    /**
     * MODEL v42 — round-1 significant strikes.
     *
     * R1 is structurally EASIER than full-fight SS and deliberately does not reuse
     * predictSS's machinery: round one is a fixed five minutes, so there is no duration
     * multiplier to get wrong — the whole v12 "rate × expected minutes" apparatus, and
     * the v14/v15 corrections that had to be bolted onto it, simply do not apply. The
     * only duration term is early-finish risk INSIDE round one.
     *
     * Constants are fitted, not chosen. Walk-forward over 3,104 samples from 478 cached
     * fighters (baseline rebuilt from PRIOR fights only, compared to that fight's actual
     * R1 SS) shows the same regression to the mean the full-fight rate has:
     *     prior  0-8   n=111  mean err -8.25   <- LOW priors UNDER-predicted
     *     prior  8-13  n=631  mean err -2.61
     *     prior 13-18  n=986  mean err -0.55
     *     prior 18-24  n=950  mean err +1.28
     *     prior 24+    n=426  mean err +8.87   <- HIGH priors OVER-predicted
     * A 17-point tilt across the range. Empirical-Bayes shrinkage toward the measured
     * league mean flattens every bucket to within ±1.02 and takes MAE 9.47 -> 9.01. As
     * with v15 the MAE gain is small; removing the systematic tilt is the point, because
     * the tilt sits exactly where an OVER would be bet.
     */
    static predictSSR1(fighterDB: FighterDB, opponentDB: FighterDB | null, scheduledRounds: number, weights: PredictorWeights, trend: FighterTrend | null, weightClass?: WeightClass | null, marketExpectedMin?: number | null): StatPrediction;
    static predictTD(fighterDB: FighterDB, opponentDB: FighterDB | null, scheduledRounds: number, weights: PredictorWeights, trend: FighterTrend | null, weightClass?: WeightClass | null): StatPrediction;
    private static calcBetrFP;
    static predictFantasy(fighterDB: FighterDB, opponentDB: FighterDB | null, scheduledRounds: number, weights: PredictorWeights, trend: FighterTrend | null, ssLine: number, tdLine: number, weightClass?: WeightClass | null, bookPriorFP?: {
        median: number;
        sampleCount: number;
    } | null): StatPrediction;
    static predictFighter(fighter: string, opponent: string, fighterDB: FighterDB, opponentDB: FighterDB | null, scheduledRounds: number, weights: PredictorWeights, trend: FighterTrend | null, weightClass?: WeightClass | null, bookPriorFP?: {
        median: number;
        sampleCount: number;
    } | null, marketFtMin?: number | null, marketExpectedMin?: number | null): PropPrediction;
    /**
     * Median OPENING line across books for one fighter+prop, with the closing line as
     * fallback. This is the quantity the predictor is actually trying to forecast: the
     * number a book will POST, not the number the fighter will produce.
     *
     * Opening rather than closing on purpose — the predictor runs before books post, so
     * the opener is the like-for-like target. The close is a different (later, sharper)
     * question and only stands in when no opener was archived.
     */
    static marketLineFor(archiveRecords: PropArchiveRecord[], fighter: string, propTypes: string[]): {
        line: number;
        kind: 'open' | 'close';
        books: number;
    } | null;
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
    static backtestVsPostedLines(predictionEvents: PredictionEvent[], archiveRecords: PropArchiveRecord[]): PredictorLineBacktest;
    /**
     * SUGGESTIONS 3 + 5 — where books actually put their numbers.
     *
     * Two separate facts, measured from the archive rather than assumed, because both
     * turned out to be things I would have got wrong by eye:
     *
     *  GRID (5). Every book posts SS, TD and R1 SS on a .50 grid — but FANTASY is
     *  book-specific: Betr and Pick6 use .50, Underdog uses .99 (366/366 rows) and
     *  PrizePicks uses .55 (100%). A prediction of 63.7 is not postable anywhere; the
     *  same number rounds to 63.5, 63.99 or 63.55 depending on who is pricing it.
     *
     *  OFFSET (3). Books disagree with the model by a CONSTANT per stat, which is the
     *  correctable half of the error — MAE spread is not. Measured over 10 events:
     *  FP ran 7.8 BELOW the books, SS 4.1 ABOVE, TD flat.
     *
     * Both are recomputed from the archive on every call rather than frozen as
     * constants. That matters: MODEL v40 now trains against the line too, so the true
     * bias shrinks event over event and this layer must shrink with it or it would
     * over-correct. A stored constant would fight the learner.
     *
     * PrizePicks Fantasy is deliberately NOT special-cased. Its +19.2 offset is a
     * different scoring basis (`Fantasy_PP`), and a per-book offset absorbs that on its
     * own — the same reason v33 excludes PP from FP best-line comparisons.
     */
    static bookCalibration(predictionEvents: PredictionEvent[], archiveRecords: PropArchiveRecord[]): BookCalibration;
    /** Snap to the nearest postable value on `frac`'s grid (63.7 -> 63.5 / 63.99 / 63.55). */
    static snapToGrid(value: number, frac: number): number;
    /**
     * The line THIS book is expected to post. Applies that book's measured offset when
     * there is enough of it, else the all-book offset, then snaps to that book's grid.
     */
    static expectedLineAtBook(predicted: number, statLabel: string, propType: string, book: string, cal: BookCalibration): number | null;
    /**
     * Calibrate a whole prediction toward what books will post: de-bias on the
     * shared-scoring consensus, then snap to the .5 grid that SS/TD use and that every
     * book except Underdog/PrizePicks uses for FP.
     *
     * The headline number stays one number — per-book variants come from
     * expectedLineAtBook — so this uses the ALL-BOOK offset rather than any single
     * book's, and PrizePicks' scoring-basis gap cannot drag the headline with it.
     */
    static calibrateToBooks(pred: PropPrediction, cal: BookCalibration): PropPrediction;
    static runLearningCycle(eventName: string, archiveRecords: PropArchiveRecord[]): Promise<LearningResult | null>;
}
//# sourceMappingURL=PropLinePredictorService.d.ts.map