import type { FighterDB, FighterTrend, LearningResult, PredictionEvent, PredictorWeights, PropArchiveRecord, PropPrediction, StatPrediction, WeightClass } from '../types/index.js';
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
    static runLearningCycle(eventName: string, archiveRecords: PropArchiveRecord[]): Promise<LearningResult | null>;
}
//# sourceMappingURL=PropLinePredictorService.d.ts.map