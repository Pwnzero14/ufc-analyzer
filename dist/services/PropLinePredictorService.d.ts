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
    static predictSS(fighterDB: FighterDB, opponentDB: FighterDB | null, scheduledRounds: number, weights: PredictorWeights, trend: FighterTrend | null, weightClass?: WeightClass | null): StatPrediction;
    static predictTD(fighterDB: FighterDB, opponentDB: FighterDB | null, scheduledRounds: number, weights: PredictorWeights, trend: FighterTrend | null, weightClass?: WeightClass | null): StatPrediction;
    private static calcBetrFP;
    static predictFantasy(fighterDB: FighterDB, opponentDB: FighterDB | null, scheduledRounds: number, weights: PredictorWeights, trend: FighterTrend | null, ssLine: number, tdLine: number, weightClass?: WeightClass | null, bookPriorFP?: {
        median: number;
        sampleCount: number;
    } | null): StatPrediction;
    static predictFighter(fighter: string, opponent: string, fighterDB: FighterDB, opponentDB: FighterDB | null, scheduledRounds: number, weights: PredictorWeights, trend: FighterTrend | null, weightClass?: WeightClass | null, bookPriorFP?: {
        median: number;
        sampleCount: number;
    } | null): PropPrediction;
    static runLearningCycle(eventName: string, archiveRecords: PropArchiveRecord[]): Promise<LearningResult | null>;
}
//# sourceMappingURL=PropLinePredictorService.d.ts.map